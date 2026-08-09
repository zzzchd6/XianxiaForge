"""
benchmark_analyze.py — 对标拆解脚本（拆文系统 · 第一梯队）

全流程：
    本地 TXT → 章节切分（split_chapters，独立函数不碰 clean_text）
            → 章内轻清洗（复用 extract_materials.clean_text，仅作用于章体）
            → LLM 单次合并拆解（骨架 skeleton + 情节 plots）
            → content 向量化（512 维 bge，与诛仙库同源）
            → 入库（创作库 benchmark_book + benchmark_item）

拆解范围（--scope）：
    volume   按章序号区间拆（--from-chapter / --to-chapter，默认全书）
    sample   抽样拆（每 --sample-step 章抽 1 章，默认 10）

幂等：已拆过的章（同 book 同 chapter_idx 有存活 item）自动跳过，--force 强制重拆。
红线：产物必须抽象化禁专名（Prompt 强制）；source_snippet 仅入库后台可见。

用法：
    python benchmark_analyze.py <TXT文件> [--source-work 作品名] [--scope volume]
                                [--from-chapter 1] [--to-chapter 30] [--max-chapters 5]
                                [--dry-run] [--dump bench_check.json]
"""
from __future__ import annotations

import argparse
import json
import logging
import os
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Dict, List, Optional

import numpy as np

# 复用 ETL 基建（LLM 调用/JSON 解析/读取/清洗），不重复造轮子
from extract_materials import (
    call_llm, parse_json, read_txt, clean_text, _clip, PG,
)
import bge_embedder

# ------------------------------------------------------------------
# 配置
# ------------------------------------------------------------------
BENCH_CONCURRENCY = int(os.getenv("BENCH_CONCURRENCY", "4"))   # 章级调用输入大，并发低于块级
MAX_CHAPTER_INPUT = int(os.getenv("MAX_CHAPTER_INPUT", "7000"))  # 单章送 LLM 的最大字符数
MIN_CHAPTER_CHARS = int(os.getenv("MIN_CHAPTER_CHARS", "300"))   # 过短章不送 LLM

_tp = os.getenv("TARGET_PROJECT_ID", "").strip()
ENV_PROJECT_ID: Optional[int] = int(_tp) if _tp else None

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("benchmark")

VALID_ITEM_TYPES = ("skeleton", "plot")
VALID_MATERIAL_TYPES = {"encounter", "foreshadow", "highlight", "task"}


# ==================================================================
# 1) 章节切分（独立函数，不碰 clean_text）
# ==================================================================
# 章节标题行：第X章/节/话（数字可中文/阿拉伯），允许尾随短标题。
# 卷行（第X卷）不切章，保留在章体内作为结构信号。
_CHAPTER_HEAD_RE = re.compile(
    r"^\s*第\s*[0-9一二三四五六七八九十百千零两]+\s*[章话]\s*.{0,40}$"
)


def split_chapters(raw: str) -> List[dict]:
    """
    按章节标题行切分原始文本。不修改原文、不做清洗。
    返回 [{"idx":1..n, "title":str, "body":str, "char_start":int, "char_end":int}, ...]
    char_start/char_end 为 raw 中的字符偏移（含标题行），供 GUI 原文定位。
    首个章节标题前的内容（前言/简介）不计入章节。
    """
    text = raw.replace("\r\n", "\n").replace("\r", "\n")
    heads: List[tuple] = []  # (line_start_offset, line_end_offset, title)
    offset = 0
    for line in text.split("\n"):
        stripped = line.strip()
        if stripped and _CHAPTER_HEAD_RE.match(stripped):
            heads.append((offset, offset + len(line), stripped))
        offset += len(line) + 1  # +1 = 换行符

    chapters: List[dict] = []
    for i, (start, line_end, title) in enumerate(heads):
        body_start = line_end + 1 if line_end < len(text) else line_end
        body_end = heads[i + 1][0] if i + 1 < len(heads) else len(text)
        chapters.append({
            "idx": i + 1,
            "title": title,
            "body": text[body_start:body_end],
            "char_start": start,
            "char_end": body_end,
        })
    return chapters


