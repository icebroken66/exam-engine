> 历史归档：仅供追溯，不作为当前排期、授权或验收门槛。当前依据：[核心功能与开发基准](../../../核心功能与开发基准.md)。原始字节见归档备份及清单；正文仅追加本提示并修正迁移链接。

# 学习 Agent 状态与上下文契约草案

首个实施范围已独立编写为[FE-V08无模型底座任务书](../阶段任务与契约/FE-V08_无模型任务主题与上下文底座任务书.md)，2026-11-23用户另授权实施，限定无模型底座实现与验证见[FE-V08报告](../实施验收与复核/FE-V08_实施与验收报告.md)。本草案其余未来能力仍未实现。后续图片、生成与专家能力不因本卡进入范围。

日期：2026-11-23｜版本：0.1｜状态：已检查现有代码后的设计细化，尚未实现、迁移或真实模型验收。

依据：[架构方向](多模态学习Agent_任务上下文与中断恢复设计草案.md)、[S01～S25 场景表](学习Agent_非线性场景决策表.md)。本文负责状态、权威边界与候选接口；场景行为仍以场景表为专题来源。用户本轮授权检查和细化设计，不自动授权代码实施、付费调用、正式库迁移或选择框架。下文字段、端点和状态名是设计提案，不是现有可调用 API。

## 1. 检查结果与必须澄清的兼容关系

| 发现 | 代码事实 | 本契约处理 |
|---|---|---|
| 多事项不等于多个正式当前题 | LearningSession.current_task_id 与现有带学／提交校验要求当前 task，推进受 running 带学保护 | 新增学习事项层表达多个未完成目标；不擅自把旧题重新设为可正式作答 |
| 暂停有两种意义 | 学习阶段、题目状态与服务调用 running 各有既有含义 | 用户关注状态、正式学习状态、生成请求状态分开；暂停事项不自动中断模型或改 stage |
| 草稿不全是服务器数据 | 正式作答草稿仍有原标签页保存边界；reader／assistant 快照分别保存 | 导航先保护各自未存数据；书签引用保存位置，不承诺跨设备恢复纸上／本机未保存草稿 |
| 旧对话快照可由客户端写 | AssistantSnapshot schema1 保存用户记录和单个 context，不是可信模型运行日志 | 服务端模型消息、工具、请求状态独立受控，客户端不能通过 PUT 冒充生成结果或帮助许可 |
| 教师答案有合法专用用途 | tutoring.send 构造带学教师上下文，包含 reference_answer／rubric／analysis | 专用教学适配器可按同意与原保护取教师数据；通用聊天／检索／照片判读不直接获得 |
| 生成会改变进度版本 | get_progress_version 纳入带学记录状态及提示事件 | 并存全局进度快照与具体任务／来源指纹；预期自身写入不能误判为外部过期 |
| 当前题未必能任意切换 | 原提交／推进在 running 带学时受保护 | 保留阅读导航自由；正式换题／提交仍按业务检查，不能以新 UI 绕过 |
| 附件授权不等于每句必带附件 | 用户可独立问明确概念 | 无歧义文本问题可发送；未附带时不读取屏幕草稿，指代有冲突才澄清 |
| 停止发布不等于从未暴露 | 原回复保存／送达未确认有保守帮助规则 | 帮助同意、生成、发布、送达与曝光分开记，失败／取消不能无条件恢复独立性 |

检查范围：backend/app/models.py、assistant_routes.py、session_access.py、tutoring.py 与 src/assistant/session.ts。只核对代码与文档，未运行功能测试或修改这些实现。

## 2. 权威与版本共同约定

