r"""
gui_server.py — 文风与领域知识蒸馏 · 本地 Web 控制台（Flask）

职责（零侵入包装现有 CLI）：
  - 后台任务：以子进程方式调用 distill_style.py / extract_domain_knowledge.py，
    完整复用其参数与管线，不改动任何现有脚本一行。
  - 实时日志：子进程 stdout/stderr 合并逐行缓存，前端轮询增量拉取。
  - 结果管理：查询 style_preset / plot_domain_knowledge，支持详情与软删除。

运行：
    .\.venv\Scripts\python.exe gui_server.py
    浏览器打开 http://127.0.0.1:8610

说明：
  - 用 sys.executable 拉起子进程 → 与本服务同一解释器（应为 venv python）。
  - 子进程强制 UTF-8（PYTHONIOENCODING/PYTHONUTF8），规避 Windows 控制台乱码。
  - 结果查询不 SELECT embedding 列，故无需 pgvector 注册。
"""
from __future__ import annotations

import itertools
import os
import subprocess
import sys
import threading
import time
from typing import List, Optional

import psycopg2
from flask import Flask, jsonify, request, send_from_directory

import env_loader  # noqa: F401  # 从根目录加载 .env 并做 PG_* 兼容映射

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PY = sys.executable  # 当前解释器（venv python）
PORT = int(os.getenv("GUI_PORT", "8610"))

PG = dict(
    host=os.getenv("PG_HOST", "localhost"),
    port=int(os.getenv("PG_PORT", "5432")),
    dbname=os.getenv("PG_NAME", "novel_studio"),
    user=os.getenv("PG_USER", "noveluser"),
    password=os.getenv("PG_PASSWORD", ""),
)

# 4 张剧情素材表（一期功能）：key -> (表名, 中文名)。key 为白名单，SQL 拼接安全。
MATERIAL_TABLES = {
    "encounter": ("plot_material_encounter", "奇遇"),
    "foreshadow": ("plot_material_foreshadow", "伏笔"),
    "highlight": ("plot_material_highlight", "高光"),
    "task": ("plot_material_task", "任务链"),
}

app = Flask(__name__, static_folder=None)

# ==================================================================
# 后台任务管理
# ==================================================================
_tasks: dict = {}
_lock = threading.Lock()
_counter = itertools.count(1)


def _run(task_id: str, cmd: List[str]) -> None:
    t = _tasks[task_id]
    env = dict(os.environ, PYTHONIOENCODING="utf-8", PYTHONUTF8="1")
    try:
        p = subprocess.Popen(
            cmd, cwd=BASE_DIR,
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            bufsize=1, encoding="utf-8", errors="replace", env=env,
        )
        with _lock:
            t["pid"] = p.pid
        assert p.stdout is not None
        for line in p.stdout:
            with _lock:
                t["lines"].append(line.rstrip("\n"))
        p.wait()
        with _lock:
            t["returncode"] = p.returncode
            t["status"] = "done" if p.returncode == 0 else "failed"
            t["ended"] = time.time()
    except Exception as e:  # noqa: BLE001
        with _lock:
            t["lines"].append(f"[GUI] 子进程启动失败: {e}")
            t["status"] = "failed"
            t["returncode"] = -1
            t["ended"] = time.time()


def start_task(kind: str, title: str, cmd: List[str]) -> str:
    tid = str(next(_counter))
    _tasks[tid] = dict(
        id=tid, kind=kind, title=title, cmd=" ".join(cmd),
        status="running", lines=[], returncode=None,
        started=time.time(), ended=None, pid=None,
    )
    threading.Thread(target=_run, args=(tid, cmd), daemon=True).start()
    return tid


def _clean_path(p: Optional[str]) -> str:
    return (p or "").strip().strip('"').strip("'")


# ==================================================================
# 数据库
# ==================================================================
def db():
    return psycopg2.connect(**PG)


# ==================================================================
# 页面
# ==================================================================
@app.route("/")
def index():
    return send_from_directory(os.path.join(BASE_DIR, "webgui"), "index.html")


