# 数据模型

> Agent 理解本项目最快的方式是看懂数据结构。本文档为双库全貌 + 字段级核心表。
> **以代码为准**：创作库表定义见 `packages/server/src/db/creative-schema.ts`（56 张），诛仙库见 `packages/server/src/db/zhuxian-schema.ts`（33 张）。技术手册 §4 声称的"48 表/18 表"为旧数据，已过时。

## 双库概述

| 库 | 库名 | 角色 | schema 表数 | 说明 |
|----|------|------|------|------|
| 诛仙库（世界观库） | `novel_db` | RAG 世界观源（system 书只读保护，user 书可写） | **33** | 3 层结构（原始设定 18 核心表 + 蒸馏/心智模型/文风/分析扩展 15 表），含 pgvector 512 维向量 |
| 创作库 | `novel_studio` | 读写项目数据 | **56**（Drizzle） | 7 核心业务表 + 49 张支撑表 |

> 另有 Python 素材蒸馏侧独立管理的素材表（不在 Drizzle schema，后端只读查询）：`plot_material_encounter/foreshadow/highlight/task`、`style_preset`、`domain_knowledge`（DDL 见 `sucaiqingxi/ddl-*.sql`）。

## 一、诛仙库（世界观库）表——33 张

### 核心设定表（18 张，手册已述 + 补充）

| 表名 | 用途 | 关键字段 |
|------|------|----------|
| novel_book | 书籍（WS0 多书） | book_id(PK), book_name, author, source_type(system/user), description, cover_url, tags, is_deleted |
| novel_chapter | 小说原文章节 | chapter_id(PK), book_id, chapter_no, raw_content, clean_content, analyzed, is_deleted |
| novel_character_lib | 人物库 | id, book_id, name, all_titles(text[]), faction, realm, combat_type, core_skills(text[]), personality, growth_line(text[]), plot_tags(text[]), writing_profile(jsonb), exclusive_items(jsonb), **embedding(vector512)**, verify_status |
| novel_faction_lib | 门派库 | id, book_id, name, camp, headquarters, leader, town_treasure, cultivation_feature, force_relations(text[]), embedding |
| novel_location_lib | 地点库 | id, book_id, name, level, parent_region, related_faction, environment, key_events, embedding |
| novel_skill_lib | 功法库 | id, book_id, name, grade, faction, skill_type, threshold, core_effect, embedding |
| novel_magic_item_lib | 法宝库 | id, book_id, name, grade, system, owners, core_abilities, embedding |
| novel_monster_lib | 妖兽库 | id, book_id, name, level, race, core_abilities, habitat, combat_level |
| novel_material_lib | 丹药/灵材/毒物 | id, book_id, name, type, grade, effects, source |
| novel_daily_item_lib | 日常物品与信物 | id, book_id, name, type, description |
| novel_faction_rule_lib | 宗门规制 | id, book_id, name, content, applicable_scope |
| novel_season_event_lib | 岁时节令与宗门事件 | id, book_id, name, season, description |
| lib_character_relation | 人物关系 | rel_id(PK), book_id, char_a_id, char_b_id, rel_type, interact_count（无 is_deleted 列） |
| lib_faction_member | 门派成员 | id, faction_id, character_id, position, note |
| chapter_analysis | 章节分析 | chapter_id, book_id, chapter_no, core_event, emotion_main_type, conflict_level, **scene_emb(vector512)** |
| scene_analysis | 场景分析 | scene_id, book_id, chapter_id, scene_no, description, **embedding(vector512)** |
| plot_unit | 情节单元 | id, book_id, chapter_id, unit_type, content, embedding |
| novel_paragraph / chapter_embedding / scene_character_action / scene_metric | 段落级/向量级分析辅助表 | 章节段落、向量索引、场景人物动作、场景指标 |

### 扩展表（15 张：蒸馏/心智模型/文风/导入）

