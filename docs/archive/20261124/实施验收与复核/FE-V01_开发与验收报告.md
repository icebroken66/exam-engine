> 历史归档：仅供追溯，不作为当前排期、授权或验收门槛。当前依据：[核心功能与开发基准](../../../核心功能与开发基准.md)。原始字节见归档备份及清单；正文仅追加本提示并修正迁移链接。

# FE-V01 开发与验收报告

当前结论（2026-11-23最终验收）：原范围技术验证通过，限定本机PDF与有限PPTX人工导出小样。125%原生缩放、真实失焦、独立保真和性能缺口已补证；下文为历史。[本轮逐项结论与证据](FE-V01_FE-V02_20261123验收记录.md)。

2026-11-23（北京时间）。状态：**首轮实现完成，部分验证完成／待验收**。不表示整个资料学习工作区完成。

## 运行与回退

在 exam-engine 执行 npm ci，然后 npm run dev:web -- --port 7172 --strictPort；访问 http://127.0.0.1:7172/reader-lab.html，Ctrl+C 停止。生产检查：npm run build，再 npm run preview -- --port 7172 --strictPort。默认 / 课程入口保留。阅读器没有导入 App 或 API 客户端。

打开 tests/fixtures/reader/mixed.pdf 验证文字与图片页；representative-12p.pdf 验证逐页导航；same-name-v2.pdf 改名 mixed.pdf 验证版本隔离。刷新后需要重新选择相同内容文件，按 SHA-256 恢复。仅当前浏览器、当前 origin 的本机数据，不跨端、不上传；开发与预览保持相同端口。

回退时移除 reader HTML、src/reader、对应脚本／测试／依赖，去掉 Vite reader input 和 package reader prepare hooks。不操作正式 data。实验数据库 fe-v01-reader，文件提示标签 fe-v01:last-document。清理只能显式处理这两个命名空间，不得清空全站存储。

公开夹具已入库，运行测试不需要 Python。重新生成：python scripts/generate-reader-fixtures.py，需要 reportlab、Pillow、python-pptx 和 Windows 微软雅黑 C:/Windows/Fonts/msyh.ttc。仅分发字体嵌入子集，不复制系统字体文件；自制夹具内容 CC0。

## 模块与数据契约

| 模块 | 职责 |
|---|---|
| reader-lab.html、main.tsx | 独立 Vite HTML，只载入该入口的样式与功能 |
| pdf.ts、PdfPage.tsx | 本地 File、SHA-256、PDF.js canvas／文字层、缩略图、错误与渲染取消 |
| types.ts、coordinates.ts | 公开类型、左上原点归一化坐标、边界裁剪、身份／预览版本／页号校验 |
| AnnotationLayer.tsx | 自由笔、多区域高亮、纯文本贴条编辑／拖动、取消／失焦停止绘制 |
| storage.ts | IndexedDB 事务完成后报成功、未知／损坏格式保护、JSON 导出 |
| ReaderLab.tsx | 阅读与面板状态、历史、350ms 合并保存、上下文／草稿、固定引用与单级返回 |
| boardui、prepare-reader.mjs | 真实 BoardUI Button 与独立 Tailwind 编译，不导入 preflight |

存储 key 为 SHA-256:previewVersion，文件名仅显示。页号从 1 开始，每页保存原始尺寸。批注为 schema=1，坐标在 [0,1]；显示变换不回写锚点。笔宽 CSS px，贴条卡片限定大小且锚点仍是页面坐标；无旋转按钮。高亮保留多行区域。临时引用不进入个人批注。脱敏契约样例见 FE-V01_脱敏样例.json。

历史覆盖整笔、高亮、贴条新增／编辑失焦提交／完整拖动／删除，保存在当前文档内存中，刷新不恢复历史。选字模式透传真实文字选择；框选／笔刷独立接管指针。上下文与当前阅读页分离，换页不改问题目标，重新选择时明确替换上下文并保留草稿。

未知 schema、损坏锚点、不兼容尺寸时暂停自动保存，原始记录保留并可导出。存储失败保留内存，明确未保存，可重试／导出。未保存离开使用 beforeunload；硬关闭和清理浏览器不保证恢复。切文件时有未保存内容会保留当前会话，提示先重试或导出。没有正式账号／笔记后端。

