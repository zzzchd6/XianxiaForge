"""
benchmark_quality.py — 质量检测独立模块（拆文系统 · 第三梯队）

独立于拆文流程：输入 = 标准配置（起承转合比例 / 情绪密度 / 钩子频率等），
输出 = 六维检测报告。标准来源二选一：
    --standard-books "1,2"   从已拆解对标书目聚合（均值）
    --standard-json FILE     人工预设 JSON（键见 build_manual_standard）

六维检测（零 LLM 纯统计）：
    1 节奏     起承转合比例与标准的偏差
    2 情绪曲线 平均张力 / 波动幅度
    3 冲突密度 情节节点数 / 章数
    4 伏笔密度 foreshadow 节点数 / 章数
    5 钩子覆盖 章骨架带章末钩子的比例
    6 减法健康 核心支点占减法候选比例（需先跑 benchmark_variables.py）

用法：
    python benchmark_quality.py --book-id N --standard-books "1,2" [--report FILE]
"""
from __future__ import annotations

import argparse
import json
import logging
import os
import sys
import time
from typing import Dict, List, Optional

from extract_materials import PG

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("quality")

RATIO_KEYS = ("setup_ratio", "develop_ratio", "turn_ratio", "resolve_ratio")
RATIO_NAMES = ("起", "承", "转", "合")


# ==================================================================
# 数据库读取
# ==================================================================
def get_conn():
    import psycopg2
    conn = psycopg2.connect(**PG)
    return conn


def load_book_metrics(cur, book_id: int) -> Dict:
    """聚合一本书的六维指标。"""
    cur.execute(
        "SELECT title FROM benchmark_book WHERE id=%s AND NOT is_deleted", (book_id,),
    )
    row = cur.fetchone()
    if not row:
        raise ValueError(f"书目 {book_id} 不存在或已删除")
    title = row[0]

    cur.execute(
        "SELECT setup_ratio, develop_ratio, turn_ratio, resolve_ratio, "
        "emotion_curve, hook FROM benchmark_item "
        "WHERE book_id=%s AND item_type='skeleton' AND NOT is_deleted",
        (book_id,),
    )
    skeletons = cur.fetchall()

    ratios: List[List[float]] = []
    curve_means: List[float] = []
    curve_stds: List[float] = []
    hook_cnt = 0
    for s in skeletons:
        r = [float(x) for x in s[:4] if x is not None]
        if len(r) == 4:
            ratios.append(r)
        curve = s[4]
        if curve:
            vals = [float(x) for x in curve]
            m = sum(vals) / len(vals)
            curve_means.append(m)
            curve_stds.append((sum((v - m) ** 2 for v in vals) / len(vals)) ** 0.5)
        if s[5]:
            hook_cnt += 1

    cur.execute(
        "SELECT COUNT(*), COALESCE(SUM(CASE WHEN item_type='plot' THEN 1 ELSE 0 END),0), "
        "COALESCE(SUM(CASE WHEN material_type='foreshadow' THEN 1 ELSE 0 END),0) "
        "FROM benchmark_item WHERE book_id=%s AND NOT is_deleted "
        "AND item_type IN ('skeleton','plot')",
        (book_id,),
    )
    _, plot_cnt, fore_cnt = cur.fetchone()

    # 减法健康：核心支点 / (核心支点+可替换+局部)
    cur.execute(
        "SELECT COUNT(*) FILTER (WHERE '核心支点' = ANY(tags)), "
        "COUNT(*) FILTER (WHERE '可替换桥段' = ANY(tags) OR '局部支点' = ANY(tags)) "
        "FROM benchmark_item WHERE book_id=%s AND item_type='plot' AND NOT is_deleted",
        (book_id,),
    )
    pivot_cnt, other_verdict = cur.fetchone()

    n_ch = max(len(skeletons), 1)
    return {
        "title": title,
        "n_chapters": n_ch,
        "ratios": [sum(col) / len(ratios) for col in zip(*ratios)] if ratios else None,
        "curve_mean": sum(curve_means) / len(curve_means) if curve_means else None,
        "curve_std": sum(curve_stds) / len(curve_stds) if curve_stds else None,
        "plot_per_chapter": plot_cnt / n_ch,
        "foreshadow_per_chapter": fore_cnt / n_ch,
        "hook_coverage": hook_cnt / n_ch,
        "pivot_ratio": (pivot_cnt / (pivot_cnt + other_verdict))
                       if (pivot_cnt + other_verdict) > 0 else None,
    }


