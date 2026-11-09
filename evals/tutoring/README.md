# 当前题带学回放

## 三考点复查（2026-11-09）

新增 `selection-projection`、`data-independence`、`sql-exemption` 三套 `*.fixture.json`、`*.baseline.json` 和 `*.heldout.json`。材料分别来自现有关系数据库课件、三级模式课件和回忆卷；原件不分发。夹具保存原件 hash、PDF 页码、改编题及答案依据、典型错误和迁移题。开发者对照原文与执行核对不等于课程持有人已经人工确认，更不等于真人测试；夹具为 draft，不能直接发布成已确认题库。

SQL 夹具明确重复报关和重复免税名单的语义，避免将普通 JOIN、EXISTS、外层 DISTINCT 一概判作等价。运行 `.venv\Scripts\python.exe scripts/check_tutoring_sql.py` 可核对 32 组数据与三个反例；这是 SQLite 样本执行，不是所有方言的形式证明。课件只支持题意与数据定义，SQL 解法属于开发核查的补充，不能声称原卷提供了标准答案。

可用 `--fixture evals/tutoring/data-independence.fixture.json` 替代 `--template-task-id`；仍须提供实际 `--source-id`，校验 hash 并从原件重新解析锚点页。首先保存 system 回放，不改产品提示词或检索。之后直接组有两种独立用途：

```powershell
# 先冻结当前系统（其余 --data-dir / --source-id 等参数同前）
.venv\Scripts\python.exe scripts/evaluate_tutoring.py --data-dir data/acceptance-tutoring-eval --source-id ACTUAL_SOURCE_ID --fixture evals/tutoring/data-independence.fixture.json --cases evals/tutoring/data-independence.baseline.json --label frozen --group system --live
# 实际上下文完全一致：直接导师处理冻结的每轮输入，包括原系统提问和证据 ID
.venv\Scripts\python.exe scripts/evaluate_tutoring.py --data-dir data/acceptance-tutoring-eval --source-id ACTUAL_SOURCE_ID --fixture evals/tutoring/data-independence.fixture.json --cases evals/tutoring/data-independence.baseline.json --label equal --group direct --evidence-from data/acceptance-tutoring-eval/frozen-system.json --live
```

`--evidence-from` 会核对原件、Provider、模型、输出预算、题目、初始作答与每条消息，并原样使用冻结上下文。它是逐轮替代回复的策略比较（teacher-forced），不是直接导师自行发展出的连续教学；直接组自己的上一回复不会混入下一轮，因而不能据此比较独立对话质量。省略该参数则是完整原件的连续直接带学，单独报告。冻结报告记录提示词、输出 schema、实现及回放工具 hash，失败输入也保存，避免只留下成功结果。

`heldout` 中已运行的连续无进展案例如今用于修复回归，不再称未参与调试。尚未运行的直接讲解、异议与小检查场景仍须单独验收。小检查错配需看实际生成的问题后再编写错配回答，不能把固定回复硬套到不同问题上。迁移题的评审答案不得出现在学生侧输入；完整方案及原始记录表见 [真人试用包](trial-protocol.md)。三考点是同一课程内的不同技能，不能称跨学科验证。

本轮实际结果与未通过项见 [三考点评审](review-2026-11-09-three-topics.md)。不能将夹具已准备等同于全部场景已经跑完。

新增 `*.fresh-boundaries.json`（连续无进展、自主选择、来源边界与暂停）及 `*.unseen-content.json`（完整讲解后停止、按内容标记来源查证帮助）。先冻结自然措辞，再运行；一旦依据失败改提示词，该批次即成为修复样本。各考点使用相同措辞，不代表覆盖了三门课程。最新结果见 [帮助边界评审](review-2026-11-09-help-boundaries.md)。

这是开发验收工具，不是学习收益评测。固定学生消息用于检查来源、条件遗漏、小检查反馈、换讲法及暂停；不由模型模拟学生或自行打分。条件不同的后续消息必须单独检查是否仍适配，不能只比较动作名称或统计“正确率”。

`relational-algebra.json` 包含六个场景。它针对库存选择 / 投影题，需要配一份可核查的本地真实课件及已存在的题目模板；仓库不附私有原始资料或验收库。可复制 JSON 自建其他考点样例。`answer` 是可选的正式初始作答；省略时只比较学生在交流中表达的思路，不能声称已经保存过错误作答。

## 准备隔离副本

停止目标验收目录的 API。用 SQLite backup 复制数据库，复制原件到副本的 uploads，勿对正式目录运行脚本。示例在仓库根目录执行，目录名按实际修改，目标应不存在：

```powershell
@'
from pathlib import Path
import sqlite3, shutil
target = Path('data/acceptance-tutoring-eval')
assert not target.exists()
target.mkdir()
source = sqlite3.connect('data/exam_engine.db')
destination = sqlite3.connect(target / 'exam_engine.db')
source.backup(destination)
destination.close()
source.close()
shutil.copytree('data/uploads', target / 'uploads')
(target / 'ISOLATED_ACCEPTANCE').touch()
'@ | .venv\Scripts\python.exe -
```

