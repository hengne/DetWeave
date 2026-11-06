"""Strict IR validation and translation-only geometry checks (all lengths mm)."""
from __future__ import annotations
import hashlib
import json
import math
from itertools import combinations
from pathlib import Path
from jsonschema import Draft202012Validator

SCHEMA = json.loads(Path(__file__).with_name("schema.json").read_text())
VALIDATOR = Draft202012Validator(SCHEMA)
MAX_INSTANCES = 1000
TOL = 1e-7  # mm; numerical comparison tolerance, never a repair


def canonical(model):
    return json.dumps(model, sort_keys=True, ensure_ascii=False, separators=(",", ":"), allow_nan=False)


def digest(model):
    return hashlib.sha256(canonical(model).encode()).hexdigest()


def evidence_paths(model):
    yield "world.size_mm"
    yield "world.material"
    for v in model["volumes"]:
        yield f"volumes.{v['id']}.shape"
        yield f"volumes.{v['id']}.material"
    for p in model["placements"]:
        for key in ("volume", "parent", "position_mm"):
            yield f"placements.{p['id']}.{key}"
        if "repeat" in p:
            yield f"placements.{p['id']}.repeat"


def half_extent(shape):
    if shape["type"] == "box":
        return [x / 2 for x in shape["size_mm"]]
    return [shape["rmax_mm"], shape["rmax_mm"], shape["length_mm"] / 2]


def expand(model):
    """Topologically ordered instances. Repeated parents are intentionally unsupported."""
    volumes = {v["id"]: v for v in model["volumes"]}
    pending = list(model["placements"])
    placed = {"world": {"global_mm": [0, 0, 0]}}
    result = []
    while pending:
        ready = [p for p in pending if p["parent"] in placed]
        if not ready:
            raise ValueError("Placement hierarchy has a cycle or an unknown parent.")
        for p in ready:
            repeat = p.get("repeat", {"count": 1, "step_mm": [0, 0, 0]})
            for i in range(repeat["count"]):
                local = [p["position_mm"][k] + i * repeat["step_mm"][k] for k in range(3)]
                instance_id = p["id"] if repeat["count"] == 1 else f"{p['id']}__{i}"
                instance = dict(id=instance_id, origin=p["id"], volume=p["volume"], parent=p["parent"],
                                position_mm=local, global_mm=[local[k] + placed[p["parent"]]["global_mm"][k] for k in range(3)],
                                shape=volumes[p["volume"]]["shape"], material=volumes[p["volume"]]["material"], copy_no=len(result)+1)
                if instance_id in placed:
                    raise ValueError(f"Expanded identifier collision: {instance_id}")
                placed[instance_id] = instance
                result.append(instance)
                if len(result) > MAX_INSTANCES:
                    raise ValueError(f"Maximum {MAX_INSTANCES} expanded placements exceeded.")
            pending.remove(p)
    return result


def contains(parent, child, pos):
    if parent["type"] == "box":
        return all(abs(pos[k]) + half_extent(child)[k] <= half_extent(parent)[k] + TOL for k in range(3))
    if abs(pos[2]) + half_extent(child)[2] > parent["length_mm"]/2 + TOL:
        return False
    distance = math.hypot(*pos[:2])
    if child["type"] == "tube":
        outer = distance + child["rmax_mm"]
        if distance < child["rmin_mm"]:
            inner = child["rmin_mm"] - distance
        else:
            inner = max(0, distance - child["rmax_mm"])
    else:
        hx, hy = half_extent(child)[:2]
        outer = math.hypot(abs(pos[0])+hx, abs(pos[1])+hy)
        inner = math.hypot(max(abs(pos[0])-hx, 0), max(abs(pos[1])-hy, 0))
    return outer <= parent["rmax_mm"]+TOL and inner >= parent["rmin_mm"]-TOL


def overlaps(a, b):
    """Exact positive-volume intersection for supported parallel boxes and annuli."""
    sa, sb = a["shape"], b["shape"]
    pa, pb = a["position_mm"], b["position_mm"]
    ha, hb = half_extent(sa), half_extent(sb)
    if abs(pa[2]-pb[2]) >= ha[2]+hb[2]-TOL:
        return False
    if sa["type"] == sb["type"] == "box":
        return all(abs(pa[k]-pb[k]) < ha[k]+hb[k]-TOL for k in (0, 1))
    if sa["type"] == sb["type"] == "tube":
        d = math.hypot(pa[0]-pb[0], pa[1]-pb[1])
        return d < sa["rmax_mm"]+sb["rmax_mm"]-TOL and d+sa["rmax_mm"] > sb["rmin_mm"]+TOL and d+sb["rmax_mm"] > sa["rmin_mm"]+TOL
    box, tube = (a, b) if sa["type"] == "box" else (b, a)
    dx, dy = [abs(box["position_mm"][k]-tube["position_mm"][k]) for k in (0, 1)]
    hx, hy = half_extent(box["shape"])[:2]
    nearest = math.hypot(max(dx-hx, 0), max(dy-hy, 0))
    farthest = math.hypot(dx+hx, dy+hy)
    return nearest < tube["shape"]["rmax_mm"]-TOL and farthest > tube["shape"]["rmin_mm"]+TOL