| 表名 | 用途 | 关键字段 |
|------|------|----------|
| technique_attribute | 功法属性蒸馏（zaomeng） | skill_id, grade, element, difficulty, effect, distill_source, is_deleted |
| technique_move | 功法招式蒸馏 | skill_id, move_name, effect, requirement, distill_source |
| technique_relation | 功法关系蒸馏 | skill_id, target_technique, relation_type(克制/互补/同宗), description |
| technique_distill_archive | 功法蒸馏归档 | skill_id, distill_version, content_json(jsonb) |
| character_mental_model | 人物心智模型蒸馏 | character_id, model_summary(one_liner), source |
| character_heuristic | 人物决策启发式蒸馏 | character_id, rule_name, rule_content |
| character_life_stage | 人物人生阶段蒸馏 | character_id, stage_name, personality_state |
| character_distill_archive | 人物蒸馏归档 | character_id, distill_version, content_json |
| style_global_config | 文风全局配置 | book_id, description_ratio, sentence_rules, matched_scene_flavor 等 |
| style_scene_mapping | 文风场景维度映射 | trigger_key, description_ratio 覆盖 |
| entity_import_log | 跨书引入日志（WS2） | source_book_id, target_book_id, entity_type, entity_id |
| world_batch_import | 文本抽取入库任务（WS3） | book_id, source_text, status(awaiting_confirm), result_json |

**查询注意**：`text[]` 数组列须 `column::text ILIKE '%kw%'`；`lib_character_relation` 无 `is_deleted` 列，PK 是 `rel_id`；向量检索用 `scene_emb <=> $1` 余弦距离（Drizzle `vector512` customType 映射 `vector(512)`）。

## 二、创作库核心业务表（7 张，字段级，以 Drizzle 属性名为准）

### creative_project — 创作项目

| 字段 | 类型 | 说明 |
|------|------|------|
| id | bigserial | 主键 |
| title / description / genre | text | 标题 / 描述 / 题材 |
| sourceBookId | bigint | 绑定诛仙库书籍 ID（默认 1，RAG 隔离源） |
| status | varchar(20) | 默认 'planning' |
| llmConfig / generationConfig | jsonb | 项目级 LLM 覆盖 / 生成参数 |
| defaultImpactCharacterIds | bigint[] | 默认影响对象人物 ID（影响体系 POV 兜底） |
| **storyEngineType / storyEngineDesc** | varchar/text | 故事引擎类型（upgrade/revenge/mystery/romance）/ 描述（R5） |
| createdAt / updatedAt | timestamp | 时间戳 |

### story_outline — 卷级大纲

| 字段 | 类型 | 说明 |
|------|------|------|
| id | bigserial | 主键 |
| projectId | bigint | 项目 FK（onDelete cascade） |
| volumeNo / title / synopsis | int/text | 卷号 / 标题 / 概要 |
| keyEvents / characterArcs / foreshadowing | jsonb | 关键事件 / 人物弧线 / 伏笔规划（keyEvents 含 chapterNumber，场景脚本/分支反写目标） |
| worldBuildingNotes | text | 世界观补充 |
| sortOrder / status | int/varchar | 排序 / 状态（默认 draft） |

