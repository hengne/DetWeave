#!/bin/bash
set -e
TASK_SCRIPT_DIR="$(cd -- "$(dirname -- "$0")" && pwd)"
exec python3 "$TASK_SCRIPT_DIR/start_dev.py"
