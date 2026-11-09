# 期末急救引擎 · Exam Engine

从自己的课程资料出发，完成「诊断 → 补缺 → 同类练习 → 独立重测」的复习 Agent。支持导入课件、往年卷、作业和笔记，保留题目来源、作答、判分与人工纠正记录。

**当前为本地单用户试用版。** 每位同伴在自己的电脑上安装，资料和学习记录分别保存在各自电脑。当前没有账号与用户数据隔离，请保持服务监听本机，不要将开发端口直接开放到公网。项目仍在迭代，欢迎记录操作卡点和题目质量问题。

## 1. 准备环境

- Git。
- Node.js **22.12 或更高版本**（建议使用受支持的 LTS；本项目已在 Node.js 24 验证）。
- Python **3.12 或更高版本**（本项目已在 Python 3.12 验证）。
- 真实学习需要一个兼容 OpenAI Chat Completions 的 API，以及该服务可用的模型 ID。没有 API 也可先用 Mock 检查安装和界面，但不能据此评价出题、讲解或判分质量。

以下主要教程使用 **Windows PowerShell**。所有命令均在仓库根目录执行；不要在 `backend` 子目录执行 `npm run dev`。

```powershell
git clone https://github.com/icebroken66/exam-engine.git
cd exam-engine
node --version
python --version
```

如果 `python` 未指向 Python 3.12+，创建虚拟环境时可改用 `py -3.12 -m venv .venv`。

## 2. 安装依赖

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install --upgrade pip
.\.venv\Scripts\python.exe -m pip install -e "./backend[test]"
npm ci
```

无需激活虚拟环境，也不需要为此修改 PowerShell 执行策略。首次安装需要下载依赖。

首次创建配置文件：

```powershell
if (!(Test-Path .env)) { Copy-Item .env.example .env }
notepad .env
```

`.env` 已被 Git 忽略。不要把它、真实密钥或包含密钥的截图提交到仓库。

## 3. 配置模型 API

### 使用同伴提供或自己申请的测试 API

向 API 提供者取得 **Base URL、API Key、模型 ID**，在 `.env` 中填写下面四项。将示例内容替换为实际值；如果已有同名配置，请修改原来的行，不要重复添加。

```dotenv
MODEL_PROVIDER=openai-compatible
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_API_KEY=replace-with-your-private-test-key
OPENAI_MODEL=replace-with-an-available-model-id
```

- 使用第三方兼容服务时，`OPENAI_BASE_URL` 填写其提供的 API 根地址，常见形式为 `https://服务域名/v1`；以提供者要求为准。这里**不要填写网页聊天地址，也不要附加 `/chat/completions`**，程序会自行拼接该路径。
- `OPENAI_MODEL` 必须是该密钥实际有权限调用的 API 模型 ID，不能直接填写产品的显示名称。项目使用 `messages`、`response_format: {"type":"json_object"}` 与 `max_tokens`；仅支持 Responses API 或不接受这些参数的服务/模型，当前不能直接接入。接口兼容也不代表教学效果已经验收。
- 转录图片或扫描 PDF 还需要模型支持图片输入。不支持图片时，先使用文字版 PDF、DOCX、PPTX、TXT 或 Markdown；复杂公式、表格和扫描件仍需核对原件。
- `.env` 修改后，需要停止并重新运行 `npm run dev`，让 API 与 Worker 使用同一份新配置。
- 密钥只供本机后端和 Worker 调用模型，不需要填入前端代码，也不要新增 `VITE_OPENAI_API_KEY` 一类变量。

程序从根目录 `.env` 读取配置；终端中已设置的同名环境变量优先。如果修改文件后未生效，也要检查终端或系统里是否设置过同名变量。

### 暂时没有 API：Mock 模式

```dotenv
MODEL_PROVIDER=mock
```

Mock 不消耗真实模型额度，页面会标记 Mock 结果。它仅用于安装、开发和流程检查，不能提供可信的真实课程学习结果。即使填写了密钥，只要 `MODEL_PROVIDER=mock`，仍然使用 Mock。

### 测试额度与用量

推荐由 API 提供者为每位同伴单独发放测试密钥，在服务商控制台设置用量限制、有效期及可用模型，测试结束后撤销。密钥应私下发送；不要共用主账户密钥，不要放进 README、Issue 或群聊截图。

项目可额外启用本机 token 预算：

```dotenv
MODEL_ENFORCE_TOKEN_BUDGET=true
MODEL_COURSE_TOKEN_BUDGET=200000
MODEL_DAILY_TOKEN_BUDGET=500000
```

