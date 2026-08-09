"""env_loader.py — 统一加载 Novel Studio 根目录 .env，并做变量名兼容。

Python ETL 脚本原有的配置：
    PG_HOST / PG_PORT / PG_NAME / PG_USER / PG_PASSWORD

从根目录 .env 复用 Node 侧的配置：
    CREATIVE_DB_HOST / CREATIVE_DB_PORT / CREATIVE_DB_NAME / CREATIVE_DB_USER / CREATIVE_DB_PASSWORD

本模块在 load 之后，如果检测到 PG_* 未设置但 CREATIVE_DB_* 已设置，
自动将 CREATIVE_DB_* 映射为 PG_*，保证旧脚本零改动。
"""
from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv


def load_root_dotenv() -> None:
    """
    从 monorepo 根目录加载 .env 文件，并为 Python ETL 脚本做变量名兼容。
    """
    # 本文件位于 sucaiqingxi/，向上两级就是 monorepo 根目录
    root_dir = Path(__file__).resolve().parent.parent
    env_path = root_dir / ".env"

    if env_path.exists():
        load_dotenv(dotenv_path=env_path)
    else:
        # 如果根目录没有 .env，退回到当前目录尝试加载（兼容旧启动方式）
        load_dotenv()

    # 兼容映射：Node 主服务的 CREATIVE_DB_* -> Python 侧的 PG_*
    mapping = {
        "PG_HOST": "CREATIVE_DB_HOST",
        "PG_PORT": "CREATIVE_DB_PORT",
        "PG_NAME": "CREATIVE_DB_NAME",
        "PG_USER": "CREATIVE_DB_USER",
        "PG_PASSWORD": "CREATIVE_DB_PASSWORD",
    }

    for py_key, node_key in mapping.items():
        if not os.getenv(py_key) and os.getenv(node_key):
            os.environ[py_key] = os.environ[node_key]


# 导入即执行，保证各脚本 import 后立即可用
load_root_dotenv()
