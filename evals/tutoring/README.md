# 当前题带学回放

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
