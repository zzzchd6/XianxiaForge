"""
extract_domain_knowledge.py — 专业领域知识蒸馏工具（独立脚本，90% 复用剧情素材管线）

全流程（与 extract_materials 同构，仅换 Prompt / 字段校验 / 目标表）：
    专业书籍 TXT
        → em.read_txt / clean_text / chunk_text（复用清洗切块）
        → 并发 LLM 抽取 5 类领域知识（术语/规则/误区/表达/案例）
        → content 向量化（512 维 bge，复用 bge_embedder）
        → 批内 + 库内两级向量去重（同类内比较）
        → 入库创作库 plot_domain_knowledge（单表 + knowledge_type 枚举）

约束遵循：不修改 extract_materials.py；异常跳过不中断；
        source_snippet 仅入库、禁止注入写作上下文。

用法：
    python extract_domain_knowledge.py <TXT或目录> [--domain 中医] [--source-book 书名]
        [--project-id N] [--dry-run] [--dump FILE] [--max-chunks N]
"""
from __future__ import annotations

import argparse
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Dict, List, Optional

import numpy as np

import bge_embedder
import extract_materials as em  # 100% 复用读取/清洗/切块/LLM/解析/连接/日志/配置

logger = em.logger

DOMAIN_TABLE = "plot_domain_knowledge"
KNOWLEDGE_TYPES = ("term", "rule", "pitfall", "expression", "case")
# 领域知识去重阈值可独立配置（术语文本更同质，默认略高于剧情素材，避免误杀近义术语）
DOMAIN_DEDUP_THRESHOLD = float(os.getenv("DOMAIN_DEDUP_THRESHOLD", "0.90"))
DOMAIN_CONTENT_MAXLEN = int(os.getenv("DOMAIN_CONTENT_MAXLEN", "300"))
# 复用剧情素材的质量门槛与每块条数、并发等配置
DOMAIN_MIN_QUALITY = int(os.getenv("DOMAIN_MIN_QUALITY", str(em.MIN_QUALITY_TO_STORE)))


# ==================================================================
# 1) 抽取 Prompt（一次抽 5 类领域知识）
# ==================================================================
DOMAIN_SYSTEM_PROMPT = (
    "你是资深领域专家与知识工程师，擅长把专业资料提炼为独立、准确、可检索的知识条目。"
    "只输出 JSON，不要任何多余解释。"
)

DOMAIN_EXTRACTION_PROMPT = """从下面的专业资料片段中，抽取结构化领域知识，分为 5 类。每条知识必须独立完整、可脱离上下文被检索复用。

【类别定义】
1. term 核心术语：术语名称 + 标准定义 + 适用场景
2. rule 操作规则：流程、方法、约束条件
3. pitfall 常见误区：外行容易写错的常识错误、避坑要点
4. expression 场景化表达：特定场景下的专业描述方式、常用说法
5. case 典型案例：经典场景示例

【每条知识字段】
- knowledge_type: 上述 5 类之一（term/rule/pitfall/expression/case）
- title: 知识点标题（术语名/规则名），简洁准确
- content: 知识正文，100-300字，独立完整、准确，可直接用于检索召回；不要出现“本书/上文/如前所述”等指代
- tags: 2-5 个标签数组
- quality_score: 1-10 整数，知识的准确度与复用价值
- source_snippet: 原文中对应的 1-2 句原句（≤120字），无法确定则 null

【要求】
- 每类抽取 0-{max_n} 条；无高质量内容则该类返回空数组，宁缺毋滥。
- content 必须是客观专业知识，禁止编造、禁止掺入原文故事情节。
- 严格输出如下 JSON（5 个键都要有，值为数组，可为空）：
{{
  "term": [ {{...}} ], "rule": [ {{...}} ], "pitfall": [ {{...}} ],
  "expression": [ {{...}} ], "case": [ {{...}} ]
}}

【待分析片段】
{chunk}
"""


def build_domain_messages(chunk: str) -> List[dict]:
    return [
        {"role": "system", "content": DOMAIN_SYSTEM_PROMPT},
        {"role": "user", "content": DOMAIN_EXTRACTION_PROMPT.format(
            chunk=chunk, max_n=em.MAX_MATERIALS_PER_CHUNK)},
    ]


# ==================================================================
# 2) 字段校验（复用 em._clip）
# ==================================================================
def validate_knowledge(raw: dict, source_book: Optional[str], domain: Optional[str]) -> Optional[dict]:
    """校验并规范化单条领域知识。不合格返回 None。"""
    if not isinstance(raw, dict):
        return None
    ktype = (raw.get("knowledge_type") or "").strip().lower()
    if ktype not in KNOWLEDGE_TYPES:
        return None
    title = em._clip(raw.get("title"), 200)
    content = em._clip(raw.get("content"), DOMAIN_CONTENT_MAXLEN)
    if not title or not content or len(content) < 30:
        return None
    try:
        quality = int(raw.get("quality_score", 0))
    except (ValueError, TypeError):
        quality = 0
    quality = max(0, min(10, quality))
    if quality < DOMAIN_MIN_QUALITY:
        return None

    tags = raw.get("tags") or []
    if isinstance(tags, str):
        tags = [tags]
    tags = [str(x).strip()[:50] for x in tags if str(x).strip()][:8]

    return {
        "knowledge_type": ktype,
        "applicable_domain": (domain[:50] if domain else None),
        "title": title,
        "content": content,
        "tags": tags,
        "quality_score": quality,
        "source_book": source_book[:100] if source_book else None,
        "source_snippet": em._clip(raw.get("source_snippet"), 120),
    }


