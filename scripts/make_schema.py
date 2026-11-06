"""Maintain the public schema from concise, dependency-free definitions."""
import json
from pathlib import Path

def obj(properties, required=None):
    return dict(type="object", properties=properties, required=list(properties) if required is None else required, additionalProperties=False)

def array(items, lo=0, hi=500):
    return dict(type="array", items=items, minItems=lo, maxItems=hi)

name = dict(type="string", pattern="^[A-Za-z][A-Za-z0-9_]{0,63}$")
text = dict(type="string", maxLength=2000)
number = dict(type="number", minimum=-1e7, maximum=1e7)
positive = dict(type="number", exclusiveMinimum=0, maximum=1e7)
vec = array(number, 3, 3)
size = array(positive, 3, 3)
evidence = obj(dict(status=dict(enum=["stated", "confirmed", "derived", "assumed", "unresolved"]), quote=text, note=text))
shape = dict(oneOf=[obj(dict(type=dict(const="box"), size_mm=size)), obj(dict(type=dict(const="tube"), rmin_mm=dict(type="number", minimum=0, maximum=1e7), rmax_mm=positive, length_mm=positive))])
material = dict(enum=["G4_AIR", "G4_Galactic", "G4_W", "G4_Pb", "G4_Si", "G4_Al", "G4_Fe", "G4_Cu", "G4_POLYSTYRENE", "G4_SILICON_DIOXIDE", "G4_CESIUM_IODIDE", "G4_PbWO4"])
schema = obj(dict(
    schema_version=dict(const="0.1"), title=dict(type="string", minLength=1, maxLength=120),
    source_text=dict(type="string", maxLength=100000),
    world=obj(dict(size_mm=size, material=material)),
    volumes=array(obj(dict(id=name, shape=shape, material=material)), 0, 100),
    placements=array(obj(dict(id=name, volume=name, parent=name, position_mm=vec, repeat=obj(dict(count=dict(type="integer", minimum=1, maximum=500), step_mm=vec))), ["id", "volume", "parent", "position_mm"]), 0, 500),
    evidence=dict(type="object", maxProperties=3000, additionalProperties=evidence),
    questions=array(obj(dict(id=name, question=text, targets=array(text, 0, 50))), 0, 100),
    notes=array(text, 0, 100)
))
schema.update({"$schema": "https://json-schema.org/draft/2020-12/schema", "$id": "https://github.com/hengne/DetWeave/schema/0.1", "title": "DetWeave geometry IR v0.1"})
Path("detweave/schema.json").write_text(json.dumps(schema, indent=2)+"\n")
