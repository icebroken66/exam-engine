> 历史归档：仅供追溯，不作为当前排期、授权或验收门槛。当前依据：[核心功能与开发基准](../../../核心功能与开发基准.md)。原始字节见归档备份及清单；正文仅追加本提示并修正迁移链接。

# FE-V06 实施与验收报告

2026-11-23（北京时间）。状态：本卡开发与工程验证已完成，待用户完整路径试用／视觉评审（C20）；不标全卡已完成，不启动新任务。

用户授权原话：“暂时完成任务书开发任务，别擅自开启新的开发任务”。仅落实 FE-V06；无真实模型调用、无正式学习库操作、无提交／推送／发布。

## 1. 工作区与边界

实际 HEAD：ff7bac3c72568b3fce6a21b2cf0b9f475b360894；本轮在原有脏工作区实施，无新提交。开工已记录 data/acceptance-reader-fev06/baseline-head.txt、baseline-status.txt、baseline-tracked.patch；保存前置用户文档、reader／assistant／后端表等既有未提交实现，未清理或重置。

基线未跟踪文件没有在首次写入前完整逐文件留副本，不能宣称有可重建的全量开工快照。最终源码202文件 SHA256、工作区状态、tracked diff、系统与测试汇总见同目录 source-sha256.json／final-status.txt／final-tracked.patch／summary.json；维护报告另含执行时源码指纹。前置 FE-V03～05 的历史通过记录仅作为契约输入，本卡重新执行测试。

本卡改动：App 默认／深链处理、SourcePanel 单一资料清单与 ReadingResume、lib/materials 与测试、reader_routes 只读摘要、共享 theme／原样式层级、Review 返回语义、UnifiedAssistant／ServerAssistant 管理层级、对应测试／验证脚本及本报告。保留前置表与 schema=1，不新增数据库字段／表或迁移。开发任务书原稿保留。

## 2. 路径与可操作样板

改前：课程默认 learn；资料列表排在完整性／上传／网络区后；侧栏无身份实验入口；标题非阅读链接；助手常驻全部管理按钮。

改后：

- 点课程／创建／恢复默认 materials。明确 learn、learn?session、history、原阅读 HTML 查询参数保持；只有 course 的 hash 默认资料，含 session 而未给子路由时练习优先。错误／归档课程身份不默默跳到另一门课程。
- 有资料首区为真实最近保存阅读、文件名搜索、全部／可阅读／需处理、资料行；上传、解析完整性、网络补全按需展开。空课程上传优先。零搜索结果与无资料区分。
- PDF 标题与阅读主按钮一次进入 course/source 工作台；queued／failed 的 PDF 可打开校验，不宣称解析成功。其他格式下载原件，PPTX人工导出PDF提示。原件损坏／缺失／加密／移除仍走既有真实读取校验。
- 搜索和筛选按 course 写 sessionStorage；返回／刷新／历史恢复，另一课程不串。可阅读意为 PDF 候选、打开时校验，不提前全量读原件。需处理包含解析未 ready 或不支持工作台阅读的文件；搜索仅文件名。
- 阅读器顶部“返回课程资料”由 URL course 构造；课程／文件名由真实元数据与文件栏显示。本机实验无身份路径继续可直达但正式导航移除，不迁移本机笔记。
- 默认资料首访不挂载 LearningPanel，不触发学习计划读取；既有练习访问后的组件与进度保留。
- 助手模式持续可见，切换在“会话与存储”；导出、复制、预检、重载在本机／服务端会话管理。错误时恢复区展开，CAS／幂等／复制空会话限制与确认保持。仍只记录问题，不发送AI。

可操作样板：以 tests/fixtures/reader/mixed.pdf 为公开合成样本；tests/reader/materials-integration.spec.ts 使用同一有资料课程与空课程，覆盖正常和失败；scripts/verify-course-reader.mjs 启临时 API／SQLite，公开夹具上传后从全新浏览器冷进入摘要恢复。运行 npm run build 后可执行 npm run test:reader -- --grep FE-V06；真实联通 node scripts/verify-course-reader.mjs 自行启动并关闭隔离进程。开发实验入口 /reader-workbench.html，仅本机。

最终视觉规范维护在 design.md FE-V06节，免费BoardUI来源及许可在 src/reader/boardui/NOTICE.md／LICENSE；无新依赖／Pro／全项目init。主站旧CSS放入同一legacy layer，真实BoardUI utilities优先；不是再加全局覆盖补丁。旧校题／统计／教学内容不作深度迁移。

## 3. 只读摘要契约

GET /api/courses/{course_id}/reading-summaries。

响应示例：{"courseId":"c1","items":[{"sourceId":"s1","name":"讲义.pdf","sha256":"原件登记SHA256","previewVersion":"pdfjs-6.5.438-normalized-v1","page":2,"revision":1,"updatedAt":"2026-11-23T08:00:00Z","readOnly":false}]}。

