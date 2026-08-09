"""
extract_materials.py — 网文剧情素材库 ETL 主脚本（独立工具，不耦合 Node 服务）

全流程：
    本地 TXT → 清洗（去广告/作者话/空行乱码/重复段落）
            → 滑动窗口切块（2000 字，overlap 200）
            → LLM 单次合并抽取 4 类素材（奇遇/伏笔/高光/任务链）
            → core_plot 向量化（512 维 bge，与诛仙库同源）
            → 去重（批内 numpy + 库内 pgvector，cos>0.92 保留高分）
            → 入库（创作库 4 张 plot_material_* 表）

用法：
    python extract_materials.py <TXT文件或目录> [--source-work 作品名] [--dry-run]

约束遵循：原生 Python + 轻量库；错误处理 + 失败重试 + 格式校验；
        异常数据跳过不中断；source_snippet 仅入库、不注入写作上下文。
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
import logging
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Dict, List, Optional

import numpy as np
import requests

import bge_embedder
import env_loader  # noqa: F401  # 从根目录加载 .env 并做 PG_* 兼容映射

# ------------------------------------------------------------------
# 配置加载
# ------------------------------------------------------------------

PG = dict(
    host=os.getenv("PG_HOST", "localhost"),
    port=int(os.getenv("PG_PORT", "5432")),
    dbname=os.getenv("PG_NAME", "novel_studio"),
    user=os.getenv("PG_USER", "noveluser"),
    password=os.getenv("PG_PASSWORD", ""),
)

LLM_BASE_URL = os.getenv("LLM_BASE_URL", "https://api.deepseek.com").rstrip("/")
LLM_API_KEY = os.getenv("LLM_API_KEY", "")
LLM_MODEL = os.getenv("LLM_MODEL", "deepseek-chat")
LLM_TEMPERATURE = float(os.getenv("LLM_TEMPERATURE", "0.3"))
# 超时拆成 (连接, 读取) 两段：连接快速失败，读取给足生成时间。
# 过大的单一超时会让被限流/挂起的请求长时间静默，看起来像卡死。
LLM_CONNECT_TIMEOUT = float(os.getenv("LLM_CONNECT_TIMEOUT", "10"))
LLM_READ_TIMEOUT = float(os.getenv("LLM_READ_TIMEOUT", "90"))
# JSON 模式：让兼容 OpenAI 的接口强制返回合法 JSON，大幅减少“JSON 解析失败”丢块。
# 个别模型不支持时可设 0 关闭。
LLM_JSON_MODE = os.getenv("LLM_JSON_MODE", "1").strip() not in ("", "0", "false", "False")
# 思考模式：deepseek-v4-flash 默认 enabled，会先生成思维链（按输出 token 2元/M 计费）。
# 本任务是结构化抽取，非思考模式已足够：关掉可省 ~40-50% 成本、大幅提速，且低温生效。
# 需更高推理质量时设 LLM_THINKING=enabled。
LLM_THINKING = os.getenv("LLM_THINKING", "disabled").strip().lower()

CHUNK_SIZE = int(os.getenv("CHUNK_SIZE", "2000"))
CHUNK_OVERLAP = int(os.getenv("CHUNK_OVERLAP", "200"))
# 章节预筛（本地零成本）：跳过明显无料的块（纯对话/低事件密度），不发 LLM，输入+输出双省。
# 默认关（=0）；验证无误杀后设 ENABLE_CHUNK_PREFILTER=1 开启。两个条件同时满足才跳过，极保守。
ENABLE_CHUNK_PREFILTER = os.getenv("ENABLE_CHUNK_PREFILTER", "0").strip() not in ("", "0", "false", "False")
PREFILTER_MIN_EVENTS = int(os.getenv("PREFILTER_MIN_EVENTS", "3"))          # 事件词 ≤ 此值
PREFILTER_MAX_DIALOGUE = float(os.getenv("PREFILTER_MAX_DIALOGUE", "0.5"))  # 且对话占比 ≥ 此值 → 判为无料
LLM_CONCURRENCY = int(os.getenv("LLM_CONCURRENCY", "10"))
LLM_MAX_RETRIES = int(os.getenv("LLM_MAX_RETRIES", "3"))
MAX_MATERIALS_PER_CHUNK = int(os.getenv("MAX_MATERIALS_PER_CHUNK", "3"))
MIN_QUALITY_TO_STORE = int(os.getenv("MIN_QUALITY_TO_STORE", "6"))
DEDUP_THRESHOLD = float(os.getenv("DEDUP_THRESHOLD", "0.86"))
MAX_CHUNKS = int(os.getenv("MAX_CHUNKS", "0"))  # >0 时只处理前 N 块（验证用，避免整本烧 token）

# --- 向量预筛分桶（第二阶降本）---
ENABLE_VECTOR_BUCKET = os.getenv("ENABLE_VECTOR_BUCKET", "0").strip() not in ("", "0", "false", "False")
BUCKET_REF_TOP_N = int(os.getenv("BUCKET_REF_TOP_N", "20"))         # 每类取库内 top-N 高分素材做基准向量
BUCKET_MIN_SCORE = float(os.getenv("BUCKET_MIN_SCORE", "0.25"))     # 块与所有类基准的最高分 < 此值 → 过滤
BUCKET_TOP_PERCENT = float(os.getenv("BUCKET_TOP_PERCENT", "0.5"))  # 保留相似度 top-N% 的块；0=不做百分位过滤
BUCKET_SECONDARY_GAP = float(os.getenv("BUCKET_SECONDARY_GAP", "0.05"))  # 次高类与最高类差距 < 此值 → 也分配

# --- 前置库内去重 ---
ENABLE_PRE_DEDUP = os.getenv("ENABLE_PRE_DEDUP", "0").strip() not in ("", "0", "false", "False")
PRE_DEDUP_THRESHOLD = float(os.getenv("PRE_DEDUP_THRESHOLD", "0.80"))  # 块向量与库内已有 > 此值 → 跳过

_tp = os.getenv("TARGET_PROJECT_ID", "").strip()
TARGET_PROJECT_ID: Optional[int] = int(_tp) if _tp else None  # None = 全局共享

# 4 类素材 → 目标表映射
TYPE_TABLE = {
    "encounter": "plot_material_encounter",
    "foreshadow": "plot_material_foreshadow",
    "highlight": "plot_material_highlight",
    "task": "plot_material_task",
}
VALID_SCENE_TYPES = {"key", "transition", "foreshadow"}

# 日志：控制台 + 失败文件
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("etl")
_fail_handler = logging.FileHandler("etl_failures.log", encoding="utf-8")
_fail_handler.setLevel(logging.WARNING)
_fail_handler.setFormatter(logging.Formatter("%(asctime)s %(message)s"))
logger.addHandler(_fail_handler)


# ==================================================================
# 1) 清洗
# ==================================================================
# 广告 / 作者话 / 站点信息 的常见特征行（整行匹配即删）
_AD_LINE_PATTERNS = [
    re.compile(p) for p in [
        r"^\s*(ps|PS|Ps)[：:、].*",                       # 作者 PS
        r"^\s*(作者|作者君|笔者)[：:].*",                  # 作者说
        r".*(求月票|求推荐|求订阅|求收藏|求打赏|月票|推荐票).*",
        r".*(本章说|感谢.*打赏|感谢.*月票|加更).*",
        r".*(https?://|www\.|\.com|\.net|\.org).*",        # 网址
        r".*(最新章节|手机阅读|请记住本站|txt下载|全文阅读|无弹窗|笔趣|飘天|起点中文).*",
        r"^\s*[-—=*·]{3,}\s*$",                            # 分隔线
        r"^\s*第[0-9一二三四五六七八九十百千]+[章节卷].{0,30}$",  # 章节标题行（单独成行）
    ]
]
# 乱码/无意义字符行：非中文非常见标点占比过高
_CJK = re.compile(r"[\u4e00-\u9fff]")


def clean_text(raw: str) -> str:
    """按行清洗：去广告/作者话/网址/分隔线/乱码，压缩多余空行，去连续重复段落。"""
    lines = raw.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    kept: List[str] = []
    seen_recent: List[str] = []  # 最近若干行，用于去相邻重复
    for line in lines:
        s = line.strip()
        if not s:
            continue
        if any(p.match(s) for p in _AD_LINE_PATTERNS):
            continue
        # 乱码行：长度>10 且中文占比<20%
        if len(s) > 10:
            cjk = len(_CJK.findall(s))
            if cjk / len(s) < 0.2:
                continue
        # 去相邻重复段落（网文常见复制粘贴重复）
        if s in seen_recent:
            continue
        seen_recent.append(s)
        if len(seen_recent) > 5:
            seen_recent.pop(0)
        kept.append(s)
    return "\n".join(kept)


# ==================================================================
# 2) 切块（按字符滑动窗口）
# ==================================================================
def chunk_text(text: str, size: int = CHUNK_SIZE, overlap: int = CHUNK_OVERLAP) -> List[str]:
    """
    以字符为单位滑动切块。step = size - overlap。
    过滤掉过短（<size/4）的尾块，避免噪声抽取。
    """
    text = text.strip()
    if not text:
        return []
    step = max(1, size - overlap)
    chunks: List[str] = []
    i = 0
    n = len(text)
    while i < n:
        chunk = text[i:i + size]
        if len(chunk) >= size // 4:  # 太短的碎块不送抽取
            chunks.append(chunk)
        if i + size >= n:
            break
        i += step
    return chunks


# 剧情事件/转折信号词：出现越多，越可能含可抽取的剧情模式
EVENT_KEYWORDS = (
    "得到", "获得", "发现", "突然", "竟然", "原来", "决定", "挑战", "危机", "秘密",
    "传承", "突破", "晋级", "晋升", "背叛", "牺牲", "任务", "奖励", "触发", "领悟",
    "顿悟", "反转", "暴露", "揭晓", "威胁", "代价", "机缘", "伏笔", "考验", "选择",
    "隐藏", "逆袭", "阴谋", "真相", "身份", "预言", "交易", "联手", "对决", "击败",
    "失败", "成功", "拼命", "赌注", "困境", "升级", "担心", "拯救",
)
_QUOTED_RE = re.compile(r'[“"「『‘]([^”"」』’]*)[”"」』’]')


def should_skip_chunk(chunk: str) -> bool:
    """保守启发式：仅当块【事件词极少】且【对话占比极高】时判为无料，跳过不发 LLM。"""
    if not chunk:
        return True
    n = len(chunk)
    if n < 150:  # 过短残块，抽不出完整模式
        return True
    events = sum(chunk.count(k) for k in EVENT_KEYWORDS)
    inside = sum(len(m.group(1)) for m in _QUOTED_RE.finditer(chunk))
    dialogue_ratio = inside / n
    # 两个条件同时成立才跳过 → 极保守，避免误杀含剧情的对话块
    return events <= PREFILTER_MIN_EVENTS and dialogue_ratio >= PREFILTER_MAX_DIALOGUE


# ==================================================================
# 3) 抽取 Prompt（单次合并抽取 4 类）
# ==================================================================
SYSTEM_PROMPT = "你是资深网文剧情分析师，擅长把小说片段提炼为可跨世界观复用的抽象剧情模式。只输出 JSON，不要任何多余解释。"

EXTRACTION_PROMPT = """从下方网文片段抽取4类剧情素材（每类0-{max_n}条，宁缺毋滥）。

