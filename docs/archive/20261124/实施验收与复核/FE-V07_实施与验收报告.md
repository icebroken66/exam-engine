> 历史归档：仅供追溯，不作为当前排期、授权或验收门槛。当前依据：[核心功能与开发基准](../../../核心功能与开发基准.md)。原始字节见归档备份及清单；正文仅追加本提示并修正迁移链接。

# FE-V07 实施与验收报告

日期：2026-11-23（北京时间）。本卡开发已实现，工程验证已通过（全量258、最终整合138、维护全套）；D21用户实际完整路径／视觉反馈待补，不能标全卡已完成。FE-V06原待评审状态保留。

用户授权原话：“完成任务书开发任务，别擅自开启新的开发任务”。本轮仅FE-V07，未开启后续卡、未调用真实模型、未操作正式学习库、未提交／推送或发布。

## 1. 基线、来源与范围

HEAD保持 ff7bac3c72568b3fce6a21b2cf0b9f475b360894。开工在大量前置未提交实现／文档上执行，未清理／重置。首次写入前将全部tracked和非ignored untracked文件归档 data/acceptance-fev07/baseline.zip，并保存baseline-sha256.json、baseline-head.txt、baseline-status.txt；本卡delta可与baseline精确区分。最终source-sha256.json、delta-from-start.json、final-status.txt及tracked.patch／summary.json在同一被忽略根目录。

读取了FE-V07、FE-V06实施报告、reader/workbench/AGENTS.md、实际BoardUI skill与components参考，保持前置schema1／CAS／助手存储契约。BoardUI Tree View实际免费registry下载到证据目录tree-view.json，tree-view.tsx／menu-styles.ts作为真实源码复用，MIT原许可及适配记NOTICE。无全项目init、无Pro、新依赖或数据库变更。橡皮擦仅整笔，未做线段分割。

## 2. 实现契约与入口

### 状态图

浏览器hash → App(course,view,source,session) → 中央overview／materials／reader／learn／questions／history／analytics。

课程树(expanded和各course列表缓存) → 箭头只改expanded；名称请求overview；文件请求reader；当前选中由route推导。Tree焦点不改App身份。资料来源目录仅作辅助／同名区分，不创建虚拟课程章节。中央ReaderLab唯一持有PDF、批注、页／比例／位置／历史／保存状态；统一助手仍为App唯一外壳，显式附带才改变上下文。

- 正式路径 #/courses/{course}/overview；点课程名称默认总览，覆盖FE-V06默认资料旧规则。明确materials、learn?session等深链不强制改总览。
- 文件标题、资料主阅读动作和树文件单击进入 #/courses/{course}/reader?source={source}；动态import CourseReader／ReaderLab，不渲染双阅读器或iframe。原reader-workbench.html?course=&source=及实验reader-lab.html兼容保留；正式导航无本机实验入口。
- 中央阅读保留共享头部、课程树和统一助手，隐藏课程大标题／Tabs；“返回课程资料”明确返回同课程。阅读失败仍显示身份错误、重试及返回。不支持格式进入资料管理并显示具体文件说明和下载入口，不打开空阅读器。
- 总览仅复用现有GET learning-sessions/current、reading-summaries和资料列表；未完成实际session才显示继续练习，链接保留真实session ID。空记录／读取失败区分，查看不创建session／触发学习计划。练习和题目校准为不同入口，历史／考点／归档／永久删除保留。
- 树按展开课程读取列表；缓存、controller按course分离，晚响应只回本节点，折叠不改变中央内容。错误节点Enter／点击重试，85文件测试末项可滚动到达；无原件预读。上传／移除后course:sources-changed使已展开节点刷新；原归档／恢复及权限检查保持。
- 列表读取可在总览与树各一请求，非N次原件读取；无新增后端接口。所有课程数据仍由原服务端GET获取，未扩大学习规则。

### 左右面板

左256／右340 CSS px参与grid；小于1250px时右300且打开助手暂收左，顶栏有说明／恢复按钮。宽屏自动恢复left偏好；窄屏点展开左则关右，避免中央狭缝。左右状态分别保存exam-engine:panels:v1；树expanded为exam-engine:tree:v1；schema1、坏记录回退，Storage失败不阻断，无笔记命名空间清理。助手关闭回触发器，不更改会话上下文。嵌入阅读的助手UI偏好不再自动写reader.panelOpen；独立旧入口仍沿原字段恢复兼容。

### 保存切换保护

