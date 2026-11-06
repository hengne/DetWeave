#include "geometry.hh"
#include "G4RunManager.hh"
#include "G4TransportationManager.hh"
#include "G4Navigator.hh"
#include "G4VUserDetectorConstruction.hh"
#include "G4VUserPrimaryGeneratorAction.hh"
#include "G4ParticleGun.hh"
#include "G4Geantino.hh"
#include "G4LogicalVolume.hh"
#include "G4VPhysicalVolume.hh"
#include "G4VSolid.hh"
#include "G4SystemOfUnits.hh"
#include "G4VModularPhysicsList.hh"
#include "G4Transportation.hh"
#include "Randomize.hh"
#include <algorithm>
#include <cstdlib>

// Geometry/navigation example only: geantinos have no detector response.
class Detector final : public G4VUserDetectorConstruction {
 public: G4VPhysicalVolume* Construct() override { return BuildDetWeaveGeometry(); }
};
class GeometryPhysics final : public G4VModularPhysicsList {
 public:
 void ConstructParticle() override {G4Geantino::GeantinoDefinition();}
 void ConstructProcess() override {AddTransportation();}
 void SetCuts() override {}
};
class Source final : public G4VUserPrimaryGeneratorAction {
 G4ParticleGun gun{1};
 public:
 void GeneratePrimaries(G4Event* event) override {
   auto* world=G4TransportationManager::GetTransportationManager()->GetNavigatorForTracking()->GetWorldVolume();
   G4ThreeVector lo,hi; world->GetLogicalVolume()->GetSolid()->BoundingLimits(lo,hi);
   gun.SetParticleDefinition(G4Geantino::GeantinoDefinition());
   gun.SetParticleEnergy(1*GeV); gun.SetParticleMomentumDirection({0,0,1});
   gun.SetParticlePosition({0,0,lo.z()+1e-3*mm}); gun.GeneratePrimaryVertex(event);
 }
};
int main(int argc,char** argv) {
 CLHEP::HepRandom::setTheSeed(12345);
 auto* run=new G4RunManager(); run->SetUserInitialization(new Detector());
 run->SetUserInitialization(new GeometryPhysics()); run->SetUserAction(new Source());
 run->Initialize(); run->BeamOn(argc>1 ? std::clamp(std::atoi(argv[1]),1,1000) : 10); delete run;
}
