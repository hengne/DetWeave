`pyrsistent-0.19.3-py3-none-any.whl` was built from the PyPI 0.19.3 source release with `PYRSISTENT_SKIP_EXTENSION=1`; its original MIT licence is included inside the wheel. It supplies a pure-Python implementation for mobile targets without an `rpds-py` wheel. The native bundle pins jsonschema 4.17.3 and pyrsistent 0.19.3; the regular Python package has its own requirements.

Rebuild with `PYRSISTENT_SKIP_EXTENSION=1 python -m pip wheel --no-deps --no-binary=:all: pyrsistent==0.19.3` and verify the wheel tag is `py3-none-any`.

`fonttools-4.68.0-py3-none-any.whl` is the unmodified pure-Python wheel downloaded from PyPI, used to make the iOS simulator dependency available when the secondary BeeWare index is unreachable. Its upstream license is included in the wheel. Re-download with `python -m pip download --no-deps --only-binary=:all: --platform any --python-version 311 fonttools==4.68.0`.
