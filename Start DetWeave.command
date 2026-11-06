#!/bin/bash
set -e
cd -- "$(dirname -- "$0")"
python3 -c 'import jsonschema' || { echo 'Install once: python3 -m pip install -e .'; exit 1; }
python3 -m detweave serve