## 选型、依赖、CSS 影响

采用 pdfjs-dist 6.5.438（Apache-2.0）：可控 canvas、文字层与独立覆盖层。未采用内置 iframe PDF 查看器，因为选区／坐标不可稳定控制。未引入整套绘图框架，当前 SVG 及有限手势足以验证范围。CMaps／标准字体／WASM 从锁定包复制到被忽略的 public/reader-assets，不依赖在线预览。worker 约 1.27MB，reader JS 约 503KB（gzip 153KB），构建有 500KB chunk 提示；正式接入需懒加载、缩略图虚拟化。

已检查相邻 BoardUI 实验 Button、cx、directional-icon、主题、排版、官方安装页与 button registry。Button 为 2026-11-23 官方 https://www.boardui.com/r/button.json 快照；支持文件来自相邻 2026-11-10 实验。只改相对导入，没有全项目 init。官方 license 页将免费源码标为 MIT，无 Pro 源码；GitHub LICENSE 下载连接失败，许可页面快照留在本机证据。来源见 src/reader/boardui/NOTICE.md。

新增 tailwind-merge 3.7.0（MIT）、@remixicon/react 4.9.0（包内 Remix Icon 许可）；构建依赖 tailwindcss、@tailwindcss/cli 4.3.5（MIT）。独立 CSS 仅扫描 Button、无 preflight、仅 reader HTML 导入。原页面构建不载入阅读器 CSS。其余布局为局部实验 CSS，未宣称最终视觉完成。npm audit 4 项 low 来自已有 KaTeX 传递链，本轮未强制升级原数学链路。

## PPTX 路径与保真

浏览器不支持 PPTX 自动转换。本机实际找到 Microsoft PowerPoint 16.0.20326.20318，Microsoft YaHei 字体。5 页自制 PPTX 以只读打开，用 SaveAs 格式 32 导出 PDF 成功。人工流程：PowerPoint 打开 → 导出／另存为 PDF → 验证页打开 PDF。需要本机可用 PowerPoint 与对应字体，没有安装或修改 WPS／Office。

验收准备以 COM 执行同等导出，不是应用上传接口。ExportAsFixedFormat 首次调用签名失败，改 SaveAs 后成功，失败如实保留。幻灯片 1～5 对应 PDF 页 1～5。原幻灯片 PNG、Poppler 独立渲染和两浏览器截图均保留；5 页中文、上标 E=mc²、椭圆、宽表格对照未见缺失／替换。复杂公式、真实 PPTX 尚未覆盖。Poppler 渲染真实课件报告 Symbol／ArialUnicode 显示字体警告，不据此宣称全部字体保真。

## 环境、样本与留痕

分支 chore/pr-05-maintenance-baseline；HEAD ff7bac3c72568b3fce6a21b2cf0b9f475b360894。无自动提交。开工前已有计划修改及未跟踪 design.md、讨论／任务书等设计文档均保留。Windows 11 家庭版 10.0.26200，i7-13650HX，14 核／20 线程，约16GB RAM，Node24.13.0。实际启动 Edge158.0.4370.33、Chrome157.0.8103.79，未改 user agent。

公开 S2/S3=mixed.pdf，S4=representative-5p.pptx，S5=corrupt.pdf／same-name-v2.pdf。来源、权限、大小、页数、哈希见 tests/fixtures/reader/manifest.json。12页公开样本是合成小样，不冒充真实 S1。

S1 为现存上传目录的35页课件，只对隔离副本测试。1,176,595 bytes，SHA-256 b6fa803c0608135d486d67af8ebcf0cdb7be025237bee29a57408c31e64ebc75。原件与副本前后哈希相同，私有内容仅本机验收、不分发。其35页超过20页性能基准，不能替代标准基准。

本机证据目录（均由 data/ 忽略）：acceptance-reader-20261123-dev02、acceptance-reader-20261123-matrix01（保留29/30初次矩阵失败）、acceptance-reader-20261123-matrix02（36项通过、私有样本对照）、acceptance-reader-20261123-final02（最后复测）。Playwright JSON、截图、失败trace、local-samples.json、审计、源码指纹、最终 acceptance.json 在这些目录。