类别: encounter(奇遇:偶然/意外触发重大收益转折,侧重reward/cost) | foreshadow(伏笔:埋线→呼应→回收手法) | highlight(高光:角色魅力爆发名场面,侧重emotional_beat) | task(任务链:多阶段目标驱动,侧重阶段结构)

字段: title(≤30字,抽象禁专名) · core_plot(≤150字,触发→经过→结果,抽象化禁专名,不得夹带他字段) · trigger_condition(≤100字) · reward(≤80字|null) · cost_or_risk(≤80字|null) · emotional_beat(≤50字,如「绝望→震惊→狂喜」) · applicable_scene_type(key|transition|foreshadow) · tags(2-5数组) · quality_score(1-10) · source_snippet(≤80字原句|null)

规则: core_plot必须抽象化可跨世界观复用,禁原文专名; 超长精炼不截断; 输出严格JSON(4键都要,值为数组可空):
{{"encounter":[{{...}}],"foreshadow":[{{...}}],"highlight":[{{...}}],"task":[{{...}}]}}

【待分析片段】
{chunk}
"""


def build_messages(chunk: str) -> List[dict]:
    return [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": EXTRACTION_PROMPT.format(chunk=chunk, max_n=MAX_MATERIALS_PER_CHUNK)},
    ]


# --- 单类 Prompt 模板（分桶后用，每类一个精简版，省 ~75% 输入 token）---
_FIELD_SCHEMA = """fields: title(≤30字,抽象化禁专名), core_plot(≤150字,触发→经过→结果,抽象化), trigger_condition(≤100字), reward(≤80字|null), cost_or_risk(≤80字|null), emotional_beat(≤50字), applicable_scene_type(key|transition|foreshadow), tags(2-5个), quality_score(1-10), source_snippet(≤80字原文|null)。
要求：抽象化禁专名；core_plot不夹带其它字段；宁缺毻滥；严格控字数。输出 JSON: {{"items":[...]}}"""

CATEGORY_PROMPTS = {
    "encounter": f"""从下面的网文片段中抽取「奇遇」类剧情素材（0-{{max_n}}条）。
