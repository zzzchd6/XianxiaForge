"""
distill_style.py — 作者文风蒸馏工具（独立脚本，复用 extract_materials 全部工程底座）

全流程：
    1 本或多本【同一作者/同一风格】的 TXT
        → 复用 em.read_txt / clean_text / chunk_text 做清洗切块
        → 块级并发抽取 6 大风格维度（map，复用 em.call_llm / parse_json）
        → [可选] 本地零成本量化统计（句长/对话占比/四字密度…），数值型以本地为准
        → 全局聚合（reduce）：量化取加权平均，定性取高频 TopK，再一次 LLM 归纳凝练
        → 计算置信度/质量分（样本不足告警）
        → 写创作库 style_preset（一套风格一行，幂等 upsert）

设计对齐：输出列名 1:1 对齐诛仙库 style_global_config，Node 文风引擎可直接读用。
约束遵循：原生 Python + 轻量库；不修改 extract_materials.py；异常跳过不中断；
        source_snippet 概念不适用（本表不落原文片段）。

用法：
    python distill_style.py <TXT文件或目录> --preset-name "忘语·凡人流" [--author 忘语]
        [--project-id N] [--no-local-stats] [--no-reduce] [--dry-run] [--dump FILE] [--max-chunks N]
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import time
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Dict, List, Optional

import numpy as np

import bge_embedder
import extract_materials as em  # 100% 复用其读取/清洗/切块/LLM/解析/连接/日志/配置

logger = em.logger

# ------------------------------------------------------------------
# 配置（复用 em 的 LLM/切块/并发配置；新增文风专属项，走同一 .env）
# ------------------------------------------------------------------
import os

STYLE_TABLE = "style_preset"
# 有效样本字数门槛：低于此值置信度打折并告警（默认 5 万字）
STYLE_MIN_SAMPLE_WORDS = int(os.getenv("STYLE_MIN_SAMPLE_WORDS", "50000"))
# 定性维度聚合后保留的高频项上限
STYLE_TOPK = int(os.getenv("STYLE_TOPK", "12"))

# 6 大定性维度键（可去重高频聚合的列表型字段）
_LIST_DIMS = (
    "mental_models", "decision_heuristics", "core_imagery",
    "forbidden_words", "perspective_rules", "anti_patterns",
)


# ==================================================================
# 1) 块级抽取 Prompt（一次抽 6 维，输出固定 JSON）
# ==================================================================
STYLE_SYSTEM_PROMPT = (
    "你是资深文学风格分析师，擅长把小说片段拆解为可复用的写作风格特征。"
    "只输出 JSON，不要任何多余解释。"
)

STYLE_BLOCK_PROMPT = """分析下面这段小说原文，提炼作者的写作风格特征（只看写法，不管剧情内容）。

【输出 6 个维度，严格用如下 JSON 结构】
{{
  "mental_models": ["核心创作心智/底层叙事原则/审美偏好，短句，2-4条"],
  "decision_heuristics": ["情节取舍的启发式规则，如“先抑后扬”，2-4条"],
  "description_ratio": {{"scene": 场景描写占比0-100, "action": 动作占比, "dialogue": 对话占比, "psychology": 心理占比}},
  "rhythm": "本段节奏特征（如：张弛有度/长铺垫短爆发/快节奏白描）",
  "sentence": {{"avg_len": 估计平均句长整数, "preference": ["句式偏好，如短句为主/长短交错"], "para": "段落长度特征", "transition": ["过渡方式"], "rhetoric": ["修辞偏好，如比喻/白描"]}},
  "core_imagery": ["作者高频使用的专属意象，2-5个"],
  "forbidden_words": ["作者明显回避、几乎不用的表达（无则空数组）"],
  "perspective_rules": ["视角与叙事规则，如严格第三人称限知/信息差控制"],
  "anti_patterns": ["该作者绝不会出现的写法/烂大街表达（无则空数组）"]
}}

【要求】
- 只依据本段可观察到的写法归纳，无法判断的字段给空数组或合理估值，禁止编造。
- 所有描述要抽象、可复用，不要出现原文人名地名。
- description_ratio 四项之和尽量接近 100。

【待分析片段】
{chunk}
"""

# ---- reduce 归纳 Prompt：把跨块高频候选项合并去重、凝练成终稿 ----
STYLE_REDUCE_PROMPT = """下面是从同一作者多段作品中统计出的风格特征候选项（已按出现频次排序）。
请合并同义项、剔除自相矛盾或过于宽泛的条目，凝练为该作者稳定的风格铁律。

