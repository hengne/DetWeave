"""Deterministic, template-owned exports. Never execute LLM-generated code."""
from __future__ import annotations
import hashlib
import io
import json
from pathlib import Path
import xml.etree.ElementTree as ET
import zipfile
from . import __version__
from .model import validate, canonical, half_extent

ROOT = Path(__file__).parent
MATERIALS = (ROOT / "materials.xml").read_text()
COLORS = {"G4_W":"#6984a8", "G4_Si":"#35d9b2", "G4_Al":"#a5b6cf", "G4_Pb":"#a28bce", "G4_POLYSTYRENE":"#f4b55f"}


def number(value):
    return format(float(value), ".17g")


def xml_text(root):
    ET.indent(root)
    return '<?xml version="1.0" encoding="UTF-8"?>\n' + ET.tostring(root, encoding="unicode") + "\n"


def gdml(model, instances):
    root = ET.Element("gdml", {"xmlns:xsi":"http://www.w3.org/2001/XMLSchema-instance", "xsi:noNamespaceSchemaLocation":"http://cern.ch/2001/Schemas/GDML/gdml.xsd"})
    ET.SubElement(root, "define")
    root.append(ET.fromstring(MATERIALS))
    solids = ET.SubElement(root, "solids")
    def solid(id_, shape):
        if shape["type"] == "box":
            ET.SubElement(solids, "box", name="s_"+id_, lunit="mm", **dict(zip("xyz", map(number, shape["size_mm"]))))
        else:
            ET.SubElement(solids, "tube", name="s_"+id_, rmin=number(shape["rmin_mm"]), rmax=number(shape["rmax_mm"]), z=number(shape["length_mm"]), startphi="0", deltaphi="360", aunit="deg", lunit="mm")
    solid("world", dict(type="box",size_mm=model["world"]["size_mm"]))
    for v in model["volumes"]:
        solid(v["id"], v["shape"])
    structure = ET.SubElement(root, "structure")
    children = {}
    for p in instances:
        children.setdefault(p["parent"], []).append(p)
    def volume(id_, shape_id, material):
        el = ET.SubElement(structure, "volume", name="lv_"+id_)
        ET.SubElement(el, "materialref", ref=material)
        ET.SubElement(el, "solidref", ref="s_"+shape_id)
        for p in children.get(id_, []):
            pv = ET.SubElement(el, "physvol", name="pv_"+p["id"], copynumber=str(p["copy_no"]))
            ET.SubElement(pv, "volumeref", ref="lv_"+p["id"])
            ET.SubElement(pv, "position", name="pos_"+p["id"], unit="mm", **dict(zip("xyz", map(number,p["position_mm"])) ))
    for p in reversed(instances):
        volume(p["id"],p["volume"],p["material"])
    volume("world","world",model["world"]["material"])
    setup=ET.SubElement(root,"setup",name="Default",version="1.0")
    ET.SubElement(setup,"world",ref="lv_world")
    return xml_text(root)