定义：主角因偶然/被迫/意外触发的非常规事件，导致重大收益或转折。侧重 reward与cost_or_risk。
{_FIELD_SCHEMA}

【待分析片段】
{{chunk}}""",
    "foreshadow": f"""从下面的网文片段中抽取「伏笔手法」类剧情素材（0-{{max_n}}条）。
定义：如何埋线、如何呼应、如何回收的可复用手法。core_plot侧重「埋设方式→呼应节点→回收效果」。
{_FIELD_SCHEMA}

【待分析片段】
{{chunk}}""",
    "highlight": f"""从下面的网文片段中抽取「人物高光」类剧情素材（0-{{max_n}}条）。
定义：角色魅力集中爆发的名场面（逆袭/救场/立威/牺牲等）。emotional_beat侧重情绪爆点曲线。
{_FIELD_SCHEMA}

【待分析片段】
{{chunk}}""",
    "task": f"""从下面的网文片段中抽取「剧情任务链」类剧情素材（0-{{max_n}}条）。
定义：多阶段推进的目标驱动型结构（任务发布→阻碇→推进→完成/反转）。core_plot侧重阶段结构。
{_FIELD_SCHEMA}

【待分析片段】
{{chunk}}""",
}

# 双类合并 Prompt 模板（top-2 分桶时一次调用抽 2 类，比 2 次单类省一半网络开销）
_DUAL_CAT_DEFS = {
    "encounter": "奇遇：主角因偶然/被迫/意外触发非常规事件，重大收益或转折",
    "foreshadow": "伏笔手法：埋线→呼应→回收的可复用手法",
    "highlight": "人物高光：角色魅力爆发名场面（逆袭/救场/立威/牺牲）",
    "task": "剧情任务链：多阶段目标驱动结构（发布→阻碇→推进→完成/反转）",
}

DUAL_CATEGORY_PROMPT = f"""\u4ece下面的网文片段中抽取以下 2 类剧情素材（每类 0-{{max_n}}条）：
1. {{cat1_name}}：{{cat1_def}}
2. {{cat2_name}}：{{cat2_def}}
{_FIELD_SCHEMA}
输出 JSON: {{"{{cat1_name}}": [...], "{{cat2_name}}": [...]}}

