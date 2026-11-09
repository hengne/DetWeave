"""Boot an iPhone simulator and verify both the built app's WebView and loopback API."""
import json
import os
import re
import subprocess
import sys
import time
import urllib.request
from pathlib import Path
from smoke_service import check_service


def run(*args, timeout=180):
    return subprocess.run(args, check=True, capture_output=True, text=True, timeout=timeout).stdout.strip()


def main():
    app = Path('build/detweave_native/ios/xcode/build/Debug-iphonesimulator/DetWeave.app').resolve()
    if not app.is_dir():
        raise RuntimeError('Simulator app was not built')
    devices = json.loads(run('xcrun', 'simctl', 'list', 'devices', 'available', '--json'))['devices']
    iphones = [d for group in devices.values() for d in group if d.get('isAvailable') and d['name'].startswith('iPhone')]
    if not iphones:
        raise RuntimeError('No available iPhone simulator')
    chosen = next((d for d in iphones if d['udid'] == os.environ.get('DETWEAVE_SIMULATOR_UDID')), iphones[0])
    device = chosen['udid']
    print('Simulator:', chosen['name'], device, flush=True)
    try:
        if chosen['state'] != 'Booted':
            run('xcrun', 'simctl', 'boot', device, timeout=60)
        run('xcrun', 'simctl', 'bootstatus', device, '-b', timeout=720)
        run('xcrun', 'simctl', 'install', device, str(app), timeout=120)
        launch = run('xcrun', 'simctl', 'launch', device, 'org.detweave.detweave-native', timeout=60)
        print('Launch:', launch, flush=True)
        match = re.search(r':\s*(\d+)\s*$', launch)
        if not match:
            raise RuntimeError('Simulator did not return an app PID')
        pid = match.group(1)
        deadline = time.monotonic() + 90
        last_error = None
        while time.monotonic() < deadline:
            time.sleep(2)
            try:
                sockets = subprocess.run(['lsof', '-nP', '-p', pid, '-a', '-iTCP', '-sTCP:LISTEN'], capture_output=True, text=True).stdout
                for port in re.findall(r'127\.0\.0\.1:(\d+)', sockets):
                    with urllib.request.urlopen(f'http://127.0.0.1:{port}/api/health', timeout=3) as response:
                        health = json.load(response)
                    with urllib.request.urlopen(f'http://127.0.0.1:{port}/api/examples', timeout=3) as response:
                        examples = json.load(response)
                    if health.get('status') == 'ok' and len(examples) >= 2:
                        with urllib.request.urlopen(f'http://127.0.0.1:{port}/api/native-ui', timeout=3) as response:
                            ui = json.load(response)
                        Path('dist').mkdir(exist_ok=True)
                        Path('dist/DetWeave-iOS-ui-smoke.json').write_text(json.dumps(ui, indent=2)+'\n')
                        if not ui.get('ready'):
                            raise RuntimeError(f'Native WebView has not rendered the application: {ui}')
                        result = check_service(f'http://127.0.0.1:{port}')
                        result['native_ui'] = ui
                        Path('dist').mkdir(exist_ok=True)
                        Path('dist/DetWeave-iOS-service-smoke.json').write_text(json.dumps(result,indent=2)+'\n')
                        time.sleep(5)  # Give the WebView time to render before capture.
                        Path('dist').mkdir(exist_ok=True)
                        run('xcrun', 'simctl', 'io', device, 'screenshot', 'dist/DetWeave-iOS-simulator-smoke.png', timeout=30)
                        print('PASS: simulator rendered chat and project controls, health OK, examples:', len(examples), flush=True)
                        return
            except Exception as exc:
                last_error = exc
        raise RuntimeError(f'App did not expose a working service AND rendered native UI within 90 seconds: {last_error}')
    finally:
        try:
            Path('dist').mkdir(exist_ok=True)
            subprocess.run(['xcrun', 'simctl', 'io', device, 'screenshot', 'dist/DetWeave-iOS-simulator-last.png'], check=False, capture_output=True, timeout=30)
        except Exception:
            pass
        subprocess.run(['xcrun', 'simctl', 'shutdown', device], check=False, capture_output=True, timeout=60)


if __name__ == '__main__':
    try:
        main()
    except Exception as exc:
        print(f'iOS simulator smoke failed: {exc}', file=sys.stderr)
        sys.exit(1)
