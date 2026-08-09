"""
benchmark_variables.py — 变量级拆解脚本（拆文系统 · 第三梯队）

对已拆解书目做变量级抽象：
    A. 9 变量抽取（书级）：基于已有 skeleton + plot 节点，单次 LLM 调用提取
       9 个可跨作品替换的抽象变量（来源：Lorn 套路四级分类 + 内核三问）。
    B. 启发式减法测试：零 token 预筛（material_type ∈ task/highlight 且
       quality_score ≥ 门槛 的"推进型/爆发型"节点）→ 仅对候选做 LLM 减法判定
       （核心支点 / 可替换 / 部分），结果写回节点 tags。

入库：变量 → benchmark_item(item_type='variable')，每书 9 条 + 1 条跨卷问题链
（title 前缀「变量·」），tags 含变量键名；幂等：已有 variable 节点默认跳过。

用法：
    python benchmark_variables.py --book-id N [--max-skeletons 30] [--max-plots 30]
                                  [--subtract-limit 12] [--min-quality 7]
                                  [--skip-subtraction] [--force] [--dry-run]
                                  [--dump FILE]
"""
from __future__ import annotations

import argparse
import json
import logging
import os
import sys
import time
from typing import Dict, List, Optional

import numpy as np

from extract_materials import call_llm, parse_json, _clip, PG
import bge_embedder

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("variables")

# ------------------------------------------------------------------
# 9 变量定义（业主确认清单：Lorn 套路四级分类 + 内核三问提炼）
# ------------------------------------------------------------------
VARIABLE_KEYS: List[tuple] = [
    ("opening_setup", "开局设定", "主角初始处境+开局套路指纹（重生/穿越/系统/废材等），抽象化禁专名"),
    ("cheat_engine", "金手指/驱动力", "金手指的获得方式与它如何持续制造新冲突/新选择（绑定主线的模式）"),
    ("worldview", "世界观框架", "力量体系/世界运行规则/阶层结构（抽象为通用规则，禁专名）"),
    ("core_conflict", "核心冲突", "主要对立面结构与贯穿全书的主矛盾线"),
    ("event_chain", "事件链模板", "情节推进的套路模板：核心事件序列抽象（≥3节点）"),
    ("relation_tension", "关系张力结构", "核心人物关系配置与张力模型（权力/情感位置与逆转）"),
    ("reward_engine", "情绪回报引擎", "读者每章获得的最强情绪回报类型与兑现节奏"),
    ("growth_beat", "成长节奏节拍", "升级/成长节拍密度与跨卷问题链的移位方式"),
    ("hook_craft", "钩子手法", "章末钩子/悬念的常用手法组合"),
]
VAR_KEY_SET = {k for k, _, _ in VARIABLE_KEYS}

VAR_SYSTEM_PROMPT = (
    "你是资深网文结构分析师，擅长从拆解产物中提炼可跨作品替换的抽象变量。"
    "所有产出必须抽象化，禁止出现原文专名（人名/地名/功法名/门派名）。只输出 JSON。"
)

VAR_PROMPT = """下方是《{book}》已拆解的章级骨架与情节节点摘要。请提炼 9 个可跨作品替换的抽象变量。

变量清单（逐项输出 content + transferability + quality_score）:
{var_list}

输出严格JSON:
{{"variables":{{"opening_setup":{{"content":"≤150字抽象描述","transferability":"通用可迁移|题材半绑定|强绑定","quality_score":1-10}}, ...共9个键}},"question_chain":"≤120字,跨卷问题链移位:第一卷追什么→第二卷变成什么→..."}}

【章级骨架摘要】
{skeletons}

【情节节点摘要】
{plots}
"""

SUBTRACT_SYSTEM_PROMPT = (
    "你是资深网文编辑，擅长判断情节节点在故事中的结构作用。只输出 JSON。"
)

