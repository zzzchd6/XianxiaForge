"""
benchmark_reflux.py — 拆解节点回流脚本（拆文系统 · 第二梯队）

把 benchmark_item 中高质量 plot 节点（material_type 非空、quality_score 达标、
尚未回流）按类型写入 4 张素材表 plot_material_{encounter,foreshadow,highlight,task}，
并写回 reflux_material_id 实现幂等。

去重逻辑与 extract_materials.upsert_material 一致：
    同表同 project 作用域内 embedding cosine 相似度 > DEDUP_THRESHOLD(0.86)
    → 库内已有更优(quality 不低于本条)则 skip，否则覆盖 update（保留 id）。

字段映射（benchmark_item → plot_material_*）：
    title / core_plot(content) / tags / quality_score / source_work(book.title)
    / source_snippet / project_id(item.project_id 优先，--project-id 覆盖)
    emotional_beat ← hook（plot 节点一般为空）；trigger_condition 等留空。

用法：
    python benchmark_reflux.py [--book-id N] [--min-quality 7] [--project-id N]
                               [--limit 0] [--dry-run]
"""
from __future__ import annotations

import argparse
import logging
import os
import sys
from typing import List, Optional

import numpy as np

from extract_materials import PG, DEDUP_THRESHOLD, TYPE_TABLE

MIN_QUALITY_DEFAULT = int(os.getenv("REFLUX_MIN_QUALITY", "7"))

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("reflux")


# ==================================================================
# 数据库
# ==================================================================
def get_conn():
    import psycopg2
    from pgvector.psycopg2 import register_vector
    conn = psycopg2.connect(**PG)
    register_vector(conn)
    return conn


def fetch_candidates(cur, book_id: Optional[int], min_quality: int,
                     limit: int) -> List[dict]:
    """选出待回流节点：plot 类型 + material_type 合法 + 质量达标 + 未回流。"""
    sql = """
        SELECT i.id, i.project_id, i.material_type, i.title, i.content,
               i.tags, i.quality_score, i.source_snippet, i.embedding,
               i.hook, b.title AS book_title
        FROM benchmark_item i
        JOIN benchmark_book b ON b.id = i.book_id AND NOT b.is_deleted
        WHERE NOT i.is_deleted
          AND i.item_type = 'plot'
          AND i.material_type IS NOT NULL
          AND i.quality_score >= %s
          AND i.reflux_material_id IS NULL
          AND i.embedding IS NOT NULL
    """
    params: list = [min_quality]
    if book_id is not None:
        sql += " AND i.book_id = %s"
        params.append(book_id)
    sql += " ORDER BY i.quality_score DESC, i.id"
    if limit > 0:
        sql += " LIMIT %s"
        params.append(limit)
    cur.execute(sql, tuple(params))
    cols = [d[0] for d in cur.description]
    return [dict(zip(cols, row)) for row in cur.fetchall()]


