"""Validate/reuse the pinned E5 export and stream real per-file byte progress."""
import hashlib
import json
import os
from pathlib import Path
import sys
import time

os.environ.setdefault('HF_HUB_DISABLE_XET', '1')
os.environ.setdefault('HF_HUB_ETAG_TIMEOUT', '15')
os.environ.setdefault('HF_HUB_DOWNLOAD_TIMEOUT', '30')
REPO = 'Xenova/multilingual-e5-small'
REVISION = '761b726dd34fb83930e26aab4e9ac3899aa1fa78'
FILES = ['config.json', 'tokenizer.json', 'tokenizer_config.json', 'special_tokens_map.json', 'onnx/model_quantized.onnx']


def report(detail, **values):
    print('MOSS_PROGRESS ' + json.dumps({'detail': detail, **values}, ensure_ascii=False), flush=True)


def file_hash(file):
    digest = hashlib.sha256()
    with file.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def prepare(cache, allow_download=False):
    marker = cache / 'moss-model.json'
    try:
        previous = json.loads(marker.read_text())
    except (OSError, ValueError):
        previous = {}
    snapshot = cache / ('models--' + REPO.replace('/', '--')) / 'snapshots' / REVISION
    hashes = {}
    for index, name in enumerate(FILES, 1):
        target = snapshot / name
        report(f'正在校验模型文件 {index}/{len(FILES)}：{name}')
        expected = previous.get('files', {}).get(name) if previous.get('revision') == REVISION else None
        actual = file_hash(target) if target.is_file() else None
        if not actual or not expected or actual != expected:
            if not allow_download:
                raise RuntimeError('本地模型缺失或校验失败，请显式准备检索引擎。')
            report(f'正在连接模型下载服务（文件 {index}/{len(FILES)}）：{name}')
            from huggingface_hub import hf_hub_download
            from tqdm.auto import tqdm

            class DownloadProgress(tqdm):
                def __init__(self, *args, **kwargs):
                    self.last_report = 0
                    kwargs['disable'] = False
                    super().__init__(*args, **kwargs)

                def display(self, *args, **kwargs):
                    now = time.monotonic()
                    if now - self.last_report >= 0.25 or self.n == self.total:
                        self.last_report = now
                        report(f'正在下载模型文件 {index}/{len(FILES)}：{name}',
                               completed=self.n, total=self.total, file=name)

            hf_hub_download(REPO, filename=name, revision=REVISION, cache_dir=str(cache),
                            # Repair only the damaged file. Incomplete downloads resume via HF's cache.
                            force_download=bool(actual and expected and actual != expected),
                            tqdm_class=DownloadProgress, etag_timeout=15)
            report(f'正在校验下载结果 {index}/{len(FILES)}：{name}')
            actual = file_hash(target)
        hashes[name] = actual
    # FastEmbed resolves main while offline; bind it to the fully downloaded revision.
    ref = snapshot.parent.parent / 'refs' / 'main'
    ref.parent.mkdir(parents=True, exist_ok=True)
    if not ref.exists() or ref.read_text() != REVISION:
        ref.write_text(REVISION)
    contents = json.dumps({'repo': REPO, 'revision': REVISION, 'files': hashes}, indent=2)
    if not marker.exists() or marker.read_text() != contents:
        temporary = marker.with_suffix('.tmp')
        temporary.write_text(contents)
        temporary.replace(marker)
    report('多语言模型已校验完成，可直接从本机加载')


if __name__ == '__main__':
    prepare(Path(sys.argv[1]), allow_download='--allow-download' in sys.argv[2:])
