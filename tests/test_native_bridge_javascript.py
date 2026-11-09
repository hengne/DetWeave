"""Exercise the exact UTF-8 slice passed to WebKit by Toga GTK 0.5.7."""
import ast
import json
from pathlib import Path
import shutil
import subprocess

import pytest


def test_native_bridges_survive_gtk_utf8_length_and_preserve_localized_save():
    node = shutil.which("node")
    if not node:
        pytest.skip("Node.js is required for the native JavaScript regression")
    source = Path(__file__).resolve().parents[1] / "packaging/src/detweave_native/bridge.py"
    constants = {
        item.targets[0].id: ast.literal_eval(item.value)
        for item in ast.parse(source.read_text()).body
        if isinstance(item, ast.Assign)
        and isinstance(item.targets[0], ast.Name)
        and item.targets[0].id in {"SAVE_SCRIPT", "PICKER_SCRIPT"}
    }
    assert set(constants) == {"SAVE_SCRIPT", "PICKER_SCRIPT"}
    assert all(script.isascii() for script in constants.values())
    # GTK's length=len(script) counts characters, while WebKit consumes bytes.
    scripts = [s.encode("utf-8")[:len(s)].decode("utf-8") for s in constants.values()]
    program = r"""
const assert = require('node:assert/strict');
const vm = require('node:vm');
const alerts = [], requests = [];
const context = {window:{}, alert: text => alerts.push(text),
 FileReader: class {readAsDataURL() {this.result='data:text/plain;base64,YQ==';this.onload();}},
 fetch: async (url, options) => {requests.push([url, JSON.parse(options.body)]);
   return {ok:true, json:async()=> url.endsWith('native-save')
     ? {saved:true,path:'/export/example.svg'} : {location:{id:'chosen'}}};}};
vm.createContext(context);
for (const script of SCRIPTS) assert.equal(vm.runInContext(script, context), true);
(async()=>{
 const saved = await context.window.DetWeaveNativeSave({}, 'example.svg');
 assert.equal(saved.saved,true);
 assert.equal(alerts[0], 'Saved / 已保存:\n/export/example.svg');
 assert.deepEqual(requests[0], ['/api/native-save',{filename:'example.svg',data:'YQ=='}]);
 const location = await context.window.DetWeaveSelectProjectFolder();
 assert.equal(location.id,'chosen');
 assert.equal(requests[1][0],'/api/native-pick-folder');
})().catch(e=>{console.error(e);process.exitCode=1;});
""".replace("SCRIPTS", json.dumps(scripts))
    subprocess.run([node, "-e", program], check=True, capture_output=True, text=True)