def validate(model):
    issues = []
    def issue(level, code, path, message):
        issues.append(dict(level=level, code=code, path=path, message=message))
    try:
        canonical(model)  # rejects NaN, Infinity
    except (ValueError, TypeError):
        issue("error", "nonfinite", "", "JSON must contain only finite values.")
    errors = sorted(VALIDATOR.iter_errors(model), key=lambda e: str(list(e.path)))
    for e in errors[:40]:
        issue("error", "schema", ".".join(map(str, e.path)), e.message[:400])
    if issues:
        return report(model, issues, [])
    volumes = {v["id"]: v for v in model["volumes"]}
    placements = {p["id"]: p for p in model["placements"]}
    for collection, values in (("volumes", model["volumes"]), ("placements", model["placements"])):
        names = [v["id"] for v in values]
        if len(names) != len(set(names)) or "world" in names:
            issue("error", "identifier", collection, "Identifiers must be unique and cannot be 'world'.")
    for v in model["volumes"]:
        if v["shape"]["type"] == "tube" and v["shape"]["rmin_mm"] >= v["shape"]["rmax_mm"]:
            issue("error", "radius", f"volumes.{v['id']}", "Tube requires 0 ≤ inner radius < outer radius.")
    for p in model["placements"]:
        if p["volume"] not in volumes:
            issue("error", "reference", p["id"], "Unknown volume.")
        if p["parent"] != "world" and p["parent"] not in placements:
            issue("error", "reference", p["id"], "Unknown parent placement.")
        if p["parent"] in placements and placements[p["parent"]].get("repeat", {}).get("count", 1) > 1:
            issue("error", "repeated_parent", p["id"], "A repeated placement cannot be a parent in v0.1; expand it explicitly.")
    if issues:
        return report(model, issues, [])
    try:
        instances = expand(model)
    except ValueError as e:
        issue("error", "hierarchy", "placements", str(e))
        return report(model, issues, [])
    if not instances:
        issue("blocker", "empty", "placements", "No detector placements have been specified.")
    unused = set(volumes) - {p["volume"] for p in instances}
    if unused:
        issue("blocker", "unused", "volumes", "Volumes without placements: " + ", ".join(sorted(unused)))
    for path in evidence_paths(model):
        evidence = model["evidence"].get(path)
        if not evidence:
            issue("blocker", "evidence_missing", path, "A source quote or an explicit user confirmation is required.")
        elif evidence["status"] in ("assumed", "unresolved"):
            issue("blocker", "unconfirmed", path, evidence["note"] or "This design assumption needs confirmation.")
        elif not evidence["quote"].strip() or evidence["quote"] not in model["source_text"]:
            issue("blocker", "source_mismatch", path, "Evidence quote must occur verbatim in source text.")
        elif evidence["status"] == "derived":
            # A free-form derivation is not a machine-verified calculation.
            issue("blocker", "derivation_review", path, "Review and confirm this derived geometry value before export.")
    for q in model["questions"]:
        issue("blocker", "clarification", q["id"], q["question"])
    by_id = {p["id"]: p for p in instances}
    world_shape = dict(type="box", size_mm=model["world"]["size_mm"])
    for p in instances:
        parent = world_shape if p["parent"] == "world" else by_id[p["parent"]]["shape"]
        if not contains(parent, p["shape"], p["position_mm"]):
            issue("error", "outside_parent", p["id"], f"{p['id']} extends outside its parent {p['parent']}.")
    groups = {}
    for p in instances:
        groups.setdefault(p["parent"], []).append(p)
    count = 0
    for siblings in groups.values():
        for a, b in combinations(siblings, 2):
            if overlaps(a, b):
                count += 1
                if count <= 30:
                    issue("error", "overlap", a["id"], f"Positive-volume overlap: {a['id']} / {b['id']}.")
    if count > 30:
        issue("error", "overlap_summary", "placements", f"{count} overlap pairs; first 30 listed.")
    return report(model, issues, instances)


def report(model, issues, instances):
    ready = not any(i["level"] in ("error", "blocker") for i in issues)
    try:
        sha = digest(model)
    except (ValueError, TypeError):
        sha = None
    return dict(ready=ready, stage="exportable" if ready else "draft", issues=issues, instances=instances,
                model_sha256=sha, counts=dict(definitions=len(model.get("volumes", [])) if isinstance(model, dict) else 0, instances=len(instances)),
                checks=dict(schema="failed" if any(i["code"] in ("schema", "nonfinite") for i in issues) else "passed",
                            analytic_geometry="failed" if any(i["level"] == "error" for i in issues) else "passed",
                            evidence="passed" if not any(i["level"] == "blocker" for i in issues) else "needs_review",
                            geant4="not_run", dd4hep="not_run"),
                scope="Axis-aligned boxes and full z-axis tubes; translations only; analytic comparison tolerance 1e-7 mm. Quote presence is checked, not semantic truth. Backend validation must be run separately.")
