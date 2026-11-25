> 历史归档：仅供追溯，不作为当前排期、授权或验收门槛。当前依据：[核心功能与开发基准](../../../核心功能与开发基准.md)。原始字节见归档备份及清单；正文仅追加本提示并修正迁移链接。

# FE-V08 接口与持久化契约

2026-11-23。实施定稿 v1；仅上下文准备，尚未发送 AI。用户已明确授权按任务书开发。

## 基线与实施顺序

HEAD `ff7bac3c72568b3fce6a21b2cf0b9f475b360894`；前置实现包含大量未提交改动，不以 HEAD 代替现状。首笔实现前完整非忽略文件快照、状态、SHA-256 已存 `data/acceptance-fev08/baseline*`。FE-V06/07 待用户评审状态不变。本卡按后端身份/CAS → 主题草稿恢复 → 主动取材 → Manifest 隔离与工程验收推进。

## 对象及状态源

| 对象 | 实现 | 命令及边界 |
|---|---|---|
| WorkItem | assistant_work_items | platform_task 引用真实 session/task；exploration 自有标题；attention 仅 ongoing/paused，探索可 finished |
| BusinessProjection | 只读即时投影 | stage/current/status、正式提交及带学能力从原记录读取，不反写正式业务 |
| Topic + Composer | assistant_topics 同一聚合行 | mode/item_ids、text、bindings、revision、context_revision；上下文变动才增加 context_revision |
| Binding | Topic 内受控 JSON，最多4项 | 稳定 binding ID，资源身份、版本、角色、区域、确认快照，替换保留 supersedes ID |
| Command receipt | assistant_commands | (course_id, command_id) 唯一；规范 JSON SHA-256 包含操作/目标/完整 DTO；同载荷返回原回执，异载荷409 |
| 焦点/视图 | 本机偏好 + 原 ReaderLab | 课程独立主题偏好，事项一个明确 origin/target 书签；不复制阅读器状态 |
| 旧记录 | 原 AssistantSnapshot/schema1 保留 | 原入口读写不改；v2只读历史，显式复制文字不附带旧 context |

## HTTP / DTO

根路径 `/api/courses/{course_id}/assistant/v2`。所有 DTO extra=forbid、schema_version=2；显式命令 `command_id`（1–100字符）、`expected_revision`（非负整数）；创建 expected_revision=0。读操作不隐式建数据。

| 方法 / 相对路径 | 输入 / 输出 |
|---|---|
| GET /items、/topics | offset≥0、limit默认20最大50，items/next_offset/read_only |
| GET /items/{id}、/topics/{id} | 课程过滤单项；主题含 composer |
| POST /items | kind、title、session_id/task_id；同课程同真实 task 唯一幂等 |
| POST /items/{id}/attention | attention、受控 bookmark；原子CAS |
| POST /topics | title、mode、item_ids；single=1、compare=2、independent=0 |
| PUT /topics/{id}/composer | text≤10000；只改正文，不能写角色或附件 |
| POST /topics/{id}/bindings | confirmed=true、binding、可选 replace_id；服务端校验、事务更新 |
| DELETE /topics/{id}/bindings/{binding_id} | 命令DTO；事务更新 |
| POST /topics/{id}/manifest | expected_revision、context_revision、question≤10000；只读，无运行请求状态 |
| GET /legacy | 原记录/指纹/schema/历史标记，未知schema原样可导出 |
| POST /topics/{id}/legacy-copy | 源指纹、entry_id（null为旧草稿）、命令；目标必须空，仅复制文字 |

绑定受控角色 document_excerpt/question/student_work/submitted_answer/visible_feedback。资料必须带 source_id/source_sha256/preview_version/page/regions/precision；归一化区域最多20、文本最多10000，无静默截断。题目含session/task、公开内容指纹；已提交内容含attempt_id，服务端投影原值；student_work明确为用户声明未提交快照。单主题非目标题的私有输入拒绝确认。

## 隔离与并发

每次写入 SQL `UPDATE ... WHERE revision = expected_revision`，回执同事务提交；唯一约束处理并发创建。409不覆盖。Topic正文与附件竞争使用同一个CAS；context_revision单独反映附件集合。Manifest只纳入明确目标/确认绑定，不扫其他主题、笔记、sessionStorage或课程全文。目标不相容返回 needs_context_choice；过期context_stale，来源/hash/preview/页码/当前题/反馈可见性逐项排除。隐藏教师字段从未序列化进普通Manifest或trace。

## 迁移、模式、回退

仅三个新表，均 course_id 外键CASCADE及索引；事项(course_id,task_id)唯一，主题(course_id,id)查找，命令(course_id,command_id)唯一。create_all仅创建新表，不变更旧字段；增量迁移脚本只建这三表，先临时SQLite演练，不自动运行正式库。课程永久删除显式清新表以兼容未启用SQLite外键的既有引擎；来源移除保留历史，禁止新绑定。归档只读，所有写命令拒绝。

v2仅服务端；本机schema1/服务端schema1保留原读写导出入口，默认不上传本机内容。v2入口显式启用，服务失败不切存储。回退关闭v2新写入口，保留只读/导出及三表，不drop、不清storage。无新增收费后台任务、OCR、模型网关、真实发送或框架。

## 最小公开 JSON

```json
{
  "schema_version": 2,
  "command_id": "public-create-topic-1",
  "expected_revision": 0,
  "title": "理解互斥与同步",
  "mode": "independent",
  "item_ids": []
}
```

候选与定稿差异：Composer与Binding合并为Topic聚合JSON，避免跨行快照失配；不创建未来Asset/Request/Message表。保留独立composer/绑定端点及ID，后续可迁移。分页采用稳定ID排序+offset，非无限加载所有草稿。