# ==================================================================
# 2) 拆解 Prompt（骨架 + 情节 单次合并调用）
# ==================================================================
BENCH_SYSTEM_PROMPT = (
    "你是资深网文结构分析师，擅长把章节拆解为可跨作品复用的抽象结构骨架与情节模式。"
    "所有产出必须抽象化，禁止出现原文专名（人名/地名/功法名/门派名）。只输出 JSON。"
)

BENCH_PROMPT = """拆解下方小说章节，输出两部分：A 章级骨架 skeleton，B 情节模式 plots（0-{max_plots}条，宁缺毋滥）。

A. skeleton 字段:
- title(≤30字,本章结构功能抽象,如「低谷受辱→逆袭铺垫」)
- setup / develop / turn / resolve(起/承/转/合,各≤60字抽象描述,某段缺失则null)
- ratios([起,承,转,合]4个0-1小数,合计1,缺失段为0)
- emotion_curve(4-8个0-10整数,按章节推进的情绪张力曲线,首→尾)
- hook(≤80字|null,章末钩子/悬念手法)
- quality_score(1-10)

B. plots 每条字段:
- title(≤30字,抽象禁专名) · content(≤150字,触发→经过→结果,抽象化可跨世界观复用)
- material_type(encounter奇遇|foreshadow伏笔手法|highlight人物高光|task任务链,选最贴合的一类)
- tags(2-5个) · quality_score(1-10) · source_snippet(≤80字原句|null)

输出严格JSON:
{{"skeleton":{{"title":"","setup":"","develop":"","turn":"","resolve":"","ratios":[0.2,0.3,0.3,0.2],"emotion_curve":[3,5,2,8],"hook":"","quality_score":8}},"plots":[...]}}

【第{idx}章 {title}】
{text}
"""

MAX_PLOTS_PER_CHAPTER = int(os.getenv("MAX_PLOTS_PER_CHAPTER", "3"))


def build_bench_messages(ch: dict) -> List[dict]:
    body = clean_text(ch["body"])  # 轻清洗只作用于送 LLM 的章体，不动定位偏移
    if len(body) > MAX_CHAPTER_INPUT:
        logger.warning(f"[第{ch['idx']}章] 正文 {len(body)} 字超窗，截断到 {MAX_CHAPTER_INPUT}")
        body = body[:MAX_CHAPTER_INPUT]
    user = BENCH_PROMPT.format(
        idx=ch["idx"], title=ch["title"].strip(),
        text=body, max_plots=MAX_PLOTS_PER_CHAPTER,
    )
    return [
        {"role": "system", "content": BENCH_SYSTEM_PROMPT},
        {"role": "user", "content": user},
    ]


# ==================================================================
# 3) 结果校验
# ==================================================================
def _norm_ratios(raw) -> List[Optional[float]]:
    """校验并归一化起承转合比例；非法返回 4 个 None。"""
    if not isinstance(raw, list) or len(raw) != 4:
        return [None] * 4
    try:
        vals = [max(0.0, min(1.0, float(x))) for x in raw]
    except (TypeError, ValueError):
        return [None] * 4
    s = sum(vals)
    if s <= 0:
        return [None] * 4
    if abs(s - 1.0) > 0.01:
        vals = [v / s for v in vals]  # 归一化
    return [round(v, 4) for v in vals]


def _norm_curve(raw) -> Optional[List[float]]:
    """情绪曲线：2-12 个 0-10 数值。"""
    if not isinstance(raw, list) or not (2 <= len(raw) <= 12):
        return None
    try:
        vals = [max(0.0, min(10.0, float(x))) for x in raw]
    except (TypeError, ValueError):
        return None
    return vals


def _norm_quality(raw) -> int:
    try:
        return max(0, min(10, int(raw)))
    except (TypeError, ValueError):
        return 0


def _norm_tags(raw) -> List[str]:
    if isinstance(raw, str):
        raw = [raw]
    if not isinstance(raw, list):
        return []
    return [str(x).strip()[:50] for x in raw if str(x).strip()][:8]


