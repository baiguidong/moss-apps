import contextlib
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('prepare_model', Path(__file__).parents[1] / 'resources/prepare_model.py')
model = importlib.util.module_from_spec(spec)
spec.loader.exec_module(model)


class ModelPreparationTest(unittest.TestCase):
    def test_cache_validation_and_repair_only_corrupt_file_with_byte_progress(self):
        with tempfile.TemporaryDirectory() as temporary:
            cache = Path(temporary)
            snapshot = cache / ('models--' + model.REPO.replace('/', '--')) / 'snapshots' / model.REVISION
            files = {}
            for name in model.FILES:
                target = snapshot / name
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(b'valid-model')
                files[name] = hashlib.sha256(b'valid-model').hexdigest()
            marker = cache / 'moss-model.json'
            marker.write_text(json.dumps({'revision': model.REVISION, 'files': files}))
            # Cached startup must not import the network downloader at all.
            with patch.dict(sys.modules, {'huggingface_hub': None}), contextlib.redirect_stdout(io.StringIO()) as output:
                model.prepare(cache)
            self.assertIn('多语言模型已校验完成', output.getvalue())
            (snapshot / model.FILES[-1]).write_bytes(b'damaged')
            downloaded = []

            class FakeTqdm:
                def __init__(self, **kwargs):
                    self.n = 0
                    self.total = kwargs['total']
                    self.display()

            def download(repo, filename, tqdm_class, **kwargs):
                downloaded.append((filename, kwargs['force_download']))
                progress = tqdm_class(total=11)
                progress.n = 11
                progress.display()
                (snapshot / filename).write_bytes(b'valid-model')

            modules = {'huggingface_hub': types.SimpleNamespace(hf_hub_download=download), 'tqdm.auto': types.SimpleNamespace(tqdm=FakeTqdm)}
            with patch.dict(sys.modules, modules), contextlib.redirect_stdout(io.StringIO()) as output:
                model.prepare(cache)
            self.assertEqual(downloaded, [(model.FILES[-1], True)])
            events = [json.loads(line.removeprefix('MOSS_PROGRESS ')) for line in output.getvalue().splitlines()]
            self.assertTrue(any(event.get('completed') == 11 and event.get('total') == 11 for event in events))
            self.assertEqual(json.loads(marker.read_text())['files'], files)
            self.assertEqual((snapshot.parent.parent / 'refs/main').read_text(), model.REVISION)


if __name__ == '__main__':
    unittest.main()
