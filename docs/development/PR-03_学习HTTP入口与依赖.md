# PR-03：拆分学习 HTTP 入口与依赖注入

更新：2026-11-10。类型：结构整理。状态：验收通过（2026-11-10，已固定本地基线）。

## 基线与范围

用户授权固定已验收 PR-02 后，核对 13 个实现 / 测试 / 脚本指纹全部一致，固定本地提交 8a07f8039b8b348cba7860c47a93da6a9af63c57（8a07f80）。提交包含 PR-02 代码、测试、评估脚本和文档，staged diff 检查通过，工作区干净后建立 refactor/pr-03-learning-http。未合并 main、推送或创建远端 PR。

本卡将 15 个学习接口原样迁到 learning_routes.py 的 APIRouter：课程学习证据、范围准备、当前 / 列表 / 新建轮次、会话 / 历史、带学读取 / 发送 / 回执、正式作答、复核 / 人工纠正、推进与提示。main.create_app 仅在原位置注册路由，资料、题库等其他接口保留。

新增 dependencies.py 作为 HTTP 稳定依赖入口：get_model_gateway 原函数体迁移；get_db 从 database 直接重新导出同一函数，不增加包装或第二个 Session 工厂。main 重新导出两个原有依赖名称，既有 app.dependency_overrides[main.get_model_gateway] 和 database.get_db 键仍有效；其余路由也引用同一网关依赖。dependencies 不反向导入 main，路由不导入应用组装。

产品文件仅 main.py、新增 dependencies.py / learning_routes.py；新增 test_learning_routes.py 与 learning_route_contract.json。无业务、schema、models、数据库、前端、提示词或模型调用变更，PR-04 / 05 不包含在本卡。

## 行为与接口保持

- 完整 OpenAPI 文档与固定基线逐项相等，包含所有路径、方法、operationId、参数、响应模型、状态码和组件；非学习接口同样核对。
- 15 个 handler 映射装饰器 app → router 后 AST 完全一致，含参数、依赖、业务调用、异常转换与响应。
- create_app 排除原学习 handler / 新增 include_router 后 AST 一致，lifespan、数据库初始化 / 迁移、running 带学恢复、CORS、上传目录和其他路由保持；其余顶层辅助函数（包括迁移的 get_model_gateway）逐个核对 AST 一致。
- 数据库依赖是同一对象，事务上下文未包装；网关依赖从 main 保持同对象公开兼容。两次 create_app 不在共享 router 上累加注册。
- 公开响应继续由原模型过滤，教师参考答案不新增；现有学习 / 评分 / 带学 / 来源 / 冲突回归覆盖。

## 本次验证

环境：Windows PowerShell，项目 .venv，Python 3.12.16；内存 / pytest 临时库和 Mock / fixture，无付费模型。

| 检查 | 命令 / 方法 | 结果 | 边界 |
|---|---|---|---|
| 学习 / 带学 / 跨轮次专项 | .venv/Scripts/python.exe -m pytest backend/tests/test_learning_sessions.py backend/tests/test_tutoring.py backend/tests/test_learning_evidence.py -q | 52 通过 | 接口错误、帮助、来源与版本保护、正式提交和纠错 |
| 后端全量 | .venv/Scripts/python.exe -m pytest backend | 212 passed / 1 warning，58.63 秒 | 包含新增 3 项契约 / 依赖 / 启动恢复测试；专项不累计 |
| OpenAPI 比对 | 从修改前应用生成临时基线，修改后完整 JSON 比较 | 完全相同 | 临时快照不入库；仓库保留 15 路径 / 方法 / operationId 契约表 |
| AST 比对 | Git 8a07f80 的 main 与当前路由、main、dependencies | 通过 | handler 只变装饰器归属，组装只变 router 注册 |
| 依赖覆盖 | 原 main 网关键覆盖命中学习和非学习接口；数据库三处对象身份一致 | 通过 | 不依赖真实密钥 |
| 启动与 CORS | 隔离库种入 running 消息，真实 TestClient lifespan 恢复为 failed，健康 / CORS / 上传目录检查 | 通过 | 迁移调用以 spy 确认；迁移实现未改，原数据库迁移测试包含于全量 |
| 差异检查 | git diff --check | 通过 | 新增文件另由 AST / pytest / 指纹验证 |
| 前端 / 浏览器 / 构建 | 未运行 | 不适用 | 无前端和 HTTP 契约变化，后端 TestClient 覆盖真实路由 |
| 真实模型 / 真人 | 未运行 / 未验证 | 不适用 | 不为结构迁移重复付费，不宣称教学效果 |

新增测试首轮 1 failed / 2 passed：契约矩阵来自按 key 排序序列化的 OpenAPI，而实际 routes 按注册顺序枚举。修正测试为排序比较同一接口集合（无产品变更），最终全量 212 通过。唯一警告为已有 Starlette TestClient/httpx 弃用提示，本卡不升级依赖。

## 实现指纹

PR-03 未提交；8a07f80 仅为已验收前置基线，不是本卡实现 hash。

| 文件 | SHA-256 |
|---|---|
| backend/app/main.py | 1a88ef3ccee2e857ae2642e8541a26997e7059dbb5938300dc578a9f99ba7833 |
| backend/app/dependencies.py | 23d845b689899bc3b2908513bde3ce0b5e39df5843b24d1ae63e1697ae4c4acd |
| backend/app/learning_routes.py | 4a4909afbce6bb884fb3c1aeccc23753521f932d64841dd37cb58bfd43637bf2 |
| backend/tests/test_learning_routes.py | a8e51cd0dc348b939b5c1fc8c9bb3cce4bc3723692ae117215c713de1027c8c4 |
| backend/tests/learning_route_contract.json | 623003a8ffa25850a2b10e75f315c05bde1b19d2f6022c999718c531c4b3c993 |

## 风险与回退

仓库内测试覆盖依赖覆盖键与新路由，未发现循环导入。仓库外如果对 main 中原嵌套 handler 做非正式反射，会看到其模块归属变化；公开 API 和依赖名称保持。单个轻量 learning router 足以表达本卡职责，不为每个接口另建文件。

仅回退本卡 main / 新增 router / dependencies / 测试即可恢复 8a07f80，无数据库迁移和资料回滚。PR-02 基线已固定，PR-03 工作区未提交、待验收；PR-04 在本卡验收并固定后再开始。没有触碰正式学习资料、密钥或付费回放。


## 本轮验收与基线固定（2026-11-10）

按用户指令重新验收：五个文件指纹全部一致；重新读取 Git 8a07f80 核对 15 handler AST、其余 create_app 及完整 OpenAPI，全部一致。后端全量重新执行 212 passed / 1 warning，30.35 秒；警告仍为既有 Starlette/httpx 弃用。无阻塞发现，验收通过。未运行前端、真实模型和真人，未改业务代码。

用户同时授权继续 PR-04，因此将本卡实现、测试及说明固定为本地提交后再创建 PR-04 分支；上文未提交描述当时状态。精确固定提交见后续 PR-04 说明和外置 03，未推送或合并 main。

固定基线的 staged 检查发现新路由文件末尾额外空行；仅删除多余末尾空行、更新指纹后检查通过，函数 AST 不变。验收测试针对相同可执行内容。