【待分析片段】
{{chunk}}"""


def build_messages_bucketed(chunk: str, categories: List[str]) -> List[dict]:
    """构建分桶后的 LLM 消息：单类或双类精简 Prompt。"""
    if len(categories) == 1:
        cat = categories[0]
        user_content = CATEGORY_PROMPTS[cat].format(chunk=chunk, max_n=MAX_MATERIALS_PER_CHUNK)
    else:
        c1, c2 = categories[0], categories[1]
        user_content = DUAL_CATEGORY_PROMPT.format(
            chunk=chunk, max_n=MAX_MATERIALS_PER_CHUNK,
            cat1_name=c1, cat1_def=_DUAL_CAT_DEFS[c1],
            cat2_name=c2, cat2_def=_DUAL_CAT_DEFS[c2],
        )
    return [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": user_content},
    ]


# ==================================================================
# 4) LLM 调用（requests + 重试）
# ==================================================================
def call_llm(messages: List[dict]) -> str:
    """调用 OpenAI-compatible chat 接口，带指数退避重试。返回原始文本。"""
    url = f"{LLM_BASE_URL}/chat/completions"
    headers = {"Authorization": f"Bearer {LLM_API_KEY}", "Content-Type": "application/json"}
    payload = {
        "model": LLM_MODEL,
        "messages": messages,
        "temperature": LLM_TEMPERATURE,
        "max_tokens": 4096,
        "stream": False,
    }
    # 强制 JSON 输出，减少 LLM 返回多余文本导致的解析失败
    if LLM_JSON_MODE:
        payload["response_format"] = {"type": "json_object"}
    # 思考模式开关：disabled 时不生成思维链，省输出 token 并提速（DeepSeek 默认 enabled）
    if LLM_THINKING in ("enabled", "disabled"):
        payload["thinking"] = {"type": LLM_THINKING}
    last_err = None
    for attempt in range(1, LLM_MAX_RETRIES + 1):
        try:
            resp = requests.post(
                url, headers=headers, json=payload,
                timeout=(LLM_CONNECT_TIMEOUT, LLM_READ_TIMEOUT),
            )
            if resp.status_code == 200:
                return resp.json()["choices"][0]["message"]["content"]
            # 429/5xx 可重试
            if resp.status_code in (429, 500, 502, 503, 504):
                last_err = f"HTTP {resp.status_code}: {resp.text[:200]}"
            else:
                # 4xx（认证/参数）不重试，直接抛
                raise RuntimeError(f"LLM 请求失败 HTTP {resp.status_code}: {resp.text[:200]}")
        except (requests.RequestException, KeyError) as e:
            last_err = str(e)
        # 指数退避 2s/4s/8s；打印出来，避免长时间静默看起来像卡死
        if attempt < LLM_MAX_RETRIES:
            wait = 2 ** attempt
            logger.warning(f"LLM 第 {attempt} 次失败（{last_err}），{wait}s 后重试…")
            time.sleep(wait)
    raise RuntimeError(f"LLM 调用重试 {LLM_MAX_RETRIES} 次仍失败: {last_err}")


# ==================================================================
# 5) JSON 解析与字段校验
# ==================================================================
def parse_json(text: str) -> Optional[dict]:
    """从 LLM 返回中提取 JSON 对象，容忍 ```json 代码围栏与前后噪声。"""
    if not text:
        return None
    t = text.strip()
    # 去代码围栏
    t = re.sub(r"^```(json)?", "", t).strip()
    t = re.sub(r"```$", "", t).strip()
    # 截取首个 { 到末个 }
    start, end = t.find("{"), t.rfind("}")
    if start == -1 or end == -1 or end <= start:
        return None
    try:
        return json.loads(t[start:end + 1])
    except json.JSONDecodeError:
        return None


def _clip(v, n: int) -> Optional[str]:
    """裁剪字符串到 n 字符；空/None 归一化为 None。"""
    if v is None:
        return None
    s = str(v).strip()
    if not s or s.lower() in ("null", "none", "无", "n/a"):
        return None
    return s[:n]


# core_plot 偶尔会被 LLM 尾部夹带其它字段（如“情绪：…适用场景：transition”）。
# 仅当出现“适用场景”这个明确泄漏信号时才裁剪，避免误伤正文。
_LEAK_HEAD = re.compile(
    r"(触发条件|触发前提|奖励|回报|代价或风险|代价|风险|情绪曲线|情绪|适用场景类型|适用场景|场景类型|标签|质量分?)\s*[:：]"
)


def _strip_leaked_fields(core_plot: str) -> str:
    """剥离 core_plot 尾部混入的其它字段（以“适用场景：”出现为触发信号）。"""
    if "适用场景" not in core_plot:
        return core_plot
    m = _LEAK_HEAD.search(core_plot)
    if not m:
        return core_plot
    stripped = core_plot[: m.start()].rstrip("　 \n。;；、,，")
    # 裁剪后正文不能过短，否则视为误判，保留原文
    return stripped if len(stripped) >= 20 else core_plot