- ID 为稳定不透明身份；文档 hash 不能代替 source ID（相同文件可有不同归属），文件名不用于绑定。
- 同时保存聚合 revision（并发写）及内容指纹（语义有效性）。updated_at 不作版本或意图判断。
- 客户端提交 expected_revision／明确资源引用；服务端校验归属、状态、可见性与当前版本。模型返回的 task／页码／操作均是候选，不能直接生效。
- 每次写入有 command_id 或 request_id；同作用域相同 ID 与相同载荷重放返回已有结果，不同载荷返回冲突。规范化规则和 payload_hash 计算由服务端定义，不能只比较消息文字。
- 用户原话／显式操作、确定性状态、模型推测分别标记 provenance；模型 confidence 不作为授权或掌握证明。
- 不需要把每次滚动写成服务端事件。视图位置可去抖保存；明确任务动作和请求生命周期才进入可靠事件／命令记录。

## 3. 核心对象与字段责任

| 对象 | 最小候选字段 | 权威／保存位置 |
|---|---|---|
| WorkItem 学习事项 | id、course_id、kind(platform_task/external_problem/exploration)、target_ref、title、attention、revision、created_at | 服务端事项记录；平台题 target 指既有 session／task |
| BusinessProjection 正式业务投影 | stage、task_status、is_current、progress_version、task_fingerprint、can_submit／can_tutor及原因 | 每次从既有学习服务读取，不复制成第二套可写真值 |
| Topic 讨论主题 | id、course_id、mode(single/compare/independent)、item_refs、revision、context_revision | 服务端主题；用户切换的焦点是 UI 偏好，不强制全局唯一 |
| Composer 草稿 | topic_id、text、attachment_refs、expected_revision、updated_at | 沿本机／服务端明确存储模式；保存不等于发送 |
| NavigationBookmark | id、origin_view_ref、target_view_ref、item_relation(known/unknown)、必要位置引用 | 默认本机标签页位置；服务端只存已声明可持久部分 |
| Asset 原始附件 | id、course_id、content_hash、mime、size、dimensions、storage_key、upload_state | 服务端隔离文件存储；内部路径不直接作为用户工具参数 |
| AttachmentBinding 附带关系 | id、asset/source/task_ref、role、page／regions、precision、version、supersedes、confirmation | 服务端校验；同原图可有不同讨论角色，hash不是角色 |
| TranscriptRevision 识别版本 | id、attachment_id、version、segments、uncertain_regions、confirmed_segments、method | 保留图像来源；机器识别不等于用户确认或正确答案 |
| Request 生成请求 | id、topic_id、payload_hash、context_manifest_id、state、execution_state、revision、错误／时间 | 服务端独占写；GET可恢复，不调用模型 |
| Message／ToolRun | id、request_id、sequence、role、content／evidence_refs、status、usage_ref | 服务端追加记录；不接收客户端伪造 assistant／tool角色 |
| LearningArtifact | id、kind(note/link)、source_anchor、target_ref、request/message_ref、revision | 复用reader笔记／新关系适配；写入后才称保存 |

这是职责模型，不要求一个对象对应一张表。持久化拆分必须随实现任务评审，避免为草案一次建齐所有数据库结构。

### 3.1 WorkItem 的边界

attention 候选为 ongoing／paused／finished／abandoned，只表示用户整理状态。waiting_user 属于交互等待提示，不与 attention 并成互斥状态。正式题是否答完／通过始终由 BusinessProjection 表达。

- 用户可暂停学习事项，之后恢复；不会改 LearningSession.stage，也不调用评分。
- 用户把事项标记 finished 仅表示自己暂时处理完，不证明正式题通过。平台题正式未完成时 UI 必须仍清楚显示未提交／未通过；首版可只给外部题／探索提供手动完成操作。
- 阅览已推进的旧题允许历史讨论，但不可直接提交到旧轮次；重新正式作答需走既有或后续明确的复测入口。不为支持多个事项暗中重置 current_task_id。
- 打开视图不强制创建 WorkItem；纯概念问题也可只有独立 Topic，明确想保留／继续时再关联探索事项。

### 3.2 附件角色与取材范围

role 候选：question、student_work、reference、document_excerpt、submitted_answer、visible_feedback。客户端声明 role 不是内容可信性，上传“参考答案”仍是用户提供材料；服务端取得的已提交作答与教师数据有独立来源标记。

