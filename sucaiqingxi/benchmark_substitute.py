"""
benchmark_substitute.py — 变量替换基础工作流（拆文系统 · 第三梯队）

把对标书的 9 变量骨架抽象"换题材实例化"：
    1) 读目标书目的 item_type='variable' 节点（先跑 benchmark_variables.py）
    2) 从 plot_domain_knowledge RAG 召回目标题材领域知识（跨题材映射不硬编码，
       走领域知识库动态检索；向量不可用时降级 ILIKE 关键字）
    3) LLM 生成替换方案：保留结构规律与关系模型，仅替换题材外壳（换/缝原则）

用法：
    python benchmark_substitute.py --book-id N --target-domain "都市"
                                   [--top-k 6] [--dump FILE]
"""
from __future__ import annotations

import argparse
import json
import logging
import os
import sys
from typing import Dict, List, Optional

from extract_materials import call_llm, parse_json, _clip, PG
import bge_embedder

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("substitute")

SUB_SYSTEM_PROMPT = (
    "你是资深网文策划，擅长把成熟作品的抽象结构迁移到新题材（表层换壳+中层缝合，"
    "保留引擎驱动原理）。所有产出给出具体可用的设定，禁止照抄原文专名。只输出 JSON。"
)

SUB_PROMPT = """把《{book}》的抽象变量骨架迁移到目标题材「{domain}」。

【抽象变量骨架】
{variables}

【目标题材领域知识参考（可部分采用）】
{knowledge}

对每个变量输出替换方案。输出严格JSON:
{{"replacements":[{{"variable":"变量名","original":"≤50字原抽象骨架","replacement":"≤150字目标题材实例化设定"}}, ...],"transfer_notes":"≤150字,迁移注意事项(题材绑定度/需调整的引擎点)"}}
"""


# ==================================================================
# 数据库
# ==================================================================
def get_conn():
    import psycopg2
    from pgvector.psycopg2 import register_vector
    conn = psycopg2.connect(**PG)
    register_vector(conn)
    return conn


def load_variables(cur, book_id: int) -> tuple:
    cur.execute(
        "SELECT title FROM benchmark_book WHERE id=%s AND NOT is_deleted", (book_id,),
    )
    row = cur.fetchone()
    if not row:
        raise ValueError(f"书目 {book_id} 不存在或已删除")
    cur.execute(
        "SELECT title, content FROM benchmark_item "
        "WHERE book_id=%s AND item_type='variable' AND NOT is_deleted ORDER BY id",
        (book_id,),
    )
    return row[0], [dict(zip(("title", "content"), r)) for r in cur.fetchall()]


def recall_knowledge_semantic(cur, domain: str, top_k: int) -> List[dict]:
    """向量召回目标题材领域知识。失败返回 None 由上层降级。"""
    try:
        vec = bge_embedder.embed_texts([f"{domain}题材的设定规则与典型案例"])[0]
    except Exception as e:  # noqa: BLE001
        logger.warning(f"向量化失败，降级关键字召回: {e}")
        return []
    import numpy as np
    emb = np.array(vec, dtype=np.float32)
    cur.execute(
        """
        SELECT id, title, content, knowledge_type, applicable_domain,
               1 - (embedding <=> %s) AS sim
        FROM plot_domain_knowledge
        WHERE NOT is_deleted AND embedding IS NOT NULL
          AND (applicable_domain IS NULL OR applicable_domain ILIKE %s)
        ORDER BY embedding <=> %s LIMIT %s
        """,
        (emb, f"%{domain}%", emb, top_k),
    )
    cols = [d[0] for d in cur.description]
    return [dict(zip(cols, r)) for r in cur.fetchall() if r[5] is None or r[5] > 0.3]


def recall_knowledge_keyword(cur, domain: str, top_k: int) -> List[dict]:
    cur.execute(
        """
        SELECT id, title, content, knowledge_type, applicable_domain, NULL AS sim
        FROM plot_domain_knowledge
        WHERE NOT is_deleted
          AND (applicable_domain ILIKE %s OR title ILIKE %s OR content ILIKE %s)
        ORDER BY quality_score DESC, id LIMIT %s
        """,
        (f"%{domain}%", f"%{domain}%", f"%{domain}%", top_k),
    )
    cols = [d[0] for d in cur.description]
    return [dict(zip(cols, r)) for r in cur.fetchall()]


# ==================================================================
# 主流程
# ==================================================================
def main() -> int:
    parser = argparse.ArgumentParser(description="变量替换工作流（题材迁移实例化）")
    parser.add_argument("--book-id", type=int, required=True, help="对标书目 ID（需已有变量节点）")
    parser.add_argument("--target-domain", required=True, help="目标题材，如 都市/科幻/女频古言")
    parser.add_argument("--top-k", type=int, default=6, help="领域知识召回条数")
    parser.add_argument("--dump", default=None, metavar="FILE", help="导出替换方案 JSON")
    args = parser.parse_args()

    conn = get_conn()
    try:
        cur = conn.cursor()
        book_title, variables = load_variables(cur, args.book_id)
        if not variables:
            logger.error("该书目没有变量节点，请先运行 benchmark_variables.py")
            return 1
        logger.info(f"《{book_title}》变量节点 {len(variables)} 条")

        knowledge = recall_knowledge_semantic(cur, args.target_domain, args.top_k)
        if not knowledge:
            logger.info("语义召回为空，降级关键字召回")
            knowledge = recall_knowledge_keyword(cur, args.target_domain, args.top_k)
        logger.info(f"领域知识召回 {len(knowledge)} 条（题材: {args.target_domain}）")
        cur.close()
    finally:
        conn.close()

    var_txt = "\n".join(f"- {v['title']}：{_clip(v['content'], 200)}" for v in variables)
    kn_txt = "\n".join(
        f"- [{k['knowledge_type']}/{k.get('applicable_domain') or '通用'}] "
        f"{k['title']}：{_clip(k['content'], 150)}"
        for k in knowledge
    ) or "（无可用领域知识，请基于常识完成迁移）"

    messages = [
        {"role": "system", "content": SUB_SYSTEM_PROMPT},
        {"role": "user", "content": SUB_PROMPT.format(
            book=book_title, domain=args.target_domain,
            variables=var_txt, knowledge=kn_txt)},
    ]
    logger.info("生成替换方案…")
    try:
        data = parse_json(call_llm(messages)) or {}
    except Exception as e:  # noqa: BLE001
        logger.error(f"LLM 调用失败: {e}")
        return 1

    replacements = data.get("replacements") or []
    logger.info(f"产出替换方案 {len(replacements)} 条")
    for r in replacements:
        if isinstance(r, dict):
            logger.info(f"  [{_clip(r.get('variable'), 20)}] → {_clip(r.get('replacement'), 80)}")
    notes = _clip(data.get("transfer_notes"), 300)
    if notes:
        logger.info(f"迁移注意：{notes}")

    if args.dump:
        payload = {
            "book": book_title, "target_domain": args.target_domain,
            "knowledge_used": [k["title"] for k in knowledge],
            "replacements": replacements, "transfer_notes": notes,
        }
        try:
            with open(args.dump, "w", encoding="utf-8") as f:
                json.dump(payload, f, ensure_ascii=False, indent=2)
            logger.info(f"已导出到 {args.dump}")
        except OSError as e:
            logger.warning(f"导出失败: {e}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