def build_standard(cur, book_ids: List[int]) -> Dict:
    """多书聚合标准：各书指标的均值。"""
    metrics = [load_book_metrics(cur, bid) for bid in book_ids]
    def mean_of(key):
        vals = [m[key] for m in metrics if m[key] is not None]
        return sum(vals) / len(vals) if vals else None
    ratios_cols = [m["ratios"] for m in metrics if m["ratios"]]
    return {
        "source": f"聚合书目 {book_ids}",
        "ratios": [sum(c) / len(ratios_cols) for c in zip(*ratios_cols)] if ratios_cols else None,
        "curve_mean": mean_of("curve_mean"),
        "curve_std": mean_of("curve_std"),
        "plot_per_chapter": mean_of("plot_per_chapter"),
        "foreshadow_per_chapter": mean_of("foreshadow_per_chapter"),
        "hook_coverage": mean_of("hook_coverage"),
        "pivot_ratio": mean_of("pivot_ratio"),
    }


def build_manual_standard(path: str) -> Dict:
    with open(path, "r", encoding="utf-8") as f:
        raw = json.load(f)
    return {
        "source": f"人工预设 {os.path.basename(path)}",
        "ratios": raw.get("ratios"),
        "curve_mean": raw.get("curve_mean"),
        "curve_std": raw.get("curve_std"),
        "plot_per_chapter": raw.get("plot_per_chapter"),
        "foreshadow_per_chapter": raw.get("foreshadow_per_chapter"),
        "hook_coverage": raw.get("hook_coverage"),
        "pivot_ratio": raw.get("pivot_ratio"),
    }


# ==================================================================
# 六维评分
# ==================================================================
def dev_score(actual, expected, tolerance: float = 0.15) -> Optional[float]:
    """偏差评分：相对偏差 ≤ tolerance → 100 分，线性衰减到 2 倍容差处 0 分。"""
    if actual is None or expected is None or expected == 0:
        return None
    dev = abs(actual - expected) / abs(expected)
    if dev <= tolerance:
        return 100.0
    if dev >= tolerance * 2:
        return 0.0
    return round(100.0 * (1 - (dev - tolerance) / tolerance), 1)


def fmt(v, digits: int = 2) -> str:
    return "—" if v is None else f"{v:.{digits}f}"


def run_checks(actual: Dict, std: Dict) -> List[dict]:
    checks: List[dict] = []

    # 1 节奏：四个比例分别评分取均值
    if actual["ratios"] and std["ratios"]:
        sub = [dev_score(a, e) for a, e in zip(actual["ratios"], std["ratios"])]
        sub = [s for s in sub if s is not None]
        score = round(sum(sub) / len(sub), 1) if sub else None
        detail = "、".join(f"{n}:{fmt(a)}(标准{fmt(e)})" for n, a, e
                           in zip(RATIO_NAMES, actual["ratios"], std["ratios"]))
        advice = "起承转合节奏偏离标准，检查各段篇幅分配" if score is not None and score < 60 else "节奏贴合标准"
    else:
        score, detail, advice = None, "缺少比例数据", "先完成骨架拆解"
    checks.append({"dim": "节奏(起承转合)", "score": score, "detail": detail, "advice": advice})

    # 2 情绪曲线
    s1 = dev_score(actual["curve_mean"], std["curve_mean"], 0.2)
    s2 = dev_score(actual["curve_std"], std["curve_std"], 0.3)
    score = round((s1 + s2) / 2, 1) if s1 is not None and s2 is not None else (s1 or s2)
    detail = f"平均张力:{fmt(actual['curve_mean'])}(标准{fmt(std['curve_mean'])})、波动:{fmt(actual['curve_std'])}(标准{fmt(std['curve_std'])})"
    advice = "情绪曲线贴合标准" if score is None or score >= 60 else "情绪张力/波动偏离，检查爽点分布"
    checks.append({"dim": "情绪曲线", "score": score, "detail": detail, "advice": advice})

    # 3 冲突密度
    score = dev_score(actual["plot_per_chapter"], std["plot_per_chapter"], 0.3)
    detail = f"{fmt(actual['plot_per_chapter'])}节点/章(标准{fmt(std['plot_per_chapter'])})"
    advice = "冲突密度贴合标准" if score is None or score >= 60 else "情节节点密度偏离，检查每章事件量"
    checks.append({"dim": "冲突密度", "score": score, "detail": detail, "advice": advice})

    # 4 伏笔密度
    score = dev_score(actual["foreshadow_per_chapter"], std["foreshadow_per_chapter"], 0.4)
    detail = f"{fmt(actual['foreshadow_per_chapter'], 3)}伏笔/章(标准{fmt(std['foreshadow_per_chapter'], 3)})"
    advice = "伏笔密度贴合标准" if score is None or score >= 60 else "伏笔埋设频率偏离，检查长线布局"
    checks.append({"dim": "伏笔密度", "score": score, "detail": detail, "advice": advice})

    # 5 钩子覆盖
    score = dev_score(actual["hook_coverage"], std["hook_coverage"], 0.15)
    detail = f"{fmt(actual['hook_coverage'])}章带钩子(标准{fmt(std['hook_coverage'])})"
    advice = "钩子覆盖贴合标准" if score is None or score >= 60 else "章末钩子覆盖率偏低，强化每章收尾悬念"
    checks.append({"dim": "钩子覆盖", "score": score, "detail": detail, "advice": advice})

    # 6 减法健康（无数据则标注跳过）
    if actual["pivot_ratio"] is None:
        score, detail, advice = None, "未执行减法测试", "先运行 benchmark_variables.py"
    else:
        expected = std["pivot_ratio"] if std["pivot_ratio"] is not None else 0.5
        score = dev_score(actual["pivot_ratio"], expected, 0.4)
        detail = f"核心支点占比 {fmt(actual['pivot_ratio'])}(参考{fmt(expected)})"
        advice = "结构结实度正常" if score is None or score >= 60 else "支点结构偏离，检查情节必要性"
    checks.append({"dim": "减法健康", "score": score, "detail": detail, "advice": advice})
    return checks