# ==================================================================
# 运行：文风蒸馏
# ==================================================================
@app.route("/api/run/style", methods=["POST"])
def run_style():
    d = request.get_json(force=True) or {}
    path = _clean_path(d.get("path"))
    preset = (d.get("preset_name") or "").strip()
    if not path or not os.path.exists(path):
        return jsonify(error=f"路径不存在: {path}"), 400
    if not preset:
        return jsonify(error="预设名（preset_name）必填"), 400

    cmd = [PY, "distill_style.py", path, "--preset-name", preset]
    if (d.get("author") or "").strip():
        cmd += ["--author", d["author"].strip()]
    if str(d.get("project_id") or "").strip():
        cmd += ["--project-id", str(d["project_id"]).strip()]
    if d.get("no_local_stats"):
        cmd += ["--no-local-stats"]
    if d.get("no_reduce"):
        cmd += ["--no-reduce"]
    if d.get("dry_run"):
        cmd += ["--dry-run"]
    if str(d.get("max_chunks") or "").strip():
        cmd += ["--max-chunks", str(d["max_chunks"]).strip()]
    if (d.get("dump") or "").strip():
        cmd += ["--dump", d["dump"].strip()]

    tid = start_task("style", f"文风蒸馏《{preset}》", cmd)
    return jsonify(task_id=tid, cmd=" ".join(cmd))


# ==================================================================
# 运行：领域知识蒸馏
# ==================================================================
@app.route("/api/run/domain", methods=["POST"])
def run_domain():
    d = request.get_json(force=True) or {}
    path = _clean_path(d.get("path"))
    if not path or not os.path.exists(path):
        return jsonify(error=f"路径不存在: {path}"), 400

    cmd = [PY, "extract_domain_knowledge.py", path]
    if (d.get("domain") or "").strip():
        cmd += ["--domain", d["domain"].strip()]
    if (d.get("source_book") or "").strip():
        cmd += ["--source-book", d["source_book"].strip()]
    if str(d.get("project_id") or "").strip():
        cmd += ["--project-id", str(d["project_id"]).strip()]
    if d.get("dry_run"):
        cmd += ["--dry-run"]
    if str(d.get("max_chunks") or "").strip():
        cmd += ["--max-chunks", str(d["max_chunks"]).strip()]
    if (d.get("dump") or "").strip():
        cmd += ["--dump", d["dump"].strip()]

    title = f"领域知识蒸馏 [{d.get('domain') or '未指定'}]"
    tid = start_task("domain", title, cmd)
    return jsonify(task_id=tid, cmd=" ".join(cmd))


# ==================================================================
# 运行：剧情素材抽取（一期，奇遇/伏笔/高光/任务链 四类一次抽取）
# ==================================================================
@app.route("/api/run/material", methods=["POST"])
def run_material():
    d = request.get_json(force=True) or {}
    path = _clean_path(d.get("path"))
    if not path or not os.path.exists(path):
        return jsonify(error=f"路径不存在: {path}"), 400

    # extract_materials.py 无 --project-id（只读环境变量 TARGET_PROJECT_ID）
    cmd = [PY, "extract_materials.py", path]
    if (d.get("source_work") or "").strip():
        cmd += ["--source-work", d["source_work"].strip()]
    if d.get("dry_run"):
        cmd += ["--dry-run"]
    if str(d.get("max_chunks") or "").strip():
        cmd += ["--max-chunks", str(d["max_chunks"]).strip()]
    if (d.get("dump") or "").strip():
        cmd += ["--dump", d["dump"].strip()]

    title = f"剧情素材抽取 [{os.path.basename(path)}]"
    tid = start_task("material", title, cmd)
    return jsonify(task_id=tid, cmd=" ".join(cmd))


# ==================================================================
# 运行：对标拆解（拆文系统，骨架+情节合并拆解）
# ==================================================================
@app.route("/api/run/benchmark", methods=["POST"])
def run_benchmark():
    d = request.get_json(force=True) or {}
    path = _clean_path(d.get("path"))
    if not path or not os.path.exists(path):
        return jsonify(error=f"路径不存在: {path}"), 400

    cmd = [PY, "benchmark_analyze.py", path]
    if (d.get("source_work") or "").strip():
        cmd += ["--source-work", d["source_work"].strip()]
    if (d.get("author") or "").strip():
        cmd += ["--author", d["author"].strip()]
    if str(d.get("project_id") or "").strip():
        cmd += ["--project-id", str(d["project_id"]).strip()]
    scope = (d.get("scope") or "volume").strip()
    cmd += ["--scope", scope if scope in ("volume", "sample") else "volume"]
    if str(d.get("from_chapter") or "").strip():
        cmd += ["--from-chapter", str(d["from_chapter"]).strip()]
    if str(d.get("to_chapter") or "").strip():
        cmd += ["--to-chapter", str(d["to_chapter"]).strip()]
    if str(d.get("sample_step") or "").strip():
        cmd += ["--sample-step", str(d["sample_step"]).strip()]
    if str(d.get("max_chapters") or "").strip():
        cmd += ["--max-chapters", str(d["max_chapters"]).strip()]
    if d.get("force"):
        cmd += ["--force"]
    if d.get("dry_run"):
        cmd += ["--dry-run"]
    if (d.get("dump") or "").strip():
        cmd += ["--dump", d["dump"].strip()]

    title = f"对标拆解 [{os.path.basename(path)}]"
    tid = start_task("benchmark", title, cmd)
    return jsonify(task_id=tid, cmd=" ".join(cmd))