SourceAnchor = course／source ID＋原件hash＋preview版本＋page＋normalized-top-left区域列表＋precision(page/text/region)。文本是引用或用户片段，精确性单独标记；服务端不能只因有文本就认定它与原页一致。

确认附件授权读取所选内容及已说明的有限背景，不默认包含所有个人批注。检索可在明确课程范围进行，但检索结果不会自动被说成用户附带。发题后改答案不会改消息附件；更新照片产生新绑定／识别版本。

附件生命周期：uploaded → ready 或 rejected；明确确认绑定后才进入请求。文件须按实际类型解码、校验大小／页数和预算，恶意或损坏文件不能靠扩展名通过。精确上限由实施任务书给出并对齐现有50MiB资料上传限制，不等同于允许一次将50MiB图像全部送模型。

## 4. 事件／命令与状态变更

| 事件或命令 | 影响 | 不得影响 |
|---|---|---|
| ViewChanged／TreeExpanded／Scrolled | 标签页路由与视图偏好，必要书签 | Topic附件、正式学习状态、模型调用 |
| ContextCaptureStarted／Cancelled | 临时取材状态；取消恢复此前工具模式 | 已确认附件、个人笔记和草稿正文 |
| AttachmentConfirmed／Removed | 草稿context_revision增加，显示预览 | 已冻结请求、历史消息 |
| ItemPaused／Resumed | 事项attention及恢复目标，需expected_revision | 正式评分、生成执行状态 |
| TopicSelected／NewTopicRequested | 当前UI主题／明确新主题，旧草稿保留 | 其他主题输入与历史 |
| SendRequested | 冻结请求意图、校验版本和幂等键 | 正式作答次数、自动长期笔记 |
| ClarificationResolved／ConsentGranted | 对应请求的有界授权／澄清记录，重新校验 | 课程所有未来题目的通用授权 |
| ProviderResultReceived | 待复核回复与实际用量 | 当前新页面、未校验写入 |
| PublicationCommitted／DeliveryAcknowledged | 可读回复、曝光／送达记录及应有帮助事件 | 自动正式提交／进度推进 |
| ArtifactSaveRequested／UndoRequested | 一次幂等笔记／关系写入或冲突回执 | 原件、成绩、原始对话内容 |

UI焦点不是全局共享事实：一个浏览器切到题B，另一窗口可以仍读题A。发布按请求主题定位，不以“最后打开页面”为目标。同课程的请求并发策略见第7节。

## 5. 上下文包与污染隔离

服务端构建 ContextManifest，包含：

1. schema／request／topic／课程身份与用户明确目标。
2. 目标事项列表及版本、正式业务可见性与独立性策略。
3. 本次消息和确认附件，资产／来源／转录版本及实际图像衍生物。
4. 同主题相关历史消息及明确关联的概念证据；比较主题按事项分组。
5. 检索命中的有效证据与原页定位，不混进教师私有评分字段。
6. include／exclude trace、截断理由、预算、允许工具和副作用范围。记录引用与hash，不重复复制无限图片。

默认排除：其他题的照片／答案／局部解法、其他课程材料、被用户否定的识别前提、未确认新附件、未公开参考答案、失败工具当作结论、个人未授权笔记。摘要保留来源和范围，不因压缩跨越隔离边界；明确比较才纳入两题。

上下文有两层快照：**输入意图**在请求接受时冻结；**实际证据集**在检索／补读后追加版本化并在模型调用前固定。后续工具新增证据产生可追溯增量，不重写最初用户附件。每次模型调用记录其manifest版本，工具结果不得偷偷改变任务。

waiting_input 的补充以追加的 resolution 事件表达，保留原输入与幂等payload_hash；在未派发前构建新的有效manifest版本。若用户改变了原目标、照片或问题本身，而非回答原澄清，则取消未派发请求并以新ID建立新请求。派发后任何输入修订都只能成为新请求，旧结果仍归旧快照。

教师侧专用上下文通过教学适配器在授权检查后单独提供，仅给必要教学执行角色，不能经通用上下文trace／前端GET泄露。用户草稿是学生输入，不自动作为正式 LearningAttempt；教师知道答案也不意味着用户可提前看到。