### chapter_plan — 章节计划（字段最丰富）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | bigserial | 主键（生成任务/生成章节均引用） |
| projectId / outlineId | bigint | 项目 / 卷大纲 FK |
| volumeNo / chapterNo | int | 卷号 / 章号 |
| title / intent | text | 标题 / 章节意图 |
| povCharacterIds | bigint[] | 视角人物 ID 数组（**负数=自定义人物**） |
| targetWordCount | int | 目标字数（默认 3000） |
| sceneBreakdown / requiredEntityIds | jsonb | 场景分解 / 必须出现的实体 |
| mustHaveEvents | jsonb | 关键剧情锚点数组（Auditor 第13维审查） |
| emotionTarget / conflictTarget | text/int | 情绪目标 / 冲突强度（默认 3） |
| prevChapterSummary | text | 前文摘要 |
| status | varchar(20) | 默认 'planned' |
| branchSourceOptionId / branchParentChapterId | bigint | 衍生分支选项 / 分支来源父章计划 |
| **plotFingerprint** | varchar(30) | 核心桥段类型：faceoff/puzzle/showcase/dialogue/relation/daily/upgrade/crisis/reveal（需求4） |
| **hookType / hookIntensity** | varchar | 章末钩子类型（suspense/emotion/turn/crisis/reveal）/ 强度（light/medium/heavy，需求6） |
| **conflictScore / conflictRating / isPeak / singularityEvent** | int/varchar/bool | 冲突量化分 / 星级（1-5）/ 是否峰值（≥4星）/ 是否奇点（天命 P0#1） |
| **chapterType** | varchar(30) | 章节类型：climax/progression/revelation/buffer_price/buffer_dialog/buffer_clue/singularity（默认 progression） |
| **pinnedMaterialIds** | jsonb | 手动固定的剧情素材引用数组（二期 RAG 人工干预） |
| branchPrediction | text | 随分支生成的后续走向推演 |
| **branchArcId / isConvergence** | bigint/bool | 所属分支弧 / 是否收束过渡章（动态叙事引擎 v1.4） |

### generation_task — 生成任务（DB 即队列）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | bigserial | 主键 |
| projectId / chapterPlanId | bigint | 项目 / 章节计划 FK（set null） |
| taskType | varchar(20) | 默认 'chapter' |
| status | varchar(20) | pending → running → auditing → revising → completed / failed / cancelled |
| currentStep | varchar(50) | queued / retry_wait / step1_build_context / step2_writer / ... |
| inputSnapshot / outputText / auditReport / revisionNotes | jsonb/text | 入参快照 / 输出正文 / 审计报告 / 修订笔记 |
| errorMessage / llmModel / tokensUsed | text/varchar/int | 错误 / 模型 / token 用量 |
| startedAt / completedAt | timestamp | 起止时间 |
| position / retryCount / maxRetries | int | 队列排序（默认 0）/ 重试计数 / 上限（默认 3） |
| batchId / queueOptions | varchar/jsonb | 批次号 / 生成参数（含 resumeFrom 断点续跑） |

### generated_chapter — 生成章节（多版本）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | bigserial | 主键 |
| projectId / chapterPlanId / taskId | bigint | 项目 / 计划 / 任务 FK |
| volumeNo / chapterNo / title / content | int/text | 卷号 / 章号 / 标题 / 正文 |
| wordCount / version / parentVersionId | int | 字数 / 版本号（默认 1）/ 父版本（版本链） |
| qualityScore | jsonb | 质量评分 |
| isCurrent / status | bool/varchar | 当前生效版本（默认 true）/ 状态（默认 draft） |
| perspectiveVersions | jsonb | 段落多视角重写版本数组（模块6，不覆盖原文） |
| **dashboard** | jsonb | 章信息仪表盘（天命 P1#6，结构化元数据） |

### author_rules — 作者规则

| 字段 | 类型 | 说明 |
|------|------|------|
| id / projectId | bigserial/bigint | 主键 / 项目 FK |
| ruleType / ruleContent | varchar(20)/text | 规则类型（默认 soft）/ 内容 |
| priority / isActive | int/bool | 优先级（默认 0）/ 是否启用（默认 true） |

### generation_log — 生成日志

| 字段 | 类型 | 说明 |
|------|------|------|
| id / projectId / taskId | bigserial/bigint | 主键 / 项目 / 任务 FK（set null） |
| agentName / action / detail | varchar/jsonb | Agent 名 / 动作 / 详情 |

## 三、创作库重要支撑表（49 张，按模块分组）

### 管线与工作流
| 表 | 用途 | 关键字段 |
|----|------|----------|
| pipeline_checkpoint | 管线断点（v1.3 断点续跑） | task_id(可空), step_name, step_order(主管线10-50/后验≥100), step_data, status(pending/running/completed/failed/skipped), token_input/output |