@app.route("/api/run/reflux", methods=["POST"])
def run_reflux():
    """高质量拆解节点回流素材表（benchmark_reflux.py 子进程）。"""
    d = request.get_json(force=True) or {}
    cmd = [PY, "benchmark_reflux.py"]
    if str(d.get("book_id") or "").strip():
        cmd += ["--book-id", str(d["book_id"]).strip()]
    if str(d.get("min_quality") or "").strip():
        cmd += ["--min-quality", str(d["min_quality"]).strip()]
    if str(d.get("project_id") or "").strip():
        cmd += ["--project-id", str(d["project_id"]).strip()]
    if str(d.get("limit") or "").strip():
        cmd += ["--limit", str(d["limit"]).strip()]
    if d.get("dry_run"):
        cmd += ["--dry-run"]
    tid = start_task("reflux", "拆解节点回流素材库", cmd)
    return jsonify(task_id=tid, cmd=" ".join(cmd))


@app.route("/api/run/variables", methods=["POST"])
def run_variables():
    """变量级拆解（benchmark_variables.py 子进程）。"""
    d = request.get_json(force=True) or {}
    if not str(d.get("book_id") or "").strip():
        return jsonify(error="缺少 book_id"), 400
    cmd = [PY, "benchmark_variables.py", "--book-id", str(d["book_id"]).strip()]
    if str(d.get("max_skeletons") or "").strip():
        cmd += ["--max-skeletons", str(d["max_skeletons"]).strip()]
    if str(d.get("max_plots") or "").strip():
        cmd += ["--max-plots", str(d["max_plots"]).strip()]
    if d.get("skip_subtraction"):
        cmd += ["--skip-subtraction"]
    if d.get("force"):
        cmd += ["--force"]
    if d.get("dry_run"):
        cmd += ["--dry-run"]
    if (d.get("dump") or "").strip():
        cmd += ["--dump", d["dump"].strip()]
    tid = start_task("variables", f"变量级拆解 [book#{d['book_id']}]", cmd)
    return jsonify(task_id=tid, cmd=" ".join(cmd))


@app.route("/api/run/quality", methods=["POST"])
def run_quality():
    """六维质量检测（benchmark_quality.py 子进程）。"""
    d = request.get_json(force=True) or {}
    if not str(d.get("book_id") or "").strip():
        return jsonify(error="缺少 book_id"), 400
    if not (d.get("standard_books") or "").strip() and not (d.get("standard_json") or "").strip():
        return jsonify(error="需指定标准来源（对标书目或预设 JSON）"), 400
    cmd = [PY, "benchmark_quality.py", "--book-id", str(d["book_id"]).strip()]
    if (d.get("standard_books") or "").strip():
        cmd += ["--standard-books", d["standard_books"].strip()]
    if (d.get("standard_json") or "").strip():
        cmd += ["--standard-json", d["standard_json"].strip()]
    if (d.get("report") or "").strip():
        cmd += ["--report", d["report"].strip()]
    tid = start_task("quality", f"质量检测 [book#{d['book_id']}]", cmd)
    return jsonify(task_id=tid, cmd=" ".join(cmd))