## 6. 请求生命周期与不确定执行

候选状态与 allowed transitions：

| 状态 | 可进入的下一状态 | 含义 |
|---|---|---|
| accepted | waiting_input／queued／blocked／cancelled | 已持久化ID和输入意图，尚未保证可调用 |
| waiting_input | queued／blocked／cancelled | 等待具体澄清或同意；补充后重校验，不在等待时持有DB事务 |
| queued | preparing／cancelled／blocked | 可以执行但尚未派发模型 |
| preparing | running／waiting_input／failed／blocked／cancelled | 取证据及工具；工具已派发产生未知副作用时不能简单cancelled |
| running | validating／failed／interrupted_unknown／cancel_requested | 至少一次外部模型／专家调用已派发 |
| cancel_requested | cancelled／interrupted_unknown／validating | 取消不保证上游已停；结果到达也不自动发布 |
| validating | published／stale／failed／cancelled | 校验来源、任务、权限及输出；取消已获确认时不发布 |
| interrupted_unknown | validating／failed | 有可靠结果可恢复复核；明确可判失败才failed，绝不自动重派原调用 |
| published／stale／blocked／failed／cancelled | 无自动回到运行 | 终态，追加交付／审计信息不改写历史；重试另建请求并带retry_of |

execution_state另记 not_dispatched／in_flight／result_received／unknown。cancelled或failed不能隐含上游零费用；工具／模型调用各自有 attempt_id 和用量／未知账单标记。客户端断网只代表传输失败，不直接改变服务端状态。

- 同request ID＋同payload返回已有状态；同ID不同附件、课程、上下文／题目版本或同意引用冲突。重试只重读状态不会再付费；决定重新生成时显式用新ID并提示可能重复成本。
- 不在长时间模型调用中持有SQLite写事务。按短事务checkpoint提交，使用revision条件更新确保旧worker结果不能覆盖新状态。首版明确单API／有界执行进程，不宣称已有多实例租约。
- 重启后 queued 可安全排队；派发前后不确定窗口以interrupted_unknown保守恢复。仅有内部“准备派发”标记不足以证明供应商没执行，不承诺exactly-once。
- 生成中用户换页面无需取消。若正式题推进被原running带学保护，保留保护；不能为了展示S18而强制绕过。S18仍适用于允许的另一事项／外部题／视图切换。

## 7. 并发、进度版本与帮助

- 同Topic首版最多一个非终态请求，第二请求返回409及active_request_id，不静默丢弃或排队拼接消息。不同Topic可有界并发，受课程／模型预算限制。这个“首版”是实施建议，容量数值后续定。
- 同一正式task的帮助／提交并发继续受原服务保护，即使来自不同Topic也不得绕过；按topic锁不足以保护题目。锁与租约只控制执行，不代替业务version。
- 校验版本区分：用户请求接受前的progress_version；授权／接收本请求产生的预期变化；生成前后任务内容、来源和公开范围。自身TutoringTurn／同意事件改变progress_version时，保存调整后的基线并说明，只忽略可证明来自本请求的变化。
- 用户明确转带学的记录绑定task／受影响版本及policy_revision；澄清／同意后来源或题目变化要重新评估。既有同一题历史帮助不能因新请求取消而清除。
- 纯导航／上传暂存不计帮助；解释的实际暴露沿原保守语义。保存可读回复、流式片段或展示解题关联均可能产生曝光，需要统一生命周期记录；首版建议整条结果复核后发布，暂不流式泄出未校验内容。
- 仅“生成但未可见”不等于无帮助：需按实际发布／交付状态判定；无法确认送达的已发布帮助不得当作独立性恢复。专用带学失败时已发生的同意／帮助事件也不能抹掉。
- 无关联文本／新主题不能成为避开测评规则的入口，但系统也不能保证识别用户隐瞒的所有场外行为。能确定与受保护题相关时走相应授权；疑似相关且会暴露解法才澄清；无关界面支持不误计。