所有SPA链接／课程树动作调用reader:before-navigate；hash前后退也检查，未保存／保存中／失败阻止卸载并恢复原路由，显示清楚说明。先blur焦点内贴条，把尚未失焦文字提交原批注状态，再做dirty检查，避免hash变化直接丢字。成功后允许切换，失败可重试／导出／显式载入服务器版本。硬刷新／离开沿beforeunload保护，不承诺强制关闭后的未保存恢复。不提供自动放弃／盲写。

### 整笔橡皮擦

整笔橡皮擦与原工具互斥；4／8／16 CSS px半径，默认8，可视圆圈。真实折线段到连续擦除路径距离，考虑笔宽一半，使用当前DOM page bounds转CSS像素，normalized数据不变。重叠范围内整笔均删；只作用当前页可见ink，高亮、贴条、课件、临时指示不参与；隐藏批注禁用。

按下保存原数组与临时removed集合，移动仅临时隐藏，松开一次changeAnnotations／历史／保存；空白无历史和写入。Esc／右键退出阅读，pointercancel／lostcapture／blur／leave／翻页／换工具／缩放／尺寸／面板变化取消未提交删除；中键只平移。undo一次恢复该手势全部，redo再次删；沿原schema1、回执、失败重试与409保护持久化，不用白色笔刷伪擦除。

## 3. 操作样板与视觉

样板公开夹具 tests/fixtures/reader/mixed.pdf，含3页与不同页面尺寸。路径：课程一总览 → 展开箭头 → 文件单击 → 中央顶部工具整笔擦除 → 关闭／打开左右栏 → 返回资料／练习。树键盘沿真实React Aria treegrid：上下焦点，右展开／入子，左收起／回父，Enter打开对象；箭头按钮独立，不同时切中央。鼠标单击是本卡显式捕获适配，避免原selectionMode=single只选择不打开。

实际规范只更新design.md FE-V07节；不新增竞争总规范。TreeView相对导入、静态默认collection renderer（无motion依赖）、浏览器document.dir、中文chevron名称和无preflight外观reset属于局部适配。已扫描组件源码，保留原MIT。原PDF／笔色不做主题替换。共享App grid在原workspace.css内，嵌入工作台样式不再锁全站html。

截图在 data/acceptance-fev07/native/{channel}-{browserZoom}-{width}-{overview/reader/both-panels/collapsed}.png，双浏览器、三CSS尺寸、100%／125%共12组；contact-1.png／contact-1.25.png为三尺寸拼图，已目视核查。真实冲突与返回另在live目录，初轮失败trace留在fev07-first／third／fourth等目录，不覆盖前卡。

## 4. 实际工程验证

环境 Windows11 10.0.26200，Node v24.13.0，Python3.12.16；实际Edge158.0.4370.33／Chrome157.0.8103.79。测试全部Mock或临时SQLite／公开PDF，无私有课件或密钥依赖；没有新增模型请求。

测试汇总最终机器可核验结果见data/acceptance-fev07/summary.json，命令和逐项证据如下：

| 范围 | 命令／结果 | 证据 |
|---|---|---|
| 单元与维护 | npm run test:maintenance 七步骤通过：225后端、27前端单元、21旧UI、runner-contract、构建、SQL、signals | maintenance-final.log、maintenance-report.json；原临时目录 exam-engine-maintenance-ZvbsBR |
| 全量reader（258通过、12真实焦点另跑） | READER_PORT=7181 READER_RUN=fev07-full npm run test:reader | data/acceptance-reader-fev07-full/playwright.json；full.log |
| 最后整合（138通过） | READER_PORT=7182 READER_RUN=fev07-last npm run test:reader -- --grep 'FE-V07\|FE-V06\|FE-V04\|FE-V05\|FE-V03' | data/acceptance-reader-fev07-last/playwright.json；last.log |
| headed历史焦点 | READER_HEADED=1 READER_PORT=7183 READER_RUN=fev07-headed npm run test:reader -- --grep 'actual blur\|real window blur'，12通过 | headed.log／fev07-headed playwright.json |
| 额外真实失焦／大列表 | READER_HEADED=1 READER_PORT=7184 READER_RUN=fev07-extra-final npm run test:reader -- --grep 'FE-V07 expanded tree retry\|FE-V07 actual window blur'，12通过 | extra-final.log／fev07-extra-final playwright.json |
| 异尺寸页面 | READER_PORT=7185 READER_RUN=fev07-portrait npm run test:reader -- --grep "FE-V07 eraser on portrait"，6通过 | portrait.log／fev07-portrait playwright.json |
| 真API | node scripts/verify-navigation-eraser-live.mjs，双浏览器通过 | live-final.log及live-1795426623034/live.json |
| 原生缩放 | node scripts/verify-navigation-native.mjs（preview7194），12组通过；4种阅读缩放共48次，对齐最大0.0125 CSS px | native-final.log、native/results.json及截图 |
| 最后构建与空白检查 | npm run build通过、git diff --check通过 | build-last.log、final-check.txt |

