"""Launch the built macOS application and verify its process-owned service."""
import json
from pathlib import Path
import re
import subprocess
import time
from smoke_service import check_service


def main():
    apps = [p for p in Path('build').rglob('DetWeave.app') if (p/'Contents/MacOS/DetWeave').is_file()]
    if len(apps) != 1:
        raise RuntimeError(f'Expected one built DetWeave.app, found {len(apps)}')
    app = apps[0].resolve()
    subprocess.run(['codesign','--verify','--deep','--strict',str(app)],check=True)
    Path('dist').mkdir(exist_ok=True)
    with open('dist/DetWeave-macOS-launch.log','w') as log:
        process = subprocess.Popen([str(app/'Contents/MacOS/DetWeave')],stdout=log,stderr=subprocess.STDOUT)
        try:
            origin = None
            for _ in range(45):
                if process.poll() is not None:
                    raise RuntimeError('macOS application exited before exposing its service')
                sockets = subprocess.run(['lsof','-nP','-p',str(process.pid),'-a','-iTCP','-sTCP:LISTEN'],capture_output=True,text=True).stdout
                ports = re.findall(r'127\.0\.0\.1:(\d+)',sockets)
                if ports:
                    origin = 'http://127.0.0.1:'+ports[0]
                    break
                time.sleep(1)
            if origin is None:
                raise RuntimeError('No process-owned macOS app service appeared')
            result = check_service(origin)
            Path('dist/DetWeave-macOS-service-smoke.json').write_text(json.dumps(result,indent=2)+'\n')
            print(json.dumps(result,indent=2))
        finally:
            if process.poll() is None:
                process.terminate()
                try:process.wait(timeout=10)
                except subprocess.TimeoutExpired:process.kill();process.wait(timeout=5)


if __name__ == '__main__':
    main()
