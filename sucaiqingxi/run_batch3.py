# -*- coding: utf-8 -*-
"""顺序补跑 3 本（复用 extract_materials 的全部配置与管线）。单本失败不中断。"""
import time
import extract_materials as em

FILES = [
    r"sucaitest\《从神迹走出的强者》（校对版全本）作者：杜灿.txt",
    r"sucaitest\《大奉打更人》（校对版全本）作者：卖报小郎君.txt",
    r"sucaitest\《凡人修仙传》（校对版全本+番外）作者：忘语.txt",
]

t0 = time.time()
for i, f in enumerate(FILES, 1):
    em.logger.info(f"########## 批处理 {i}/{len(FILES)} 开始：{f} ##########")
    try:
        em.process_file(f, None, dry_run=False, max_chunks=0, dump_path=None)
    except Exception as e:  # noqa: BLE001 单文件失败不中断
        em.logger.error(f"文件处理失败，跳过 [{f}]: {e}")
em.logger.info(f"########## 3 本全部结束，总耗时 {time.time() - t0:.1f}s ##########")
