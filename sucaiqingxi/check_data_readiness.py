"""
check_data_readiness.py — 二期召回「数据就绪」自检（只读，psycopg2）

作用：
    二期 Novel Studio 接入 RAG 前，先用本脚本确认创作库里的召回数据是否就绪：
    6 张表是否存在、行数、embedding 覆盖率、HNSW 向量索引是否建好、
    project_id 分布（全局 vs 归属）。一跑即知「数据够不够召回」。

只读保证：
    全程仅执行 SELECT / 系统目录查询，绝不写库，符合「素材表只读」红线。

用法：
    .venv\\Scripts\\python.exe check_data_readiness.py
    # 连接信息复用 .env（PG_HOST/PG_PORT/PG_NAME/PG_USER/PG_PASSWORD）
"""
from __future__ import annotations

import os
import sys

import env_loader  # noqa: F401  # 从根目录加载 .env 并做 PG_* 兼容映射

PG = dict(
    host=os.getenv("PG_HOST", "localhost"),
    port=int(os.getenv("PG_PORT", "5432")),
    dbname=os.getenv("PG_NAME", "novel_studio"),
    user=os.getenv("PG_USER", "noveluser"),
    password=os.getenv("PG_PASSWORD", ""),
)

# 6 张召回表：表名 -> 中文标签
TABLES = [
    ("plot_material_encounter", "剧情素材·奇遇"),
    ("plot_material_foreshadow", "剧情素材·伏笔"),
    ("plot_material_highlight", "剧情素材·高光"),
    ("plot_material_task", "剧情素材·任务链"),
    ("style_preset", "文风预设"),
    ("plot_domain_knowledge", "领域知识"),
]

# style_preset 的向量可空（风格摘要向量为预留），不计入硬性阻塞
EMBEDDING_OPTIONAL = {"style_preset"}


def table_exists(cur, table: str) -> bool:
    cur.execute("SELECT to_regclass(%s) IS NOT NULL", (f"public.{table}",))
    return bool(cur.fetchone()[0])


def inspect_table(cur, table: str) -> dict:
    """返回单表就绪指标（全部只读）。"""
    info: dict = {"exists": table_exists(cur, table)}
    if not info["exists"]:
        return info

    # 活跃行数（排除逻辑删除）
    cur.execute(f"SELECT count(*) FROM {table} WHERE NOT is_deleted")
    info["live_rows"] = cur.fetchone()[0]

    # embedding 覆盖（活跃且非空向量）
    cur.execute(
        f"SELECT count(*) FROM {table} WHERE NOT is_deleted AND embedding IS NOT NULL"
    )
    info["with_embedding"] = cur.fetchone()[0]

    # project_id 分布：全局 vs 归属
    cur.execute(
        f"SELECT count(*) FROM {table} WHERE NOT is_deleted AND project_id IS NULL"
    )
    info["global_rows"] = cur.fetchone()[0]

    # 是否存在 HNSW 向量索引（查系统目录，只读）
    cur.execute(
        """
        SELECT count(*)
        FROM pg_index x
        JOIN pg_class idx ON idx.oid = x.indexrelid
        JOIN pg_class tbl ON tbl.oid = x.indrelid
        JOIN pg_am am ON am.oid = idx.relam
        WHERE tbl.relname = %s AND am.amname = 'hnsw'
        """,
        (table,),
    )
    info["hnsw_index"] = cur.fetchone()[0] > 0
    return info


def main() -> int:
    try:
        import psycopg2
    except ImportError:
        print("缺少 psycopg2，请执行 .venv\\Scripts\\pip install -r requirements.txt")
        return 2

    print(f"[readiness] 连接 {PG['host']}:{PG['port']}/{PG['dbname']} …")
    try:
        conn = psycopg2.connect(**PG)
    except Exception as e:  # noqa: BLE001
        print(f"[readiness] 连接失败：{e}")
        return 2
    conn.set_session(readonly=True, autocommit=True)  # 双保险：会话只读

    blockers: list[str] = []
    warnings: list[str] = []

    with conn.cursor() as cur:
        # pgvector 扩展在不在
        cur.execute("SELECT count(*) FROM pg_extension WHERE extname = 'vector'")
        has_vector = cur.fetchone()[0] > 0
        print(f"\npgvector 扩展：{'✅ 已安装' if has_vector else '❌ 未安装'}")
        if not has_vector:
            blockers.append("pgvector 扩展未安装，无法做向量召回")

        print(f"\n{'表':<26}{'存在':<6}{'活跃行':<8}{'带向量':<8}{'全局':<7}{'HNSW索引'}")
        print("-" * 68)
        for table, label in TABLES:
            info = inspect_table(cur, table)
            if not info["exists"]:
                print(f"{table:<26}{'❌':<6}{'-':<8}{'-':<8}{'-':<7}{'-'}")
                blockers.append(f"表 {table} 不存在")
                continue

            live = info["live_rows"]
            emb = info["with_embedding"]
            glob = info["global_rows"]
            hnsw = "✅" if info["hnsw_index"] else "❌"
            print(f"{table:<26}{'✅':<6}{live:<8}{emb:<8}{glob:<7}{hnsw}")

            # 阻塞/告警判定
            if live == 0:
                warnings.append(f"{label}（{table}）无活跃数据，召回该类将永远为空")
            if table not in EMBEDDING_OPTIONAL:
                if live > 0 and emb == 0:
                    blockers.append(f"{label}（{table}）有数据但 embedding 全空，无法召回")
                elif live > 0 and emb < live:
                    warnings.append(
                        f"{label}（{table}）embedding 覆盖 {emb}/{live}，部分行不可召回"
                    )
                if not info["hnsw_index"]:
                    warnings.append(
                        f"{label}（{table}）缺 HNSW 索引，召回可用但大表会退化为全表扫描"
                    )

    conn.close()

    print("\n" + "=" * 68)
    if blockers:
        print("❌ 存在阻塞项（二期召回不可用，须先解决）：")
        for b in blockers:
            print(f"   - {b}")
    if warnings:
        print("⚠️  告警（可用但需注意）：")
        for w in warnings:
            print(f"   - {w}")
    if not blockers and not warnings:
        print("✅ 数据完全就绪：6 张表存在、向量与索引齐备，可直接接入二期召回。")
    elif not blockers:
        print("✅ 数据基本就绪（无阻塞项），可接入二期召回；建议处理上述告警。")

    return 1 if blockers else 0


if __name__ == "__main__":
    sys.exit(main())