@app.route("/api/run/substitute", methods=["POST"])
def run_substitute():
    """变量替换工作流（benchmark_substitute.py 子进程）。"""
    d = request.get_json(force=True) or {}
    if not str(d.get("book_id") or "").strip():
        return jsonify(error="缺少 book_id"), 400
    if not (d.get("target_domain") or "").strip():
        return jsonify(error="缺少 target_domain"), 400
    cmd = [PY, "benchmark_substitute.py", "--book-id", str(d["book_id"]).strip(),
           "--target-domain", d["target_domain"].strip()]
    if str(d.get("top_k") or "").strip():
        cmd += ["--top-k", str(d["top_k"]).strip()]
    if (d.get("dump") or "").strip():
        cmd += ["--dump", d["dump"].strip()]
    tid = start_task("substitute", f"变量替换 [book#{d['book_id']}→{d['target_domain']}]", cmd)
    return jsonify(task_id=tid, cmd=" ".join(cmd))


@app.route("/api/results/quality/report")
def quality_report():
    """读取六维质量检测报告 markdown。"""
    book = (request.args.get("book") or "").strip()
    if not book or not book.isdigit():
        return jsonify(error="缺少合法的 book 参数"), 400
    path = os.path.join(BASE_DIR, "outputs", f"quality-report-book{book}.md")
    if not os.path.isfile(path):
        return jsonify(error="报告不存在，请先运行质量检测"), 404
    with open(path, "r", encoding="utf-8") as f:
        return jsonify(content=f.read())


# ==================================================================
# 任务日志（增量轮询）
# ==================================================================
@app.route("/api/task/<tid>")
def task_status(tid: str):
    t = _tasks.get(tid)
    if not t:
        return jsonify(error="任务不存在"), 404
    try:
        offset = int(request.args.get("offset", "0"))
    except ValueError:
        offset = 0
    with _lock:
        lines = t["lines"][offset:]
        total = len(t["lines"])
        status = t["status"]
        rc = t["returncode"]
        started, ended = t["started"], t["ended"]
    elapsed = round((ended or time.time()) - started, 1)
    return jsonify(status=status, returncode=rc, lines=lines,
                   next_offset=total, elapsed=elapsed)


@app.route("/api/tasks")
def list_tasks():
    with _lock:
        items = [
            dict(id=t["id"], kind=t["kind"], title=t["title"], status=t["status"],
                 returncode=t["returncode"],
                 elapsed=round((t["ended"] or time.time()) - t["started"], 1),
                 nlines=len(t["lines"]))
            for t in _tasks.values()
        ]
    items.sort(key=lambda x: int(x["id"]), reverse=True)
    return jsonify(tasks=items[:30])


# ==================================================================
# 文件浏览助手（服务端 .txt 选择）
# ==================================================================
@app.route("/api/browse")
def browse():
    d = _clean_path(request.args.get("dir")) or BASE_DIR
    d = os.path.abspath(d)
    if not os.path.isdir(d):
        return jsonify(error=f"不是目录: {d}"), 400
    dirs, files = [], []
    try:
        for name in sorted(os.listdir(d), key=str.lower):
            full = os.path.join(d, name)
            if os.path.isdir(full):
                if not name.startswith(".") and name != "__pycache__":
                    dirs.append(name)
            elif name.lower().endswith(".txt"):
                files.append(dict(name=name, path=full,
                                  size=os.path.getsize(full)))
    except PermissionError:
        pass
    parent = os.path.dirname(d)
    return jsonify(dir=d, parent=parent if parent != d else None,
                   dirs=dirs, files=files)


# ==================================================================
# 结果：文风预设
# ==================================================================
@app.route("/api/results/style")
def results_style():
    q = (request.args.get("q") or "").strip()
    where = "NOT is_deleted"
    params: list = []
    if q:
        where += " AND (style_name ILIKE %s OR author ILIKE %s)"
        params += [f"%{q}%", f"%{q}%"]
    sql = f"""
        SELECT id, project_id, style_name, author, quality_score, confidence,
               sample_word_count, verify_status, "version",
               COALESCE(array_length(mental_models,1),0),
               COALESCE(array_length(core_imagery,1),0),
               to_char(update_time,'YYYY-MM-DD HH24:MI') 
        FROM style_preset WHERE {where}
        ORDER BY update_time DESC LIMIT 200
    """
    conn = db()
    try:
        cur = conn.cursor()
        cur.execute(sql, params)
        rows = [dict(id=r[0], project_id=r[1], style_name=r[2], author=r[3],
                     quality_score=r[4], confidence=float(r[5]) if r[5] is not None else 0,
                     sample_word_count=r[6], verify_status=r[7], version=r[8],
                     n_mind=r[9], n_img=r[10], update_time=r[11])
                for r in cur.fetchall()]
        cur.close()
        return jsonify(rows=rows)
    finally:
        conn.close()


