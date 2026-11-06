#include "geometry.hh"
#include "G4GDMLParser.hh"
#include "G4VPhysicalVolume.hh"
#include "G4LogicalVolume.hh"
#include "G4Material.hh"
#include "G4VSolid.hh"
#include "G4GeometryManager.hh"
#include "G4Navigator.hh"
#include "G4SystemOfUnits.hh"
#include "G4Version.hh"
#include "Randomize.hh"
#include <fstream>
#include <cmath>
#include <iomanip>
#include <iostream>
#include <string>
#include <vector>

// Checks only the selected world's descendants (not unrelated catalogue objects).
int main(int argc, char** argv) {
  CLHEP::HepRandom::setTheSeed(12345);
  G4GDMLParser parser;
  G4VPhysicalVolume* world = nullptr;
  if (argc == 2) { parser.Read(argv[1], false); world=parser.GetWorldVolume(); }
  else if (argc == 1) world=BuildDetWeaveGeometry();
  else { std::cerr << "Usage: detweave-check [geometry.gdml]\n"; return 64; }
  if (!world) return 2;
  G4GeometryManager::GetInstance()->CloseGeometry(true, false, world);
  std::ofstream table("geometry-table.tsv");
  table << std::setprecision(14) << "path\tmaterial\tx_mm\ty_mm\tz_mm\tvolume_mm3\tdensity_g_cm3\n";
  int count=0, overlap_count=0;
  auto visit = [&](auto&& self, G4VPhysicalVolume* parent, const G4ThreeVector& global, std::string path) -> void {
    auto* lv=parent->GetLogicalVolume();
    table << path << '\t' << lv->GetMaterial()->GetName() << '\t' << global.x()/mm << '\t' << global.y()/mm << '\t' << global.z()/mm << '\t' << lv->GetSolid()->GetCubicVolume()/mm3 << '\t' << lv->GetMaterial()->GetDensity()/(g/cm3) << '\n';
    for (int i=0; i<lv->GetNoDaughters(); ++i) {
      auto* child=lv->GetDaughter(i);
      ++count;
      if (child->CheckOverlaps(10000, 0*mm, true, 10)) ++overlap_count;
      self(self, child, global+child->GetTranslation(), path+"/"+child->GetName());
    }
  };
  visit(visit,world,G4ThreeVector(),"world");
  G4Navigator navigator;
  navigator.SetWorldVolume(world);
  G4ThreeVector lo, hi;
  world->GetLogicalVolume()->GetSolid()->BoundingLimits(lo,hi);
  int navigation_failures=0;
  // Three orthogonal central rays. This is smoke coverage, not exhaustive navigation.
  for(int axis=0;axis<3;++axis) {
    G4ThreeVector dir, point; dir[axis]=1; point[axis]=lo[axis]+1e-5*mm;
    int steps=0;
    while(point[axis]<hi[axis]-1e-5*mm && steps++<100000) {
      auto* located=navigator.LocateGlobalPointAndSetup(point,nullptr,false);
      if(!located) { ++navigation_failures; break; }
      G4double safety=0;
      auto step=navigator.ComputeStep(point,dir,hi[axis]-point[axis],safety);
      if(step<0 || !std::isfinite(step)) {++navigation_failures;break;}
      point += dir*(step+1e-5*mm);
    }
    if(steps>=100000)++navigation_failures;
  }
  std::ofstream out("backend-validation.json");
  out << "{\"backend\":\"Geant4\",\"version\":\"" << G4Version << "\",\"placements\":" << count
      << ",\"overlap_placements\":" << overlap_count << ",\"navigation_failures\":" << navigation_failures
      << ",\"samples_per_placement\":10000,\"tolerance_mm\":0,\"seed\":12345,\"navigation_rays\":3,\"passed\":"
      << (overlap_count==0 && navigation_failures==0 ? "true":"false") << "}\n";
  std::cout << "DetWeave: " << count << " placements, " << overlap_count << " overlap reports, " << navigation_failures << " navigation failures.\n";
  G4GeometryManager::GetInstance()->OpenGeometry(world);
  return overlap_count || navigation_failures ? 1 : 0;
}
