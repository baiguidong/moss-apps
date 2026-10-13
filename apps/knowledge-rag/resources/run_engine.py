"""Run the pinned upstream server; stop if its owning App Backend disappears."""
import os
import signal
import threading
import time
import json


def progress(detail):
    print('MOSS_PROGRESS ' + json.dumps({'detail': detail}, ensure_ascii=False), flush=True)

parent_pid = os.getppid()


def watch_parent():
    while True:
        time.sleep(2)
        if os.getppid() != parent_pid:
            os.kill(os.getpid(), signal.SIGTERM)
            return


threading.Thread(target=watch_parent, daemon=True).start()

# Register the public ONNX export using FastEmbed's supported custom-model API.
# E5's query/passage prefixes are applied by knowledge-rag's embedding provider.
progress('正在加载本地推理组件…')
from fastembed import TextEmbedding
from fastembed.common.model_description import ModelSource, PoolingType

TextEmbedding.add_custom_model(
    model="intfloat/multilingual-e5-small",
    pooling=PoolingType.MEAN,
    normalization=True,
    sources=ModelSource(hf="Xenova/multilingual-e5-small"),
    dim=384,
    model_file="onnx/model_quantized.onnx",
    description="Multilingual E5 small, quantized ONNX export",
    license="mit",
    size_in_gb=0.12,
)
from mcp_server import preflight
import subprocess
import sys


def probe_chroma_readonly(timeout_seconds=preflight.PROBE_TIMEOUT_SECONDS):
    """4.11.0 creates a default-embedding collection in its probe; never create one.

    The original recovery/locking flow remains intact. In particular, an existing
    incompatible index is not removed or opened with a different embedding.
    """
    progress(f'正在检查已有索引，每次检查最多等待 {timeout_seconds} 秒…')
    code = """
import chromadb
from mcp_server.config import config
if not config.chroma_dir.exists():
    print('missing')
    raise SystemExit(0)
client = chromadb.PersistentClient(path=str(config.chroma_dir))
try:
    collection = client.get_collection(name=config.collection_name, embedding_function=None)
except chromadb.errors.NotFoundError:
    print('missing collection')
else:
    print(collection.count())
"""
    return subprocess.run([sys.executable, '-c', code], env=os.environ.copy(),
                          text=True, capture_output=True, timeout=timeout_seconds, check=False)


preflight._probe_chroma = probe_chroma_readonly
progress('正在初始化检索服务与索引组件…')
from mcp_server.server import main

main()