def cpp_geometry(model, instances):
    lines = ['#include "geometry.hh"', '#include "G4Box.hh"', '#include "G4Tubs.hh"', '#include "G4LogicalVolume.hh"', '#include "G4PVPlacement.hh"', '#include "G4GDMLParser.hh"', '#include "G4Material.hh"', '#include "G4SystemOfUnits.hh"', '#include <stdexcept>', '', 'G4VPhysicalVolume* BuildDetWeaveGeometry() {',
             '  // Load the versioned material snapshot; do not rely on host NIST table drift.',
             '  G4GDMLParser materials;', '  materials.Read("materials.gdml", false);',
             '  auto mat = [](const char* name) { auto* m=G4Material::GetMaterial(name, false); if(!m) throw std::runtime_error("Missing material"); return m; };']
    def solid(id_, shape):
        if shape["type"] == "box":
            args = ", ".join(number(x/2)+"*mm" for x in shape["size_mm"])
            lines.append(f'  auto* s_{id_} = new G4Box("s_{id_}", {args});')
        else:
            args = ", ".join(number(x)+"*mm" for x in (shape["rmin_mm"],shape["rmax_mm"],shape["length_mm"]/2))
            lines.append(f'  auto* s_{id_} = new G4Tubs("s_{id_}", {args}, 0, 360*deg);')
    solid("world",dict(type="box",size_mm=model["world"]["size_mm"]))
    lines += [f'  auto* lv_world = new G4LogicalVolume(s_world, mat("{model["world"]["material"]}"), "lv_world");', '  auto* world = new G4PVPlacement(nullptr, {}, lv_world, "world", nullptr, false, 0);']
    for v in model["volumes"]:
        solid(v["id"],v["shape"])
    for p in instances:
        lines.append(f'  auto* lv_{p["id"]} = new G4LogicalVolume(s_{p["volume"]}, mat("{p["material"]}"), "lv_{p["id"]}");')
        pos = ", ".join(number(x)+"*mm" for x in p["position_mm"])
        lines.append(f'  new G4PVPlacement(nullptr, G4ThreeVector({pos}), lv_{p["id"]}, "pv_{p["id"]}", lv_{p["parent"]}, false, {p["copy_no"]}, false);')
    return "\n".join(lines + ["  return world;", "}", ""])


def material_document():
    # GDML reader needs a setup/world even for loading the material catalogue. This world
    # is not placed in the actual detector and checks traverse only the returned world.
    root = ET.Element("gdml")
    ET.SubElement(root,"define")
    root.append(ET.fromstring(MATERIALS))
    solids=ET.SubElement(root,"solids")
    ET.SubElement(solids,"box",name="catalog_s",x="1",y="1",z="1",lunit="mm")
    structure=ET.SubElement(root,"structure")
    v=ET.SubElement(structure,"volume",name="catalog_lv")
    ET.SubElement(v,"materialref",ref="G4_Galactic")
    ET.SubElement(v,"solidref",ref="catalog_s")
    setup=ET.SubElement(root,"setup",name="Default",version="1.0")
    ET.SubElement(setup,"world",ref="catalog_lv")
    return xml_text(root)


def svg(model, instances, plane="xz"):
    if plane not in ("xy","xz","yz"):
        raise ValueError("Projection must be xy, xz or yz.")
    axes = ["xyz".index(x) for x in plane]
    if instances:
        lo=[min(p["global_mm"][a]-half_extent(p["shape"])[a] for p in instances) for a in axes]
        hi=[max(p["global_mm"][a]+half_extent(p["shape"])[a] for p in instances) for a in axes]
    else:
        lo=[-50,-50];hi=[50,50]
    span=[max(hi[k]-lo[k],1) for k in range(2)]
    scale=min(700/span[0],420/span[1])
    root=ET.Element("svg",xmlns="http://www.w3.org/2000/svg",width="900",height="600",viewBox="0 0 900 600")
    ET.SubElement(root,"rect",width="900",height="600",fill="#0c1423")
    ET.SubElement(root,"text",x="35",y="35",fill="#e5edf8",**{"font-size":"20"}).text=f"DetWeave · {model['title']} · {plane.upper()} / mm"
    def point(position):
        return [80+(position[axes[0]]-lo[0])*scale,500-(position[axes[1]]-lo[1])*scale]
    for p in instances:
        xy=point(p["global_mm"]);h=half_extent(p["shape"])
        group=ET.SubElement(root,"g",fill=COLORS.get(p["material"],"#e4b76a"),stroke="#d8e4f0",**{"stroke-width":"0.8","fill-opacity":"0.65"})
        ET.SubElement(group,"title").text=f"{p['id']} | {p['material']} | centre {p['global_mm']} mm"
        if plane=="xy" and p["shape"]["type"]=="tube":
            radius=p["shape"]["rmax_mm"]*scale;inner=p["shape"]["rmin_mm"]*scale
            # An annulus, not a filled disk.
            d=f'M {xy[0]-radius} {xy[1]} a {radius} {radius} 0 1 0 {2*radius} 0 a {radius} {radius} 0 1 0 {-2*radius} 0'
            if inner:
                d+=f' M {xy[0]-inner} {xy[1]} a {inner} {inner} 0 1 0 {2*inner} 0 a {inner} {inner} 0 1 0 {-2*inner} 0'
            ET.SubElement(group,"path",d=d,**{"fill-rule":"evenodd"})
        else:
            ET.SubElement(group,"rect",x=number(xy[0]-h[axes[0]]*scale),y=number(xy[1]-h[axes[1]]*scale),width=number(2*h[axes[0]]*scale),height=number(2*h[axes[1]]*scale))
    ET.SubElement(root,"text",x="35",y="548",fill="#c8d5e5",**{"font-size":"15"}).text=f"Envelope: {span[0]:g} × {span[1]:g} mm · {len(instances)} placements · orthographic projection"
    ET.SubElement(root,"text",x="35",y="575",fill="#9aacbf",**{"font-size":"13"}).text="Preview from IR. This image does not certify Geant4 / DD4hep loading or navigation."
    return xml_text(root)


