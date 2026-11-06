"""Ask the desktop session running the standalone server for an existing folder."""
from __future__ import annotations

from importlib.util import find_spec
import json
import os
from pathlib import Path
import subprocess
import sys


MAC_PICKER = Path("/usr/bin/osascript")
MAC_SCRIPT = """try
    set selectedFolder to choose folder with prompt "Choose the parent folder for the DetWeave project"
    return POSIX path of selectedFolder
on error number -128
    return ""
end try"""


class FolderPickerError(RuntimeError):
    pass


def picker_backend():
    if hasattr(sys, "getandroidapilevel"):
        return None
    if sys.platform == "darwin" and MAC_PICKER.is_file():
        return "macos"
    if sys.platform == "win32" or (sys.platform.startswith("linux") and os.environ.get("DISPLAY")):
        if find_spec("tkinter") is not None and find_spec("_tkinter") is not None:
            return "tk"
    return None


def pick_folder(backend):
    if backend == "macos":
        command = [str(MAC_PICKER), "-e", MAC_SCRIPT]
    elif backend == "tk":
        command = [sys.executable, "-X", "utf8", str(Path(__file__))]
    else:
        raise FolderPickerError("A desktop folder picker is unavailable on the machine running DetWeave.")
    try:
        result = subprocess.run(command, capture_output=True, check=True, timeout=600)
        output = result.stdout.decode("utf-8")
        # Remove only the script's delimiter so directory names can contain whitespace.
        return (output.removesuffix("\n") or None) if backend == "macos" else (json.loads(output) or None)
    except (OSError, subprocess.SubprocessError, ValueError) as exc:
        raise FolderPickerError("Could not open or complete the system folder picker.") from exc


def _run_tk_picker():
    import tkinter
    from tkinter import filedialog

    root = tkinter.Tk()
    root.withdraw()
    try:
        root.attributes("-topmost", True)
        path = filedialog.askdirectory(parent=root, title="Choose the parent folder for the DetWeave project", mustexist=True)
        print(json.dumps(path or None))
    finally:
        root.destroy()


if __name__ == "__main__":
    _run_tk_picker()