@app.route("/api/results/style/<int:sid>")
def results_style_detail(sid: int):
    conn = db()
    try:
        cur = conn.cursor()
        cur.execute("""
            SELECT style_name, author, source_works, mental_models, decision_heuristics,
                   description_ratio, sentence_rules, core_imagery, forbidden_words,
                   perspective_rules, anti_patterns, local_stats, ext,
                   confidence, quality_score, sample_word_count, verify_status, "version"
            FROM style_preset WHERE id=%s
        """, (sid,))
        r = cur.fetchone()
        cur.close()
        if not r:
            return jsonify(error="不存在"), 404
        keys = ["style_name", "author", "source_works", "mental_models",
                "decision_heuristics", "description_ratio", "sentence_rules",
                "core_imagery", "forbidden_words", "perspective_rules",
                "anti_patterns", "local_stats", "ext", "confidence",
                "quality_score", "sample_word_count", "verify_status", "version"]
        data = dict(zip(keys, r))
        if data.get("confidence") is not None:
            data["confidence"] = float(data["confidence"])
        return jsonify(data=data)
    finally:
        conn.close()


@app.route("/api/results/style/<int:sid>/delete", methods=["POST"])
def results_style_delete(sid: int):
    conn = db()
    try:
        cur = conn.cursor()
        cur.execute("UPDATE style_preset SET is_deleted=TRUE, update_time=NOW() WHERE id=%s", (sid,))
        conn.commit()
        n = cur.rowcount
        cur.close()
        return jsonify(deleted=n)
    finally:
        conn.close()


# ==================================================================
# 结果：领域知识
# ==================================================================
@app.route("/api/results/domain")
def results_domain():
    q = (request.args.get("q") or "").strip()
    ktype = (request.args.get("type") or "").strip()
    domain = (request.args.get("domain") or "").strip()
    where = "NOT is_deleted"
    params: list = []
    if q:
        where += " AND (title ILIKE %s OR content ILIKE %s)"
        params += [f"%{q}%", f"%{q}%"]
    if ktype:
        where += " AND knowledge_type=%s"
        params.append(ktype)
    if domain:
        where += " AND applicable_domain ILIKE %s"
        params.append(f"%{domain}%")
    sql = f"""
        SELECT id, project_id, knowledge_type, applicable_domain, title,
               LEFT(content, 120), tags, quality_score, source_book,
               to_char(created_at,'YYYY-MM-DD HH24:MI')
        FROM plot_domain_knowledge WHERE {where}
        ORDER BY created_at DESC LIMIT 300
    """
    conn = db()
    try:
        cur = conn.cursor()
        cur.execute(sql, params)
        rows = [dict(id=r[0], project_id=r[1], knowledge_type=r[2],
                     applicable_domain=r[3], title=r[4], preview=r[5],
                     tags=r[6] or [], quality_score=r[7], source_book=r[8],
                     created_at=r[9])
                for r in cur.fetchall()]
        cur.close()
        return jsonify(rows=rows)
    finally:
        conn.close()


@app.route("/api/results/domain/<int:kid>")
def results_domain_detail(kid: int):
    conn = db()
    try:
        cur = conn.cursor()
        cur.execute("""
            SELECT knowledge_type, applicable_domain, title, content, tags,
                   quality_score, source_book, source_snippet,
                   to_char(created_at,'YYYY-MM-DD HH24:MI')
            FROM plot_domain_knowledge WHERE id=%s
        """, (kid,))
        r = cur.fetchone()
        cur.close()
        if not r:
            return jsonify(error="不存在"), 404
        keys = ["knowledge_type", "applicable_domain", "title", "content",
                "tags", "quality_score", "source_book", "source_snippet", "created_at"]
        return jsonify(data=dict(zip(keys, r)))
    finally:
        conn.close()


@app.route("/api/results/domain/<int:kid>/delete", methods=["POST"])
def results_domain_delete(kid: int):
    conn = db()
    try:
        cur = conn.cursor()
        cur.execute("UPDATE plot_domain_knowledge SET is_deleted=TRUE WHERE id=%s", (kid,))
        conn.commit()
        n = cur.rowcount
        cur.close()
        return jsonify(deleted=n)
    finally:
        conn.close()