### 场景脚本（5 表）
| 表 | 用途 | 关键字段 |
|----|------|----------|
| scene_node | 场景节点 | outline_id, sort_order, title, time_setting, location_desc, core_event, effect_and_result, foreshadowing_note, scene_type(key/transition/foreshadow), ai_status, **core_beat/state_change/scene_hook_type/rhythm_anchor/scene_plot_fingerprint/payoff_setup（施工卡增强）**, **node_type/branch_group_id/path_label（PRD-B 分支三字段）**, metadata |
| scene_node_character | 场景-人物关联 | scene_node_id, character_id, appearance_type(protagonist/core_support/mention), role_note |
| scene_node_element | 场景-要素关联 | scene_node_id, element_type, element_id, **element_source(native/custom)**, foreshadow_direction(plant/payoff) |
| scene_node_relation | 节点关系连线 | source_node_id, target_node_id, relation_type(causal/sequential/foreshadow_echo) |
| scene_edit_log | 对话修改日志 | user_instruction, parsed_plan, snapshot_before/after, apply_status(pending/applied/rolled_back), operation_type |

### 状态追踪 / 伏笔 / 任务链 / 分支
| 表 | 用途 | 关键字段 |
|----|------|----------|
| character_state_snapshot | 人物状态快照 | character_id(可空), character_name, chapter_no(0=初始), location, realm, injury, mental_state, possessed_items, extra_state, **status(pending/confirmed/auto_confirmed/rejected)**, **source(bootstrap/extracted/manual)** |
| timeline_milestone | 时间线里程碑 | chapter_no, story_time, title, description, importance(key/normal), status(pending/confirmed/auto_confirmed/rejected), source |
| foreshadow_thread | 伏笔台账 | title, hint_clue, status(pending/planted/resolved/abandoned), priority, plant_chapter, resolve_chapter, **tier(t1/t2/t3)**, **dna_subject/dna_action/dna_object/dna_emotion（DNA 四元组）**, **referenced_material_id**, **source_type(manual/scene/branch)/source_branch_option_id/is_confirmed/backfill_method/backfill_target_chapter_id（分支衍生回填）** |
| task_arc | 任务链台账（征途录） | title, description, **progress_clue（进度线索子串匹配）**, status(active/progressing/completed/failed/abandoned), priority, tier, task_type(main/side/hidden/fortune), start/target_chapter, referenced_material_ids, related_character_ids, source_type(manual/scene/branch/auto) |
| chapter_branch_option | 剧情分支选项 | source_chapter_plan_id, option_title/description, next_chapter_intent, next_scene_hint, impact_tags, option_type(normal/encounter/detour/divergence), source_materials, main_direction, secondary_directions, direction_match_score, is_selected, **branch_premise/estimated_length(默认2)/core_conflict/converge_to_milestone_id（动态叙事引擎）** |

### 动态叙事引擎（v1.4，3 表）
| 表 | 用途 | 关键字段 |
|----|------|----------|
| narrative_milestone | 叙事里程碑 | outline_id, label, description, must_happen(jsonb), key_character_ids(bigint[]), target_chapter_from/to, status(upcoming/active/reached/skipped), importance(critical/major/minor), sort_order |
| branch_arc | 分支弧 | source_chapter_id, source_milestone_id, title, premise, branch_type(approach/detour/consequence/divergence), estimated_length(默认2/硬限5/豁免+2), status(active/converged/abandoned), converge_to_milestone_id, new_elements, state_snapshot |
| plan_rewrite_log | 计划改写日志 | branch_arc_id, action(convergence), plan_id, before/after_snapshot, rolled_back |