## A01～A17 逐项结论

2026-11-23后续补测：完整历史／单行选字、非首页恢复、深滚动返回、上下文替换、不同预览隔离与读取拒绝测试已新增。FE-V02期间真实有界面Edge／Chrome失焦、Escape、leave、cancel各通过；三参考笔迹点／贴条锚点矩阵与12页标准性能在两浏览器三尺寸12项补测通过（证据acceptance-reader-20261123-fev02-precision-final、fev02-prerequisite-blur01）。保留早期1920参考点落在屏外导致少画一笔的失败，修正为50%建立参考再测所有比例；不是降低误差阈值。原生125%仍无有效通过证据；原查看器真实资料对账未收口，下面首轮表格保留历史，不据本次布局评审宣称FE-V01完整通过。BoardUI版权原文已通过GitHub API补齐，位于src/reader/boardui/LICENSE。

| 用例 | 状态 | 证据／剩余项 |
|---|---|---|
| A01 | 部分通过 | S1双浏览器页1/4/8/16/35截图及哈希不变；公开12页逐页导航。S1全页人工对账、原查看器复杂页核对待补 |
| A02 | 小样通过／待验收 | 5页PowerPoint→PDF，中文／上标／图形／表格对照；真实复杂公式未覆盖 |
| A03 | 部分通过 | 真实鼠标跨行中文、区域框选、图片回退；独立单行鼠标用例待补 |
| A04 | 通过（公开夹具） | 三种批注共存、贴条编辑拖动、截图与存储断言 |
| A05 | 部分通过 | 模式分离、实际选字／绘制；blur/Escape/cancel/leave已实现，真实失焦测试待补 |
| A06 | 部分通过 | 编辑／拖动撤销重做、隐藏恢复自动化；逐动作删除历史待补 |
| A07 | 部分通过 | 三处分布区域、四档缩放×10往返、面板／翻页／滚动／刷新／窗口变化，实际DOM误差<0.01 CSS px；浏览器125%真缩放、笔迹／贴条参考点矩阵未运行 |
| A08 | 部分通过 | 三种已存批注、草稿／上下文／面板重选恢复；最后非首页页码恢复独立断言待补 |
| A09 | 部分通过 | 同名不同内容隔离、原版本恢复，preview key单测；不同预览版本真实浏览器矩阵待补 |
| A10 | 通过 | 故障注入不误报保存成功、内存保留、导出、重试、旧持久化未覆盖 |
| A11 | 部分通过 | 换页保留目标和草稿、未观察API或第三方请求；重新选区明确替换已实现，完整交互待补 |
| A12 | 部分通过 | 固定跨页目标和返回页／草稿／上下文／面板；深滚动和不同缩放往返待补 |
| A13 | 部分通过 | 无效页／版本／区域均拒绝跳转；页级回退实现，独立断言待补 |
| A14 | 部分通过 | 损坏PDF、未知schema保护及恢复；不支持后缀实现，读取拒绝故障未注入 |
| A15 | 部分通过 | 双浏览器×三桌面尺寸，无应用横向溢出，页码Enter与面板焦点；完整键盘／125%待补 |
| A16 | 部分通过 | 20笔＋10高亮＋10贴条保存重开；35页样本冷开0.66～0.71秒、导航57～70ms单轮观测（含自动化开销）；标准样本冷／热、笔迹100ms反馈未测量，不报SLA通过 |
| A17 | 通过（Mock工程基线） | 本轮实际 test:maintenance，隔离临时库和Mock；不是人工正式课程全流程验收 |

初次矩阵缩窗时测量在canvas重绘前读到160px瞬时差，保留trace；增加实际尺寸稳定等待，data-ready随scale/page/document重置，复测通过。真实课件检查发现“跳当前页会一直未就绪”，已修复为仅资源／页／比例变化重置，当前页跳转实测恢复。

可进入PDF局部交互精细设计，但FE-V01仍待验收。优先补125%真缩放、笔迹／贴条实际误差、失焦与完整历史、S1独立查看器保真、标准性能采样。不降低任务书阈值、不将未运行记为不适用。生产接入另需版本迁移、配额、并发冲突、虚拟化、完整可访问性、正式身份／存储接口；AI与题目关联另开卡。

