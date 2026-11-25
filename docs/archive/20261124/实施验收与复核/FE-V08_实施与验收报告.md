> 历史归档：仅供追溯，不作为当前排期、授权或验收门槛。当前依据：[核心功能与开发基准](../../../核心功能与开发基准.md)。原始字节见归档备份及清单；正文仅追加本提示并修正迁移链接。

# FE-V08 实施与验收报告

2026-11-23，北京时间。状态：本卡工程检查通过，T20待用户实际试用；不标全卡完成。授权原话：“按任务书开始开发”。仅此卡，无真实发送／OCR／图像理解／Agent框架，无提交、推送、发布或正式库迁移。

## 1. 基线与实现

HEAD ff7bac3c72568b3fce6a21b2cf0b9f475b360894，实施在大量前置未提交改动上进行。首笔新增前将297个非忽略文件归档 data/acceptance-fev08/baseline.zip；同目录baseline-head/status/sha256。不能以HEAD冒充实现提交。FE-V06 C20、FE-V07 D21及反馈修订待用户评审状态保留。

先交付[接口与持久化定稿](../阶段任务与契约/FE-V08_接口与持久化契约.md)，再实现独立assistant_workspace领域/models/dto/routes。前端WorkspaceAssistant/WorkspaceLegacy/workspace.ts接唯一助手壳；ReaderLab临时取材，LearningPanel明确公开内容选择。无新依赖或收费后台处理，不复用旧schema1 PUT存新模型。

入口：课程 → AI学习助手 → 会话与存储 → **启用任务主题与上下文**。可返回原本机／服务端schema1入口。独立主题可无附件保存并检查上下文；没有发送或机器人生成消息。

- 多事项：真实session/task身份，同课同task唯一；独立探索可结束，平台事项只暂停恢复。即时业务投影不复制正式真值，历史题可看不可重开。明确origin/target书签不改stage/current_task/帮助/成绩。
- Topic/Composer：single/independent/compare，每主题正文及最多4个确认绑定。SQL CAS及同事务命令回执；正文不增加context_revision。409停止覆盖，内存保留、导出、显式重读。丢回执原ID重试；保存期间新编辑不会丢。
- 取材：助手内选字/框选/选择本课资料/公开题/明确未提交草稿/权威已提交答案和可见反馈。预览后新增或替换，取消/Esc恢复原工具及先前选区。临时选区不存reader、不建个人批注；普通批注或答案修改不自动改变助手绑定。区域只定位，不声称OCR。
- Manifest：确认绑定逐项查source/hash/preview/page/task/attempt版本，纳入/排除trace可见；公开allowlist从不序列化教师字段。无整课检索、不用语言判断意图；不可用目标返回needs_context_choice及明确候选。
- legacy：旧历史只读展示导出，旧context不授权。服务端复制需源指纹、空目标、命令，仅复制文字；本机记录明确复制才成为待存正文，不自动上传。旧TutoringTurn/UsageRecord/ReaderSnapshot不迁移改写。

## 2. 保存、迁移、回退

仅三新表 assistant_work_items/assistant_topics/assistant_commands。约束、索引与DTO见接口契约；Binding受控JSON在Topic聚合内。最多4绑定、每条20区域、10000字符；分页默认20最大50，extra/角色伪造/坏坐标/跨课ID拒绝，无静默截断。

scripts/migrate_assistant_workspace.py --database-url sqlite:///临时目录/test.db 只建三表，必须显式URL，不改旧列；临时SQLite保留旧courses字段和值并重复执行验证。正式库未运行迁移；原后端启动create_all会建新表，正式使用前备份并安排新版服务启动。课程永久删除显式清三表，来源移除保留历史而拒绝新绑定；归档拒绝写命令。

| 模式 | v2 | 旧schema1 |
|---|---|---|
| 当前本地单用户服务可用 | 服务端持久化 | 本机/服务端原入口 |
| 服务不可用 | 明确失败，内存/导出/原ID重试，不切存储 | 原边界 |
| 归档/关闭写入口 | 读取/Manifest/导出 | 原数据保留 |

回退设置ASSISTANT_WORKSPACE_WRITES=0，保留GET/Manifest及导出；前端可返回旧助手，不drop表或清storage。同页切课保留未存内存；硬刷新前不保证，常驻说明及浏览器beforeunload保护。正式作答草稿仍原标签页sessionStorage，未新增服务端同步。

## 3. 本卡证据

唯一忽略根data/acceptance-fev08/。公开脚本scripts/fev08_public_fixture.py入库；真实服务仅显式临时SQLite/目录。两个课程、不同数字题干、同名不同内容PDF、多页选区。原件hash见live.json，源码指纹/最终状态见同根最终索引。

| 检查 | 结果及证据 |
|---|---|
| 新后端 | 14项通过，backend-second.log：CAS/幂等/权限/限额/失效/迁移/分页/反馈/无副作用 |
| 前端单元 | 31项通过，maintenance-final/frontend-unit.log；含transport/outbox |
| 新浏览器 | 最终48项通过browser-final48.log（双浏览器×三尺寸×8路径），早期失败/补测均保留 |
| 真API | live-final-verified.log、live-1795433666149/live.json：Edge158/Chrome157，fresh context、双窗口409、草稿固定快照、公开题/反馈、compare、跨课、进程重启 |
| 真SQL竞争 | 同HTTP临时服务并发PUT得到200/409；并发同命令返回同ID，异载荷409 |
| 无模型副作用 | 网关generate_json替换为必抛错spy而未触发；session/task/attempt/event/tutoring/usage/schema1全表before/after精确相等 |
| 原生缩放 | native-final.log、native-1795434034212/results.json；双浏览器×三CSS尺寸×100/125%=12组，最大误差1.500058 CSS px≤4 |
| 维护 | 最终7步骤通过：239后端/31单元/22旧UI、构建、SQL/signals及runner-contract；maintenance-final.log，原始report/log副本在maintenance-final/ |
| 完整reader | 完整354项运行330通过/6失败/18跳过；六组失败均旧横幅断言，按基线前置反馈更新后boundary-final.log六组通过。三类真实焦点跳过另headed.log 24/24覆盖；最终新增48项亦独立通过，不伪称单次全绿 |