def validate_material(raw: dict, source_work: str) -> Optional[dict]:
    """校验并规范化单条素材。不合格返回 None（跳过）。"""
    if not isinstance(raw, dict):
        return None
    title = _clip(raw.get("title"), 200)
    core_plot = _clip(raw.get("core_plot"), 4000)
    if core_plot:
        core_plot = _strip_leaked_fields(core_plot)  # 剥离混入正文的其它字段残留
    if not title or not core_plot or len(core_plot) < 20:
        return None  # 缺核心字段直接丢
    try:
        quality = int(raw.get("quality_score", 0))
    except (ValueError, TypeError):
        quality = 0
    quality = max(0, min(10, quality))
    if quality < MIN_QUALITY_TO_STORE:
        return None  # 低质量直接丢弃

    scene_type = _clip(raw.get("applicable_scene_type"), 50)
    if scene_type not in VALID_SCENE_TYPES:
        scene_type = None

    tags = raw.get("tags") or []
    if isinstance(tags, str):
        tags = [tags]
    tags = [str(x).strip()[:50] for x in tags if str(x).strip()][:8]

    return {
        "title": title,
        "core_plot": core_plot,
        "trigger_condition": _clip(raw.get("trigger_condition"), 2000),
        "reward": _clip(raw.get("reward"), 2000),
        "cost_or_risk": _clip(raw.get("cost_or_risk"), 2000),
        "emotional_beat": _clip(raw.get("emotional_beat"), 1000),
        "applicable_scene_type": scene_type,
        "tags": tags,
        "quality_score": quality,
        "source_work": source_work[:100] if source_work else None,
        "source_snippet": _clip(raw.get("source_snippet"), 80),
    }


# ==================================================================
# 6) 单切块抽取（供线程池调用）
# ==================================================================
def extract_from_chunk(chunk: str, source_work: str, idx: int) -> List[dict]:
    """抽取单个切块，返回带 material_type 标注的素材列表。异常不外抛，记录日志后返回空。"""
    try:
        text = call_llm(build_messages(chunk))
        data = parse_json(text)
        if not data:
            logger.warning(f"[chunk#{idx}] JSON 解析失败，跳过")
            return []
        out: List[dict] = []
        for mtype in TYPE_TABLE:
            items = data.get(mtype) or []
            if not isinstance(items, list):
                continue
            for raw in items[:MAX_MATERIALS_PER_CHUNK]:
                m = validate_material(raw, source_work)
                if m:
                    m["material_type"] = mtype
                    out.append(m)
        return out
    except Exception as e:  # noqa: BLE001 单块失败不影响整体
        logger.warning(f"[chunk#{idx}] 抽取失败，跳过: {e}")
        return []


def extract_from_chunk_bucketed(chunk: str, categories: List[str], source_work: str, idx: int) -> List[dict]:
    """分桶定向抽取：仅抽取指定类别（单类或双类合并一次 LLM 调用）。"""
    try:
        text = call_llm(build_messages_bucketed(chunk, categories))
        data = parse_json(text)
        if not data:
            logger.warning(f"[bucket-chunk#{idx}] JSON 解析失败，跳过")
            return []
        out: List[dict] = []
        if len(categories) == 1:
            # 单类输出格式: {"items": [...]}
            items = data.get("items") or data.get(categories[0]) or []
            if not isinstance(items, list):
                items = []
            for raw in items[:MAX_MATERIALS_PER_CHUNK]:
                m = validate_material(raw, source_work)
                if m:
                    m["material_type"] = categories[0]
                    out.append(m)
        else:
            # 双类输出格式: {"cat1": [...], "cat2": [...]}
            for cat in categories:
                items = data.get(cat) or []
                if not isinstance(items, list):
                    continue
                for raw in items[:MAX_MATERIALS_PER_CHUNK]:
                    m = validate_material(raw, source_work)
                    if m:
                        m["material_type"] = cat
                        out.append(m)
        return out
    except Exception as e:  # noqa: BLE001
        logger.warning(f"[bucket-chunk#{idx}] 抽取失败，跳过: {e}")
        return []


# ==================================================================
# 7) 向量化 + 批内去重
# ==================================================================
def vectorize(materials: List[dict]) -> None:
    """为每条素材的 core_plot 生成向量，写入 m['embedding']（list[float]）。"""
    if not materials:
        return
    vecs = bge_embedder.embed_texts([m["core_plot"] for m in materials])
    for m, v in zip(materials, vecs):
        m["embedding"] = v


def dedup_in_batch(materials: List[dict]) -> List[dict]:
    """
    批内去重（同类内比较）：余弦相似度 > 阈值视为重复簇，簇内只保留 quality_score 最高者。
    向量已归一化，余弦相似度 = 点积。
    """
    survivors: List[dict] = []
    for mtype in TYPE_TABLE:
        group = [m for m in materials if m["material_type"] == mtype]
        if not group:
            continue
        mat = np.array([m["embedding"] for m in group], dtype=np.float32)
        sims = mat @ mat.T  # 归一化向量点积 = 余弦相似度
        removed = set()
        # 按质量分降序遍历，保留高分，压制其相似的低分
        order = sorted(range(len(group)), key=lambda i: group[i]["quality_score"], reverse=True)
        for a in order:
            if a in removed:
                continue
            survivors.append(group[a])
            for b in range(len(group)):
                if b != a and b not in removed and sims[a][b] > DEDUP_THRESHOLD:
                    removed.add(b)
    return survivors