# ==================================================================
# 报告
# ==================================================================
def render_report(actual: Dict, std: Dict, checks: List[dict]) -> str:
    scored = [c["score"] for c in checks if c["score"] is not None]
    total = round(sum(scored) / len(scored), 1) if scored else None
    grade = ("A" if total >= 85 else "B" if total >= 70 else "C" if total >= 55 else "D") if total is not None else "—"
    lines = [
        f"# 质量检测报告 —《{actual['title']}》",
        "",
        f"- 检测时间：{time.strftime('%Y-%m-%d %H:%M:%S')}",
        f"- 标准来源：{std['source']}",
        f"- 样本章数：{actual['n_chapters']}",
        f"- **总评分：{fmt(total, 1)} / 100（等级 {grade}）**",
        "",
        "| 维度 | 得分 | 明细 | 建议 |",
        "|------|------|------|------|",
    ]
    for c in checks:
        lines.append(f"| {c['dim']} | {fmt(c['score'], 1)} | {c['detail']} | {c['advice']} |")
    return "\n".join(lines) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description="六维质量检测（标准驱动）")
    parser.add_argument("--book-id", type=int, required=True, help="被检测书目 ID")
    parser.add_argument("--standard-books", default=None,
                        help='标准来源：逗号分隔对标书目 ID，如 "1,2"')
    parser.add_argument("--standard-json", default=None, help="标准来源：人工预设 JSON 文件")
    parser.add_argument("--report", default=None, metavar="FILE",
                        help="报告输出路径（默认 outputs/quality-report-book<N>.md）")
    args = parser.parse_args()

    if not args.standard_books and not args.standard_json:
        logger.error("必须指定标准来源：--standard-books 或 --standard-json")
        return 1

    conn = get_conn()
    try:
        cur = conn.cursor()
        actual = load_book_metrics(cur, args.book_id)
        if args.standard_json:
            std = build_manual_standard(args.standard_json)
        else:
            ids = [int(x) for x in args.standard_books.split(",") if x.strip()]
            std = build_standard(cur, ids)
        cur.close()
    finally:
        conn.close()

    checks = run_checks(actual, std)
    report = render_report(actual, std, checks)

    out = args.report or os.path.join("outputs", f"quality-report-book{args.book_id}.md")
    os.makedirs(os.path.dirname(out) or ".", exist_ok=True)
    with open(out, "w", encoding="utf-8") as f:
        f.write(report)

    # 终端摘要（GUI 日志可读）
    for c in checks:
        logger.info(f"[{c['dim']}] {fmt(c['score'], 1)}分 — {c['detail']}")
    logger.info(f"报告已写入 {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
