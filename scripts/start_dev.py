#!/usr/bin/env python3
"""Start the single-document development UI with its local Python backend."""
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from detweave.server import serve

if __name__ == '__main__':
    # An OS-assigned port avoids interfering with an existing workbench.
    serve(port=0, dev_ui=True, open_browser=True)
