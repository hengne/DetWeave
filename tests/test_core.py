import copy
import io
import json
import math
from pathlib import Path
import xml.etree.ElementTree as ET
import zipfile
import pytest
from detweave.model import validate, expand, contains, overlaps, evidence_paths, canonical
from detweave.exporters import project_zip, gdml, svg, MATERIALS, cpp_geometry

EXAMPLES=Path(__file__).parents[1]/'examples'
@pytest.fixture
def sample():return json.loads((EXAMPLES/'sampling.json').read_text())


def codes(model):return {x['code'] for x in validate(model)['issues']}


def test_sample_physical_positions_and_lengths(sample):
    report=validate(sample)
    assert report['ready'] and report['checks']['geant4']=='not_run'
    items=report['instances']
    assert len(items)==8 and len(sample['volumes'])==2
    assert sorted(p['global_mm'][2] for p in items)==[-5.5,-4,-2.5,-1,0.5,2,3.5,5]
    assert max(p['global_mm'][2]+p['shape']['size_mm'][2]/2 for p in items)==6
    assert min(p['global_mm'][2]-p['shape']['size_mm'][2]/2 for p in items)==-6


@pytest.mark.parametrize('file',['sampling.json','beamline.json'])
def test_fixtures_export_and_determinism(file):
    model=json.loads((EXAMPLES/file).read_text())
    assert validate(model)['ready']
    first=project_zip(model); assert first==project_zip(model)
    with zipfile.ZipFile(io.BytesIO(first)) as archive:
        names=archive.namelist()
        assert 'DetWeave/dd4hep/DetWeave.cpp' in names
        root=ET.fromstring(archive.read('DetWeave/geometry.gdml'))
        assert len(root.findall('.//physvol'))==len(expand(model))
        assert len(root.findall('.//materials/material'))==12
        manifest=json.loads(archive.read('DetWeave/manifest.json'))
        import hashlib
        for name,sha in manifest['sha256'].items():assert hashlib.sha256(archive.read('DetWeave/'+name)).hexdigest()==sha
        assert manifest['backend_runtime_checks']=='not_run'


@pytest.mark.parametrize('kind',['missing','assumed','unresolved','derived','bad_quote'])
def test_evidence_gates_export(sample,kind):
    key='world.size_mm'
    if kind=='missing':del sample['evidence'][key]
    elif kind=='bad_quote':sample['evidence'][key]['quote']='not present in source'
    else:sample['evidence'][key]['status']=kind
    assert not validate(sample)['ready']
    with pytest.raises(ValueError):project_zip(sample)


def test_confirmed_is_still_required_to_have_source(sample):
    sample['evidence']['world.size_mm'].update(status='confirmed',quote='')
    assert 'source_mismatch' in codes(sample)


def test_clarification_conflict_blocks(sample):
    sample['questions']=[dict(id='thickness',question='20 × (1+5) mm is 120 mm, above the stated 100 mm limit. Which requirement should change?',targets=['placements'])]
    assert 'clarification' in codes(sample)
    assert not validate(sample)['ready']


def test_touching_valid_overlap_invalid(sample):
    sample['placements'][1]['position_mm'][2]-=0.1
    assert 'overlap' in codes(sample)


def test_world_containment(sample):
    sample['world']['size_mm'][0]=79
    assert 'outside_parent' in codes(sample)


@pytest.mark.parametrize('value',[0,-1,float('inf'),float('nan')])
def test_invalid_dimension(sample,value):
    sample['volumes'][0]['shape']['size_mm'][0]=value
    assert not validate(sample)['ready']


def test_cyclic_unknown_duplicate_reserved(sample):
    sample['placements'][0]['parent']='absent';assert 'reference' in codes(sample)
    sample['placements'][0]['parent']='sensor';sample['placements'][1]['parent']='absorber'
    for p in sample['placements']:p.pop('repeat')
    assert 'hierarchy' in codes(sample)
    sample['placements'][1]['id']='absorber';assert 'identifier' in codes(sample)
    sample['placements'][0]['id']='world';assert 'identifier' in codes(sample)


def test_unknown_features_rejected(sample):
    sample['placements'][0]['rotation_deg']=[0,0,30]
    assert 'schema' in codes(sample)


def test_no_code_injection_in_identifiers(sample):
    sample['volumes'][0]['id']='x");system("id");'
    assert 'schema' in codes(sample)