def validate_skeleton(raw, ch: dict) -> Optional[dict]:
    """校验骨架。content 由起承转合四段拼成（抽象结构描述）。"""
    if not isinstance(raw, dict):
        return None
    title = _clip(raw.get("title"), 200)
    if not title:
        return None
    parts = []
    for k, label in (("setup", "起"), ("develop", "承"), ("turn", "转"), ("resolve", "合")):
        seg = _clip(raw.get(k), 300)
        if seg:
            parts.append(f"{label}：{seg}")
    if not parts:
        return None
    return {
        "item_type": "skeleton",
        "chapter_idx": ch["idx"],
        "char_start": ch["char_start"],
        "char_end": ch["char_end"],
        "title": title,
        "content": "\n".join(parts),
        "ratios": _norm_ratios(raw.get("ratios")),
        "emotion_curve": _norm_curve(raw.get("emotion_curve")),
        "hook": _clip(raw.get("hook"), 500),
        "material_type": None,
        "tags": ["骨架"],
        "quality_score": _norm_quality(raw.get("quality_score")),
        "source_snippet": None,
    }


def validate_plot(raw, ch: dict) -> Optional[dict]:
    if not isinstance(raw, dict):
        return None
    title = _clip(raw.get("title"), 200)
    content = _clip(raw.get("content"), 4000)
    if not title or not content or len(content) < 20:
        return None
    mt = _clip(raw.get("material_type"), 20)
    if mt not in VALID_MATERIAL_TYPES:
        mt = "encounter"  # 兼容旧模型输出：默认归奇遇类
    return {
        "item_type": "plot",
        "chapter_idx": ch["idx"],
        "char_start": ch["char_start"],
        "char_end": ch["char_end"],
        "title": title,
        "content": content,
        "ratios": [None] * 4,
        "emotion_curve": None,
        "hook": None,
        "material_type": mt,
        "tags": _norm_tags(raw.get("tags")),
        "quality_score": _norm_quality(raw.get("quality_score")),
        "source_snippet": _clip(raw.get("source_snippet"), 300),
    }


# ==================================================================
# 4) 单章拆解（线程池调用）
# ==================================================================
def analyze_chapter(ch: dict) -> List[dict]:
    """拆解单章，返回 item 列表。异常不外抛。"""
    try:
        text = call_llm(build_bench_messages(ch))
        data = parse_json(text)
        if not data:
            logger.warning(f"[第{ch['idx']}章] JSON 解析失败，跳过")
            return []
        items: List[dict] = []
        sk = validate_skeleton(data.get("skeleton"), ch)
        if sk:
            items.append(sk)
        plots = data.get("plots") or []
        if isinstance(plots, list):
            for raw in plots[:MAX_PLOTS_PER_CHAPTER]:
                p = validate_plot(raw, ch)
                if p:
                    items.append(p)
        return items
    except Exception as e:  # noqa: BLE001 单章失败不影响整体
        logger.warning(f"[第{ch['idx']}章] 拆解失败，跳过: {e}")
        return []


def vectorize_items(items: List[dict]) -> None:
    """为每个 item 的 content 生成 512 维向量，写入 item['embedding']。"""
    if not items:
        return
    vecs = bge_embedder.embed_texts([it["content"] for it in items])
    for it, v in zip(items, vecs):
        it["embedding"] = v


# ==================================================================
# 5) 数据库
# ==================================================================
def get_conn():
    import psycopg2
    from pgvector.psycopg2 import register_vector
    conn = psycopg2.connect(**PG)
    register_vector(conn)
    return conn


def upsert_book(cur, project_id: Optional[int], title: str, author: Optional[str],
                source_path: str) -> int:
    """同名同作用域书目复用，否则新建。返回 book_id。"""
    if project_id is None:
        scope, params = "project_id IS NULL", ()
    else:
        scope, params = "project_id = %s", (project_id,)
    cur.execute(
        f"SELECT id FROM benchmark_book WHERE NOT is_deleted AND title=%s AND {scope}",
        (title, *params),
    )
    row = cur.fetchone()
    if row:
        return int(row[0])
    cur.execute(
        """
        INSERT INTO benchmark_book (project_id, title, author, source_path, status)
        VALUES (%s,%s,%s,%s,'analyzing') RETURNING id
        """,
        (project_id, title, author, source_path),
    )
    return int(cur.fetchone()[0])


