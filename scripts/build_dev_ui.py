#!/usr/bin/env python3
"""Export the backend-dependent single HTML development interface."""
import argparse
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from detweave.dev_ui import bundle_document

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=Path('dist/DetWeave-dev.html'))
    args = parser.parse_args()
    html, _ = bundle_document()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_bytes(html)
    print(f'Wrote {args.output}. Requires local backend: python -m detweave serve --dev-ui --open')