全量回归启动后增加了贴条焦点提交保护与erase note pointer-events限定；最后整合／维护／真API／原生缩放对最终生产源码补跑。之后仅文档和额外测试变更。未用FE-V06历史通过代替本卡结果。Vite保留约500kB ReaderLab chunk警告，默认总览资源断言不加载ReaderLab／PDF worker；本卡不把大包警告隐藏或宣称性能深度优化。

原生缩放使用隔离profile per_host_zoom_levels、真实安装浏览器headless窗口；测量CSS innerWidth／innerHeight精确三尺寸，DPR相对1.25、CSS zoom=1、visualScale=1。不是CSS zoom或DPR模拟。截图使用CDP原生visualViewport捕捉完整表面，避免125%截图裁剪单位差；真实blur另headed验证。

### 保留的失败与修复

- 首轮树chevron中文可访问名被React Aria再拼label，严格定位失败；aria-label只传动作词，最终名称唯一。原single selection鼠标只选不激活，已增加明确名称／Enter动作；不是改成双击要求。
- 初轮高亮测试在大贴条覆盖范围拖选，按钮disabled；测试先收起贴条并使用空白区域，保留非ink擦除断言。取消／隐藏时note pointer-events明确限制。
- FE-V06原默认／返回／侧栏button定位与本卡新总览／树冲突，测试按新交互调整，保留原保存、筛选、失败与深链断言。矩阵初次101通过7失败留存；最终整合重新执行。
- 偏好测试用addInitScript每次刷新重新写损坏值，误判偏好保存；改为仅首次种损坏值，随后验证真实存储恢复。
- 真API脚本第一次数据库路径转义语法错、第二次树行名称假设重复、第三次重复点击选中橡皮擦导致退出，均修正脚本后双浏览器通过。原生缩放脚本同类重复点击工具已按aria-pressed处理；高倍先把目标真实滚入视口。没有绕过DOM指针或调用内部删除。
- 新增hash切换测试暴露焦点内贴条尚未blur；已在导航／beforeunload先提交文字，失败仍留原ReaderLab，最终测试覆盖。

## 5. D01～D21结果

| 编号 | 结果 | 本卡证据 |
|---|---|---|
| D01 | 工程通过 | navigation-eraser course tree：箭头不切中央、课程名总览；折叠route保持 |
| D02 | 工程通过 | 同名文件带目录、source路由；旧course-reader／unified-session与真API |
| D03 | 工程通过 | late tree、retry／85末文件可达；空课程／原件无预取断言 |
| D04 | 工程通过 | overview active-session／503／无记录；GET-only，无伪阅读或掌握率 |
| D05 | 工程通过 | overview真实入口＋维护21旧UI／225后端，原评分及帮助规则未改 |
| D06 | 工程通过 | native12组grid几何断言，central width≥650；窄屏临时收左 |
| D07 | 工程通过 | native48阅读比例实测、0.0125px；reader precision全量重跑 |
| D08 | 工程通过 | 中央reader／overview／资料／learn深链、刷新与hash恢复，助手草稿不替换 |
| D09 | 工程通过 | failed navigation／focused-note hash、真409、不卸载旧读取器；恢复／导出保留 |
| D10 | 工程通过 | tree keyboard偏好坏值回退／reload恢复、native窄屏与宽屏规则 |
| D11 | 工程通过 | actual mouse：单击与快速拖过、重叠、非ink保持、当页校验 |
| D12 | 工程通过 | L形包围盒空白不删，跨采样段、2／8px两宽、稀疏第三笔，geometry单元 |
| D13 | 工程通过 | gesture一次undo／redo、临时不PUT、空白无新PUT／历史 |
| D14 | 工程通过 | pointercancel／lostcapture／blur／leave／page／tool回滚；headed实际失焦＋中键 |
| D15 | 工程通过 | 50／100／200／fit×原生缩放12组，隐藏禁用；portrait6组实际第二页擦除、第一页笔迹保留与翻页取消 |
| D16 | 工程通过 | local重新打开、真API fresh-context恢复／CAS、断网／409原回归 |
| D17 | 工程通过 | Tree箭头／Enter与面板焦点／IME原feedback回归；不截编辑按键 |
| D18 | 工程通过 | source变化事件刷树、原移除／归档／上传维护与course-reader生命周期；invalid不跳别课 |
| D19 | 工程通过 | 全量reader／统一助手＋维护；色、贴条、高亮、原笔刷历史保持 |
| D20 | 工程通过 | 构建／维护／临时API／最终回归，默认总览无阅读资源预载 |
| D21 | 待用户反馈 | 只有开发授权原话，没有本轮完整路径／视觉反馈；不伪造满意度 |

