"""Run App-packaged dependencies using the Host's Python standard library."""
import json
import pathlib
import platform
import runpy
import sys

root = pathlib.Path(__file__).resolve().parent
bundle = json.loads((root / 'python-bundle.json').read_text(encoding='utf-8'))
architecture = {'aarch64': 'arm64', 'arm64': 'arm64', 'amd64': 'x64', 'x86_64': 'x64'}.get(platform.machine().lower())
if f'{sys.version_info.major}.{sys.version_info.minor}' != bundle['python']:
    raise SystemExit(f"This App requires Moss Python {bundle['python']}; update the Host runtime.")
if f'{sys.platform}-{architecture}' != bundle['platform']:
    raise SystemExit('This App package was built for a different platform; install the matching package.')
libraries = root / 'site-packages'
if not libraries.is_dir():
    raise SystemExit('App dependencies are missing; reinstall the App package.')
# -I -S excludes user/global packages, -B keeps installed App files read-only.
sys.path.insert(0, str(libraries))
sys.argv = [bundle['module'], *sys.argv[1:]]
runpy.run_module(bundle['module'], run_name='__main__', alter_sys=True)
