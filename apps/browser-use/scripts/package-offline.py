"""Build offline media around the original App ZIP and pinned Chrome archive."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
from zipfile import ZIP_STORED, ZipFile


RUNTIME = Path(__file__).resolve().parents[1] / 'src' / 'playwright-cdp'
PART_BYTES = 96 * 1024 ** 2


def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def build(app_zip, browser_zip, work):
    lock = json.loads((RUNTIME / 'chrome.lock.json').read_text())
    with ZipFile(app_zip) as app:
        manifest = json.loads(app.read('app.moss.json'))
        if json.loads(app.read('dist/playwright-cdp/chrome.lock.json')) != lock:
            raise ValueError('App ZIP contains a different Chrome lock')
    platform, = manifest['platforms']
    version = manifest['version']
    if manifest['id'] != 'moss.browser-use' or app_zip.name != f'moss.browser-use-{version}-{platform}.zip':
        raise ValueError('App ZIP identity mismatch')
    if digest(app_zip) != app_zip.with_suffix('.sha256').read_text().split()[0]:
        raise ValueError('App ZIP checksum mismatch')
    chrome = lock['platforms'][platform]
    chrome_name = Path(chrome['archive']).name
    if browser_zip is None:
        browser_zip = work / chrome_name
        subprocess.run(['node', '-e', '''
const runtime = require(process.argv[1]);
if (runtime.platform !== process.argv[2]) throw new Error('Offline kit requires a native build runner');
runtime.downloadArchive(process.argv[3]).catch(error => { console.error(error); process.exitCode = 1; });
''', str(RUNTIME / 'chrome-archive.cjs'), platform, str(browser_zip)], check=True)
    if browser_zip.stat().st_size != chrome['size'] or digest(browser_zip) != chrome['sha256']:
        raise ValueError('Chrome archive checksum mismatch')

    resources = [f'browser.part-{i:03}' for i in range((chrome['size'] + PART_BYTES - 1) // PART_BYTES)]
    marker = {'format': 1, 'appId': manifest['id'], 'version': version, 'platform': platform,
              'browserVersion': lock['version'], 'appArchive': app_zip.name, 'resources': resources}
    output = app_zip.with_name(f'{app_zip.stem}-offline-{platform}.zip')
    staged = work / output.name
    with ZipFile(staged, 'w', compression=ZIP_STORED) as kit:
        with app_zip.open('rb') as source, kit.open(app_zip.name, 'w') as destination:
            shutil.copyfileobj(source, destination, length=1024 * 1024)
        with browser_zip.open('rb') as source:
            for name in resources:
                with kit.open(name, 'w') as destination:
                    remaining = PART_BYTES
                    while remaining:
                        chunk = source.read(min(remaining, 1024 * 1024))
                        if not chunk:
                            break
                        destination.write(chunk)
                        remaining -= len(chunk)
        kit.writestr('offline.json', json.dumps(marker, indent=2) + '\n')
        kit.writestr('安装说明.txt', f'''网页操控 {version} · {platform}

在 Moss 应用页选择“本地安装 ZIP”，打开完整离线包 {output.name}。
安装完成后按平常方式使用网页操控。首次使用专用浏览器时会自动准备随包内核。
''')
    staged.replace(output)
    output.with_suffix('.sha256').write_text(f'{digest(output)}  {output.name}\n')
    print(output, output.stat().st_size, 'bytes')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('app_zip', type=Path)
    parser.add_argument('--browser-archive', type=Path, help='use an existing ZIP matching the pinned checksum')
    args = parser.parse_args()
    with tempfile.TemporaryDirectory(dir=args.app_zip.parent) as temp:
        build(args.app_zip, args.browser_archive, Path(temp))