## 8. 候选 API 与信任边界

均为独立候选 v2 路由，具体命名后续实现审查；旧schema1／preflight继续可用，不把预检“canSend=false”改名就当真实发送完成。

| 操作（/api/courses/{course}/assistant/v2 下） | 必要输入／输出 | 副作用边界 |
|---|---|---|
| GET /items、/topics | 分页、有效身份、revision和能力投影 | 只读、不建任务或调用模型 |
| POST /items 与 /items/{id}/commands | command_id、expected_revision、明确start／pause／resume意图 | 只改事项；正式学习操作走原接口 |
| POST /topics、PATCH /topics/{id}/composer | 目标范围、revision、草稿／附件引用 | 保存不发送，不允许写assistant/tool消息 |
| POST /assets、GET /assets/{id}/status | 文件及声明元数据、服务端校验回执 | 只上传／预处理，不自动OCR收费或加入Topic |
| POST /bindings | topic／asset或原资源引用、role、版本、确认信息 | 服务端取目标快照，不信任客户端学生文本作权威作答 |
| POST /topics/{id}/requests | request_id、expected_topic/context_revision、message、binding_ids、目标／policy引用 | 冻结并受控执行；不能传服务器指令或任意工具名 |
| GET /requests/{id}、/topics/{id}/messages | 状态、可见输出、引用、usage与可执行动作 | 重读无生成；隐藏教师／内部路径／思维链 |
| POST /requests/{id}/resolve | command_id、request_revision、澄清选项／同意引用 | 仅恢复等待请求；不改已派发输入，冲突重建请求 |
| POST /requests/{id}/cancel | command_id、expected_revision | 返回真实取消或未知状态，不承诺停止计费 |
| POST /artifacts | command_id、message／action_id、目标anchor、expected_target_revision | 再校验、去重、回执；不任意写原件或注入HTML／代码 |

通用错误code候选：revision_conflict、context_stale、scope_mismatch、resource_unavailable、unsupported_media、needs_clarification、consent_required、budget_exceeded、execution_unknown。HTTP与语义分开：等待澄清／同意可作为已接受请求的waiting_input；格式错误422、归属错误按现有404／403策略、并发和版本409、已失效资源410、容量413／配额429。后续需统一选定，不让同类错误因入口不同含义冲突。

读文件工具只接受服务端资源ID与受验证区域，不接受任意本机路径／URL。附件与资料内容是数据，不能覆盖工具权限、扩大scope或触发写操作。当前本地单用户的course归属检查不等于多租户鉴权；未来账号隔离另补，不虚称已具备。

## 9. 专家与工具契约

DelegateInput：request_id、subtask_id、role(interpret/research/verify)、goal、target_refs、manifest_version、authorized_resource_ids、allowed_tool_set、remaining_budget、deadline、禁止动作。

DelegateOutput：subtask_id、input_fingerprint、status、claims、evidence_refs、uncertainties、read_resources、excluded_resources、usage_refs、errors。自由文本不能替代来源ID或决定新任务。

- 调度由统一导师提出，Harness校验；判读结果是检索前提时顺序执行，独立来源可并行。专家失败可给有边界部分回复，不无限递归委派。
- 核查优先有限确定性计算／可核查方法，不直接给Agent开放任意shell或代码执行。若将来提供计算沙箱，单独设计隔离和配额。
- 定位动作是有类型的action_id＋target anchor；默认用户点击，显式打开意图才执行。永久保存需独立save action，模型不能直接新增贴条。
- 预算同时约束每请求和全课程（调用、图片、token、时长）；专家分配共享剩余额度，不能各自复制全额预算。配置不满足能力时拒绝或降级并说明。阈值先留待任务书，不引入未经测量的产品承诺。

## 10. 旧数据兼容与迁移策略

