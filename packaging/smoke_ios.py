"""Boot an iPhone simulator and verify the built app's loopback API."""
import json
import re
import subprocess
import sys
import time
import urllib.request
from pathlib import Path


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
    device = iphones[0]['udid']
    print('Simulator:', iphones[0]['name'], device, flush=True)
    try:
        if iphones[0]['state'] != 'Booted':
            run('xcrun', 'simctl', 'boot', device, timeout=60)
        run('xcrun', 'simctl', 'bootstatus', device, '-b', timeout=240)
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
                        time.sleep(5)  # Give the WebView time to render before capture.
                        Path('dist').mkdir(exist_ok=True)
                        run('xcrun', 'simctl', 'io', device, 'screenshot', 'dist/DetWeave-iOS-simulator-smoke.png', timeout=30)
                        print('PASS: simulator launched, health OK, examples:', len(examples), flush=True)
                        return
            except Exception as exc:
                last_error = exc
        raise RuntimeError(f'App did not expose a working loopback service within 90 seconds: {last_error}')
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