D11～D16使用真实浏览器鼠标down/move/up，未调用内部删除函数。暂存集合仅展示，不增加批注schema或写白色层。几何函数测试只作补充，定位以实际canvas／note屏幕坐标独立测量。

## 6. 运行、限制与回退

npm run dev 后点课程名称见总览；箭头展开资料，PDF进入中央，橡皮擦半径在选中工具后显示。左右开关在顶栏。独立实验入口保留供旧测试，不是正式工作流。没有需要迁移的表／字段，新旧快照继续schema1；新UI偏好独立可移除，不清其他存储。

仍未支持局部擦除、多标签、拖拽目录、自动PPT转换、真实模型、手机或公共账号。窄屏不能同时常驻左右完整栏，按说明临时收左；这是明确策略不是丢状态。服务器冲突后先导出再显式重载，未保存情况下硬关闭仍受浏览器能力限制。

回退以data/acceptance-fev07/baseline.zip与delta-from-start.json为准，只撤本卡涉及文件的增量；严禁git reset清空前置脏工作区。保留全部原件、reader／assistant快照、学习记录与schema。橡皮擦已保存的整笔删除本身是用户数据，不随回退批量恢复或清理。最终停在FE-V07待验收，不擅自开启新开发任务。


## 7. 2026-11-23 用户反馈修订（未新增任务）

用户实际反馈包含：选字横幅影响阅读；滚轮不能前后翻页；当前题带学与统一助手重复；询问题目勾选内容是否应可关联。已收到实际卡点，不再写“没有本轮反馈”；修正版是否满意仍待反馈，不能据此标D21认可。

### 修正

1. 选字／框选成功不再新增rl-message，固定selectionbar已显示页与工具。真实存储／读取错误仍用alert，不隐藏。浏览器测量选字前后scroll区域y和height完全相等，向助手提问仍附带文字。
2. 普通滚轮先滚当前页，触底／顶继续滚动跨页，下翻落顶，上翻落前页底；fit整页直接可翻。60 CSS px累计、500ms翻页间隔避免惯性连跳；Ctrl缩放、横滚、输入框与侧栏独立。仍只渲染一页，不承诺全篇连续DOM。
3. 原TutoringPanel通过Portal移至同一应用助手侧栏，中央不再常驻第二个聊天区；侧栏“问题记录与上下文／带学对话”明确两种当前能力。原题内请求、幂等、CAS、送达、重测同意、帮助记账保持，不新增通用模型调用。重复的“围绕当前题求助”“最新交流”跳转移除，保留当前题带学快捷打开统一侧栏。
4. FE-V04已有显式当前题题干／选项／已提交反馈关联；本次补上当前勾选答案／输入草稿快照，标记“未提交、未判分”，仅点击关联时附带；改选不暗中覆盖，需再次关联。保存范围服从用户原本机／服务端选择，不自动迁移。通用真实发送、引用与帮助协议合流仍未实现，后续需用户另行授权。

### 验证与证据

证据根data/acceptance-fev07-feedback（忽略目录），开工baseline.zip保留原全部非ignored源码。build-final.log构建通过（保留ReaderLab大包警告），git diff --check通过。维护七步骤通过，225后端、27单元、22旧UI，报告原路径C:/Users/Lenovo/AppData/Local/Temp/exam-engine-maintenance-MxaqTN/report.json。最后移除冗余求助按钮后重新build与22 UI全跑通过；Chrome题内6测试也通过，ui-final.log／ui-chrome.log。

新增reader反馈测试双浏览器三尺寸18项通过：选字无横幅和画布跳动、页内／边缘双向滚轮、上一页底部恢复、Ctrl缩放、编辑与侧栏滚轮隔离。reader-second.log／data/acceptance-reader-feedback-second/playwright.json。额外reader／助手／橡皮擦／precision回归186通过，12个需headed的原焦点场景本次未跑（该部分未改），最终见data/acceptance-reader-feedback-regression/playwright.json；不引用之前FE-V07通过作为本次结果。

失败保留：首次fit页测试在快速加载500ms内被初始time=0冷却误挡，初始化改负时间后18项全过；题内移入侧栏后正式作答快捷被关闭按钮回焦抢走，改为独立关闭事件并下一帧回作答；原测试必须先展开当前题带学，按真实新入口调整，原重测同意和断线幂等断言保留。测试夹具不调用真实模型或正式库。

D21：收到本轮真实反馈并已处理上述卡点；修正版待用户再次试用。原任务后置范围不变，不启动新卡、提交／推送／发布。