# ==================================================================
# 3) 单块抽取（供线程池）
# ==================================================================
def extract_from_chunk(chunk: str, source_book: Optional[str], domain: Optional[str], idx: int) -> List[dict]:
    try:
        data = em.parse_json(em.call_llm(build_domain_messages(chunk)))
        if not data:
            logger.warning(f"[domain#{idx}] JSON 解析失败，跳过")
            return []
        out: List[dict] = []
        for ktype in KNOWLEDGE_TYPES:
            items = data.get(ktype) or []
            if not isinstance(items, list):
                continue
            for raw in items[:em.MAX_MATERIALS_PER_CHUNK]:
                if isinstance(raw, dict):
                    raw.setdefault("knowledge_type", ktype)  # 容忍 LLM 漏填类型
                k = validate_knowledge(raw, source_book, domain)
                if k:
                    out.append(k)
        return out
    except Exception as e:  # noqa: BLE001 单块失败不影响整体
        logger.warning(f"[domain#{idx}] 抽取失败，跳过: {e}")
        return []


# ==================================================================
# 4) 向量化 + 批内去重（同类内比较）
# ==================================================================
def vectorize(items: List[dict]) -> None:
    if not items:
        return
    vecs = bge_embedder.embed_texts([k["content"] for k in items])
    for k, v in zip(items, vecs):
        k["embedding"] = v


def dedup_in_batch(items: List[dict]) -> List[dict]:
    """同 knowledge_type 内余弦 > 阈值判重，保留高质量者。"""
    survivors: List[dict] = []
    for ktype in KNOWLEDGE_TYPES:
        group = [k for k in items if k["knowledge_type"] == ktype]
        if not group:
            continue
        mat = np.array([k["embedding"] for k in group], dtype=np.float32)
        sims = mat @ mat.T
        removed = set()
        order = sorted(range(len(group)), key=lambda i: group[i]["quality_score"], reverse=True)
        for a in order:
            if a in removed:
                continue
            survivors.append(group[a])
            for b in range(len(group)):
                if b != a and b not in removed and sims[a][b] > DOMAIN_DEDUP_THRESHOLD:
                    removed.add(b)
    return survivors


# ==================================================================
# 5) 入库（库内去重：同类同作用域最近邻）
# ==================================================================
def upsert_knowledge(cur, k: dict, project_id: Optional[int]) -> str:
    emb = np.array(k["embedding"], dtype=np.float32)
    if project_id is None:
        scope, scope_params = "project_id IS NULL", ()
    else:
        scope, scope_params = "project_id = %s", (project_id,)

    cur.execute(
        f"""
        SELECT id, quality_score, 1 - (embedding <=> %s) AS sim
        FROM {DOMAIN_TABLE}
        WHERE embedding IS NOT NULL AND NOT is_deleted AND knowledge_type = %s AND {scope}
        ORDER BY embedding <=> %s
        LIMIT 1
        """,
        (emb, k["knowledge_type"], *scope_params, emb),
    )
    row = cur.fetchone()
    if row and row[2] is not None and row[2] > DOMAIN_DEDUP_THRESHOLD:
        existing_id, existing_q = row[0], row[1]
        if existing_q >= k["quality_score"]:
            return "skip"
        cur.execute(
            f"""
            UPDATE {DOMAIN_TABLE} SET
              applicable_domain=%s, title=%s, content=%s, tags=%s, quality_score=%s,
              source_book=%s, source_snippet=%s, embedding=%s
            WHERE id=%s
            """,
            (k["applicable_domain"], k["title"], k["content"], k["tags"], k["quality_score"],
             k["source_book"], k["source_snippet"], emb, existing_id),
        )
        return "update"

    cur.execute(
        f"""
        INSERT INTO {DOMAIN_TABLE}
          (project_id, knowledge_type, applicable_domain, title, content, tags,
           quality_score, source_book, source_snippet, embedding)
        VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
        """,
        (project_id, k["knowledge_type"], k["applicable_domain"], k["title"], k["content"],
         k["tags"], k["quality_score"], k["source_book"], k["source_snippet"], emb),
    )
    return "insert"


def persist(items: List[dict], project_id: Optional[int]) -> Dict[str, int]:
    stats = {"insert": 0, "update": 0, "skip": 0}
    if not items:
        return stats
    conn = em.get_conn()
    try:
        cur = conn.cursor()
        for k in items:
            try:
                stats[upsert_knowledge(cur, k, project_id)] += 1
                conn.commit()
            except Exception as e:  # noqa: BLE001
                conn.rollback()
                logger.warning(f"入库失败，跳过《{k.get('title')}》: {e}")
        cur.close()
    finally:
        conn.close()
    return stats