有效课程无快照返回 items=[]，课程不存在404；归档返回readOnly=true。限20条，查询最多检查100条候选，按快照updated_at倒序、source ID稳定排序；不是最近打开统计。更新时间统一UTC，界面按浏览器时区展示。页、缩放、滚动、批注不在摘要里重造，打开仍从原有reader端点恢复完整已确认快照。

过滤course、未移除source、PDF类型（大小写兼容）、source_sha256、preview version、revision>0、schema1、快照document ID／version和有效保存页范围。SQL JSON字段投影只取必要元数据，不获取批注／正文，不读原件，无逐文件N次请求。只有课程查询和一次有界projection；不创建快照、不写updated_at、不解析、不调用模型／写学习事件。摘要无法证明磁盘健康，打开再次校验原件及生命周期。摘要失败只提示并可重试，列表／手动阅读可用。

真实临时API结果：data/acceptance-reader-20261123-fev06-live-1795423415199/live.json，Edge／Chrome均passed；包含全新context从课程摘要进入第2页、真实保存／409／断网重试、助手服务端跨context恢复与冲突、预检无模型。summary GET前后读取完整snapshot结果完全一致。

## 4. 本卡实际测试

环境 Windows 11 10.0.26200、Node v24.13.0、Python3.12.16；Edge158.0.4370.33、Chrome157.0.8103.79（精确浏览器值以native/results.json与live.json为准）。日期均2026-11-23，北京时间。未运行收费模型或私有课程验收。

| 运行 | 实际命令／结果 | 证据 |
|---|---|---|
| 第一轮整合 | READER_RUN=fev06-first npm run test:reader -- --grep 'FE-V06|FE-V03|FE-V04|FE-V05'，84通过 | data/acceptance-reader-fev06-first/playwright.json |
| 全量阅读 | READER_RUN=fev06-final npm run test:reader，222通过、12仅真实焦点场景跳过 | data/acceptance-reader-fev06-final/playwright.json |
| 真实焦点补跑 | READER_HEADED=1 READER_PORT=7174 READER_RUN=fev06-headed npm run test:reader -- --grep 'actual blur|real window blur'，12通过 | data/acceptance-reader-fev06-headed/playwright.json |
| 最终整合补跑 | READER_PORT=7173 READER_RUN=fev06-last npm run test:reader -- --grep 'FE-V06|FE-V03|FE-V04|FE-V05'，90通过（含新增竞态／深链） | data/acceptance-reader-fev06-last/playwright.json |
| 维护全套 | npm run test:maintenance，七步骤全通过：224后端、24前端单元、21旧UI、runner-contract／构建／SQL／signals | data/acceptance-reader-fev06/maintenance-report.json；临时路径 exam-engine-maintenance-AaWtMx |
| 最后后端补充 | .venv/Scripts/python.exe -m pytest backend/tests/test_reading_summaries.py -q，4通过；追加原件损坏／密码PDF真实校验，无生产代码变更 | data/acceptance-reader-fev06/summary-tests-last.log |
| 真实API联通 | node scripts/verify-course-reader.mjs，双浏览器通过 | 上节live.json、live-final.log |
| 原生浏览器缩放 | node scripts/verify-materials-native.mjs（7199 preview），双浏览器×三CSS尺寸×100%/125%，12组通过；贴条独立canvas参照最大0 CSS px | data/acceptance-reader-fev06-native/results.json、native-capture.log |
| 源码／差异 | git diff --check通过；最终指纹 | data/acceptance-reader-fev06/source-sha256.json、summary.json |

维护通过后仅追加一个后端测试并单独运行，生产源码未再改变；最终真实API及缩放运行使用同一生产构建。全量reader回归后Button无preflight reset小改由最终90项、12焦点和原生缩放覆盖；不将旧截图当最终源码。

原生缩放方法：临时profile per_host_zoom_levels，CSS viewport实际调整至1024×768、1440×900、1920×1080，断言DPR相对倍率、CSS zoom=1及visual scale=1，不用DPR模拟充当缩放。为避本机物理屏幕尺寸上限，矩阵采用已安装真实Edge／Chrome headless及CDP窗口调整；另有headed焦点矩阵。Chromium截图在125%时API裁剪单位与实际缩放不同，最终使用CDP visualViewport尺寸捕捉完整表面；非页面修复。

### 失败与修复保留

- 首次维护20/21 UI通过：新增直接错误提示与折叠解析详情有两个status-reconnect，旧测试strict locator失败；改为可见元素定位，复跑21/21通过，未删断网断言。旧日志 exam-engine-maintenance-A2mnLq 与 maintenance.log 保留。
- 首轮截图发现原生按钮边框、链接下划线及旧样式抢优先级；原CSS迁入legacy layer，Button加无preflight基础reset，最终构建与回归覆盖。
- 原生缩放第一次headed受物理屏幕限制，实际CSS高度差109，脚本立即失败；改headless实际浏览器窗口后12组通过。第二次清空UI存储但复用了已挂载组件，旧偏好保存在组件中；脚本先about:blank再入，最后通过。均为验收脚本问题，日志native-screen-limit／native-second／native-third保留。
- 125%截图右侧截断经DOM几何断言和CDP对照确认为截图API裁剪单位；最终CDP完整截图保留。没有通过CSS补偿坐标。
- FE-V04跨窗口Quota测试有意访问未mock的新页面reader导致proxy ECONNREFUSED日志；是隔离夹具预期失败面，测试验证未保存草稿保护。不会接正式库，非正式服务实际运行报错。

