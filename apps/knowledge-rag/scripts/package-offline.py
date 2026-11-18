"""Build a portable offline kit around the exact ZIP used for online installs."""
import argparse
import json
import os
import shutil
from pathlib import Path
import subprocess
import sys
import tempfile
from urllib.parse import unquote, urlsplit
from urllib.request import urlretrieve
from zipfile import ZIP_DEFLATED, ZIP_STORED, ZipFile, ZipInfo

RESOURCES = Path(__file__).resolve().parents[1] / 'resources'
sys.dont_write_bytecode = True
sys.path.insert(0, str(RESOURCES))
from offline_media import check_platform, digest, identity


def build(app_zip, wheels, model_dir, work):
    check_platform()
    expected = identity()
    with ZipFile(app_zip) as app:
        manifest = json.loads(app.read('app.moss.json'))
        if (manifest['id'], manifest['version']) != (expected['appId'], expected['version']):
            raise ValueError('App ZIP version mismatch')
        for name in ('model.lock.json', 'requirements.lock', 'offline_media.py', 'MODEL-LICENSE.txt'):
            if app.read('resources/' + name) != (RESOURCES / name).read_bytes():
                raise ValueError('App ZIP source differs: ' + name)
    if digest(app_zip) != app_zip.with_suffix('.sha256').read_text().split()[0]:
        raise ValueError('App ZIP checksum mismatch')

    requirements = RESOURCES / 'requirements.lock'
    options = ['--only-binary=:all:', '--require-hashes', '-r', str(requirements), '--disable-pip-version-check']
    pip = [sys.executable, '-I', '-m', 'pip']
    if wheels is None:
        wheels = work / 'wheels'
        subprocess.run([*pip, 'download', '--dest', str(wheels), *options], check=True)
    wheels = wheels.resolve()
    # Resolve from scratch on the actual target. Include exactly the selected files.
    result = work / 'resolved.json'
    subprocess.run([*pip, '--isolated', 'install', '--dry-run', '--ignore-installed', '--no-cache-dir',
                    '--no-index', '--find-links', str(wheels), '--report', str(result), *options],
                   check=True, env={**os.environ, 'PIP_CONFIG_FILE': os.devnull})
    artifacts = []
    for item in json.loads(result.read_text())['install']:
        url = urlsplit(item['download_info']['url'])
        wheel = Path(unquote(url.path)).resolve()
        if url.scheme != 'file' or wheel.parent != wheels or wheel.suffix != '.whl':
            raise ValueError('Expected a local locked wheel')
        artifacts.append((wheel, 'wheels/' + wheel.name, ZIP_STORED))

    model = json.loads((RESOURCES / 'model.lock.json').read_text())
    for name, expected_hash in model['files'].items():
        if model_dir:
            file = model_dir / name
        else:
            file = work / 'model' / name
            file.parent.mkdir(parents=True, exist_ok=True)
            urlretrieve(f"https://huggingface.co/{model['repo']}/resolve/{model['revision']}/{name}", file)
        if digest(file) != expected_hash:
            raise ValueError('Model checksum mismatch: ' + name)
        artifacts.append((file, 'model/' + name, ZIP_DEFLATED))

    output = app_zip.with_name(app_zip.stem + '-offline-darwin-arm64.zip')
    with ZipFile(work / 'kit.zip', 'w') as kit:
        artifacts.append((app_zip, app_zip.name, ZIP_STORED))
        artifacts.append((RESOURCES / 'MODEL-LICENSE.txt', 'model/LICENSE.txt', ZIP_STORED))
        for source, name, compression in sorted(artifacts, key=lambda item: item[1]):
            entry = ZipInfo(name)
            entry.compress_type = compression
            with source.open('rb') as stream, kit.open(entry, 'w') as dest:
                shutil.copyfileobj(stream, dest, length=1024 * 1024)
        kit.writestr(ZipInfo('offline.json'), json.dumps(expected, indent=2))
        kit.writestr(ZipInfo('安装说明.txt'), f"""语义知识库 {expected['version']} · macOS Apple Silicon 离线安装

需要带内置 Python 3.13 的 Moss 桌面版。新电脑请一并带入对应的 Moss 安装程序。
1. 完整解压本包，在 Moss 应用页选择“本地安装 ZIP”，打开 {app_zip.name}。
2. 打开“语义知识库”，点击“选择离线包”，选取本目录中的 offline.json。
3. 等待依赖与模型校验、安装完成，即可导入本地文档和搜索。请保留整包供修复或其他机器安装。
模型来源 https://huggingface.co/{model['repo']}/tree/{model['revision']}
""")
    (work / 'kit.zip').replace(output)
    output.with_suffix('.sha256').write_text(f'{digest(output)}  {output.name}\n')
    print(output, output.stat().st_size, 'bytes')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('app_zip', type=Path)
    parser.add_argument('--wheels', type=Path, help='verify and use an existing wheel directory')
    parser.add_argument('--model-dir', type=Path, help='verify and use a local pinned snapshot')
    args = parser.parse_args()
    with tempfile.TemporaryDirectory(dir=args.app_zip.parent) as staging:
        build(args.app_zip, args.wheels, args.model_dir, Path(staging))