### 影响体系 / 因果链（阶段4）
| 表 | 用途 | 关键字段 |
|----|------|----------|
| impact_definition | 影响定义白名单 | impact_key(唯一), name, domain(character/world/relation/rule), category(base/fate/qualification/faction/inner/karma), value_type(numeric/tag), min/max/default_value, decay_per_chapter, grade, mutex_group, threshold_events, is_active |
| character_impact_snapshot | 人物影响快照 | character_id, character_name, chapter_no(0=初始), numeric_values(jsonb), tag_states(jsonb), status, source(manual/auto/branch/bootstrap) |
| world_impact_snapshot | 世界观影响快照 | region(空=全局), numeric_values, tag_states, status, source |
| branch_impact_link | 分支影响关联 | branch_option_id, target_type, target_id, char_a/b_id, region, impact_key, change_type(add/set/add_tag/remove_tag), change_value, tag_key, tag_duration(-1永久), display_text, is_hidden, sort_order |
| impact_history | 影响变更历史 | source_type, source_id, chapter_no, snapshot_before/after, operator_note |
| causal_chain | 因果链 | source_type(branch/event/manual), source_id, source_chapter_no, cause_type(secret/debt/betrayal/prophecy/promise/grudge), cause_description, effect_type(reveal/repay/revenge/fulfill/break), effect_description, target_chapter_min/max, status(planted/foreshadowed/triggered/resolved/expired), priority(1-10), strength(0-100), direction_code, parent_chain_id, tags |
| relation_impact_snapshot | 关系影响快照 | char_a_id/char_b_id(约定 a<b), rel_type, relation_values(affection/trust/respect/intimacy), relation_delta, status, source |

### 三工坊 + 自定义实体（负数 ID 体系）
| 表 | 用途 | 关键字段 |
|----|------|----------|
| custom_character | 自定义人物（对外负数 ID） | name, gender, race_category(7大类), race_sub(56小类), position(chenjie/tongtu/dazhe/zhelong/tianyou), fake_position, stance(0-100), inner_personality, outer_personality, talents(3正向+1缺陷), strengths/weaknesses, description(300-500字), verdict_poem(判词七绝), verdict_comment(二字考语), dao_title/combo_ability(套装道号), source_ref, entity_status(draft/official), chapter_updates, is_deleted |
| custom_weapon | 自定义武器（神兵坊） | category(5门类), type(形制), grade(凡造/灵淬/宝胎/道纹/仙蜕/神蕴), grade_level(1-3), fake_grade(伪装底蕴), base_material, forge/soak/attach/cavity_traits(jsonb 四类特质ID数组), soul_refine_level(none/soul_mark/blood_merge/dao_resonance), core_direction, growth_type, base_entity_id, source_entity_ids, linked_character_ids, breakthrough_narrative, **selected_directions/generated_traits（方向组合特质）**, **temperament/past_type/taboos/reverse_mode（五感+反差）**, source_ref, entity_status, chapter_updates, is_deleted |
| weapon_lore | 武器文案（兵器谱） | weapon_id, name(名号), fake_name(化名), intro, moves(jsonb 配套招式), **real_skill/weird_trait/past_memory/jianghu_nickname/jianghu_heihua/rules/hooks/famous_scenes/spirit（五感卡全字段）**, is_current |
| custom_technique | 自定义功法（九大道则） | name, main_dao(9选1: gengjin/kunearth/thunder/mingshi/void/suishi/xingzhi/lingqi/shenhun), assist_dao(0-3门), guidance_depth(rudimentary/complete/essential), fake_depth(藏拙), style_type, threshold, core_traits, practice_path(6路线), body_mark, usage_skills, abilities(分道境入微/化境/合道/超脱), backlash, **backlash_text（US-20d 动态反噬）**, **insight_renames（US-20e 天机独悟改名）**, **moves（配套招式）**, inheritance, evolution, inherent_conflict, core_direction, fit_monk, description(500-700字), growth_type, base_entity_id, source_entity_ids, linked_character_ids, source_ref, entity_status, chapter_updates, is_deleted |
| character_technique_variant | 千人千面个人变种 | character_id, base_technique_id, variant_name, rarity(common/remarkable/rare 60/30/10), dao_weight_offset, trait_offset, ability_variant, backlash_offset, body_mark, exclusive_skill, cultivation_effect, description(400-600字), version, is_deleted |
| character_martial_lore | 人物武学档案 | character_id, weapon_id, technique_id, 融合招式 + 小传, version(upsert+1) |
| custom_magic_item_lib | 自定义法宝（成长工坊） | 与旧 custom_skill_lib 结构对称：grade(凡造~神蕴), effects(jsonb 特效数组), growth_type(fusion/mutation/upgrade/evolution), linked_character_ids |
| custom_skill_lib | 自定义功法（**阶段6已退役**，保留为空表，能力由 custom_technique 取代） | 同上结构 |
| entity_growth_record | 实体成长记录 | entity_type(skill/magic_item), entity_id, operation_type(fusion/mutation/upgrade/evolution), source_entity_ids, before/after_snapshot, result, operator_note |
| custom_character_relation | 自定义人物关系 | char_a_id/char_b_id, rel_type, **rel_level(强度等级)**, description, interact_pattern, **source_event（触发事件）**, is_active, **entity_type(character/weapon_bond)**, **weapon_id（人器羁绊）** |