# ==================================================================
# 6) 主流程
# ==================================================================
def process_file(path: str, source_book: Optional[str], domain: Optional[str],
                 project_id: Optional[int], dry_run: bool, max_chunks: int,
                 dump_path: Optional[str]) -> None:
    fname = os.path.basename(path)
    book = source_book or os.path.splitext(fname)[0]
    logger.info(f"===== 领域知识蒸馏《{book}》 领域={domain or '未指定'} [{fname}] =====")

    cleaned = em.clean_text(em.read_txt(path))
    chunks = em.chunk_text(cleaned)
    total = len(chunks)
    if em.ENABLE_CHUNK_PREFILTER and chunks:
        kept = [c for c in chunks if not em.should_skip_chunk(c)]
        logger.info(f"章节预筛：{total} 块 → 保留 {len(kept)} 块")
        chunks = kept
    if max_chunks and max_chunks > 0:
        chunks = chunks[:max_chunks]
    logger.info(f"清洗后 {len(cleaned)} 字，{len(chunks)} 块，开始抽取（并发 {em.LLM_CONCURRENCY}）…")
    if not chunks:
        logger.warning("无有效切块，跳过")
        return

    all_items: List[dict] = []
    done = 0
    with ThreadPoolExecutor(max_workers=em.LLM_CONCURRENCY) as pool:
        futures = [pool.submit(extract_from_chunk, c, book, domain, i) for i, c in enumerate(chunks)]
        for fut in as_completed(futures):
            all_items.extend(fut.result())
            done += 1
            if done % 10 == 0 or done == len(chunks):
                logger.info(f"进度 {done}/{len(chunks)} 块，累计抽取 {len(all_items)} 条")

    logger.info(f"抽取完成，原始 {len(all_items)} 条，向量化…")
    vectorize(all_items)
    survivors = dedup_in_batch(all_items)
    logger.info(f"批内去重后 {len(survivors)} 条（去掉 {len(all_items) - len(survivors)} 条）")

    by_type: Dict[str, int] = {}
    for k in survivors:
        by_type[k["knowledge_type"]] = by_type.get(k["knowledge_type"], 0) + 1
    logger.info("分类分布: " + ", ".join(f"{t}={c}" for t, c in by_type.items()))

    if dump_path:
        try:
            import json
            with open(dump_path, "w", encoding="utf-8") as fp:
                json.dump([{kk: vv for kk, vv in k.items() if kk != "embedding"} for k in survivors],
                          fp, ensure_ascii=False, indent=2)
            logger.info(f"已导出 {len(survivors)} 条到 {dump_path}")
        except OSError as e:
            logger.warning(f"导出失败: {e}")

    if dry_run:
        logger.info("[dry-run] 跳过入库。示例：")
        for k in survivors[:3]:
            logger.info(f"  [{k['knowledge_type']}] {k['title']} (q={k['quality_score']})")
        return

    stats = persist(survivors, project_id)
    logger.info(f"入库完成：新增 {stats['insert']}，覆盖更新 {stats['update']}，库内重复跳过 {stats['skip']}")


def main() -> int:
    parser = argparse.ArgumentParser(description="专业领域知识蒸馏 → plot_domain_knowledge")
    parser.add_argument("path", help="TXT 文件或目录")
    parser.add_argument("--domain", default=None, help="领域归属，如 中医/刑侦/军事")
    parser.add_argument("--source-book", default=None, help="来源书名（默认取文件名）")
    parser.add_argument("--project-id", type=int, default=None,
                        help="归属项目 id；默认取环境变量 TARGET_PROJECT_ID（空=全局共享 NULL）")
    parser.add_argument("--dry-run", action="store_true", help="只抽取不入库")
    parser.add_argument("--dump", default=None, metavar="FILE", help="导出知识 JSON（不含向量）")
    parser.add_argument("--max-chunks", type=int, default=em.MAX_CHUNKS, help="只处理前 N 块（验证用）")
    args = parser.parse_args()

    if not em.LLM_API_KEY:
        logger.error("未配置 LLM_API_KEY，请先复制 .env.example 为 .env 并填写")
        return 1

    files = em.collect_txt_files(args.path)
    if not files:
        logger.error(f"未找到 TXT 文件: {args.path}")
        return 1

    project_id = args.project_id if args.project_id is not None else em.TARGET_PROJECT_ID
    logger.info(f"共 {len(files)} 个 TXT 待处理。目标 project_id="
                f"{project_id if project_id is not None else 'NULL(全局共享)'}")
    t0 = time.time()
    for path in files:
        try:
            process_file(path, args.source_book, args.domain, project_id,
                         args.dry_run, args.max_chunks, args.dump)
        except Exception as e:  # noqa: BLE001 单文件失败不中断
            logger.error(f"文件处理失败，跳过 [{path}]: {e}")
    logger.info(f"全部完成，耗时 {time.time() - t0:.1f}s。失败详情见 etl_failures.log")
    return 0


if __name__ == "__main__":
    sys.exit(main())
