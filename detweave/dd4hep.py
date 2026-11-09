"""Export a validated, translation-only DetWeave model to DD4hep compact + plugin."""
from __future__ import annotations

import json
import xml.etree.ElementTree as ET


def _num(x):
    return format(float(x), '.17g')


def _cppstr(s):
    return json.dumps(s, ensure_ascii=True)


def export_dd4hep(model, instances, materials_xml: str) -> dict[str, str]:
    """Return files; caller must validate the model and provide common materials.

    Each physical instance has its own logical volume, preserving nested placements.
    DD4hep needs a vacuum material even when no instance uses it.
    """
    materials = ET.fromstring(materials_xml)
    if materials.tag != 'materials':
        raise ValueError('Expected a GDML-style <materials> element')
    names = {e.get('name') for e in materials if e.tag == 'material'}
    needed = {model['world']['material'], 'G4_Galactic'} | {i['material'] for i in instances}
    if needed - names:
        raise ValueError('Missing DD4hep materials: ' + ', '.join(sorted(needed - names)))

    # DD4hep's compact material converter uses fractions/composites, unlike
    # GDML's elemental <material Z=...><atom .../> form. Convert that form
    # to an explicit element referenced at mass fraction one.
    for material in list(materials.findall('material')):
        atom = material.find('atom')
        if atom is not None:
            if material.get('Z') is None:
                raise ValueError('Elemental material has no Z: ' + material.get('name', ''))
            ename = 'Element_' + material.get('name')
            element = ET.Element('element', name=ename, formula=material.get('name').removeprefix('G4_'), Z=material.get('Z'))
            element.append(atom)
            material.remove(atom)
            ET.SubElement(material, 'fraction', n='1', ref=ename)
            materials.insert(0, element)
    # Namespacing prevents ROOT's preloaded elements/isotopes from silently
    # replacing the NIST definitions. ROOT 6.30's TGeoMixture also checks Z
    # against the number of registered elements, not the largest atomic number.
    # Register unused placeholders so sparse isotope catalogs satisfy that check.
    atomic_numbers = [int(e.get('Z')) for e in materials
                      if e.tag in ('isotope', 'element') and e.get('Z')]
    max_z = max(atomic_numbers, default=1)
    if max_z > 118:
        raise ValueError('Atomic number exceeds the supported periodic table')
    names = {e.get('name') for e in materials if e.tag in ('isotope', 'element')}
    for e in materials:
        if e.tag in ('isotope', 'element'):
            if e.tag == 'element' and not e.get('formula'):
                e.set('formula', e.get('name'))
            e.set('name', 'DetWeave_' + e.get('name'))
        for child in e:
            if child.get('ref') in names:
                child.set('ref', 'DetWeave_' + child.get('ref'))
    for i in range(max_z + 1):
        name = f'DetWeave_unused_table_entry_{i}'
        if name in {'DetWeave_' + n for n in names}:
            raise ValueError('Material element name conflicts with internal table entries')
        dummy = ET.SubElement(materials, 'element', name=name, formula=name, Z='1')
        ET.SubElement(dummy, 'atom', value='1.00794', unit='g/mole')
    ET.indent(materials, space='  ')
    material_file = '<?xml version="1.0" encoding="UTF-8"?>\n' + ET.tostring(materials, encoding='unicode') + '\n'
    root = ET.Element('lccdd')
    ET.SubElement(root, 'info', name='DetWeave', title=model['title'], author='DetWeave', version='0.1', status='generated')
    define = ET.SubElement(root, 'define')
    for axis, size in zip('xyz', model['world']['size_mm']):
        ET.SubElement(define, 'constant', name='world_' + axis, value=f'{_num(size / 2)}*mm')
    ET.SubElement(define, 'constant', name='Air', value=model['world']['material'], type='string')
    ET.SubElement(define, 'constant', name='Vacuum', value='G4_Galactic', type='string')
    includes = ET.SubElement(root, 'includes')
    ET.SubElement(includes, 'gdmlFile', ref='materials.xml')
    ET.SubElement(root, 'world', material=model['world']['material'])
    detectors = ET.SubElement(root, 'detectors')
    ET.SubElement(detectors, 'detector', id='1', name='DetWeave', type='DetWeaveGeometry')
    ET.indent(root, space='  ')
    compact = '<?xml version="1.0" encoding="UTF-8"?>\n' + ET.tostring(root, encoding='unicode') + '\n'

    lines = ['#include "DD4hep/DetFactoryHelper.h"', '', 'using namespace dd4hep;', '',
             'static Ref_t create_detector(Detector& detector, xml_h element, SensitiveDetector) {',
             '  xml_det_t x_det(element);', '  DetElement result(x_det.nameStr(), x_det.id());',
             '  Assembly assembly("DetWeaveAssembly");']
    # Public export callers need not pre-sort. Reject malformed graphs explicitly.
    pending = list(instances)
    ids = [inst['id'] for inst in pending]
    if len(ids) != len(set(ids)) or 'world' in ids:
        raise ValueError('DD4hep instances require unique non-world identifiers')
    ordered, placed = [], {'world'}
    while pending:
        ready = [inst for inst in pending if inst['parent'] in placed]
        if not ready:
            raise ValueError('DD4hep instance hierarchy has a cycle or unknown parent')
        for inst in ready:
            ordered.append(inst)
            placed.add(inst['id'])
            pending.remove(inst)
    index = {}
    for n, inst in enumerate(ordered):
        index[inst['id']] = n
        shape = inst['shape']
        if shape['type'] == 'box':
            args = ', '.join(_num(v / 2) + '*mm' for v in shape['size_mm'])
            solid = 'Box(' + args + ')'
        else:
            solid = 'Tube(' + ', '.join(_num(v) + '*mm' for v in (shape['rmin_mm'], shape['rmax_mm'], shape['length_mm'] / 2)) + ')'
        name = _cppstr('DetWeave_' + inst['id'])
        lines.append(f'  Volume v{n}({name}, {solid}, detector.material({_cppstr(inst["material"])}));')
        parent = 'assembly' if inst['parent'] == 'world' else 'v' + str(index[inst['parent']])
        position = ', '.join(_num(v) + '*mm' for v in inst['position_mm'])
        lines.append(f'  {parent}.placeVolume(v{n}, {int(inst["copy_no"])}, Position({position}));')
    lines += ['  result.setPlacement(detector.worldVolume().placeVolume(assembly));', '  return result;', '}',
              'DECLARE_DETELEMENT(DetWeaveGeometry, create_detector)', '']
    cmake = '''cmake_minimum_required(VERSION 3.14)
project(DetWeaveDD4hep LANGUAGES CXX)
find_package(DD4hep REQUIRED)
include(${DD4hep_DIR}/cmake/DD4hep.cmake)
include(${DD4hep_DIR}/cmake/DD4hepBuild.cmake)
dd4hep_add_plugin(DetWeavePlugins SOURCES DetWeave.cpp USES DD4hep::DDCore ROOT::Core ROOT::Geom ROOT::GenVector)
'''
    readme = '''# DD4hep geometry

Requires a compatible DD4hep and ROOT installation with its environment set up.

```sh
cmake -S . -B build -DDD4hep_DIR="$DD4hepINSTALL/cmake"
cmake --build build
# Make the built plugin and its ROOT plugin map discoverable, e.g.:
export LD_LIBRARY_PATH="$PWD/build/lib:$PWD/build:$LD_LIBRARY_PATH"
export DYLD_LIBRARY_PATH="$PWD/build/lib:$PWD/build:$DYLD_LIBRARY_PATH"
geoPluginRun -input compact.xml
```

A zero-offset assembly contains world-level placements; nested placements retain their
local coordinates. Each instance has a separate logical volume and assigned copy number.
Lengths are mm in the input; DD4hep boxes and tubes take half-lengths. Materials are
explicitly defined in materials.xml; `G4_Galactic` is also used for DD4hep's required
framework vacuum. Unused table entries avoid ROOT 6.30 sparse-element lookup
limits; no material references them. DD4hep may not retain all GDML material
properties such as mean excitation energy; compare physics settings separately.
Export is not a substitute for loading or checking overlaps in your
DD4hep/Geant4 environment. Rotations and other shapes are not supported.
'''
    return {'dd4hep/compact.xml': compact, 'dd4hep/DetWeave.cpp': '\n'.join(lines),
            'dd4hep/CMakeLists.txt': cmake, 'dd4hep/README.md': readme,
            'dd4hep/materials.xml': material_file}