【候选项】
{candidates}

【输出，严格 JSON，键与输入一致，值为去重凝练后的字符串数组】
{{
  "mental_models": [], "decision_heuristics": [], "core_imagery": [],
  "forbidden_words": [], "perspective_rules": [], "anti_patterns": []
}}
只输出 JSON，不要解释。"""


def build_style_messages(chunk: str) -> List[dict]:
    return [
        {"role": "system", "content": STYLE_SYSTEM_PROMPT},
        {"role": "user", "content": STYLE_BLOCK_PROMPT.format(chunk=chunk)},
    ]


def extract_style_from_chunk(chunk: str, idx: int) -> Optional[dict]:
    """抽取单块风格特征。异常不外抛，记录日志后返回 None。"""
    try:
        data = em.parse_json(em.call_llm(build_style_messages(chunk)))
        if not isinstance(data, dict):
            logger.warning(f"[style#{idx}] JSON 解析失败，跳过")
            return None
        return data
    except Exception as e:  # noqa: BLE001 单块失败不影响整体
        logger.warning(f"[style#{idx}] 抽取失败，跳过: {e}")
        return None


# ==================================================================
# 2) 本地零成本量化统计（数值型以本地为准，与 LLM 双向校准）
# ==================================================================
_SENT_SPLIT = re.compile(r"[。！？!?…]+")
_CLAUSE_SPLIT = re.compile(r"[，。！？、；：,.!?;:]+")
_CJK = re.compile(r"[\u4e00-\u9fff]")


def local_style_stats(text: str) -> Dict[str, float]:
    """统计可量化风格指标。全部本地计算，零 Token。"""
    n = len(text)
    if n == 0:
        return {}
    sentences = [s for s in _SENT_SPLIT.split(text) if s.strip()]
    clauses = [c for c in _CLAUSE_SPLIT.split(text) if c.strip()]
    cjk = len(_CJK.findall(text))
    # 平均句长（按中文字符/句数）
    avg_sentence_len = round(cjk / len(sentences), 1) if sentences else 0.0
    # 对话占比（复用 em 的引号正则）
    inside = sum(len(m.group(1)) for m in em._QUOTED_RE.finditer(text))
    dialogue_ratio = round(inside * 100 / n, 1)
    # 四字短语密度（长度恰为 4 的分句占比，近似成语/四字格偏好）
    four = sum(1 for c in clauses if len(c.strip()) == 4)
    four_char_density = round(four * 100 / len(clauses), 1) if clauses else 0.0
    # 平均段落长度（按行）
    paras = [ln for ln in text.split("\n") if ln.strip()]
    avg_para_len = round(cjk / len(paras), 1) if paras else 0.0
    return {
        "avg_sentence_len": avg_sentence_len,
        "dialogue_ratio_pct": dialogue_ratio,
        "four_char_density_pct": four_char_density,
        "avg_para_len": avg_para_len,
        "sample_char_count": n,
    }


# ==================================================================
# 3) 全局聚合（reduce）
# ==================================================================
def _topk_by_freq(items: List[str], k: int) -> List[str]:
    """按出现频次排序取前 k，保留可读原文（去空白/去重计数）。"""
    norm = [s.strip() for s in items if isinstance(s, str) and s.strip()]
    if not norm:
        return []
    counter = Counter(norm)
    return [s for s, _ in counter.most_common(k)]


def aggregate_style(blocks: List[dict], local: Optional[dict]) -> dict:
    """把 N 块抽取结果聚合为 1 套文风配置。量化平均、定性高频。"""
    # ---- 定性维度：跨块收集 → 高频 TopK ----
    agg: Dict[str, List[str]] = {d: [] for d in _LIST_DIMS}
    for b in blocks:
        for d in _LIST_DIMS:
            v = b.get(d)
            if isinstance(v, list):
                agg[d].extend(x for x in v if isinstance(x, str))
    result = {d: _topk_by_freq(agg[d], STYLE_TOPK) for d in _LIST_DIMS}

    # ---- 描写比例：各块数值平均并归一化到 100 ----
    ratio_keys = ("scene", "action", "dialogue", "psychology")
    sums = {k: 0.0 for k in ratio_keys}
    cnt = 0
    for b in blocks:
        r = b.get("description_ratio")
        if isinstance(r, dict):
            cnt += 1
            for k in ratio_keys:
                try:
                    sums[k] += float(r.get(k, 0) or 0)
                except (ValueError, TypeError):
                    pass
    if cnt:
        avg = {k: sums[k] / cnt for k in ratio_keys}
        total = sum(avg.values()) or 1.0
        description_ratio = {k: round(avg[k] * 100 / total, 1) for k in ratio_keys}
    else:
        description_ratio = {k: 0 for k in ratio_keys}
    description_ratio["rhythm_notes"] = _topk_by_freq(
        [b.get("rhythm") for b in blocks if isinstance(b.get("rhythm"), str)], 5
    )

    # ---- 句式规则：数值平均 + 定性高频 ----
    lens = [float(b["sentence"].get("avg_len") or 0)
            for b in blocks if isinstance(b.get("sentence"), dict) and b["sentence"].get("avg_len")]
    pref, trans, rhet, paras = [], [], [], []
    for b in blocks:
        s = b.get("sentence")
        if isinstance(s, dict):
            pref += s.get("preference") or []
            trans += s.get("transition") or []
            rhet += s.get("rhetoric") or []
            if isinstance(s.get("para"), str):
                paras.append(s["para"])
    sentence_rules = {
        "avg_sentence_len": round(sum(lens) / len(lens), 1) if lens else 0,
        "preference": _topk_by_freq(pref, 6),
        "transition": _topk_by_freq(trans, 6),
        "para_length": _topk_by_freq(paras, 3),
    }
    ext = {"rhetoric": _topk_by_freq(rhet, 8)}

    # ---- 本地量化校准：数值型以本地为准（覆盖对应 LLM 估值）----
    if local:
        if local.get("avg_sentence_len"):
            sentence_rules["avg_sentence_len"] = local["avg_sentence_len"]
        if "dialogue_ratio_pct" in local:
            llm_dlg = description_ratio.get("dialogue", 0)
            description_ratio["dialogue_measured"] = local["dialogue_ratio_pct"]
            if abs(float(llm_dlg) - local["dialogue_ratio_pct"]) > 20:
                logger.warning(
                    f"对话占比校准：LLM={llm_dlg}% vs 本地={local['dialogue_ratio_pct']}%，差异较大，已并存供复核"
                )
        ext["four_char_density_pct"] = local.get("four_char_density_pct")

    result["description_ratio"] = description_ratio
    result["sentence_rules"] = sentence_rules
    result["ext"] = ext
    return result


def reduce_with_llm(candidates: dict) -> dict:
    """把定性候选项交给 LLM 合并去重凝练。失败则原样返回候选项（降级）。"""
    payload = {d: candidates.get(d, []) for d in _LIST_DIMS}
    try:
        msg = [
            {"role": "system", "content": STYLE_SYSTEM_PROMPT},
            {"role": "user", "content": STYLE_REDUCE_PROMPT.format(
                candidates=json.dumps(payload, ensure_ascii=False, indent=2))},
        ]
        data = em.parse_json(em.call_llm(msg))
        if isinstance(data, dict):
            out = {}
            for d in _LIST_DIMS:
                v = data.get(d)
                out[d] = [x.strip() for x in v if isinstance(x, str) and x.strip()] if isinstance(v, list) else payload[d]
            return out
    except Exception as e:  # noqa: BLE001
        logger.warning(f"reduce 归纳失败，改用高频候选项: {e}")
    return payload


# ==================================================================
# 4) 置信度 / 质量分
# ==================================================================
def compute_confidence(sample_words: int, n_blocks: int, preset: dict) -> tuple:
    """综合样本量、块数、维度覆盖率 → 置信度(0-100) 与 质量分(1-10)。"""
    sample_ratio = min(1.0, sample_words / STYLE_MIN_SAMPLE_WORDS) if STYLE_MIN_SAMPLE_WORDS else 1.0
    covered = sum(1 for d in _LIST_DIMS if preset.get(d))
    coverage = covered / len(_LIST_DIMS)
    block_factor = min(1.0, n_blocks / 20)
    confidence = round(100 * (0.5 * sample_ratio + 0.3 * coverage + 0.2 * block_factor), 2)
    quality = max(1, min(10, round(confidence / 10)))
    return confidence, quality


# ==================================================================
# 5) 入库（幂等 upsert，按 style_name + project 作用域）
# ==================================================================
def _style_embedding(preset: dict, style_name: str) -> Optional[list]:
    """用风格摘要生成 512 维向量（失败返回 None，字段可空）。"""
    parts = [style_name] + preset.get("mental_models", [])[:5] + preset.get("core_imagery", [])[:8]
    text = "；".join(p for p in parts if p)
    if not text.strip():
        return None
    try:
        return bge_embedder.embed_one(text)
    except Exception as e:  # noqa: BLE001
        logger.warning(f"风格向量生成失败（置空，不影响入库）: {e}")
        return None


def persist_style_preset(preset: dict, project_id: Optional[int]) -> str:
    """写入 style_preset：同名同作用域已存在则覆盖更新+version+1，否则新增。"""
    from psycopg2.extras import Json
    emb = _style_embedding(preset, preset["style_name"])
    emb_param = np.array(emb, dtype=np.float32) if emb is not None else None

    if project_id is None:
        scope, scope_params = "project_id IS NULL", ()
    else:
        scope, scope_params = "project_id = %s", (project_id,)

    conn = em.get_conn()
    try:
        cur = conn.cursor()
        cur.execute(
            f"SELECT id FROM {STYLE_TABLE} WHERE style_name=%s AND {scope} AND NOT is_deleted LIMIT 1",
            (preset["style_name"], *scope_params),
        )
        row = cur.fetchone()
        cols_vals = [
            ("author", preset.get("author")),
            ("source_works", preset.get("source_works") or []),
            ("mental_models", preset.get("mental_models") or []),
            ("decision_heuristics", preset.get("decision_heuristics") or []),
            ("description_ratio", Json(preset.get("description_ratio") or {})),
            ("sentence_rules", Json(preset.get("sentence_rules") or {})),
            ("core_imagery", preset.get("core_imagery") or []),
            ("forbidden_words", preset.get("forbidden_words") or []),
            ("perspective_rules", preset.get("perspective_rules") or []),
            ("anti_patterns", preset.get("anti_patterns") or []),
            ("local_stats", Json(preset.get("local_stats") or {})),
            ("confidence", preset.get("confidence", 0)),
            ("quality_score", preset.get("quality_score", 0)),
            ("sample_word_count", preset.get("sample_word_count", 0)),
            ("category", preset.get("category")),
            ("ext", Json(preset.get("ext") or {})),
            ("embedding", emb_param),
        ]
        if row:
            set_clause = ", ".join(f"{c}=%s" for c, _ in cols_vals) + ", update_time=NOW(), \"version\"=\"version\"+1"
            cur.execute(
                f"UPDATE {STYLE_TABLE} SET {set_clause} WHERE id=%s",
                (*[v for _, v in cols_vals], row[0]),
            )
            result = "update"
        else:
            cols = ["project_id", "style_name"] + [c for c, _ in cols_vals]
            ph = ",".join(["%s"] * len(cols))
            cur.execute(
                f"INSERT INTO {STYLE_TABLE} ({','.join(cols)}) VALUES ({ph})",
                (project_id, preset["style_name"], *[v for _, v in cols_vals]),
            )
            result = "insert"
        conn.commit()
        cur.close()
        return result
    finally:
        conn.close()


# ==================================================================
# 6) 主流程
# ==================================================================
def distill(path: str, preset_name: str, author: Optional[str], project_id: Optional[int],
            use_local: bool, use_reduce: bool, dry_run: bool,
            max_chunks: int, dump_path: Optional[str]) -> None:
    files = em.collect_txt_files(path)
    if not files:
        logger.error(f"未找到 TXT 文件: {path}")
        return
    logger.info(f"===== 文风蒸馏《{preset_name}》 作者={author or '未知'}，样本 {len(files)} 本 =====")

    # 读取+清洗+切块（复用 em）
    all_text, all_chunks, source_works = [], [], []
    for f in files:
        cleaned = em.clean_text(em.read_txt(f))
        all_text.append(cleaned)
        cs = em.chunk_text(cleaned)
        if em.ENABLE_CHUNK_PREFILTER and cs:
            cs = [c for c in cs if not em.should_skip_chunk(c)]
        all_chunks.extend(cs)
        import os as _os
        source_works.append(_os.path.splitext(_os.path.basename(f))[0])
    sample_word_count = sum(len(t) for t in all_text)
    if max_chunks and max_chunks > 0:
        all_chunks = all_chunks[:max_chunks]
    logger.info(f"清洗后共 {sample_word_count} 字，{len(all_chunks)} 块，开始块级抽取（并发 {em.LLM_CONCURRENCY}）…")
    if not all_chunks:
        logger.warning("无有效切块，终止")
        return
    if sample_word_count < STYLE_MIN_SAMPLE_WORDS:
        logger.warning(f"样本仅 {sample_word_count} 字 < 门槛 {STYLE_MIN_SAMPLE_WORDS}，置信度将打折")

    # 块级并发抽取（map）
    blocks: List[dict] = []
    done = 0
    with ThreadPoolExecutor(max_workers=em.LLM_CONCURRENCY) as pool:
        futures = [pool.submit(extract_style_from_chunk, c, i) for i, c in enumerate(all_chunks)]
        for fut in as_completed(futures):
            r = fut.result()
            if r:
                blocks.append(r)
            done += 1
            if done % 10 == 0 or done == len(all_chunks):
                logger.info(f"进度 {done}/{len(all_chunks)} 块，有效 {len(blocks)} 块")
    if not blocks:
        logger.error("所有块抽取失败，终止")
        return

    # 本地量化统计（可选）
    local = local_style_stats("\n".join(all_text)) if use_local else None
    if local:
        logger.info(f"本地量化：句长{local['avg_sentence_len']} 对话{local['dialogue_ratio_pct']}% 四字{local['four_char_density_pct']}%")

    # 聚合（reduce）
    agg = aggregate_style(blocks, local)
    if use_reduce:
        logger.info("LLM 归纳凝练定性维度…")
        reduced = reduce_with_llm({d: agg[d] for d in _LIST_DIMS})
        agg.update(reduced)

    # 组装 preset
    preset = {
        "style_name": preset_name,
        "author": author,
        "source_works": source_works,
        "local_stats": local or {},
        "category": None,
        **agg,
    }
    conf, quality = compute_confidence(sample_word_count, len(blocks), preset)
    preset["confidence"] = conf
    preset["quality_score"] = quality
    preset["sample_word_count"] = sample_word_count
    logger.info(f"聚合完成：置信度 {conf}，质量分 {quality}，覆盖维度 "
                + ", ".join(f"{d}={len(preset.get(d, []))}" for d in _LIST_DIMS))

    # 导出
    if dump_path:
        try:
            with open(dump_path, "w", encoding="utf-8") as fp:
                json.dump({k: v for k, v in preset.items() if k != "embedding"}, fp,
                          ensure_ascii=False, indent=2)
            logger.info(f"已导出文风配置到 {dump_path}")
        except OSError as e:
            logger.warning(f"导出失败: {e}")

    if dry_run:
        logger.info("[dry-run] 跳过入库。终稿预览：")
        for d in _LIST_DIMS:
            logger.info(f"  {d}: {preset.get(d)}")
        logger.info(f"  description_ratio: {preset.get('description_ratio')}")
        logger.info(f"  sentence_rules: {preset.get('sentence_rules')}")
        return

    result = persist_style_preset(preset, project_id)
    logger.info(f"入库完成：{result} 《{preset_name}》(project_id={project_id if project_id is not None else 'NULL'})")


def main() -> int:
    parser = argparse.ArgumentParser(description="作者文风蒸馏 → style_preset")
    parser.add_argument("path", help="TXT 文件或目录（应为同一作者/同一风格）")
    parser.add_argument("--preset-name", required=True, help="文风预设名（幂等键）")
    parser.add_argument("--author", default=None, help="作者名")
    parser.add_argument("--project-id", type=int, default=None,
                        help="归属项目 id；默认取环境变量 TARGET_PROJECT_ID（空=全局共享 NULL）")
    parser.add_argument("--no-local-stats", action="store_true", help="关闭本地量化统计")
    parser.add_argument("--no-reduce", action="store_true", help="关闭 LLM 归纳凝练（省一次调用）")
    parser.add_argument("--dry-run", action="store_true", help="只蒸馏不入库")
    parser.add_argument("--dump", default=None, metavar="FILE", help="导出文风配置 JSON")
    parser.add_argument("--max-chunks", type=int, default=em.MAX_CHUNKS, help="只处理前 N 块（验证用）")
    args = parser.parse_args()

    if not em.LLM_API_KEY:
        logger.error("未配置 LLM_API_KEY，请先复制 .env.example 为 .env 并填写")
        return 1

    project_id = args.project_id if args.project_id is not None else em.TARGET_PROJECT_ID
    t0 = time.time()
    try:
        distill(args.path, args.preset_name, args.author, project_id,
                use_local=not args.no_local_stats, use_reduce=not args.no_reduce,
                dry_run=args.dry_run, max_chunks=args.max_chunks, dump_path=args.dump)
    except Exception as e:  # noqa: BLE001
        logger.error(f"文风蒸馏失败: {e}")
        return 1
    logger.info(f"完成，耗时 {time.time() - t0:.1f}s。失败详情见 etl_failures.log")
    return 0


if __name__ == "__main__":
    sys.exit(main())
