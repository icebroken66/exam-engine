> 历史归档：仅供追溯，不作为当前排期、授权或验收门槛。当前依据：[核心功能与开发基准](../../../核心功能与开发基准.md)。原始字节见归档备份及清单；正文仅追加本提示并修正迁移链接。

# FE-V10 实施与验收报告

2026-11-23。用户授权继续完成FE-V10。分层状态：工程及隔离Mock通过；真实模型质量未运行；本人短试用未运行。正式库未操作，付费尝试0。不能标整卡完成。

## 实现及兼容

沿ConversationPanel／conversationStore同一入口增加真实请求适配、服务端消息、停止、显式重新生成、请求恢复、引用核对及返回路径。未配置／未启用／只读／区域附件／预算不足显示真实边界；无课程本机工作区不请求课程API。普通Enter和中文组合不发，Ctrl／Cmd+Enter发送。Markdown模型链接及图片不访问外部地址。继续输入和切换主题不被回执清空；丢接受回执保留完整同ID载荷，刷新可显式确认。

请求和消息独立两表，保留既有草稿及schema；Manifest仍只读且不调用模型。request_id和规范载荷哈希幂等；接受与一条用户消息短事务提交。单API进程2worker／4等待，运行槽和提交队列均有界。最多一个Topic非终态请求。派发前网关回调再次核验停止／目标及教学基线；ModelGateway单次模式关闭JSON重试、HTTP重试和Node回退。模型调用时不占SQLite写事务。60秒未知不自动重发，未知用量保留保守预留；读取及轮询无生成。服务重启不重新排队派发。

PDF逐页提取、原件hash／preview／页码／归属核验。仅白空格规范化后匹配才标verified_source_text，保留原始用户文字、服务端页内片段、规范化和指纹。当前只包含明确片段，不偷偷扩到相邻页；重复文字和无准确文字框一律页级定位。无法匹配经明确选择成为user_provided_text，没有PDF定位按钮。纯区域／扫描／图表不执行OCR或视觉理解。

claim逐段绑定Evidence；未知ID、引文不匹配、无来源段落、自造页码、网址或本机路径均不发布。来源动作由服务端白名单构造，点击重验来源和版本；题目／作答在助手打开对应公开只读记录，不修改current_task_id。原资料定位复用ReaderLab临时指示及返回状态，不写个人批注。引用ID有效不是语义事实核验，证据支持关系仍待人工真实评测。

平台题经原帮助来源检查与重测同意；每题创建TutoringTurn复用正式提交／推进的running保护；两题分别检查后一次导师生成，稳定uuid5映射到每题，复用同一UsageRecord，不调用旧send。发布按worked_answer保守计帮助，不把学习对话当掌握证据。已完成且有判分的历史题可在明确比较中只读讨论；未满足条件的题不生成。

迁移、回退及DTO见[接口契约](../阶段任务与契约/FE-V10_接口与迁移契约.md)。正常启动不创建新表；迁移脚本要求显式数据库URL与全新SQLite备份路径，check-only不迁移。重复执行校验旧字段保持；回退关闭ASSISTANT_GENERATION_ENABLED，保留新表和只读历史。基线data/acceptance-fev10/baseline.zip；保留用户原有未提交工作。

## 验证与失败留痕

进入条件按一轮桌面路径完成：使用scripts/verify-assistant-repairs.mjs，真实临时SQLite、Edge、模型调用禁止，验证取消／确认、草稿恢复、换题、新对话与比较。证据data/acceptance-fev09/repairs-1795441333447。CUA工具连接关闭，未把工具失败冒充桌面检查；改用已有真实浏览器脚本。

本卡新增后端生命周期及范围测试、真实文件SQLite并发重放／备份迁移、四类附件、重测同意、帮助映射、正文保存失败、停止窗口、超时未知、提示注入、伪造引用和真实运行守卫。前端新增冻结输入／双击／丢回执／刷新载荷恢复／切主题测试。真实API脚本自建公开课程和临时库，结束只关闭自身服务。原生缩放写Chromium per-host zoom profile，实测DPR相对倍率、CSS zoom=1及visualViewport.scale=1，不以DPR仿真代替浏览器缩放。

已发现并修正：

- 读取消息和状态分两次快照可出现“状态已发布但列表未含回答”，统一与发布互斥；保留首次失败截图／日志。
- 两题同session映射同请求ID撞旧表唯一键，改每题稳定uuid5；一模型调用、两题帮助均保留。
- 取消排队请求不能释放无限内存排队，增加独立6槽提交上限。
- 原native脚本在about:blank测窗口后才加载host缩放，125%尺寸不准，改先加载host再适配窗口。
- 引用返回路径补验发现定位处理及阅读状态保存时序问题；同文件采用独立定位事件、读取最新阅读状态，跨资料仍走受保护路由。测试等待真实阅读状态保存后返回，保留未存笔记保护，不绕过guard。
- 原FE-V02工作台回归依赖旧演示DOM，改显式assistantDebug=1，完整保留草稿、笔记、焦点、恢复及零API断言。
- 未配置价格专项测试受维护入口显式Mock零价格影响，夹具显式移除价格配置后验“未知=null”。未改变生产费用语义。

