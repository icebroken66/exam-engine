# 维护与离线回归

更新：2026-11-10。实际模块见 [模块职责](模块职责.md)，历史证据见 [证据索引](证据索引.md)，PR 状态只维护 [本地计划](../development/开发拆分与PR计划.md)。安装与日常启动见 [仓库 README](../../README.md)。

## 首次准备与完整入口

在仓库根目录，按 README 创建 .venv 并安装 backend[test]，运行 npm ci。Python >=3.12，Node >=22.12。Windows 默认使用已安装 Microsoft Edge；其他系统或无 Edge 时先运行 npx playwright install chromium，并设置 PLAYWRIGHT_CHANNEL=chromium。安装需要网络；“离线”指回归不调用外部模型或读取私有课程，依赖首次下载仍需网络。macOS / Linux 路径由入口选择，尚未在这些系统实测。

无需 .env、API 密钥、作者 data 或固定个人路径。7171 被其他程序占用时 Playwright strictPort 会失败；识别并停止自己的服务后重试，不杀未知进程。

默认执行：

    npm run test:maintenance

按序运行自身配置契约 → 后端全量 → 前端单元 → TypeScript/Vite 构建 → 全量模拟 API 浏览器（preview 构建产物） → SQL 有限执行 → 信号数值检查。任一步失败即停止，后续标 not_run，返回非零，不将部分通过标成全量完成。

入口固定 PYTHONPATH 为当前检出的 backend，避免复用虚拟环境时误测旧 editable 安装。维护浏览器设置 EXAM_ENGINE_UI_PREVIEW=1 使用刚构建的 dist，避免 Vite 冷启动编译计入单个用例超时；日常 test:ui 仍使用开发服务。

每次建立系统临时目录，强制 MODEL_PROVIDER=mock，清除继承的模型 / 数据库 / 数据目录配置，使用临时 SQLite 和上传目录。价格重置只用于测试配置，不表示真实服务免费。dotenv 仍可能读取本地文件，但显式 Mock 和隔离路径优先；不改写 .env 或正式库。浏览器使用 fixture；Vite 未拦截请求转到本机端口 1，避免访问正式 8010 服务。

日志和 report.json 保留于打印的临时目录，记录 HEAD、工作区状态、源码 SHA-256、Node / Python / 平台、各步耗时 / 退出码 / passed / failed / not_run，不记录环境变量或密钥。工作区有修改时 HEAD 是前置基线，须结合文件指纹。Playwright 结束关闭自启 Vite，中断仅停止本入口子进程树。临时目录不自动删除，确认不需要后可手工清理。

## 局部检查

优先读取失败日志。完整入口的隔离环境仅对子进程有效，直接执行 pytest 前须自己指定 Mock 和临时数据库，因为应用启动仍初始化所配置库。

| 层 | 命令 | 边界 |
|---|---|---|
| 入口守卫 | node --test scripts/verify-maintenance.test.mjs | 配置隔离、清单，不证明产品功能 |
| 后端 | .venv/Scripts/python.exe -m pytest backend | fixture / TestClient / 数据库与服务契约 |
| 前端 | npm test | 工具与请求逻辑 |
| 浏览器 | npm run test:ui | 模拟 API 交互 / 恢复 / 窄屏 |
| 构建 | npm run build | TS 静态检查和前端产物 |
| SQL | .venv/Scripts/python.exe scripts/check_tutoring_sql.py | 有限 SQLite 执行 |
| 信号 | .venv/Scripts/python.exe scripts/check_tutoring_signals.py | 有限数值积分，不是一般证明 |

macOS/Linux 局部 Python 路径改 .venv/bin/python，完整入口自动选择。

## 不纳入默认回归

- evaluate_tutoring.py / evaluate_grading.py：真实模型、原件 / 隔离库 / --live，需当次授权确定调用量、费用、来源与人工核查，失败不覆盖旧报告。
- prepare_demo.py / smoke_dev.py：涉及演示写入或启动服务，不属于维护默认入口。
- 真人前测、未见后测、延迟试验：另需参与者与原答记录，见 [协议](../../evals/tutoring/trial-protocol.md)，工程通过不能替代。

结构移动检查依赖方向、事务、异常、公开字段和原测试；行为修复另附原失败和新样本。快照与限制见 [PR-05](../development/PR-05_维护与验收基线.md)。
