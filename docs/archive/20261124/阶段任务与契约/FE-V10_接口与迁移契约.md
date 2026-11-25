> 历史归档：仅供追溯，不作为当前排期、授权或验收门槛。当前依据：[核心功能与开发基准](../../../核心功能与开发基准.md)。原始字节见归档备份及清单；正文仅追加本提示并修正迁移链接。

# FE-V10 接口与迁移契约

2026-11-23，V10-A。只在隔离库验证；正式库不自动迁移。基线 data/acceptance-fev10/baseline.zip。

新增 assistant_requests、assistant_messages 两表；Evidence、冻结输入、帮助映射以有界JSON存在request中，不修改旧表。消息唯一(request_id,role)，request_id全局唯一，payload_hash覆盖课程/主题/版本/正文/附件和retry_of。请求接受短事务提交，单进程2 worker+4等待槽；每主题非终态唯一通过短事务BEGIN IMMEDIATE与进程锁保护。恢复不重新派发：重启前已派发标interrupted_unknown，其余失败。进程多实例不受支持。

v2新增：GET /capabilities；POST /topics/{id}/requests；GET /requests/{id}；GET /topics/{id}/messages（游标分页，带非终态状态）；POST /requests/{id}/resolve；POST /requests/{id}/cancel；GET /requests/{id}/citations/{evidence_id}。POST request接受request_id(UUID)、expected_revision、context_revision、text、binding_ids、user_provided_binding_ids（明确降级文字）、retry_of。拒绝客户端角色、system、动作URL与未知字段。resolve只允许既定帮助同意或同一附件降级；实质变更另发新请求。

reply包含自然语言reply和claims[{text,evidence_ids,quote,kind}]，kind=evidence或model_explanation；引用只引用本请求Evidence，quote规范化后必须匹配且claim.text必须出现在reply。引用动作由服务端白名单生成，点击重新校验来源/版本/归属；模型不生成动作。无效输出不发布。不将ID校验冒充语义事实核验。

错误：request_id_conflict、topic_busy、queue_full、context_stale、model_unavailable、input_budget、invalid_citation、source_removed、evidence_unmatched、help_required、teaching_unavailable。状态accepted/queued/preparing/waiting_input/running/validating/published/blocked/failed/cancelled/stale/interrupted_unknown；cancel_requested独立布尔。GET不生成。新草稿不参与请求快照；确认接受才由客户端CAS保护清除被冻结正文。

历史只取同主题最近6完整已发布问答，旧请求附件依赖不再存在或版本失效则整对排除，保留界面真实历史和范围提示。输入按UTF8字节上界保守估计，含schema最多12000，输出1500，单次60秒；仅一次导师派发，无下层transport fallback或JSON重试。费用未配置返回null。

迁移：离线SQLite backup后运行 scripts/migrate_assistant_generation.py --database-url sqlite:///隔离路径 --backup-file 隔离备份新文件；重复执行不改旧字段，脚本支持 --check-only。应用不自动创建这两表，缺表能力禁用。回退设置ASSISTANT_GENERATION_ENABLED=0（GET历史仍可读）并运行旧版本，保留新表，绝不DROP。正式库迁移必须另行明确执行，当前不操作。

教学适配：逐题检查来源/当前任务/重测许可和既有running；每请求每题建立一TutoringTurn占用原业务互斥，单次导师派发共享UsageRecord；发布保守记hint_requested与tutoring_saved，取消不抹除许可事件。专用适配不给通用模型教师字段。不满足条件时不派发。

迁移命令现在强制SQLite原生backup到全新文件后才建表，禁止覆盖原库或已有备份；check-only不迁移。比较中的每题旧TutoringTurn使用uuid5(request_id, task_id)稳定派生标识，避免同一session内唯一键冲突；映射保存在请求teaching字段中。
