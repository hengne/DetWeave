import copy
from pathlib import Path
import pytest
from detweave.model import MIN_FEATURE_MM, overlaps, validate
from detweave.server import examples
from detweave.exporters import COLORS, MATERIALS, cpp_geometry
from detweave.dd4hep import export_dd4hep


@pytest.mark.parametrize('shape', [
    {'type':'box','size_mm':[10,10,1e-9]},
    {'type':'tube','rmin_mm':10,'rmax_mm':10+1e-9,'length_mm':50},
])
def test_coincident_subtolerance_shapes_are_not_tolerated(shape):
    item={'shape':shape,'position_mm':[0,0,0]}
    assert overlaps(item,item)
    model=copy.deepcopy(examples()[0]['model'])
    model['volumes'][0]['shape']=shape
    result=validate(model)
    assert not result['ready']
    assert any(i['code']=='dimension' for i in result['issues'])


def test_numerical_resolution_does_not_impose_one_micron_physics_limit():
    assert MIN_FEATURE_MM < 1e-3
    model=copy.deepcopy(examples()[0]['model'])
    model['world']['size_mm'][2]=MIN_FEATURE_MM/2
    assert any(i['code']=='dimension' for i in validate(model)['issues'])


def test_material_lookup_has_explicit_location_override():
    source=cpp_geometry(examples()[0]['model'],[])
    assert 'std::getenv("DETWEAVE_MATERIALS_FILE")' in source
    cmake=Path('detweave/templates/CMakeLists.txt').read_text()
    assert cmake.count('PRIVATE DETWEAVE_MATERIALS_FILE="${CMAKE_CURRENT_BINARY_DIR}/materials.gdml"')==2
    simulation=Path('detweave/templates/simulation.cc').read_text()
    assert 'std::min(1e-3*mm, 0.1*(hi.z()-lo.z()))' in simulation


def test_dd4hep_invalid_parent_is_controlled_error():
    model=examples()[0]['model']
    instances=validate(model)['instances']
    instances[0]['parent']='missing'
    with pytest.raises(ValueError,match='cycle or unknown parent'):
        export_dd4hep(model,instances,MATERIALS)