### 金句 / 成长 / 文风 / 技法 / 心智 / 淘宝 / 热点 / 舆图
| 表 | 用途 | 关键字段 |
|----|------|----------|
| project_quote_lib | 金句库 | quote_text, original_text, polished_text, polished_versions(jsonb 三档), scores(jsonb 五维+total), grade(legendary≥90/good80-89/candidate70-79), polish_status(none/polished/applied), is_collected, source_type(auto/manual/import), character_id/name, scene_desc, quality_score |
| character_growth_stage | 人物成长阶段 | character_id, stage_no, name, traits, chapter_start/end(NULL=不限), **stage_type（B2：境界突破/心境转变/能力觉醒/关系升华）**, **is_key_node（命中即强制召回高光素材）** |
| style_audit_record | 文风校验记录 | chapter_plan_id, generation_task_id(可空), config_snapshot, overall_score, dimension_scores, issues(含excerpt), issue_count, status |
| technique_atom | 叙事技法原子 | technique_id(T_PLAN_001), name, category(content_planning/presentation/rhythm/character_logic), level(principle/pattern/example), source(manual/custom), core_rules(jsonb 可计算规则), generation_guidance, audit_prompt_segment, auto_fix_template, examples, applicable_genres, status |
| chapter_technique_map | 章节-技法关联 | chapter_plan_id, technique_id, enabled, params, audit_score, audit_detail, fixed |
| info_point | 章节信息点（双维度） | chapter_plan_id, content, importance(core/secondary/foreshadow), function(plot/character/world/atmosphere/foreshadow), sort_order |
| character_voice_config | 角色声音配置（PRD-A） | character_id(正=诛仙/负=自定义), speech_style, catchphrases, address_habit, tone_base, example_quotes, forbidden_expressions, enabled |
| character_knowledge | 角色已知信息 | character_id, knowledge_content, info_level(core/common/secret), source_type(manual/foreshadow/timeline), source_ref, acquired_chapter, enabled |
| character_memory_card | 角色记忆卡 | character_id, event_summary, chapter_no, emotional_impact, importance, source(auto/manual), enabled |
| treasure_item | 淘宝物品 | project_id, name, item_type(trinket/secret), trinket_category, full_data(jsonb 秘宝数据), unlock_stage(0-5), unlock_progress, bound_character_id, bound_chapter_no, use_count, is_fake(打眼), fake_reveal, hunt_location, hunt_record_id, is_collected, is_converted, converted_id, note, is_deleted |
| treasure_hunt_record | 淘宝记录 | location, item_count(默认10), trinket_count, secret_count |
| hotspot_crawl_batch / hotspot_raw_novel / hotspot_insight / hotspot_push_log | 热点嗅探 4 表 | 批次/原始书目/灵感条目/推送记录 |
| custom_map | 山河舆图-地图 | name, description, **bg_image(base64 底图)/bg_opacity**, **min_x~max_y(坐标范围 默认2000×1500)**, **parent_map_id(地图层级 US-3)**, sort_order, is_deleted |
| custom_location | 山河舆图-地点 | map_id, name, x/y, location_type(sect/city/secret_realm/danger/teleport/battlefield/generic), danger_level(safe/normal/danger/deadly), description, affiliated_faction, **parent_location_id/linked_map_id**, **icon/color**, metadata.source(manual/auto-extract/zhuxian-import), entity_status(draft/official), chapter_updates, is_deleted |
| custom_location_link | 地点路径连线 | from/to_location_id(无向图), link_type(main_road/path/teleport/secret_path), travel_time_walk/fly/ship/teleport, description, is_deleted |
| plot_material_benchmark | 对标素材库（原生 SQL 直连，v1.5；v1.5.1 扩展整本拆文字段） | project_id, source_book_title, material_type(character/plot_unit/style/setting), title, content_md, tags(jsonb), **pinned(置顶=写作强制融入)**, embedding(vector 512 维), chapter_idx, item_type(asset/skeleton/plot), setup_ratio/develop_ratio/turn_ratio/resolve_ratio(NUMERIC), emotion_curve(NUMERIC[]), hook, quality_score, source_snippet |