## 5. C01～C20结果

| 项 | 结果 | 本卡证据／说明 |
|---|---|---|
| C01 | 工程通过 | materials-integration cold resume；empty／materials三尺寸截图；1440首屏真实文件与阅读可见 |
| C02 | 通过 | 标题与主按钮同一身份URL，cold路径一次点击 |
| C03 | 通过 | failed／queued PDF列表与真实PDF读取不依赖解析，摘要后端failed样本 |
| C04 | 通过 | 前置reader API本卡重跑missing/hash/remove；新增损坏及密码PDF真实422，PPTX无阅读主按钮，失败可返回 |
| C05 | 通过 | 名称搜索、组合、零结果、清除、跨课程偏好与单元测试 |
| C06 | 通过 | 上传中原文件仍可点、disabled防重复、部分失败显示；多文件与folder input保留webkitdirectory；旧上传失败恢复用例通过 |
| C07 | 通过 | 空摘要不占位，冷进入课程摘要真实page2／revision1；时间明确最近保存 |
| C08 | 通过 | 真API全新context继续第2页；course-reader恢复缩放／位置／笔记；摘要hash／preview／移除过滤API测试 |
| C09 | 通过 | 课程→阅读→明确返回、刷新、历史、草稿；未保存保护沿原实现，本卡失败／冲突重跑 |
| C10 | 通过 | 延迟c1摘要后切空课程不串、summary503列表可读、AbortController+active guards |
| C11 | 通过 | 默认课程资料、显式learn?session保留、invalid不串课程、历史阅读HTML保留，正式导航去实验入口 |
| C12 | 工程通过／待用户视觉认可 | shared tokens／BoardUI复用及三尺寸五场景截图；原画布／自定义色未改 |
| C13 | 通过 | 本机／服务端当前模式、主要草稿与记录、折叠可键盘达；无模型真实说明 |
| C14 | 通过 | server-assistant本卡矩阵＋临时API重跑；显式确认、空会话复制、跨新context恢复 |
| C15 | 通过 | 409／断网／schema／归档API与浏览器回归，当前草稿与导出／重载直接可达 |
| C16 | 工程通过 | 三CSS尺寸与原生125%，无应用横向溢出、冲突区按钮可达；composition／焦点原测试重跑 |
| C17 | 通过 | 全量reader222＋headed12、precision／feedback／unified-session；无新学习／模型副作用 |
| C18 | 通过 | 新只读接口SQL投影／无原件读取与写入测试、实际临时API冷恢复，不仅Mock |
| C19 | 通过 | 维护全套、全量受影响、最终补跑、构建；浏览器资源断言默认不加载ReaderLab／pdf.worker |
| C20 | 待用户反馈 | 仅有开发授权原话，无本轮实际操作反馈；未编造满意度，未标全卡完成 |

## 6. 截图、限制与回退

最终三尺寸五场景×双浏览器×两种缩放截图：data/acceptance-reader-fev06-native/{channel}-{zoom}-{width}-{empty/materials/reader/assistant/conflict}.png；全部被data/忽略。1024、1440、1920代表图已查看，125%完整冲突表面及恢复动作可达。阅读继续／解析失败／原件读取失败另见fev06-last的materials-integration目录。所有截图只含公开合成资料／测试草稿。

本轮没有在第一笔写入前捕捉同数据、同视口的旧版五场景全套截图；已有历史截图不能冒充满足该改前／改后要求。这是交付证据缺项，已明确保留，不重建或伪造旧视觉。最终可操作样板和五场景三尺寸证据齐备，仍需用户C20实际评审。默认reader完整包仅进入阅读入口加载，依赖拆分维持现有方案，不宣称完成性能深度优化。

摘要服务需要重启新版后端；没有数据库迁移。服务端意为当前本地单用户后端，不是公共云／账号同步。快照摘要检查登记hash但不提前检查物理原件健康，点击再次校验。全站旧教学区域视觉、手机、暗色完整实现、真实AI回复／联网／自动PPTX转换均未开展。

回退仅撤本卡App默认／布局、摘要路由和共享主题调整；必须按本卡文件及基线差异操作，不能git reset清空原脏工作区。保留reader_snapshots、assistant_snapshots、原件、schema1与本机命名空间。无逆向迁移需要。当前停在FE-V06待用户试用；不创建或推进下一开发任务。
