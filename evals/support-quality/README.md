# 帮助质量核对

本目录提供4个公开合成案例：局部步骤范围、实质换表示、用户改变前提、明确暂停。每个案例区分模型输入、人工核对标准和参考备注；备注不发给模型。S04是系统行为，不计模型教学质量。

默认只列计划，不导入应用、不读取环境配置、不写数据库、不调用网络：

    .venvScriptspython.exe scripts/evaluate_support_quality.py

离线演练走正式请求接受、冻结、上下文构建、发布校验路径；只用内存SQLite、临时目录和RecordingMock，不调用真实供应商。指定全新输出子目录：

    .venvScriptspython.exe scripts/evaluate_support_quality.py --mock --output data/acceptance-support-quality/my-run

产出packet.json与review.json。packet保留实际Provider输入、完整本轮输出、请求／代码／材料版本指纹、Provider调用数和正式学习记录计数。review的每项判断必须写pass、fail或uncertain及原因，且绑定准确packet和输出指纹；空白、不全、重复或旧输出评审会被拒绝。

    .venvScriptspython.exe scripts/evaluate_support_quality.py --packet data/acceptance-support-quality/my-run/packet.json --review data/acceptance-support-quality/my-run/review.json

本工具没有live入口，不读取.env或配置真实供应商；不得把手工替换的回答包标为真实模型运行。Mock演练和人工标记都不会将quality_passed或model_quality_evaluated设为true。它只交付可核对的隔离工程证据，尚未进行真实模型语义评估，不能证明模型遵守偏好、识别正确或教会。后续真实调用应复用既有受授权预算／单次传输／未知执行账本机制，并单列评估。