# ==================================================================
# 7b) 向量预筛分桶 + 前置库内去重（第二阶降本，开关控制）
# ==================================================================
def load_reference_vectors() -> Dict[str, np.ndarray]:
    """从库内各类素材表取 quality_score 最高的 top-N 条的 embedding 做基准向量集。"""
    import psycopg2
    from pgvector.psycopg2 import register_vector
    conn = psycopg2.connect(**PG)
    register_vector(conn)
    refs: Dict[str, np.ndarray] = {}
    try:
        cur = conn.cursor()
        for mtype, table in TYPE_TABLE.items():
            cur.execute(
                f"SELECT embedding FROM {table} "
                f"WHERE NOT is_deleted AND embedding IS NOT NULL "
                f"ORDER BY quality_score DESC LIMIT %s",
                (BUCKET_REF_TOP_N,),
            )
            rows = cur.fetchall()
            if rows:
                refs[mtype] = np.array([r[0] for r in rows], dtype=np.float32)
            else:
                refs[mtype] = np.empty((0, 512), dtype=np.float32)
        cur.close()
    finally:
        conn.close()
    return refs


def bucket_chunks(chunks: List[str], ref_vectors: Dict[str, np.ndarray]) -> List[dict]:
    """
    对所有块做本地 bge 向量化 → 与各类基准向量算余弦 → 分配 top-2 类别。
    返回 [{"chunk": str, "vec": list, "categories": [str,...], "max_score": float}, ...]
    """
    logger.info(f"向量分桶：正在向量化 {len(chunks)} 块（本地 bge，零 API 成本）…")
    chunk_vecs = np.array(bge_embedder.embed_texts(chunks), dtype=np.float32)

    # 计算每块对每类的代表得分（与该类基准向量的最大余弦相似度）
    cat_names = [k for k in TYPE_TABLE if ref_vectors[k].shape[0] > 0]
    if not cat_names:
        return [{"chunk": c, "vec": v.tolist(), "categories": list(TYPE_TABLE.keys()), "max_score": 0.0}
                for c, v in zip(chunks, chunk_vecs)]

    # scores_matrix: (N_chunks, N_cats)
    scores_matrix = np.zeros((len(chunks), len(cat_names)), dtype=np.float32)
    for ci, cat in enumerate(cat_names):
        # chunk_vecs @ ref_vecs.T → (N_chunks, ref_count)，每行取 max
        sim = chunk_vecs @ ref_vectors[cat].T  # (N, top_n)
        scores_matrix[:, ci] = sim.max(axis=1)

    # 分配类别
    bucketed: List[dict] = []
    for i in range(len(chunks)):
        scores = scores_matrix[i]
        order = np.argsort(-scores)  # 降序
        top1_idx = order[0]
        top1_score = float(scores[top1_idx])

        # 过滤：最高分低于阈值
        if top1_score < BUCKET_MIN_SCORE:
            continue

        cats = [cat_names[top1_idx]]
        # 次高类差距小于 gap 也纳入
        if len(order) > 1:
            top2_idx = order[1]
            if top1_score - float(scores[top2_idx]) < BUCKET_SECONDARY_GAP:
                cats.append(cat_names[top2_idx])

        bucketed.append({"chunk": chunks[i], "vec": chunk_vecs[i].tolist(), "categories": cats, "max_score": top1_score})

    # 百分位过滤
    if BUCKET_TOP_PERCENT > 0 and bucketed:
        bucketed.sort(key=lambda x: x["max_score"], reverse=True)
        keep = max(1, int(len(bucketed) * BUCKET_TOP_PERCENT))
        bucketed = bucketed[:keep]

    return bucketed


def pre_dedup_chunks(bucketed: List[dict]) -> List[dict]:
    """
    前置库内去重：用块向量去 DB 查是否已有高度相似素材。
    命中则从该块的 categories 中移除对应类；categories 空则整块跳过。
    """
    import psycopg2
    from pgvector.psycopg2 import register_vector
    conn = psycopg2.connect(**PG)
    register_vector(conn)
    conn.set_session(readonly=True, autocommit=True)

    # project_id 作用域
    if TARGET_PROJECT_ID is None:
        scope = "project_id IS NULL"
        scope_params: tuple = ()
    else:
        scope = "(project_id = %s OR project_id IS NULL)"
        scope_params = (TARGET_PROJECT_ID,)

    result: List[dict] = []
    try:
        cur = conn.cursor()
        for b in bucketed:
            vec = np.array(b["vec"], dtype=np.float32)
            kept_cats: List[str] = []
            for cat in b["categories"]:
                table = TYPE_TABLE[cat]
                cur.execute(
                    f"SELECT 1 FROM {table} "
                    f"WHERE NOT is_deleted AND embedding IS NOT NULL AND {scope} "
                    f"AND 1 - (embedding <=> %s) > %s LIMIT 1",
                    (*scope_params, vec, PRE_DEDUP_THRESHOLD),
                )
                if not cur.fetchone():
                    kept_cats.append(cat)  # 未命中，保留
            if kept_cats:
                b["categories"] = kept_cats
                result.append(b)
        cur.close()
    finally:
        conn.close()
    return result


# ==================================================================
# 8) 数据库：库内去重 + 入库
# ==================================================================
def get_conn():
    import psycopg2
    from pgvector.psycopg2 import register_vector
    conn = psycopg2.connect(**PG)
    register_vector(conn)  # 使 list/np.array 可直接作为 vector 参数
    return conn


