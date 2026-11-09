import xml.etree.ElementTree as ET
from pathlib import Path

import pytest

from detweave.dd4hep import export_dd4hep
from detweave.model import expand


def test_dd4hep_geometry_and_materials():
    model = {
        'title': 'test & compare',
        'world': {'size_mm': [1000, 800, 600], 'material': 'G4_AIR'},
        'volumes': [
            {'id': 'shell', 'material': 'G4_Al', 'shape': {'type': 'box', 'size_mm': [100, 80, 60]}},
            {'id': 'core', 'material': 'G4_Si', 'shape': {'type': 'tube', 'rmin_mm': 1, 'rmax_mm': 10, 'length_mm': 20}},
        ],
        'placements': [
            {'id': 'inside', 'volume': 'core', 'parent': 'outer', 'position_mm': [0, 2, 3]},
            {'id': 'outer', 'volume': 'shell', 'parent': 'world', 'position_mm': [10, 0, 0]},
            {'id': 'other', 'volume': 'shell', 'parent': 'world', 'position_mm': [-100, 0, 0]},
        ],
    }
    material_xml = Path('detweave/materials.xml').read_text()
    files = export_dd4hep(model, expand(model), material_xml)
    compact = ET.fromstring(files['dd4hep/compact.xml'])
    assert compact.find("./define/constant[@name='world_x']").get('value') == '500*mm'
    assert compact.find('world').get('material') == 'G4_AIR'
    assert compact.find('./includes/gdmlFile').get('ref') == 'materials.xml'
    materials = ET.fromstring(files['dd4hep/materials.xml'])
    assert materials.find("./isotope[@name='DetWeave_Si28']") is not None
    silicon = materials.find("./element[@name='DetWeave_Si']")
    assert silicon.find('fraction').get('ref') == 'DetWeave_Si28'
    assert materials.find("./material[@name='G4_Si']/fraction").get('ref') == 'DetWeave_Si'
    pads = {e.get('name') for e in materials.findall('element')
            if e.get('name').startswith('DetWeave_unused_table_entry_')}
    assert len(pads) > 82
    assert all(e.get('ref') not in pads for e in materials.iter() if e.get('ref'))
    assert materials.find("./material[@name='G4_Al']/fraction").get('ref') == 'DetWeave_Element_G4_Al'
    assert materials.find("./element[@name='DetWeave_Element_G4_Al']/atom") is not None
    source = files['dd4hep/DetWeave.cpp']
    assert 'Box(50*mm, 40*mm, 30*mm)' in source
    assert 'Tube(1*mm, 10*mm, 10*mm)' in source
    assert 'v0.placeVolume(v2, 3, Position(0*mm, 2*mm, 3*mm))' in source
    assert source.count('detector.material("G4_Al")') == 2


def test_missing_framework_vacuum_is_rejected():
    model = {'title': 'x', 'world': {'size_mm': [1, 1, 1], 'material': 'A'}}
    with pytest.raises(ValueError, match='G4_Galactic'):
        export_dd4hep(model, [], '<materials><material name="A"/></materials>')