选择实际 source ID 与 task ID：题目原有证据须来自该原件，模板及参考答案应事先核查。脚本要求原件 hash 和原来源一致，重新进行确定性全文提取，并将模板引用精确映射到新证据；解析失败或映射不一致会停止，不带着缺失上下文继续调用。

## 显式运行

默认无 `--live` 会拒绝执行；使用 `.env` 中现有模型与预算。整份资料直接组每条消息都会传完整提取文本，可能花费较多 token；输出上限 2,000，输入并未等量限制。此比较回答“相同原始资料、不同上下文构建”，不要当成“实际输入完全相同”的对照。

```powershell
.venv\Scripts\python.exe scripts/evaluate_tutoring.py --data-dir data/acceptance-tutoring-eval --source-id ACTUAL_SOURCE_ID --template-task-id ACTUAL_TASK_ID --cases evals/tutoring/relational-algebra.json --label current --group system --live
.venv\Scripts\python.exe scripts/evaluate_tutoring.py --data-dir data/acceptance-tutoring-eval --source-id ACTUAL_SOURCE_ID --template-task-id ACTUAL_TASK_ID --cases evals/tutoring/relational-algebra.json --label raw --group direct --live
.venv\Scripts\python.exe scripts/evaluate_tutoring.py --data-dir data/acceptance-tutoring-eval --source-id ACTUAL_SOURCE_ID --template-task-id ACTUAL_TASK_ID --cases evals/tutoring/relational-algebra.json --label legacy --group legacy --live
```

每组重新建立一个仅含此原件的隔离课程，以相同模板建立各场景任务。直接组得到完整原件的确定性文本，系统自行选上下文，legacy 是旧 hint API（本组不调用模型）。这里固定已存在的有效题，不评测范围识别、初始选题或复杂扫描识别，不能当全产品端到端验收。

输出为目录内 `label-group.json`：代码提交及实现文件 hash、原件 hash / 解析版本、完整提取结果、实际输入、消息、模型输出、用量 / 耗时、前后状态和错误。同名报告存在会拒绝覆盖。每次完成一条即保存；失败保留并结束该场景的依赖对话，不自动付费重试，之后显式新运行也会创建新任务。失败调用也记录在课程用量中；未返回 token 不表示未收费。报告中的价格估算为零不表示免费。

逐项人工检查：事实与引用是否支持、是否听取纠正、问答条件是否一致、帮助程度是否准确、是否改变讲法、是否尊重停止、是否错误宣称掌握。标记通过 / 部分通过 / 失败 / 证据不足，附原句。特别核对正文与 evidence_ids 是否一致，不因有效 ID 就忽略正文伪造引用。

回复内容与资料可能私密，报告保存在被忽略的 data 目录。真人未见题、撤提示与延迟复测需要另做；脚本中的回答或小检查成功不能算真人效果。

## 实际小检查与第二科目

最新进展见[跨轮次证据与复测建议](review-2026-11-09-cross-session.md)：课程级只读有效证据列表、规划器摘要、旧题去重及真实固定切面；隔天效果尚无真人证据。

正式评分结果见[信号评分与纠错](review-2026-11-09-signals-grading.md)。评分重放必须使用新建隔离目录、真实原件及明确付费开关，例如在PowerShell中运行：

```powershell
New-Item -ItemType Directory data/acceptance-grading-new
New-Item -ItemType File data/acceptance-grading-new/ISOLATED_ACCEPTANCE
.venv/Scripts/python.exe scripts/evaluate_grading.py --data-dir data/acceptance-grading-new --source "D:/study/信号与线性系统/sls答案汇总.pdf" --fixture evals/tutoring/signals-step-impulse.fixture.json --cases evals/tutoring/signals-step-impulse.grading.json --live
```

拒绝复用已有数据库及覆盖原报告。该命令最多对每个样本做一次正式评分；仅case显式提供review_reason时再复核。当前六样本没有review_reason，本轮复核与纠错是另行按实际结果开展，保存在私有证据。夹具只在隔离库提升为开发核查的validated，不改变仓库draft或正式题库，不证明自动校题质量；每次运行有API费用。原件不随仓库分发，请填写实际拥有且hash一致的路径。

后续[PDF整页视觉回退评审](review-2026-11-09-pdf-render.md)记录矢量/乱码页渲染、AES依赖修复及真实视觉转录的成功与保存失败边界。

最新结果见[小检查和信号评审](review-2026-11-09-checks-and-signals.md)。actual-checks.json是读取实际问题后人工写错配/改正输入的已发生记录，不是给任意新问题硬套的用例。conceptual-help文件检查完整自然语言示范→局部解释的当轮帮助。signals-step-impulse夹具基于用户授权本地原件，hash/页码可追溯；原件不分发，来源与夹具仍须核查，不能冒充整科端到端支持。运行 `scripts/check_tutoring_signals.py` 可独立做有限数值核查，无模型调用。