# ==================================================================
# 结果：剧情素材（4 张对称表，按 table 白名单切换）
# ==================================================================
@app.route("/api/results/material")
def results_material():
    tk = (request.args.get("table") or "encounter").strip()
    if tk not in MATERIAL_TABLES:
        return jsonify(error="未知素材表"), 400
    table = MATERIAL_TABLES[tk][0]
    q = (request.args.get("q") or "").strip()
    scene = (request.args.get("scene") or "").strip()
    where = "NOT is_deleted"
    params: list = []
    if q:
        where += " AND (title ILIKE %s OR core_plot ILIKE %s)"
        params += [f"%{q}%", f"%{q}%"]
    if scene:
        where += " AND applicable_scene_type=%s"
        params.append(scene)
    sql = f"""
        SELECT id, project_id, title, LEFT(core_plot,120), applicable_scene_type,
               tags, quality_score, source_work, to_char(created_at,'YYYY-MM-DD HH24:MI')
        FROM {table} WHERE {where}
        ORDER BY created_at DESC LIMIT 300
    """
    conn = db()
    try:
        cur = conn.cursor()
        cur.execute(sql, params)
        rows = [dict(id=r[0], project_id=r[1], title=r[2], preview=r[3],
                     scene_type=r[4], tags=r[5] or [], quality_score=r[6],
                     source_work=r[7], created_at=r[8]) for r in cur.fetchall()]
        cur.close()
        return jsonify(rows=rows)
    finally:
        conn.close()


@app.route("/api/results/material/<tk>/<int:mid>")
def results_material_detail(tk: str, mid: int):
    if tk not in MATERIAL_TABLES:
        return jsonify(error="未知素材表"), 400
    table = MATERIAL_TABLES[tk][0]
    conn = db()
    try:
        cur = conn.cursor()
        cur.execute(f"""
            SELECT title, core_plot, trigger_condition, reward, cost_or_risk,
                   emotional_beat, applicable_scene_type, tags, quality_score,
                   source_work, source_snippet, to_char(created_at,'YYYY-MM-DD HH24:MI')
            FROM {table} WHERE id=%s
        """, (mid,))
        r = cur.fetchone()
        cur.close()
        if not r:
            return jsonify(error="不存在"), 404
        keys = ["title", "core_plot", "trigger_condition", "reward", "cost_or_risk",
                "emotional_beat", "applicable_scene_type", "tags", "quality_score",
                "source_work", "source_snippet", "created_at"]
        return jsonify(data=dict(zip(keys, r)))
    finally:
        conn.close()


@app.route("/api/results/material/<tk>/<int:mid>/delete", methods=["POST"])
def results_material_delete(tk: str, mid: int):
    if tk not in MATERIAL_TABLES:
        return jsonify(error="未知素材表"), 400
    table = MATERIAL_TABLES[tk][0]
    conn = db()
    try:
        cur = conn.cursor()
        cur.execute(f"UPDATE {table} SET is_deleted=TRUE WHERE id=%s", (mid,))
        conn.commit()
        n = cur.rowcount
        cur.close()
        return jsonify(deleted=n)
    finally:
        conn.close()


# ==================================================================
# 结果：对标拆解（benchmark_book + benchmark_item）
# ==================================================================
@app.route("/api/results/benchmark/books")
def results_bench_books():
    q = (request.args.get("q") or "").strip()
    where = "NOT is_deleted"
    params: list = []
    if q:
        where += " AND (title ILIKE %s OR author ILIKE %s)"
        params += [f"%{q}%", f"%{q}%"]
    sql = f"""
        SELECT b.id, b.title, b.author, b.status, b.total_chapters, b.total_chars,
               (SELECT COUNT(*) FROM benchmark_item i
                WHERE i.book_id=b.id AND NOT i.is_deleted) AS n_items,
               to_char(b.updated_at,'YYYY-MM-DD HH24:MI')
        FROM benchmark_book b WHERE {where}
        ORDER BY b.updated_at DESC LIMIT 100
    """
    conn = db()
    try:
        cur = conn.cursor()
        cur.execute(sql, params)
        rows = [dict(id=r[0], title=r[1], author=r[2], status=r[3],
                     total_chapters=r[4], total_chars=r[5], n_items=r[6],
                     updated_at=r[7]) for r in cur.fetchall()]
        cur.close()
        return jsonify(rows=rows)
    finally:
        conn.close()


