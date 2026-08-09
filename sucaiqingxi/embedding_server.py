"""
embedding_server.py — bge 512 维向量小服务（二期 RAG 召回依赖）

作用：
    Novel Studio 后端当前无 query-time embedding 能力（context-builder.ts
    的向量检索被置空）。本服务把 ETL 用的同一个 bge-small-zh-v1.5 模型
    暴露为 HTTP 接口，二期 plot-material-retriever.ts 在召回时调用它把
    「章节 intent + sceneBreakdown」向量化，再用 pgvector 做 top-2 语义召回，
    保证查询向量与入库向量同源同空间。

启动：
    python embedding_server.py
    # 默认监听 0.0.0.0:8600，可用 EMBEDDING_SERVER_HOST/PORT 覆盖

接口：
    GET  /health
        → {"status":"ok","model":"BAAI/bge-small-zh-v1.5","dim":512}

    POST /embed            （简单接口，供 Node 直接调用）
        body: {"texts": ["...", "..."]}
        → {"embeddings": [[...512...], ...], "dim": 512}

    POST /v1/embeddings    （OpenAI-compatible，可用 openai SDK 直接对接）
        body: {"input": "..." | ["...", ...], "model": "..."}
        → {"data":[{"embedding":[...],"index":0}], "model":"...", ...}
"""
from __future__ import annotations

import os

from flask import Flask, jsonify, request

import bge_embedder
import env_loader  # noqa: F401  # 从根目录加载 .env 并做 PG_* 兼容映射

app = Flask(__name__)


@app.get("/health")
def health():
    return jsonify(status="ok", model=bge_embedder.EMBEDDING_MODEL, dim=bge_embedder.EMBEDDING_DIM)


@app.post("/embed")
def embed():
    """简单接口：{"texts": [...]} → {"embeddings": [[...]]}"""
    data = request.get_json(silent=True) or {}
    texts = data.get("texts")
    if isinstance(texts, str):
        texts = [texts]
    if not isinstance(texts, list) or not texts:
        return jsonify(error="texts 必须为非空数组或字符串"), 400
    try:
        vecs = bge_embedder.embed_texts([str(t) for t in texts])
    except Exception as e:  # noqa: BLE001
        return jsonify(error=str(e)), 500
    return jsonify(embeddings=vecs, dim=bge_embedder.EMBEDDING_DIM)


@app.post("/v1/embeddings")
def openai_embeddings():
    """OpenAI-compatible 接口，便于用 openai SDK 直连（baseURL 指向本服务）。"""
    data = request.get_json(silent=True) or {}
    inp = data.get("input")
    if isinstance(inp, str):
        inp = [inp]
    if not isinstance(inp, list) or not inp:
        return jsonify(error={"message": "input 必须为非空字符串或数组"}), 400
    try:
        vecs = bge_embedder.embed_texts([str(t) for t in inp])
    except Exception as e:  # noqa: BLE001
        return jsonify(error={"message": str(e)}), 500
    return jsonify(
        object="list",
        data=[{"object": "embedding", "index": i, "embedding": v} for i, v in enumerate(vecs)],
        model=data.get("model") or bge_embedder.EMBEDDING_MODEL,
        usage={"prompt_tokens": 0, "total_tokens": 0},
    )


if __name__ == "__main__":
    host = os.getenv("EMBEDDING_SERVER_HOST", "0.0.0.0")
    port = int(os.getenv("EMBEDDING_SERVER_PORT", "8600"))
    # 启动即预热模型，避免首个请求超时
    print(f"[embedding-server] 预热模型 {bge_embedder.EMBEDDING_MODEL} …")
    bge_embedder.embed_one("预热")
    print(f"[embedding-server] 就绪，监听 http://{host}:{port}")
    app.run(host=host, port=port, threaded=True)