def upsert_reflux(cur, it: dict, project_id: Optional[int]) -> tuple:
    """
    单条回流入库（含库内去重），返回 (result, material_id)。
    result: 'insert' / 'update' / 'skip'
    """
    table = TYPE_TABLE[it["material_type"]]
    raw_emb = it["embedding"]
    if hasattr(raw_emb, "to_list"):  # pgvector Vector 对象 → list
        raw_emb = raw_emb.to_list()
    elif hasattr(raw_emb, "tolist"):
        raw_emb = raw_emb.tolist()
    emb = np.array(raw_emb, dtype=np.float32)

    if project_id is None:
        scope = "project_id IS NULL"
        scope_params: tuple = ()
    else:
        scope = "project_id = %s"
        scope_params = (project_id,)

    cur.execute(
        f"""
        SELECT id, quality_score, 1 - (embedding <=> %s) AS sim
        FROM {table}
        WHERE embedding IS NOT NULL AND NOT is_deleted AND {scope}
        ORDER BY embedding <=> %s
        LIMIT 1
        """,
        (emb, *scope_params, emb),
    )
    row = cur.fetchone()
    if row and row[2] is not None and row[2] > DEDUP_THRESHOLD:
        existing_id, existing_q = int(row[0]), row[1]
        if (existing_q or 0) >= (it["quality_score"] or 0):
            return "skip", existing_id  # 库内已有更优 → 也记录 id，避免反复重试
        cur.execute(
            f"""
            UPDATE {table} SET
              title=%s, core_plot=%s, emotional_beat=%s, tags=%s, quality_score=%s,
              source_work=%s, source_snippet=%s, embedding=%s
            WHERE id=%s
            """,
            (
                it["title"], it["content"], it["hook"], it["tags"] or [],
                it["quality_score"], it["book_title"], it["source_snippet"],
                emb, existing_id,
            ),
        )
        return "update", existing_id

    cur.execute(
        f"""
        INSERT INTO {table}
          (project_id, title, core_plot, emotional_beat, tags, quality_score,
           source_work, source_snippet, embedding)
        VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)
        RETURNING id
        """,
        (
            project_id, it["title"], it["content"], it["hook"], it["tags"] or [],
            it["quality_score"], it["book_title"], it["source_snippet"], emb,
        ),
    )
    return "insert", int(cur.fetchone()[0])


# ==================================================================
# 主流程
# ==================================================================
def main() -> int:
    parser = argparse.ArgumentParser(description="高质量拆解节点回流素材表")
    parser.add_argument("--book-id", type=int, default=None,
                        help="限定书目（默认全部书目）")
    parser.add_argument("--min-quality", type=int, default=MIN_QUALITY_DEFAULT,
                        help=f"质量分门槛（默认 {MIN_QUALITY_DEFAULT}）")
    parser.add_argument("--project-id", type=int, default=None,
                        help="覆盖目标作用域（默认沿用 item 自身 project_id）")
    parser.add_argument("--limit", type=int, default=0,
                        help="本次最多回流 N 条；0=不限")
    parser.add_argument("--dry-run", action="store_true", help="只统计不入库")
    args = parser.parse_args()

    conn = get_conn()
    stats = {"insert": 0, "update": 0, "skip": 0}
    try:
        cur = conn.cursor()
        candidates = fetch_candidates(cur, args.book_id, args.min_quality, args.limit)
        logger.info(f"候选节点 {len(candidates)} 条（quality>={args.min_quality}，未回流）")
        if not candidates:
            return 0
        by_type = {}
        for it in candidates:
            by_type[it["material_type"]] = by_type.get(it["material_type"], 0) + 1
        logger.info(f"类型分布: {by_type}")

        if args.dry_run:
            for it in candidates[:10]:
                logger.info(f"  [{it['material_type']}] q={it['quality_score']} "
                            f"《{it['title']}》← {it['book_title']}")
            logger.info("[dry-run] 不入库")
            return 0

        for it in candidates:
            pid = args.project_id if args.project_id is not None else it["project_id"]
            try:
                result, mat_id = upsert_reflux(cur, it, pid)
                # 写回回流标记（skip/update 也记录，保证幂等不再重扫）
                cur.execute(
                    "UPDATE benchmark_item SET reflux_material_id=%s WHERE id=%s",
                    (mat_id, it["id"]),
                )
                conn.commit()
                stats[result] += 1
                logger.info(f"[{result}] item#{it['id']} → {TYPE_TABLE[it['material_type']]}"
                            f"#{mat_id} 《{it['title']}》")
            except Exception as e:  # noqa: BLE001 单条失败不拖垮整批
                conn.rollback()
                logger.warning(f"回流失败，跳过 item#{it['id']} 《{it['title']}》: {e}")
        cur.close()
    finally:
        conn.close()

    logger.info(f"回流完成: insert={stats['insert']}, update={stats['update']}, "
                f"skip={stats['skip']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