def upsert_material(cur, m: dict) -> str:
    """
    单条入库，先做库内去重：查同表同 project 范围内最相似条目。
    返回 'insert' / 'update' / 'skip'。
    """
    table = TYPE_TABLE[m["material_type"]]
    emb = np.array(m["embedding"], dtype=np.float32)

    # project_id 作用域：NULL 与具体 id 分别比较
    if TARGET_PROJECT_ID is None:
        scope = "project_id IS NULL"
        scope_params: tuple = ()
    else:
        scope = "project_id = %s"
        scope_params = (TARGET_PROJECT_ID,)

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
        existing_id, existing_q = row[0], row[1]
        if existing_q >= m["quality_score"]:
            return "skip"  # 库内已有更优，跳过
        # 新素材质量更高 → 覆盖更新既有条目（保留 id 稳定）
        cur.execute(
            f"""
            UPDATE {table} SET
              title=%s, core_plot=%s, trigger_condition=%s, reward=%s, cost_or_risk=%s,
              emotional_beat=%s, applicable_scene_type=%s, tags=%s, quality_score=%s,
              source_work=%s, source_snippet=%s, embedding=%s
            WHERE id=%s
            """,
            (
                m["title"], m["core_plot"], m["trigger_condition"], m["reward"], m["cost_or_risk"],
                m["emotional_beat"], m["applicable_scene_type"], m["tags"], m["quality_score"],
                m["source_work"], m["source_snippet"], emb, existing_id,
            ),
        )
        return "update"

    # 新增
    cur.execute(
        f"""
        INSERT INTO {table}
          (project_id, title, core_plot, trigger_condition, reward, cost_or_risk,
           emotional_beat, applicable_scene_type, tags, quality_score,
           source_work, source_snippet, embedding)
        VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
        """,
        (
            TARGET_PROJECT_ID, m["title"], m["core_plot"], m["trigger_condition"], m["reward"],
            m["cost_or_risk"], m["emotional_beat"], m["applicable_scene_type"], m["tags"],
            m["quality_score"], m["source_work"], m["source_snippet"], emb,
        ),
    )
    return "insert"


def persist(materials: List[dict]) -> Dict[str, int]:
    """逐条入库（含库内去重）。返回统计。"""
    stats = {"insert": 0, "update": 0, "skip": 0}
    if not materials:
        return stats
    conn = get_conn()
    try:
        cur = conn.cursor()
        for m in materials:
            try:
                result = upsert_material(cur, m)
                stats[result] += 1
                conn.commit()  # 逐条提交，单条失败不拖垮整批
            except Exception as e:  # noqa: BLE001
                conn.rollback()
                logger.warning(f"入库失败，跳过《{m.get('title')}》: {e}")
        cur.close()
    finally:
        conn.close()
    return stats


# ==================================================================
# 9) 主流程
# ==================================================================
def collect_txt_files(path: str) -> List[str]:
    if os.path.isfile(path) and path.lower().endswith(".txt"):
        return [path]
    if os.path.isdir(path):
        files = []
        for root, _, names in os.walk(path):
            for n in names:
                if n.lower().endswith(".txt"):
                    files.append(os.path.join(root, n))
        return sorted(files)
    return []


def read_txt(path: str) -> str:
    """尝试多编码读取 TXT（网文常见 utf-8 / gbk）。"""
    for enc in ("utf-8", "gb18030", "gbk"):
        try:
            with open(path, "r", encoding=enc) as f:
                return f.read()
        except (UnicodeDecodeError, LookupError):
            continue
    with open(path, "r", encoding="utf-8", errors="ignore") as f:
        return f.read()