这些数字只是示例，单位为 **token，不是金额**；仅开启开关并设置正数时才限制对应预算。默认不开启硬限制。解析往年卷、独立验题和重试可能产生多次调用，额度过低会中断处理。各电脑的本地预算不能汇总限制共享密钥，也不能替代服务商侧的额度控制。

可选成本估算字段见 `.env.example`，需按实际服务商价格填写；本地估算不等于真实账单。上传资料的相关内容会发送给配置的模型服务用于解析、出题或判分，请使用允许用于本次测试的资料。

OpenAI 官方接口与密钥管理参考：[Chat Completions](https://platform.openai.com/docs/api-reference/chat/create)、[API 生产使用建议](https://developers.openai.com/api/docs/guides/production-best-practices)。第三方服务请同时核对其自己的接入说明。

## 4. 启动与停止

```powershell
npm run dev
```

这个命令会同时启动 **后端 API、资料处理 Worker 和前端**。保留终端运行，打开 Vite 输出的本地网址（默认 [http://127.0.0.1:5173](http://127.0.0.1:5173)）。前端端口被占用时 Vite 可能另选端口，以终端输出为准；API 默认监听 `127.0.0.1:8010`。

可访问 [API 健康检查](http://127.0.0.1:8010/api/health) 排查后端连接。健康检查成功只表示应用与数据库可用，**不能证明模型密钥有效**；真实 API 是否可用，要通过资料处理和学习调用观察。

在启动终端按 **Ctrl+C** 停止服务。下次进入仓库再次运行 `npm run dev`，已保存的数据仍然保留。不要同时对同一个数据目录启动多套开发服务或 Worker。

`npm run dev:web` 只启动前端，不能单独完成资料处理；`npm run build` 只构建前端文件，也不会启动后端和 Worker。

## 5. 第一轮怎么试用

1. 新建课程，填写学校和课名；不需要先手填考试范围。
2. 上传少量同一课程的真实资料。建议先选一份文字清晰的课件和一份往年卷，便于核对来源与结果。支持 PDF、DOCX、PPTX、TXT、MD、PNG、JPG、JPEG，单文件最大 50 MiB；旧 `.doc` / `.ppt` 请先转换格式。
3. 等待资料处理完成，观察状态、耗时和待确认提示。资料较长时会有多次模型调用，不要因等待就重复上传或重复开始。
4. 必要时进入「题目校准」核对题干、选项、答案与解析。题干和答案分别确认；AI 验收通过不代表人工已经确认。缺失公式、原卷无答案或扫描不清时，先核对原件。
5. 在「开始学习」确认安排，独立作答，再看反馈、参考答案与资料依据。按下一步安排进入补缺、练习或重测；判分有问题时可复核或人工纠正。
6. 刷新页面，确认已保存的作答与进度仍在；到「学习记录」回看本轮题目。网络异常时先读取已保存进度，不要连续重复提交。
7. 在「考点概览」查看资料与学习覆盖记录，搜索后续章节或筛选尚无诊断作答引用的单元。台账列出已有资料和引用，不代表逐章理解或整课覆盖；短轮次完成不等于整门课学完。

首次试用建议记录：哪一步需要别人解释、等待时是否知道发生了什么、题干是否完整、判分是否合理、资料依据能否核对。反馈时附操作步骤、预期结果、实际结果与脱敏截图即可，不要附 API Key 或完整私密资料。

### 当前题带学怎么用

在「开始学习」当前题下方的「围绕当前题带学」交流区，可以描述思路、说“第二步没懂”、要求直接讲解或质疑判分。“围绕当前题求助”会定位到交流区。发送交流不会提交答案、推进题目或增加掌握证据；正式作答、下一步与判分纠正仍通过原有按钮操作。

- 导师按当前题、实际保存作答、相关资料与最近对话选择提示、解释、例子、查证或小检查。引用可回到原件；教学观察保留待确认，不代表掌握。
- 回复保存后刷新可恢复；保存但送达尚未确认的帮助也保守留痕。接受帮助后正式提交会标明“已接受帮助”，不会当作本题无提示独立成功。
- 独立重测默认不能发送求助，需要先明确勾选转为带学；该题不再算无提示重测，不会因此自动判错或通过。
- 发送中断时先读服务器记录，读取失败保留文字并阻止继续发送；不要因等待而重复点发送。记录仍在生成时可手动读取，重启后中断任务会标为失败，由你决定是否发新请求。
- 每条带学消息经现有模型网关调用并记用量；本入口不自动重试生成或超时请求。仅支持当前本地单 API 进程；没有多实例任务租约或跨轮教师记忆。旧 hint API 保留兼容，页面求助已改走连续带学。

当前只对数据库关系代数单考点做了真实模型对照和恢复验证，尚不能据此宣称教学收益、全学科适用或优于直接模型。

## 6. 数据、备份与更新

默认自动建立 `data/exam_engine.db`（SQLite）及 `data/uploads/`（原件）。`data/` 不上传到 GitHub，克隆仓库不会获得作者的课程、资料或历史记录。

备份前先停止服务，再复制整个 `data/` 目录；恢复时也先停止服务，再使用匹配的数据库和上传目录。`.env` 应另行私下保管，不随试用反馈上传。

资料「从课程移除」会停止后续使用并保留历史与原件，**不会物理删除文件或释放存储空间**。作答草稿仅保存在当前标签页的 `sessionStorage`，尚未提交的草稿不等同于数据库记录。

更新前停止服务并备份数据；没有本地代码修改时可执行：

```powershell
git pull --ff-only
npm ci
.\.venv\Scripts\python.exe -m pip install -e "./backend[test]"
npm run dev
```

已有本地代码修改或合并冲突时，先保留修改再处理，勿直接覆盖。应用启动时会执行当前版本的数据库字段迁移；迁移后退回旧代码前应先考虑备份兼容性。

## 7. 常见问题

| 现象 | 检查方法 |
| --- | --- |
| 未找到后端环境 / 找不到 Python | 按第 2 节创建根目录 `.venv` 并安装依赖；确认 Python 3.12+。 |
| 页面显示 API 未连接 | 使用 `npm run dev` 启动全部服务，检查终端报错和 `/api/health`；不要只启动前端。 |
| 资料一直排队 | 检查同一终端是否有 Worker 启动输出；Worker 缺失或已退出时，资料不会继续处理。 |
| 页面仍显示 Mock | 将 `.env` 的 `MODEL_PROVIDER` 改为 `openai-compatible`，填写密钥并重启；检查同名环境变量覆盖。 |
| 模型拒绝请求（401/403） | 检查密钥、权限、有效期及模型访问范围，不要把真实密钥贴到反馈里。 |
| 模型拒绝请求（404/400） | 核对 Base URL、模型 ID，以及该模型是否支持项目所用的接口参数。 |
| 模型暂时不可用 / 连接超时 | 检查服务商额度、限流、网络或代理；先读取已保存进度，再按页面提示重试。 |
| 预算不足 | 检查是否启用了本机 token 预算，以及服务商是否有额度；本机预算与服务商账单分别管理。 |
| 图片或扫描件待确认 | 核对模型是否支持图片输入，检查原图清晰度；复杂扫描、公式与表格尚需人工核对。 |
| API 端口 8010 被占用 | 先判断是否已有一套本项目正在运行；关闭自己不需要的那套服务，再启动。不要随意结束未知进程。 |
| npm 安装或构建报 Node 版本错误 | 升级到 Node.js 22.12+ 的受支持 LTS，重新打开终端后运行 `npm ci`。 |

## 8. 开发验证与其他系统

Windows PowerShell：

```powershell
npm test
.\.venv\Scripts\python.exe -m pytest backend
npm run build
```

浏览器回归默认使用 Windows 的 Microsoft Edge；如需 Chromium：

```powershell
npx playwright install chromium
$env:PLAYWRIGHT_CHANNEL = 'chromium'
npm run test:ui
```

浏览器测试使用明确的网络样例；自动化通过不等于任意学科的模型质量均已验证。真实资料闭环曾完成验收，仍需同伴反馈与更多课程测试。

macOS / Linux 可使用以下安装命令；一键启动脚本会选择对应系统的 Python 路径。完整操作主要在 Windows 验证，其他系统尚待实测：

```bash
python3 -m venv .venv
.venv/bin/python -m pip install --upgrade pip
.venv/bin/python -m pip install -e './backend[test]'
npm ci
# 仅首次创建；已有 .env 时保留原配置
test -f .env || cp .env.example .env
# 用编辑器修改 .env 后启动
npm run dev
```

技术栈：React / TypeScript / Vite、FastAPI、SQLAlchemy、SQLite；后台 Worker 处理资料。多人账号、正式公开部署、完整取消与所有中断恢复、多学科效果仍在后续计划中。
