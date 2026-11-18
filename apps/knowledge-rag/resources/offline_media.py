"""Check the selected offline directory against the installed App's own locks."""
import hashlib
import json
import platform
from pathlib import Path
import re
import sys

RESOURCES = Path(__file__).resolve().parent


def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def identity(resources=RESOURCES):
    app = json.loads((resources.parent / 'app.moss.json').read_text())
    return {
        'format': 1, 'appId': app['id'], 'version': app['version'],
        'platform': 'darwin-arm64', 'python': 'cpython-3.13',
        'requirementsSha256': digest(resources / 'requirements.lock'),
        'modelRevision': json.loads((resources / 'model.lock.json').read_text())['revision'],
    }


def check_platform():
    if (sys.platform, platform.machine(), sys.implementation.name, sys.version_info[:2]) != ('darwin', 'arm64', 'cpython', (3, 13)):
        raise ValueError('此离线包需要 Apple Silicon Mac 和 Moss 内置 CPython 3.13。')


def validate(marker):
    check_platform()
    if marker.name != 'offline.json' or not marker.is_file() or marker.stat().st_size > 4096:
        raise ValueError('请选择离线包解压目录中的 offline.json。')
    if json.loads(marker.read_text()) != identity():
        raise ValueError('离线资源与当前 App 版本、平台或依赖锁不匹配。请选择同版本的离线包。')
    root = marker.parent.resolve()
    wheels = root / 'wheels'
    if wheels.resolve() != wheels or not wheels.is_dir():
        raise ValueError('离线包缺少 wheels 目录。')
    entries = list(wheels.iterdir())
    if not entries or any(not p.is_file() or p.is_symlink() or not re.fullmatch(r'[a-zA-Z0-9._+!-]+\.whl', p.name) for p in entries):
        raise ValueError('离线包中的 wheels 目录无效。')
    # pip verifies wheel contents against the installed requirements.lock before installation.
    for name in json.loads((RESOURCES / 'model.lock.json').read_text())['files']:
        file = root / 'model' / name
        if file.resolve() != file or not file.is_file():
            raise ValueError(f'离线包缺少模型文件：{name}')


if __name__ == '__main__':
    validate(Path(sys.argv[1]))