def load_done_chapters(cur, book_id: int) -> set:
    cur.execute(
        "SELECT DISTINCT chapter_idx FROM benchmark_item "
        "WHERE book_id=%s AND NOT is_deleted AND chapter_idx IS NOT NULL",
        (book_id,),
    )
    return {int(r[0]) for r in cur.fetchall()}


def insert_item(cur, book_id: int, project_id: Optional[int], it: dict) -> None:
    r = it["ratios"]
    cur.execute(
        """
        INSERT INTO benchmark_item
          (book_id, project_id, item_type, chapter_idx, char_start, char_end,
           title, content, setup_ratio, develop_ratio, turn_ratio, resolve_ratio,
           emotion_curve, hook, material_type, tags, quality_score, source_snippet, embedding)
        VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
        """,
        (
            book_id, project_id, it["item_type"], it["chapter_idx"],
            it["char_start"], it["char_end"], it["title"], it["content"],
            r[0], r[1], r[2], r[3], it["emotion_curve"], it["hook"],
            it["material_type"], it["tags"], it["quality_score"], it["source_snippet"],
            np.array(it["embedding"], dtype=np.float32),
        ),
    )


def finish_book(cur, book_id: int, total_chapters: int, total_chars: int,
                status: str) -> None:
    cur.execute(
        "UPDATE benchmark_book SET total_chapters=%s, total_chars=%s, status=%s, "
        "updated_at=NOW() WHERE id=%s",
        (total_chapters, total_chars, status, book_id),
    )


# ==================================================================
# 6) 主流程
# ==================================================================
def select_chapters(chapters: List[dict], args) -> List[dict]:
    if args.scope == "volume":
        lo = args.from_chapter or 1
        hi = args.to_chapter or len(chapters)
        sel = [c for c in chapters if lo <= c["idx"] <= hi]
    else:  # sample
        step = max(1, args.sample_step)
        sel = [c for c in chapters if (c["idx"] - 1) % step == 0]
    if args.max_chapters and args.max_chapters > 0:
        sel = sel[:args.max_chapters]
    return sel