1. schema1 AssistantSnapshot维持原GET／PUT及导出，本机记录不静默上传。新写入入口独立v2，已生成消息／执行状态不能被旧快照PUT覆盖。
2. 旧提问记录映射为legacy user note，标“历史未发送记录”；旧context只作历史关联，不当作当前有效附件或用户新授权。用户明确选择后重新校验并附带。
3. 原TutoringTurn、帮助／同意事件、UsageRecord不重写。新教学请求保存与旧turn的稳定对应，避免统一助手和原入口重复生成／重复计费／双记帮助；该适配未完成前不启用相关通用真实发送。
4. ReaderSnapshot沿原schema和保存规则；导航书签引用其服务端已存状态。新学习链接若新增字段／表，先给迁移脚本、兼容、备份与回退，不能靠create_all假装修改已有表字段。
5. 先在临时SQLite及公开夹具验证迁移与故障，再根据明确授权部署。回退关闭v2写入口、保留新记录只读／导出；不清空旧库／附件，不把回滚当数据回滚。

## 11. S01～S25 映射与契约验证

| 场景 | 主要契约检查 |
|---|---|
| S01 | Bookmark／事项关系，ViewChanged不推进业务 |
| S02 | 手动导航保留关系unknown，不要求强建新事项 |
| S03 | waiting_input与明确附件／指代检查，草稿保留 |
| S04 | independent Topic可无WorkItem／无附件 |
| S05 | 不用时间更新attention或派发模型 |
| S06 | ItemPaused与正式stage／运行请求分离 |
| S07 | 新事项／主题的范围隔离，旧业务current规则保持 |
| S08 | 恢复前查权威版本和can_submit，历史不可擅自改当前 |
| S09 | compare分组manifest，各正式题policy分别检查 |
| S10 | course scope、过期响应和主题草稿隔离 |
| S11 | 等待用户提示不创建Attempt／模型轮询 |
| S12 | Binding角色／确认、未提交、图片真实输入 |
| S13 | external_problem与用户参考材料的可信性 |
| S14 | supersedes／转录版本、冻结附件和顺序 |
| S15 | uncertain_segments与用户修订，机器识别非真值 |
| S16 | 页／图像衍生物、文字与视觉证据及精度 |
| S17 | 临时capture与已确认binding分离 |
| S18 | Request归属固定、业务running保护、结果不抢页 |
| S19 | payload_hash去重、interrupted_unknown与显式retry_of |
| S20 | 发布前指纹／权限复核，stale非当前可用回复 |
| S21 | 服务端教学策略、同意／曝光、跨入口适配 |
| S22 | 提交原答／反馈可见性与正式复核服务 |
| S23 | 独立action、目标revision、写入去重与撤销 |
| S24 | 修订版与撤销授权、不重写历史请求输入 |
| S25 | 共享预算、专家错误／部分输出、停止条件 |

静态检查需验证每场景均有对象／命令／保护映射。未来测试至少涵盖：同ID异payload、派发边界崩溃、两个标签页同topic／同task竞争、自产进度版本变化、教师字段前端不泄露、legacy记录不冒充回复、不同任务污染、附件确认后又修改、发布与送达分离。只测DTO能序列化不算状态契约通过。

## 12. 建议实施切片及尚待定稿

1. **无模型状态底座**：WorkItem／Topic／Binding语义、上下文manifest、旧记录只读映射、助手内取材、路由独立性。使用Mock证明非线性隔离，不新增付费调用。
2. **请求与教学适配**：请求状态机、幂等、故障恢复、帮助／教师可见性与原带学同一事务边界。先Mock／临时库后限定真实验收。
3. **多模态与证据**：受控照片、区域视觉、转录修订、课程检索、引用与定位；真实质量另列预算和样本。
4. **按需专家与学习产物**：有收益再扩委派，独立核查、保存笔记／双向关联及撤销。网络检索继续独立范围。

这些是设计拆分，不是已创建任务。仍需定稿：具体持久表与路由名称、同时请求上限／资源预算、附件大小／保留与删除策略、主题恢复UI、事项手动完成范围、HTTP错误统一和原带学的逐步适配方式。无需先引入LangGraph或多个常驻模型；如选择框架必须保持本契约的事实与权限边界。