原生缩放用隔离profile每站点缩放，实测CSS三尺寸1024×768、1440×900、1920×1080，CSS zoom=1/visualScale=1/DPR相对1.25，不是CSS或DPR模拟。预览/Manifest各12截图。已目视1024原生125%及代表界面，滚动与确认取消/导出可达。构建仍约503kB ReaderLab chunk警告；默认总览断言无ReaderLab/PDF worker，不宣称深度性能优化。

### 保留的失败与修复

首轮取消后details从受控变非受控造成收起，改显式打开状态。初轮窄屏测试点被既有规则收起的课程树，改先关闭助手再切课。保存回执/新正文竞争增专项，原ID重放并保留新编辑；干净内存不遮住重新读取数据。真实API脚本路径转义、误用不存在portrait样本、重复点击已开details、未等新建主题回执、reader保存中导航被保护拦截，原日志留存，脚本按真实状态修正，没有禁用保护。原生脚本重复开details同理修复，最终12组通过。

## 4. T01～T20

| 项目 | 结果/证据 |
|---|---|
| T01 | 通过：多事项/探索/幂等/暂停恢复；真实侧栏，正式表不变 |
| T02 | 通过：历史只读业务投影、非法task/跨课拒绝，不重开 |
| T03 | 通过：主题分离、跨课内存、fresh browser服务端恢复 |
| T04 | 通过：确认/取消/Esc/恢复原工具选区，不建批注 |
| T05 | 通过：真实公开题/明确未提交草稿/权威答案反馈，隐藏字段不纳入 |
| T06 | 通过：修改原答案不改绑定，显式替换版本递增，源失效可见 |
| T07 | 通过：新主题无旧答案，compare明确两项分组及同课边界 |
| T08 | 通过（确定性范围）：无附件概念可预览，目标失效给候选，不声称语言指代理解 |
| T09 | 通过：移除/hash/preview/越界/归档/反馈修订逐项失效 |
| T10 | 通过：真双窗口/并发HTTP CAS及正文附件竞争 |
| T11 | 通过：真同命令重放/异载荷/原ID重试 |
| T12 | 通过：断网导出、重启/fresh browser、回执前未存 |
| T13 | 通过：旧响应不覆盖新课，保存期间新编辑保留 |
| T14 | 通过：schema1/未知格式原样保留，显式纯文字复制 |
| T15 | 通过（不作时间推断）：浏览/取材无自动完成评分/帮助/模型；不猜纸上作答 |
| T16 | 通过：4/20/10000、分页上限、角色/坏区域/跨课受控错误 |
| T17 | 通过：真实SQLite/HTTP双安装浏览器及重启，读取无业务写 |
| T18 | 工程通过：最终48矩阵含中文组合/文字选区/恢复原选区，12原生缩放≤4px；24 headed失焦/全屏，原reader完整运行及受影响补测 |
| T19 | 工程通过：临时迁移/关闭写回退、最终239后端/31单元/22旧UI/构建/维护七步骤，reader完整运行并补测修正旧断言 |
| T20 | 待用户实际试用反馈；只有开发授权，不伪造认可 |

S01～S10、S11等待说明、S16/S17上下文元数据、S20失效、S24纠正只验证本卡边界。S12～S15真实图片理解、S18/S19真实生成、S21帮助合流、S22评分核查、S23产物、S25专家预算均后续未实现。停在无模型底座，不自动开启下一卡。


## 5. 最终核验与交付状态

最后生产逻辑修改后：维护七步骤通过（239后端/31单元/22旧UI）；v2 48项桌面矩阵通过；真实API Edge/Chrome脚本包含未提交快照/两项比较/课程隔离/进程重启并通过；native-final 12组通过。之后只规范文本换行、更新文档和修正旧测试横幅断言，六组补测通过。git diff --check最终通过，构建保留大包提示与Starlette/httpx弃用警告，不掩盖。

完整reader运行保留原始6失败而非改写历史：六个项目均在A08测试等待“上下文已明确替换”alert，开工baseline.zip的ReaderLab已无该文案（FE-V07反馈去除成功横幅）。只改测试为固定selectionbar第2页、无旧横幅，同时继续核对真实context.page、草稿、返回和恢复；boundary-final六组通过。原330通过覆盖旧导航/reader/助手，18真实焦点skip由headed24通过覆盖，不将跳过算通过，不用旧通过数冒充最终一轮全量。

源码最终指纹source-sha256.json、相对开工delta-from-start.json、final-status/head、tracked.patch和summary.json在唯一忽略根data/acceptance-fev08。前置共享文件局部delta另有main/LearningPanel/ReaderLab/UnifiedAssistant-delta.patch。未清理任何前置改动，HEAD不变。

T01～T19限定本卡工程范围通过，T20待用户实际“做题→查资料→独立主题→恢复”体验反馈。用户没有给出本轮满意度，整卡保持待验收，不自动启动后续。
