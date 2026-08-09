"""
bge_embedder.py — 共享向量化模块（ETL 与二期向量服务共用同一份实现）

设计目的：
  - 保证「ETL 入库时的素材向量」与「二期 Node 查询时的召回向量」来自
    完全相同的模型、维度、归一化方式，处于同一向量空间，余弦相似度才有意义。
  - 与诛仙库既有向量体系对齐：BAAI/bge-small-zh-v1.5，输出 512 维、归一化、cosine。

依赖：sentence-transformers（首次运行会自动下载模型权重，约 100MB）。
"""
from __future__ import annotations

import os
import threading
from typing import List

# 全局单例：模型加载昂贵，进程内只加载一次；多线程下用锁保护初始化
_model = None
_model_lock = threading.Lock()

EMBEDDING_MODEL = os.getenv("EMBEDDING_MODEL", "BAAI/bge-small-zh-v1.5")
EMBEDDING_DEVICE = os.getenv("EMBEDDING_DEVICE", "cpu")  # cpu 或 cuda
EMBEDDING_DIM = 512  # 铁律：与 pgvector VECTOR(512) 及诛仙库一致，不可改


def _get_model():
    """惰性加载模型（线程安全）。"""
    global _model
    if _model is None:
        with _model_lock:
            if _model is None:
                # 延迟 import，未安装 sentence-transformers 时给出清晰报错
                try:
                    from sentence_transformers import SentenceTransformer
                except ImportError as e:  # pragma: no cover
                    raise RuntimeError(
                        "缺少依赖 sentence-transformers，请执行 pip install -r requirements.txt"
                    ) from e
                _model = SentenceTransformer(EMBEDDING_MODEL, device=EMBEDDING_DEVICE)
    return _model


def embed_texts(texts: List[str], batch_size: int = 32) -> List[List[float]]:
    """
    将一批文本向量化为 512 维归一化向量。

    Args:
        texts: 文本列表。空串会被替换为单空格，避免模型报错。
        batch_size: 批大小，CPU 上 32 较稳。

    Returns:
        与 texts 等长的向量列表，每个是 512 维 float 列表。
    """
    if not texts:
        return []
    safe_texts = [(t if (t and t.strip()) else " ") for t in texts]
    model = _get_model()
    # normalize_embeddings=True → 输出单位向量，配合 pgvector cosine 距离
    vecs = model.encode(
        safe_texts,
        batch_size=batch_size,
        normalize_embeddings=True,
        show_progress_bar=False,
        convert_to_numpy=True,
    )
    # 维度自检：模型输出必须是 512 维，否则与库结构不兼容，尽早失败
    if vecs.shape[1] != EMBEDDING_DIM:
        raise RuntimeError(
            f"模型输出维度 {vecs.shape[1]} ≠ 期望 {EMBEDDING_DIM}，"
            f"请确认 EMBEDDING_MODEL={EMBEDDING_MODEL} 为 512 维模型"
        )
    return vecs.tolist()


def embed_one(text: str) -> List[float]:
    """单条文本向量化，便捷封装。"""
    return embed_texts([text])[0]


def to_pgvector_literal(vec: List[float]) -> str:
    """
    将向量转为 pgvector 可识别的字面量字符串，如 '[0.1,0.2,...]'。
    用于不依赖 pgvector 适配器时的手动拼接（psycopg 参数化传入）。
    """
    return "[" + ",".join(f"{x:.7f}" for x in vec) + "]"