失败目录与原始日志均在data/acceptance-fev10，不删除失败或降低保护断言。

## 真实模型与本人体验

固定12开发＋6保留，保留项各独立2次；每项原题、可见材料、正确点、禁止字段、引用和五维rubric在evals/assistant-v10。固定自制PDF和两道公开题由隔离fixture生成；未使用私人资料。真实执行配置v10-eval-1：openai-compatible／gpt-6-luna；最多36尝试、总token200000，单次输入保守上界12000／输出1500，60秒；金额未知。见[执行配置](../../../../evals/assistant-v10/execution.md)。

scripts/evaluate_assistant_generation.py默认仅输出计划，未确认配置即使传--live也拒绝。显式run-directory保留跨次台账、所有provider原始响应、用量及未知预留；保留集需要开发集人工通过文件。当前仅运行计划输出，真实尝试0。未填写质量通过或本人认可。约20分钟本人试用仍需用户自然操作，不以自动化代替。

## 最终复核结果

维护七步全部通过，报告data/acceptance-fev10/maintenance-final/report.json：后端266项、前端53项、既有模拟API界面23项，TypeScript/Vite、runner-contract、SQL、signals通过。追加最新前端构建及53单元通过，见build-verified.log／unit-verified.log。新后端生成专项26项通过，见generation-roles-final.log。既有阅读器／旧样板三尺寸×Edge／Chrome合计42项通过，reader-final.log及data/acceptance-reader-fev10-core-final/playwright.json。

原生100%／125%×三尺寸×Edge／Chrome共12组交互通过；同时真实终止已派发进程、同库重启、重复GET保持interrupted_unknown，provider-dispatch台账无新增，上游用量unknown且不写0费用，见native-durable-final.log及browser-1795444360822/results.json。包括长文／公式、普通Enter与组合事件不发送、Ctrl+Enter、引用页1→返回原页2、丢接受回执同ID、下一条草稿、取消迟到输出、刷新及换主题隔离。浏览器原生中文输入法本人操作仍留试用，不将组合事件模拟称作真人IME体验。

截图复核发现Playwright默认原生缩放截图可能只截CSS尺寸的一部分，已改用CDP完整visualViewport截图；另清理接受恢复成功后残留的旧Failed to fetch提示，用户只看当前恢复状态。最终CDP完整截图及12组交互、真实进程重启复核全部通过，见data/acceptance-fev10/native-capture-final.log及browser-1795444641574/results.json（24张截图）。已目视复核1024×768原生125%的完整面板，正文自身滚动，关闭／输入／发送可见。


## 当前验收分层与使用

| 层 | 状态 | 边界 |
|---|---|---|
| 工程及Mock | 通过 | 固定流程、并发、生命周期、引用动作、桌面尺寸；不证明真实教学质量 |
| 真实模型质量 | 未运行 | 缺本次模型与总预算确认，provider尝试0；不能以Mock冒充 |
| 本人约20分钟试用 | 未运行 | 需用户按自然节奏完成，不代填认可 |

可复现：npm run test:maintenance；npm run test:reader -- tests/reader/reader.spec.ts tests/reader/workbench.spec.ts；构建后设置FEV10_NATIVE=1执行node scripts/verify-assistant-generation.mjs。脚本自建临时SQLite和公开材料；默认模型网关仅Mock。旧FE-V09修复脚本仍保留。

公开预览保留于http://127.0.0.1:7208/（临时Mock，非正式库，API8038，data/acceptance-fev10/public-preview/preview.db）。页面和回答明确MOCK流程样本。桌面App开页工具连接关闭，提供直接URL供用户打开，不宣称已自动开页。

最终公开预览直达：http://127.0.0.1:7208/#/courses/462bb56a-8fac-4ae6-b5b6-7e1d13d00e16/reader?source=32e03b92-978f-4f2e-a127-e93de01586f7 。仅Mock，不计真实质量或本人认可。执行配置仍awaiting_user_confirmation。下一步仅确认有限真实评测预算，不自动开展图片、检索或多专家。

## 2026-11-24 真实测试续作

已获明确授权，累计22次／32218 token，费用未知，未知预留0。开发场景均有可恢复结果，引用身份与动作复核通过；D03／D05／D11部分论断超出引文支持，AI辅助初审不等于人工通过。保留集与本人试用未运行。最新状态见[真实测试续记](../模型评测历史/assistant-v10/真实测试续记_20261124.md)。前文真实尝试0与配置待确认为历史状态，由本节更新。