def process_file(path: str, source_work: Optional[str], dry_run: bool,
                 max_chunks: int = 0, dump_path: Optional[str] = None) -> None:
    fname = os.path.basename(path)
    work = source_work or os.path.splitext(fname)[0]
    logger.info(f"===== 处理《{work}》 [{fname}] =====")

    raw = read_txt(path)
    cleaned = clean_text(raw)
    chunks = chunk_text(cleaned)
    total = len(chunks)
    # 章节预筛（开关控制）：本地零成本跳过明显无料的块，不发 LLM
    if ENABLE_CHUNK_PREFILTER and chunks:
        kept = [c for c in chunks if not should_skip_chunk(c)]
        skipped = total - len(kept)
        pct = (skipped * 100 // total) if total else 0
        logger.info(f"章节预筛：{total} 块 → 保留 {len(kept)} 块（跳过 {skipped} 块无料，约省 {pct}% 调用）")
        chunks = kept
        total = len(chunks)
    if max_chunks and max_chunks > 0 and total > max_chunks:
        chunks = chunks[:max_chunks]
        logger.info(f"清洗后 {len(cleaned)} 字，（预筛后）{total} 块，【验证模式】只取前 {len(chunks)} 块，"
                    f"开始抽取（并发 {LLM_CONCURRENCY}）…")
    else:
        logger.info(f"清洗后 {len(cleaned)} 字，切成 {len(chunks)} 块，开始抽取（并发 {LLM_CONCURRENCY}）…")
    if not chunks:
        logger.warning("无有效切块，跳过")
        return

    # 并发抽取（分桶定向 or 全类）
    all_materials: List[dict] = []
    if ENABLE_VECTOR_BUCKET:
        ref_vectors = load_reference_vectors()
        if any(v.size > 0 for v in ref_vectors.values()):
            bucketed = bucket_chunks(chunks, ref_vectors)
            logger.info(f"向量分桶：{len(chunks)} 块 → 保留 {len(bucketed)} 块（过滤 {len(chunks)-len(bucketed)} 低相关块）")

            # 前置库内去重
            if ENABLE_PRE_DEDUP and bucketed:
                before = len(bucketed)
                bucketed = pre_dedup_chunks(bucketed)
                logger.info(f"前置去重：跳过 {before - len(bucketed)} 块（库内已有相似素材）")

            if bucketed:
                done = 0
                with ThreadPoolExecutor(max_workers=LLM_CONCURRENCY) as pool:
                    futures = {pool.submit(extract_from_chunk_bucketed, b["chunk"], b["categories"], work, i): i
                               for i, b in enumerate(bucketed)}
                    for fut in as_completed(futures):
                        all_materials.extend(fut.result())
                        done += 1
                        if done % 10 == 0 or done == len(bucketed):
                            logger.info(f"进度 {done}/{len(bucketed)} 块，累计 {len(all_materials)} 条")
            else:
                logger.info("分桶+去重后无剩余块，跳过 LLM 抽取")
        else:
            logger.info("向量分桶：基准表无数据，降级为全类抽取")
            done = 0
            with ThreadPoolExecutor(max_workers=LLM_CONCURRENCY) as pool:
                futures = {pool.submit(extract_from_chunk, c, work, i): i for i, c in enumerate(chunks)}
                for fut in as_completed(futures):
                    all_materials.extend(fut.result())
                    done += 1
                    if done % 10 == 0 or done == len(chunks):
                        logger.info(f"进度 {done}/{len(chunks)} 块，累计抽取 {len(all_materials)} 条")
    else:
        # 原流程：全类并发抽取
        done = 0
        with ThreadPoolExecutor(max_workers=LLM_CONCURRENCY) as pool:
            futures = {pool.submit(extract_from_chunk, c, work, i): i for i, c in enumerate(chunks)}
            for fut in as_completed(futures):
                all_materials.extend(fut.result())
                done += 1
                if done % 10 == 0 or done == len(chunks):
                    logger.info(f"进度 {done}/{len(chunks)} 块，累计抽取 {len(all_materials)} 条")

    logger.info(f"抽取完成，原始 {len(all_materials)} 条，开始向量化…")
    vectorize(all_materials)

    survivors = dedup_in_batch(all_materials)
    logger.info(f"批内去重后 {len(survivors)} 条（去掉 {len(all_materials) - len(survivors)} 条重复）")

    # 分类统计
    by_type: Dict[str, int] = {}
    for m in survivors:
        by_type[m["material_type"]] = by_type.get(m["material_type"], 0) + 1
    logger.info("分类分布: " + ", ".join(f"{k}={v}" for k, v in by_type.items()))

    # 导出完整素材到 JSON（便于逐条核对质量/去重/打分；不含 512 维向量，保持可读）
    if dump_path:
        dumpable = []
        for m in survivors:
            d = {k: v for k, v in m.items() if k != "embedding"}
            dumpable.append(d)
        try:
            with open(dump_path, "w", encoding="utf-8") as f:
                json.dump(dumpable, f, ensure_ascii=False, indent=2)
            logger.info(f"已导出 {len(dumpable)} 条到 {dump_path}（供逐条核对）")
        except OSError as e:
            logger.warning(f"导出 JSON 失败: {e}")

    if dry_run:
        logger.info("[dry-run] 跳过入库。示例：")
        for m in survivors[:3]:
            logger.info(f"  [{m['material_type']}] {m['title']} (q={m['quality_score']})")
        return

    stats = persist(survivors)
    logger.info(
        f"入库完成：新增 {stats['insert']}，覆盖更新 {stats['update']}，"
        f"库内重复跳过 {stats['skip']}"
    )


def main() -> int:
    parser = argparse.ArgumentParser(description="网文剧情素材库 ETL")
    parser.add_argument("path", help="TXT 文件或目录")
    parser.add_argument("--source-work", default=None, help="作品名（默认取文件名）")
    parser.add_argument("--dry-run", action="store_true", help="只抽取不入库，用于验证")
    parser.add_argument("--max-chunks", type=int, default=MAX_CHUNKS,
                        help="只处理前 N 块（验证用，避免整本烧 token）；0=全部。也可用环境变量 MAX_CHUNKS")
    parser.add_argument("--dump", default=None, metavar="FILE",
                        help="把抽取到的完整素材导出为 JSON 文件（不含向量），便于逐条核对质量")
    args = parser.parse_args()

    if not LLM_API_KEY:
        logger.error("未配置 LLM_API_KEY，请先复制 .env.example 为 .env 并填写")
        return 1

    files = collect_txt_files(args.path)
    if not files:
        logger.error(f"未找到 TXT 文件: {args.path}")
        return 1

    logger.info(f"共 {len(files)} 个 TXT 待处理。目标 project_id="
                f"{TARGET_PROJECT_ID if TARGET_PROJECT_ID is not None else 'NULL(全局共享)'}")
    t0 = time.time()
    for path in files:
        try:
            process_file(path, args.source_work, args.dry_run, args.max_chunks, args.dump)
        except Exception as e:  # noqa: BLE001 单文件失败不中断
            logger.error(f"文件处理失败，跳过 [{path}]: {e}")
    logger.info(f"全部完成，耗时 {time.time() - t0:.1f}s。失败详情见 etl_failures.log")
    return 0


if __name__ == "__main__":
    sys.exit(main())
