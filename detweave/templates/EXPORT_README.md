# DetWeave geometry project

This bundle contains a reviewed IR and deterministic geometry exports. `validation.json`
records schema, evidence-presence and analytic shape checks. Backend status is **not_run**
until the following commands succeed in your own environment. Source quotes are not proof
that the model interpreted the discussion correctly: review `model.json` before scientific use.

All lengths in the IR are **full lengths in mm**. Positions are local to parent placements.
Tubes are full 360° annuli along z. Rotations are unsupported in v0.1. No sensitive detectors,
optical surfaces, fields or detector-response physics are implied by material names.

## Geant4 GDML and C++

Requires Geant4 built with GDML (Xerces-C) and CMake. Activate the target environment first.

```sh
cmake -S geant4 -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build -j 2
cd build
./detweave-check ../geometry.gdml
# Save these results separately before the next run overwrites them:
# backend-validation.json and geometry-table.tsv
./detweave-check
./detweave-sim 10
```

Both paths use the bundled Geant4 11.1.3 NIST material snapshot, including isotopic abundances,
density and state as written by its GDML writer. Temperature/pressure/optical properties not
present in that snapshot are not a complete optical or thermodynamic model. The C++ path
constructs solids and placements explicitly, and reads `materials.gdml` only for materials.
Run from the build directory so that this material file is found.

The checker recursively samples 10,000 surface points per placement at tolerance 0 mm with
seed 12345, and traces three central axis rays with 1e-5 mm boundary nudges. A passing result
means no problem detected under those settings, not a proof of absence of all overlaps or
navigation errors. The small ray set can miss off-axis or sub-nudge features. `detweave-sim`
runs geantinos with transportation only; it tests tracking, not energy deposition or readout.

## DD4hep

See `dd4hep/README.md`. Compact XML requires the supplied compiled detector constructor.
Do not load the compact file without building and exposing its plugin first.

## Reproducibility

`manifest.json` records engine/schema/material versions, model SHA-256 and output hashes.
`source.txt` and `model.json` contain your input: share this bundle only with its intended recipients.
The ZIP is deterministic for identical input and engine version. API keys are never included.