def project_files(model, provenance=None):
    report=validate(model)
    if not report["ready"]:
        raise ValueError("Resolve geometry errors, missing evidence and clarification questions before export.")
    instances=report["instances"]
    from .dd4hep import export_dd4hep
    files={"geometry.gdml":gdml(model,instances), "model.json":json.dumps(model,indent=2,ensure_ascii=False)+"\n", "source.txt":model["source_text"],
           "validation.json":json.dumps(report,indent=2,ensure_ascii=False)+"\n", "geant4/geometry.cc":cpp_geometry(model,instances), "geant4/materials.gdml":material_document()}
    for plane in ("xy","xz","yz"):
        files[f"preview-{plane}.svg"]=svg(model,instances,plane)
    for name in ("geometry.hh","check.cc","simulation.cc","CMakeLists.txt"):
        files["geant4/"+name]=(ROOT/"templates"/name).read_text()
    files.update(export_dd4hep(model,instances,MATERIALS))
    if isinstance(provenance, dict):
        allowed = ("provider", "model", "response_model", "thinking", "prompt_version", "source_sha256")
        clean = {key: provenance[key][:300] for key in allowed if isinstance(provenance.get(key), str)}
        clean["exported_model_sha256"] = report["model_sha256"]
        clean["note"] = "Extraction metadata refers to its recorded source hash; subsequent human edits are represented by the exported model."
        files["provenance.json"] = json.dumps(clean, indent=2, ensure_ascii=False)+"\n"
    files["README.md"]=(ROOT/"templates"/"EXPORT_README.md").read_text()
    for name in ("CITATION.cff", "NOTICE.txt", "LICENSE.txt"):
        files[name] = (ROOT/"templates"/name).read_text()
    manifest=dict(detweave_version=__version__,schema_version="0.1",model_sha256=report["model_sha256"],material_catalog="Geant4 11.1.3 NIST snapshot",backend_runtime_checks="not_run",checks={"points_per_placement":10000,"tolerance_mm":0,"seed":12345},
                  sha256={name:hashlib.sha256(value.encode()).hexdigest() for name,value in sorted(files.items())})
    files["manifest.json"]=json.dumps(manifest,indent=2)+"\n"
    return files


def project_zip(model, provenance=None):
    files=project_files(model, provenance)
    buffer=io.BytesIO()
    with zipfile.ZipFile(buffer,"w",compression=zipfile.ZIP_DEFLATED) as archive:
        for name,value in sorted(files.items()):
            info=zipfile.ZipInfo("DetWeave/"+name,date_time=(2026,1,1,0,0,0))
            info.compress_type=zipfile.ZIP_DEFLATED
            info.external_attr=0o644 << 16
            archive.writestr(info,value.encode())
    return buffer.getvalue()