def main() -> int:
    parser = argparse.ArgumentParser(description="对标拆解（骨架+情节合并拆解入库）")
    parser.add_argument("path", help="TXT 文件路径")
    parser.add_argument("--source-work", default=None, help="作品名（默认取文件名）")
    parser.add_argument("--author", default=None, help="作者名")
    parser.add_argument("--project-id", type=int, default=None,
                        help="归属创作项目（默认读环境变量 TARGET_PROJECT_ID，空=全局共享）")
    parser.add_argument("--scope", choices=["volume", "sample"], default="volume",
                        help="volume=章序号区间；sample=抽样")
    parser.add_argument("--from-chapter", type=int, default=None, help="volume 起始章序号")
    parser.add_argument("--to-chapter", type=int, default=None, help="volume 结束章序号")
    parser.add_argument("--sample-step", type=int, default=10, help="sample 抽样步长（每 N 章抽 1）")
    parser.add_argument("--max-chapters", type=int, default=0,
                        help="最多拆 N 章（验证用，避免整本烧 token）；0=不限")
    parser.add_argument("--force", action="store_true", help="强制重拆已有章节")
    parser.add_argument("--dry-run", action="store_true", help="只拆解不入库")
    parser.add_argument("--dump", default=None, metavar="FILE",
                        help="导出全部拆解产物为 JSON（不含向量）便于核对")
    args = parser.parse_args()

    if not os.path.isfile(args.path):
        logger.error(f"文件不存在: {args.path}")
        return 1

    project_id = args.project_id if args.project_id is not None else ENV_PROJECT_ID
    work = args.source_work or os.path.splitext(os.path.basename(args.path))[0]

    raw = read_txt(args.path)
    chapters = split_chapters(raw)
    if not chapters:
        logger.error("未切出任何章节（检查 TXT 是否含「第X章」格式标题行）")
        return 1
    logger.info(f"《{work}》切出 {len(chapters)} 章（原文 {len(raw)} 字符）")

    sel = select_chapters(chapters, args)
    logger.info(f"scope={args.scope} 选中 {len(sel)} 章（并发 {BENCH_CONCURRENCY}）")
    if not sel:
        logger.warning("无可拆章节")
        return 0

    # 幂等：跳过已拆章节
    book_id: Optional[int] = None
    done: set = set()
    if not args.dry_run:
        conn = get_conn()
        try:
            cur = conn.cursor()
            book_id = upsert_book(cur, project_id, work, args.author, os.path.abspath(args.path))
            if not args.force:
                done = load_done_chapters(cur, book_id)
            cur.execute(
                "UPDATE benchmark_book SET status='analyzing', updated_at=NOW() WHERE id=%s",
                (book_id,),
            )
            conn.commit()
            cur.close()
        finally:
            conn.close()
    if done:
        before = len(sel)
        sel = [c for c in sel if c["idx"] not in done]
        logger.info(f"幂等跳过 {before - len(sel)} 章（已拆过），剩余 {len(sel)} 章")
        if not sel:
            logger.info("全部章节已拆过，无需处理（--force 可重拆）")
            return 0

    # 并发拆解
    all_items: List[dict] = []
    done_count = 0
    t0 = time.time()
    with ThreadPoolExecutor(max_workers=BENCH_CONCURRENCY) as pool:
        futures = {pool.submit(analyze_chapter, c): c["idx"] for c in sel}
        for fut in as_completed(futures):
            items = fut.result()
            all_items.extend(items)
            done_count += 1
            if done_count % 5 == 0 or done_count == len(sel):
                logger.info(f"进度 {done_count}/{len(sel)} 章，累计 {len(all_items)} 个节点")

    logger.info(f"拆解完成（{time.time() - t0:.1f}s），共 {len(all_items)} 个节点，开始向量化…")
    vectorize_items(all_items)

    sk_n = sum(1 for it in all_items if it["item_type"] == "skeleton")
    pl_n = sum(1 for it in all_items if it["item_type"] == "plot")
    logger.info(f"节点分布: skeleton={sk_n}, plot={pl_n}")

    # 导出核对
    if args.dump:
        dumpable = [{k: v for k, v in it.items() if k != "embedding"} for it in all_items]
        try:
            with open(args.dump, "w", encoding="utf-8") as f:
                json.dump(dumpable, f, ensure_ascii=False, indent=2)
            logger.info(f"已导出 {len(dumpable)} 条到 {args.dump}")
        except OSError as e:
            logger.warning(f"导出 JSON 失败: {e}")

    if args.dry_run:
        logger.info("[dry-run] 跳过入库。示例：")
        for it in all_items[:5]:
            logger.info(f"  [{it['item_type']}] 第{it['chapter_idx']}章 {it['title']} (q={it['quality_score']})")
        return 0

    # 入库
    conn = get_conn()
    inserted = 0
    try:
        cur = conn.cursor()
        for it in all_items:
            try:
                insert_item(cur, book_id, project_id, it)
                inserted += 1
                conn.commit()
            except Exception as e:  # noqa: BLE001
                conn.rollback()
                logger.warning(f"节点入库失败，跳过《{it.get('title')}》: {e}")
        # 收尾状态：全部选中章都产出骨架 → done，否则 partial
        status = "done" if sk_n >= len(sel) else "partial"
        total_chars = sum(len(clean_text(c["body"])) for c in chapters)
        finish_book(cur, book_id, len(chapters), total_chars, status)
        conn.commit()
        cur.close()
    finally:
        conn.close()

    logger.info(f"入库完成：book_id={book_id}，新增节点 {inserted}，书目状态={status}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