## 四、模块间数据关联

```
项目 creative_project ──1:N── 卷大纲 story_outline ──1:N── 章节计划 chapter_plan
                                     │                          │1:N
                                     │                          ▼  generation_task（队列）
                                     │                          │1:1
                                     │                          ▼  generated_chapter（多版本，is_current）
                                     ▼
                              scene_node（场景脚本）──N:1── 卷大纲 keyEvents（反写）

人物 ↔ 自定义武器/功法/法宝：linked_character_ids(jsonb) 多对多（上下文按出场人物匹配注入）
人物 ↔ 功法个人变种：character_technique_variant（1人物×N功法）
人物 ↔ 武学档案：character_martial_lore（1人1档案，version+1）
人物 ↔ 声音/已知信息/记忆：character_voice_config / character_knowledge / character_memory_card（1人物×N）
地图 custom_map ──1:N── 地点 custom_location ──1:N── 路径 custom_location_link
分支选项 chapter_branch_option ──衍生──▶ 章节计划 chapter_plan（branch_parent_chapter_id）
分支弧 branch_arc ──N:1── 里程碑 narrative_milestone（收束目标）
影响体系：branch_impact_link ──N:1── chapter_branch_option；快照按章节对齐（chapter_no=0 为初始态）
伏笔：foreshadow_thread ──scene_ids── scene_node；回填至 chapter_plan.must_have_events
技法：technique_atom ──N:N── chapter_plan（chapter_technique_map，含审计得分）
淘宝：treasure_item ──convert──▶ custom_weapon / custom_technique（converted_id）
对标素材：plot_material_benchmark ──pinned>语义>关键字──▶ context-builder 写作上下文（v1.5）
```

## 五、设计约束（铁律）

1. **基础字段**：所有核心实体含 `id`、`created_at`、`updated_at`；多数含 `is_deleted` 软删除标记。
2. **复杂结构一律 JSONB**：关系/特效/评分/快照/更新记录等不拆表，适度冗余，不做过度范式化。
3. **负数 ID = 自定义实体**：`custom_character` 等自定义实体对外暴露**负数 ID**（真实自增 ID 取负），与诛仙库正数 ID 共存分流——POV 数组、影响目标解析、声音配置（character_voice_config.character_id）均按符号分流（负数查创作库，正数查诛仙库）。
4. **只读引用**：创作库对诛仙库实体只存 ID/名称做只读引用，不写诛仙库（character_id、element_id 等）。
5. **`bigint[]` 是真数组列**：`pov_character_ids`、`key_character_ids`、`default_impact_character_ids` 须用 Drizzle `bigint(...).array()`，勿误声明为 jsonb。
6. **软删除体系**：`is_deleted` 标记删除，查询一律带 `is_deleted=false` 过滤；诛仙库 system 书禁改禁删。
7. **状态机升级**（v1.4 三期）：状态快照/时间线 status 增加 `auto_confirmed`（LLM 自动生效、用户可否决）与 `rejected`，`confirmed + auto_confirmed` 才进上下文。
