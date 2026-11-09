"""Copy reviewed CI outputs to an existing draft; never build or publish here."""
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile


def gh(*args):
    return subprocess.check_output(['gh', *args], text=True)


def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def main():
    tag = os.environ['DETWEAVE_RELEASE_TAG']
    if not re.fullmatch(r'v\d+\.\d+\.\d+', tag):
        raise ValueError('Expected a semantic version release tag.')
    version = tag[1:]
    release = json.loads(gh('release', 'view', tag, '--json', 'isDraft'))
    if not release['isDraft']:
        raise ValueError('This uploader only handles an unpublished draft.')
    with tempfile.TemporaryDirectory(prefix='detweave-release-') as temporary:
        root = Path(temporary)
        assets = root / 'assets'
        assets.mkdir()
        gh('release', 'download', tag, '--pattern', 'BUILD-MANIFEST.json', '--dir', str(assets))
        gh('release', 'download', tag, '--pattern', 'SHA256SUMS.txt', '--dir', str(assets))
        sums = {}
        for line in (assets / 'SHA256SUMS.txt').read_text().splitlines():
            checksum, name = line.split('  ', 1)
            if not re.fullmatch(r'[0-9a-f]{64}', checksum) or Path(name).name != name:
                raise ValueError('Invalid checksum entry.')
            sums[name] = checksum
        if digest(assets / 'BUILD-MANIFEST.json') != sums['BUILD-MANIFEST.json']:
            raise ValueError('Manifest checksum mismatch.')
        manifest = json.loads((assets / 'BUILD-MANIFEST.json').read_text())
        if manifest['release_tag'] != tag or manifest['version'] != version:
            raise ValueError('Manifest version mismatch.')
        for kind in ['native', 'python']:
            build = manifest[kind + '_build']
            run_id = build['run'].rsplit('/', 1)[-1]
            if not run_id.isdecimal():
                raise ValueError('Invalid workflow run identifier.')
            run = json.loads(gh('run', 'view', run_id, '--json', 'conclusion,headSha'))
            if run['conclusion'] != 'success' or run['headSha'] != build['commit']:
                raise ValueError('Build provenance or success status mismatch.')
            gh('run', 'download', run_id, '--dir', str(root / kind))
        names = {
            f'DetWeave-{version}-macOS-universal-adhoc.dmg': f'DetWeave-{version}.dmg',
            f'DetWeave-{version}-Windows-x64-unsigned.msi': f'DetWeave-{version}.msi',
            f'DetWeave-{version}-Ubuntu-24.04-amd64.deb': f'detweave-native_{version}-1~ubuntu-noble_amd64.deb',
            f'DetWeave-{version}-Android-debug.apk': f'DetWeave-{version}.debug.apk',
            f'DetWeave-{version}-iOS-simulator.zip': 'DetWeave-iOS-simulator.zip',
            f'DetWeave-{version}-iOS-Xcode-project.zip': 'DetWeave-iOS-Xcode-project.zip',
            f'DetWeave-{version}-iOS-simulator-smoke.png': 'DetWeave-iOS-simulator-smoke.png',
        }
        for entry in manifest['artifacts']:
            name = entry['name']
            if Path(name).name != name:
                raise ValueError('Invalid asset name.')
            source_root = root / ('python' if name.startswith('detweave-') else 'native')
            matches = list(source_root.rglob(names.get(name, name)))
            if len(matches) != 1:
                raise ValueError(f'Expected one archived source for {name}, found {len(matches)}.')
            source = matches[0]
            if source.stat().st_size != entry['size_bytes'] or digest(source) != entry['sha256'] or sums[name] != entry['sha256']:
                raise ValueError(f'Artifact checksum or size mismatch: {name}')
            shutil.copy2(source, assets / name)
            print(f'Verified {name}', flush=True)
        if set(sums) != {p.name for p in assets.iterdir() if p.name != 'SHA256SUMS.txt'}:
            raise ValueError('Checksum inventory does not match the assets.')
        gh('release', 'upload', tag, *(str(p) for p in sorted(assets.iterdir())), '--clobber')
        print('All verified assets uploaded. Release remains a draft.', flush=True)


if __name__ == '__main__':
    main()
