"""
serve_embedding.py — embedding_server 的生产级启动器（waitress WSGI）

为什么需要它：
    embedding_server.py 直接 app.run() 用的是 Flask 自带开发服务器，会打印
    "development server, do not use in production" 告警，且并发/稳定性不适合
    二期长期常驻。本脚本用 waitress（纯 Python、Windows 友好的 WSGI 服务器）
    托管同一个 Flask app，不改动 embedding_server.py 一行（零侵入，复用其 app 与预热）。

用法：
    .venv\\Scripts\\python.exe serve_embedding.py
    # 环境变量（与 embedding_server 一致）：
    #   EMBEDDING_SERVER_HOST（默认 127.0.0.1，生产建议本机回环；跨机再放开）
    #   EMBEDDING_SERVER_PORT（默认 8600）
    #   EMBEDDING_SERVER_THREADS（默认 8，waitress 工作线程数）

依赖：
    pip install waitress   （已加入 requirements.txt）
"""
from __future__ import annotations

import os

# 复用 embedding_server 里已建好的 Flask app；导入即触发其 load_dotenv()
from embedding_server import app
import bge_embedder


def main() -> None:
    host = os.getenv("EMBEDDING_SERVER_HOST", "127.0.0.1")
    port = int(os.getenv("EMBEDDING_SERVER_PORT", "8600"))
    threads = int(os.getenv("EMBEDDING_SERVER_THREADS", "8"))

    try:
        from waitress import serve
    except ImportError as e:  # pragma: no cover
        raise SystemExit(
            "缺少依赖 waitress，请执行：.venv\\Scripts\\pip install waitress"
        ) from e

    # 启动即预热模型，避免首个请求超时（与 embedding_server.py __main__ 行为一致）
    print(f"[serve-embedding] 预热模型 {bge_embedder.EMBEDDING_MODEL} …")
    bge_embedder.embed_one("预热")
    print(f"[serve-embedding] waitress 就绪，监听 http://{host}:{port}（threads={threads}）")

    serve(app, host=host, port=port, threads=threads)


if __name__ == "__main__":
    main()