@app.route("/api/results/benchmark/items")
def results_bench_items():
    try:
        book_id = int(request.args.get("book") or 0)
    except ValueError:
        book_id = 0
    if not book_id:
        return jsonify(error="缺 book 参数"), 400
    itype = (request.args.get("type") or "").strip()
    q = (request.args.get("q") or "").strip()
    where = "NOT is_deleted AND book_id=%s"
    params: list = [book_id]
    if itype in ("skeleton", "plot", "variable", "arc"):
        where += " AND item_type=%s"
        params.append(itype)
    if q:
        where += " AND (title ILIKE %s OR content ILIKE %s)"
        params += [f"%{q}%", f"%{q}%"]
    sql = f"""
        SELECT id, item_type, chapter_idx, title, LEFT(content,100),
               tags, quality_score, to_char(created_at,'YYYY-MM-DD HH24:MI')
        FROM benchmark_item WHERE {where}
        ORDER BY chapter_idx NULLS FIRST, item_type, id LIMIT 500
    """
    conn = db()
    try:
        cur = conn.cursor()
        cur.execute(sql, params)
        rows = [dict(id=r[0], item_type=r[1], chapter_idx=r[2], title=r[3],
                     preview=r[4], tags=r[5] or [], quality_score=r[6],
                     created_at=r[7]) for r in cur.fetchall()]
        cur.close()
        return jsonify(rows=rows)
    finally:
        conn.close()


@app.route("/api/results/benchmark/items/<int:iid>")
def results_bench_item_detail(iid: int):
    conn = db()
    try:
        cur = conn.cursor()
        cur.execute("""
            SELECT i.item_type, i.chapter_idx, i.char_start, i.char_end, i.title, i.content,
                   i.setup_ratio, i.develop_ratio, i.turn_ratio, i.resolve_ratio,
                   i.emotion_curve, i.hook, i.tags, i.quality_score, i.source_snippet,
                   b.title, to_char(i.created_at,'YYYY-MM-DD HH24:MI')
            FROM benchmark_item i JOIN benchmark_book b ON b.id=i.book_id
            WHERE i.id=%s
        """, (iid,))
        r = cur.fetchone()
        cur.close()
        if not r:
            return jsonify(error="不存在"), 404
        keys = ["item_type", "chapter_idx", "char_start", "char_end", "title", "content",
                "setup_ratio", "develop_ratio", "turn_ratio", "resolve_ratio",
                "emotion_curve", "hook", "tags", "quality_score", "source_snippet",
                "book_title", "created_at"]
        data = dict(zip(keys, r))
        for k in ("setup_ratio", "develop_ratio", "turn_ratio", "resolve_ratio"):
            if data[k] is not None:
                data[k] = float(data[k])
        if data["emotion_curve"] is not None:
            data["emotion_curve"] = [float(x) for x in data["emotion_curve"]]
        return jsonify(data=data)
    finally:
        conn.close()


@app.route("/api/results/benchmark/items/<int:iid>/delete", methods=["POST"])
def results_bench_item_delete(iid: int):
    conn = db()
    try:
        cur = conn.cursor()
        cur.execute("UPDATE benchmark_item SET is_deleted=TRUE WHERE id=%s", (iid,))
        conn.commit()
        n = cur.rowcount
        cur.close()
        return jsonify(deleted=n)
    finally:
        conn.close()


@app.route("/api/results/benchmark/books/<int:bid>/delete", methods=["POST"])
def results_bench_book_delete(bid: int):
    conn = db()
    try:
        cur = conn.cursor()
        cur.execute("UPDATE benchmark_book SET is_deleted=TRUE, updated_at=NOW() WHERE id=%s", (bid,))
        conn.commit()
        n = cur.rowcount
        cur.close()
        return jsonify(deleted=n)
    finally:
        conn.close()


@app.route("/api/health")
def health():
    info = dict(python=PY, base=BASE_DIR, port=PORT)
    try:
        conn = db()
        conn.close()
        info["db"] = "ok"
    except Exception as e:  # noqa: BLE001
        info["db"] = f"fail: {e}"
    return jsonify(info)


if __name__ == "__main__":
    print(f"[GUI] 文风/领域知识蒸馏控制台 → http://127.0.0.1:{PORT}")
    print(f"[GUI] 解释器: {PY}")
    app.run(host="127.0.0.1", port=PORT, threaded=True, debug=False)
