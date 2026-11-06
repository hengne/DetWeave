# Material provenance

`detweave/materials.xml` is a numerical material snapshot written by
`G4GDMLParser::Write` from `G4NistManager::FindOrBuildMaterial` in Geant4 11.1.3.
It contains the twelve material identifiers allowed by the IR schema, with
isotopic elemental abundances, density, state and mean excitation energy where
present in that writer's output. It does not add optical property tables.

The GDML backend includes the snapshot directly. The direct C++ geometry backend
loads the same snapshot via a tiny catalogue-only GDML world, then explicitly
constructs detector solids/volumes/placements. The catalogue world is not a
physical placement in the detector and native checks traverse only the actual world.

The DD4hep backend translates elemental material definitions into explicit elements
and fractions and namespaces element/isotope identifiers. Its material converter
can omit properties such as mean excitation energy; compare physics separately.
The ROOT 6.30 sparse-element workaround inserts unused elements which are never
referenced by a material. See `docs/VALIDATION.md` for the tested environment.

Definitions are from [Geant4](https://geant4.web.cern.ch/), an external project
under the [Geant4 Software License](https://geant4.web.cern.ch/download/license).
DetWeave's MIT license does not relicense Geant4, DD4hep or ROOT software.
