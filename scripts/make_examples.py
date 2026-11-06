import json
from pathlib import Path

source = """Synthetic design example — not an experimental detector.
Build four tungsten/silicon periods along z. All dimensions below are full lengths in mm.
The world is a 200 × 200 × 200 mm G4_AIR box, centred at the global origin.
Each tungsten plate is a box 80 × 60 × 1 mm, material G4_W.
Each silicon plate is a box 80 × 60 × 2 mm, material G4_Si.
Place both plate types directly in world. All x and y centres are 0 mm.
The first tungsten centre is z = -5.5 mm; repeat 4 times with step (0,0,3) mm.
The first silicon centre is z = -4 mm; repeat 4 times with step (0,0,3) mm.
This makes a 12 mm stack, with touching interfaces and no gaps. No rotations, optical properties or sensitive detectors are requested."""
model = dict(schema_version="0.1", title="四周期钨／硅采样结构", source_text=source,
 world=dict(size_mm=[200,200,200],material="G4_AIR"),
 volumes=[dict(id="absorber", shape=dict(type="box",size_mm=[80,60,1]), material="G4_W"),dict(id="sensor",shape=dict(type="box",size_mm=[80,60,2]),material="G4_Si")],
 placements=[dict(id="absorber",volume="absorber",parent="world",position_mm=[0,0,-5.5],repeat=dict(count=4,step_mm=[0,0,3])),dict(id="sensor",volume="sensor",parent="world",position_mm=[0,0,-4],repeat=dict(count=4,step_mm=[0,0,3]))],evidence={},questions=[],notes=["Synthetic geometry-only fixture. Silicon is not configured as a sensitive detector."])
from detweave.model import evidence_paths
for path in evidence_paths(model):
 model['evidence'][path]=dict(status="stated",quote=source,note="Source explicitly specifies this value; quote matching is not semantic validation.")
Path('examples/sampling.json').write_text(json.dumps(model,ensure_ascii=False,indent=2)+'\n')
Path('examples/sampling.txt').write_text(source+'\n')
source2='Synthetic beam test: world is a 400 x 400 x 400 mm G4_AIR box. An aluminium tube (G4_Al), inner radius 20 mm, outer radius 22 mm, full length 100 mm, is placed in world at (0,0,0) mm with z axis. A silicon box (G4_Si), full dimensions 10 x 10 x 1 mm, is placed in world at (0,0,0) mm inside the bore. No rotations, fields, optical surfaces or readout requested.'
m2=dict(schema_version='0.1',title='圆管与硅片束流测试结构',source_text=source2,world=dict(size_mm=[400]*3,material='G4_AIR'),volumes=[dict(id='pipe',shape=dict(type='tube',rmin_mm=20,rmax_mm=22,length_mm=100),material='G4_Al'),dict(id='chip',shape=dict(type='box',size_mm=[10,10,1]),material='G4_Si')],placements=[dict(id=n,volume=n,parent='world',position_mm=[0,0,0]) for n in ['pipe','chip']],evidence={},questions=[],notes=['Synthetic geometry-only fixture.'])
for path in evidence_paths(m2):m2['evidence'][path]=dict(status='stated',quote=source2,note='Explicit synthetic source.')
Path('examples/beamline.json').write_text(json.dumps(m2,ensure_ascii=False,indent=2)+'\n')