def test_repeated_parent_rejected(sample):
    sample['placements'][1]['parent']='absorber'
    assert 'repeated_parent' in codes(sample)


def test_expansion_limit_and_collision(sample):
    sample['placements'][0]['repeat']['count']=500
    sample['placements'][1]['repeat']['count']=500
    sample['placements'].append(dict(id='third',volume='sensor',parent='world',position_mm=[0,0,0]))
    assert 'hierarchy' in codes(sample)
    sample['placements']=sample['placements'][:2]
    sample['placements'][1]['id']='absorber__0';sample['placements'][1].pop('repeat')
    assert 'hierarchy' in codes(sample)


def test_nested_positions_and_gdml_parent(sample):
    sample['placements'][0].pop('repeat');sample['placements'][1].pop('repeat')
    sample['volumes'][0]['shape']['size_mm']=[90,70,10]
    sample['placements'][0]['position_mm']=[10,2,3]
    sample['placements'][1].update(parent='absorber',position_mm=[0,0,1])
    items=expand(sample)
    assert items[1]['global_mm']==[10,2,4]
    assert validate(sample)['ready']
    root=ET.fromstring(gdml(sample,items))
    sensor=root.find(".//volume[@name='lv_absorber']/physvol/volumeref")
    assert sensor.attrib['ref']=='lv_sensor'
    assert 'G4ThreeVector(0*mm, 0*mm, 1*mm)' in cpp_geometry(sample,items)


def p(shape,xyz=(0,0,0)):return dict(shape=shape,position_mm=list(xyz))
box=lambda x,y,z:dict(type='box',size_mm=[x,y,z])
tube=lambda a,b,c:dict(type='tube',rmin_mm=a,rmax_mm=b,length_mm=c)


def test_tube_holes_touching_and_crossings():
    shell=p(tube(10,12,40));chip=p(box(2,2,1))
    assert not overlaps(shell,chip)
    assert overlaps(shell,p(box(2,2,1),(11,0,0)))
    assert not overlaps(shell,p(tube(0,10,40)))
    assert overlaps(shell,p(tube(11,13,40)))
    assert not overlaps(shell,p(tube(0,2,40),(14,0,0)))
    assert overlaps(shell,p(tube(0,2,40),(13,0,0)))
    assert not contains(tube(10,20,100),box(2,2,2),[0,0,0])
    assert contains(tube(10,20,100),box(2,2,2),[15,0,0])
    assert contains(tube(10,20,100),tube(12,18,30),[0,0,0])
    assert not contains(tube(10,20,100),tube(9,18,30),[0,0,0])


def test_svg_escape_and_material_snapshot(sample):
    sample['title']='<script>alert(1)</script>'
    image=svg(sample,expand(sample))
    assert '<script>' not in image and '&lt;script&gt;' in image
    materials=ET.fromstring(MATERIALS)
    assert float(materials.find("material[@name='G4_W']/D").attrib['value'])==19.3
    assert materials.find("material[@name='G4_Galactic']") is not None
    assert materials.find("isotope[@name='Si28']") is not None


@pytest.mark.parametrize('model',[None,[],{},'bad',{'schema_version':'bad'}])
def test_malformed_models_do_not_crash(model):
    assert not validate(model)['ready']


def test_export_provenance_allowlist_excludes_credentials(sample):
    data=project_zip(sample,dict(provider='openai',model='ark-code-latest',response_model='auto',api_key='DO-NOT-EXPORT',base_url='SECRET-URL',nested={'key':'ALSO-SECRET'}))
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        meta=json.loads(archive.read('DetWeave/provenance.json'))
        assert meta['response_model']=='auto'
        for name in archive.namelist():assert b'DO-NOT-EXPORT' not in archive.read(name)
        assert 'base_url' not in meta and 'nested' not in meta


def test_noncontiguous_evidence_is_explicit_and_each_quote_verified(sample):
    path='placements.sensor.position_mm'
    sample['evidence'][path]['quote']=['All x and y centres are 0 mm.','The first silicon centre is z = -4 mm; repeat 4 times with step (0,0,3) mm.']
    assert validate(sample)['ready']
    sample['evidence'][path]['quote'].append('invented statement')
    assert 'source_mismatch' in codes(sample)
    sample['evidence'][path]['quote']=[]
    assert 'schema' in codes(sample)
