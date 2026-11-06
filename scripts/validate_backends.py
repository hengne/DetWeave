#!/usr/bin/env python3
"""Compile fixed generated templates, compare actual Geant4 geometry with the IR.

Run in your activated Geant4 environment. Never compiles arbitrary model-generated source.
All work and detailed logs are written to --output (default local/native-validation).
"""
import argparse
import csv
import json
import math
import os
from pathlib import Path
import shutil
import subprocess
import sys
import xml.etree.ElementTree as ET
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from detweave.exporters import project_files
from detweave.model import expand, evidence_paths, digest


def invoke(args,cwd,log):
    with log.open('w') as stream:
        result=subprocess.run(args,cwd=cwd,stdout=stream,stderr=subprocess.STDOUT,timeout=180,check=False)
    if result.returncode:
        raise RuntimeError(f"Command failed ({result.returncode}); see {log}")


def compare_table(path,model):
    with path.open() as stream:rows=list(csv.DictReader(stream,delimiter='\t'))
    instances=expand(model)
    assert len(rows)==len(instances)+1,(len(rows),len(instances))
    rows_by_name={r['path'].split('/')[-1]:r for r in rows if r['path']!='world'}
    for item in instances:
        row=rows_by_name['pv_'+item['id']]
        assert row['material']==item['material']
        for axis,expected in zip('xyz',item['global_mm']):
            assert math.isclose(float(row[axis+'_mm']),expected,rel_tol=1e-10,abs_tol=1e-9)
        shape=item['shape']
        volume=math.prod(shape['size_mm']) if shape['type']=='box' else math.pi*(shape['rmax_mm']**2-shape['rmin_mm']**2)*shape['length_mm']
        assert math.isclose(float(row['volume_mm3']),volume,rel_tol=1e-10)
    return rows


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--geant4-prefix')
    parser.add_argument('--cxx')
    parser.add_argument('--model',type=Path,help='Validate a specific model JSON or extraction-result JSON')
    parser.add_argument('--output',type=Path,default=Path('local/native-validation'))
    args=parser.parse_args()
    out=args.output.resolve();out.mkdir(parents=True,exist_ok=True)
    root=Path(__file__).resolve().parents[1]
    models={name:json.loads((root/'examples'/f'{name}.json').read_text()) for name in ['sampling','beamline']}
    nested=json.loads(json.dumps(models['sampling']))
    for p in nested['placements']:p.pop('repeat')
    nested['volumes'][0]['shape']['size_mm']=[90,70,10]
    nested['placements'][0]['position_mm']=[10,2,3]
    nested['placements'][1].update(parent='absorber',position_mm=[0,0,1])
    nested['source_text']='Synthetic native regression: world 200 mm cube Air; G4_W mother box 90x70x10 at (10,2,3); G4_Si child box 80x60x2 at local (0,0,1). All lengths mm, world parent for mother.'
    nested['evidence']={path:dict(status='stated',quote=nested['source_text'],note='Synthetic regression fixture') for path in evidence_paths(nested)}
    models['nested']=nested
    if args.model:
        supplied=json.loads(args.model.read_text())
        models={'provided':supplied.get('model',supplied)}
    results={}
    for name,model in models.items():
        project=out/name;project.mkdir(exist_ok=True)
        for path,content in project_files(model).items():
            target=project/path;target.parent.mkdir(parents=True,exist_ok=True);target.write_text(content)
        build=project/'build'
        command=['cmake','-S',str(project/'geant4'),'-B',str(build),'-DCMAKE_POLICY_VERSION_MINIMUM=3.5']
        if args.geant4_prefix:command.append('-DCMAKE_PREFIX_PATH='+args.geant4_prefix)
        if args.cxx:command.append('-DCMAKE_CXX_COMPILER='+args.cxx)
        invoke(command,project,project/'configure.log')
        invoke(['cmake','--build',str(build),'-j','2'],project,project/'build.log')
        checks={'model_sha256':digest(model)};tables={}
        for mode,arguments in [('gdml',[str(project/'geometry.gdml')]),('cpp',[])]:
            invoke([str(build/'detweave-check')]+arguments,build,project/f'{mode}.log')
            checks[mode]=json.loads((build/'backend-validation.json').read_text())
            assert checks[mode]['passed']
            tables[mode]=compare_table(build/'geometry-table.tsv',model)
            shutil.copyfile(build/'backend-validation.json',project/f'{mode}-validation.json')
            shutil.copyfile(build/'geometry-table.tsv',project/f'{mode}-geometry.tsv')
        assert tables['gdml']==tables['cpp'],'Native GDML and C++ geometries differ'
        invoke([str(build/'detweave-sim'),'10'],build,project/'simulation.log')
        checks['simulation']={'particle':'geantino','events':10,'physics':'transportation only','exit_code':0}
        if name=='sampling':
            tree=ET.parse(project/'geometry.gdml')
            # Intentionally overlap the first silicon and tungsten plate.
            tree.find(".//physvol[@name='pv_sensor__0']/position").set('z','-5.5')
            bad=project/'intentionally-overlapping.gdml';tree.write(bad)
            with (project/'negative-overlap.log').open('w') as log:
                result=subprocess.run([str(build/'detweave-check'),str(bad)],cwd=build,stdout=log,stderr=subprocess.STDOUT,timeout=120)
            assert result.returncode==1,'Checker failed to reject an injected overlap'
            checks['negative_overlap_detected']=True
        results[name]=checks
        print(name+': GDML, C++, table comparison and 10-event geantino run passed',flush=True)
        (out/'summary.json').write_text(json.dumps(results,indent=2)+'\n')

if __name__=='__main__':main()