SUBTRACT_PROMPT = """对下方情节节点逐个做减法测试：假设删掉该节点，判断故事主线逻辑是否仍然成立。
判定三档：pivot(核心支点:删掉主线断裂) / removable(可替换:功能可由其他桥段承担) / partial(部分:删掉需局部修补)。

输出严格JSON: {{"verdicts":[{{"id":节点id,"verdict":"pivot|removable|partial","reason":"≤40字"}}]}}

【节点列表】
{nodes}
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


def load_items(cur, book_id: int, item_type: str, min_quality: int,
               limit: int, material_types: Optional[tuple] = None) -> List[dict]:
    sql = ("SELECT id, chapter_idx, title, content, hook, material_type, quality_score, tags "
           "FROM benchmark_item WHERE book_id=%s AND item_type=%s AND NOT is_deleted")
    params: list = [book_id, item_type]
    if min_quality > 0:
        sql += " AND quality_score >= %s"
        params.append(min_quality)
    if material_types:
        sql += " AND material_type IN %s"
        params.append(material_types)
    sql += " ORDER BY quality_score DESC, chapter_idx NULLS LAST, id"
    if limit > 0:
        sql += " LIMIT %s"
        params.append(limit)
    cur.execute(sql, tuple(params))
    cols = [d[0] for d in cur.description]
    return [dict(zip(cols, row)) for row in cur.fetchall()]


def soft_delete_variables(cur, book_id: int) -> int:
    cur.execute(
        "UPDATE benchmark_item SET is_deleted=TRUE WHERE book_id=%s AND item_type='variable'",
        (book_id,),
    )
    return cur.rowcount


def insert_variable_item(cur, book_id: int, project_id: Optional[int],
                         title: str, content: str, tags: List[str],
                         quality: int, emb: np.ndarray) -> None:
    cur.execute(
        """
        INSERT INTO benchmark_item
          (book_id, project_id, item_type, title, content, material_type,
           tags, quality_score, embedding)
        VALUES (%s,%s,'variable',%s,%s,NULL,%s,%s,%s)
        """,
        (book_id, project_id, title, content, tags, quality, emb),
    )


# ==================================================================
# A. 9 变量抽取
# ==================================================================
def build_var_prompt(cur, book_id: int, book_title: str,
                     max_skeletons: int, max_plots: int) -> Optional[List[dict]]:
    skeletons = load_items(cur, book_id, "skeleton", 0, max_skeletons)
    plots = load_items(cur, book_id, "plot", 0, max_plots)
    if not skeletons and not plots:
        return None
    sk_txt = "\n".join(
        f"- [第{s['chapter_idx'] or '?'}章] {s['title']}｜{_clip(s['content'], 300)}"
        + (f"｜钩子:{_clip(s['hook'], 60)}" if s.get("hook") else "")
        for s in skeletons
    ) or "（无）"
    pl_txt = "\n".join(
        f"- [{p['material_type'] or '?'}] {p['title']}｜{_clip(p['content'], 200)}"
        for p in plots
    ) or "（无）"
    var_list = "\n".join(f"- {k}: {name} — {desc}" for k, name, desc in VARIABLE_KEYS)
    user = VAR_PROMPT.format(
        book=book_title, var_list=var_list, skeletons=sk_txt, plots=pl_txt,
    )
    return [
        {"role": "system", "content": VAR_SYSTEM_PROMPT},
        {"role": "user", "content": user},
    ]


def parse_variables(data) -> List[dict]:
    """校验变量输出，返回待入库 item 列表（含跨卷问题链条目）。"""
    items: List[dict] = []
    if not isinstance(data, dict):
        return items
    vmap = data.get("variables") or {}
    name_of = {k: n for k, n, _ in VARIABLE_KEYS}
    for key, name, _ in VARIABLE_KEYS:
        raw = vmap.get(key)
        if not isinstance(raw, dict):
            continue
        content = _clip(raw.get("content"), 600)
        if not content:
            continue
        trans = _clip(raw.get("transferability"), 20)
        if trans:
            content = f"【可迁移性:{trans}】{content}"
        try:
            q = max(0, min(10, int(raw.get("quality_score", 0))))
        except (TypeError, ValueError):
            q = 0
        items.append({
            "title": f"变量·{name}",
            "content": content,
            "tags": ["变量", key],
            "quality_score": q,
        })
    chain = _clip(data.get("question_chain"), 400)
    if chain:
        items.append({
            "title": "变量·跨卷问题链",
            "content": chain,
            "tags": ["变量", "question_chain"],
            "quality_score": 7,
        })
    return items


# ==================================================================
# B. 启发式减法测试
# ==================================================================
def build_subtract_prompt(candidates: List[dict]) -> List[dict]:
    nodes_txt = "\n".join(
        f"- id={p['id']} [{p['material_type']}] {p['title']}｜{_clip(p['content'], 200)}"
        for p in candidates
    )
    return [
        {"role": "system", "content": SUBTRACT_SYSTEM_PROMPT},
        {"role": "user", "content": SUBTRACT_PROMPT.format(nodes=nodes_txt)},
    ]


VERDICT_TAG = {"pivot": "核心支点", "removable": "可替换桥段", "partial": "局部支点"}


def apply_verdicts(cur, verdicts: List[dict]) -> Dict[str, int]:
    stats = {"pivot": 0, "removable": 0, "partial": 0, "invalid": 0}
    by_id = {v.get("id"): v for v in verdicts if isinstance(v, dict)}
    for node_id, v in by_id.items():
        verdict = str(v.get("verdict") or "").strip()
        if verdict not in VERDICT_TAG or node_id is None:
            stats["invalid"] += 1
            continue
        tag = VERDICT_TAG[verdict]
        cur.execute(
            "UPDATE benchmark_item SET tags = array_append(tags, %s) "
            "WHERE id=%s AND NOT (%s = ANY(tags))",
            (tag, int(node_id), tag),
        )
        stats[verdict] += 1
    return stats


# ==================================================================
# 主流程
# ==================================================================
def main() -> int:
    parser = argparse.ArgumentParser(description="变量级拆解（9变量+启发式减法测试）")
    parser.add_argument("--book-id", type=int, required=True, help="目标书目 ID")
    parser.add_argument("--max-skeletons", type=int, default=30, help="输入骨架上限")
    parser.add_argument("--max-plots", type=int, default=30, help="输入情节节点上限")
    parser.add_argument("--subtract-limit", type=int, default=12, help="减法测试候选上限")
    parser.add_argument("--min-quality", type=int, default=7, help="减法测试候选质量门槛")
    parser.add_argument("--skip-subtraction", action="store_true", help="跳过减法测试")
    parser.add_argument("--force", action="store_true", help="软删已有变量节点并重新抽取")
    parser.add_argument("--dry-run", action="store_true", help="只抽取不入库")
    parser.add_argument("--dump", default=None, metavar="FILE", help="导出产物 JSON")
    args = parser.parse_args()

    conn = get_conn()
    t0 = time.time()
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT title, project_id FROM benchmark_book WHERE id=%s AND NOT is_deleted",
            (args.book_id,),
        )
        row = cur.fetchone()
        if not row:
            logger.error(f"书目 {args.book_id} 不存在或已删除")
            return 1
        book_title, project_id = row

        # 幂等检查
        cur.execute(
            "SELECT COUNT(*) FROM benchmark_item WHERE book_id=%s AND item_type='variable' "
            "AND NOT is_deleted", (args.book_id,),
        )
        if cur.fetchone()[0] > 0 and not args.force:
            logger.info("该书目已有变量节点（--force 可重新抽取），跳过")
            return 0

        # ---------- A. 9 变量抽取 ----------
        messages = build_var_prompt(cur, args.book_id, book_title,
                                    args.max_skeletons, args.max_plots)
        if not messages:
            logger.error("该书目没有已拆解的骨架/情节节点，请先运行 benchmark_analyze.py")
            return 1
        logger.info(f"《{book_title}》开始 9 变量抽取…")
        var_items: List[dict] = []
        try:
            data = parse_json(call_llm(messages))
            var_items = parse_variables(data or {})
        except Exception as e:  # noqa: BLE001
            logger.warning(f"9 变量抽取失败: {e}")
        logger.info(f"产出变量节点 {len(var_items)} 条")

        # ---------- B. 启发式减法测试 ----------
        sub_stats: Optional[Dict[str, int]] = None
        if not args.skip_subtraction:
            candidates = load_items(
                cur, args.book_id, "plot", args.min_quality,
                args.subtract_limit, material_types=("task", "highlight"),
            )
            if candidates:
                logger.info(f"减法测试候选 {len(candidates)} 条"
                            f"（预筛: material_type∈task/highlight 且 q>={args.min_quality}）")
                try:
                    sdata = parse_json(call_llm(build_subtract_prompt(candidates)))
                    verdicts = (sdata or {}).get("verdicts") or []
                    if not args.dry_run:
                        sub_stats = apply_verdicts(cur, verdicts)
                        conn.commit()
                    else:
                        sub_stats = {"pivot": 0, "removable": 0, "partial": 0, "invalid": 0}
                        for v in verdicts:
                            verdict = str(v.get("verdict") or "")
                            if verdict in sub_stats:
                                sub_stats[verdict] += 1
                    logger.info(f"减法判定: {sub_stats}")
                except Exception as e:  # noqa: BLE001
                    logger.warning(f"减法测试失败（不影响变量入库）: {e}")
            else:
                logger.info("无减法测试候选（提高候选量需先拆更多高质量章节）")

        # ---------- 导出 / 入库 ----------
        if args.dump:
            try:
                with open(args.dump, "w", encoding="utf-8") as f:
                    json.dump({"variables": var_items, "subtraction": sub_stats},
                              f, ensure_ascii=False, indent=2)
                logger.info(f"已导出到 {args.dump}")
            except OSError as e:
                logger.warning(f"导出失败: {e}")
        if args.dry_run:
            for it in var_items:
                logger.info(f"  {it['title']} (q={it['quality_score']}): {_clip(it['content'], 60)}")
            logger.info("[dry-run] 不入库")
            return 0

        if not var_items:
            logger.warning("无变量产出，未入库")
            return 0
        if args.force:
            n = soft_delete_variables(cur, args.book_id)
            if n:
                logger.info(f"已软删旧变量节点 {n} 条")
        vecs = bge_embedder.embed_texts([it["content"] for it in var_items])
        inserted = 0
        for it, vec in zip(var_items, vecs):
            try:
                insert_variable_item(
                    cur, args.book_id, project_id, it["title"], it["content"],
                    it["tags"], it["quality_score"],
                    np.array(vec, dtype=np.float32),
                )
                inserted += 1
                conn.commit()
            except Exception as e:  # noqa: BLE001
                conn.rollback()
                logger.warning(f"变量入库失败《{it['title']}》: {e}")
        cur.close()
    finally:
        conn.close()

    logger.info(f"变量级拆解完成（{time.time() - t0:.1f}s）：入库 {inserted} 条")
    return 0


if __name__ == "__main__":
    sys.exit(main())
