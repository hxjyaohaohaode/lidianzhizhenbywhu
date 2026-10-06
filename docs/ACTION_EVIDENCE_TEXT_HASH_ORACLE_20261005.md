# 行动证据原文摘要契约修正（2026-10-05 UTC）

本次只修正 L12 取证脚本的摘要算法，增加真实 API 回归与本说明；不改产品、原生交互路径、预算或任何阅读/选择/草稿/历史/几何断言，不发布或触发 CI。

基线为本地 `971552845ac6eb4a7950ef9083d97b0e079fb418`，与原托管提交 `abb2d5b09c3b0dcb7d6e1daf6ce487c2a8126506` 的 tree 均为 `81f61a5a7354736b3185f77dcf2d1eb0179b0611`。产品树保持：server `2b8695ac5c17d2dd947b434a54e7fdfa1aa31978`；web `9c648d7a80064f0ddd6548724fb06bf1af93c83b`。

## 原生失败与生产契约

Push run `37383460564` 的 Ubuntu、Windows L12 均已保存企业资料、企业人工审阅及通用未审阅资料，随后在第 42 个记录步骤之后的目录摘要断言失败。两平台原报告继续标记 `failed`，42 步之后的原生展开、逐段阅读、选择、草稿保留、提交完成和后来审阅历史阅读均未执行。本修正不把旧红色运行改称通过。

生产路径 `server.app.create_evidence` 对 `payload['text']` 调用 `server.store.digest`。该函数对字符串直接执行 SHA-256(UTF-8 字节)，对对象则先规范化 JSON。目录的 `review_hash` 来自完整审阅对象的规范化 JSON。旧 `expect_catalog` 错把原文当成 JSON 字符串再次编码，连同外层引号与转义字符参与摘要，因此拒绝了正确保存的原文。纯替身测试也按错误算法造数，未发现这一不一致。

修正只将原文断言改为独立计算 `hashlib.sha256(text.encode('utf-8')).hexdigest()`。`canonical_hash` 及 review、object、history、dataset 等 JSON 对象摘要断言全部保持。纯替身的原文摘要同步采用原文字节契约，但它们仍只提供不利条件测试，不充当真实 API 或原生证据。

两平台官方摘要中 `scenarios[].observations.corroborating_gets` 的“明确创建与审阅后的真实目录”原响应，未经任何字段改写，均通过修正后的同一 `expect_catalog`：

- 企业原文：`ced4e49b655acaaa70b9d09b38d760b6a0d5a4c06ac80cebec4acf1c0e3e9df5`
- 通用原文：`854285b1c3f1a7145bd6c51f027a466a22b440850630e5f4fa6b4146313e50df`

用于上述只读复核的原始 `product-action-evidence-audit.json` 文件 SHA-256：Ubuntu `324b54f4b21887e82c538d10707a2125f121b1bd12d77d890108838f99f9dc73`；Windows `dbbb1e3897317145487103b9467a3cd31dd3e1630c86715d78a2430a7ff167b8`。原媒体和完整报告未复制进本修正。

## 新增真实 API 回归

`tests/test_product_action_evidence_journey_api.py` 使用真实 `make_app`、TestClient、隔离 SQLite 与现有 `offline_test_client`。所有业务数据通过 API 创建，无数据库播种、响应替换或生产摘要函数导入。

- 两组文本分别覆盖原旅程完整企业/通用原文，以及包含中文、换行、引号、反斜线的不同文本。真实创建、企业人工审阅后取得的目录直接通过原生脚本使用的同一 oracle
- 对每一份真实资料，证明原始 UTF-8 摘要不等于 JSON 字符串摘要；改成旧错误摘要或全零摘要均拒绝，审阅对象摘要错误也拒绝
- 完整 API 闭环执行精确的 12 次写入：注册、两季度 CSV 暂存及提交、零外部计划及执行、报告行动及开始、企业资料及审阅、通用资料、单选验收、后来反向审阅。真实目录、完成快照、冻结历史均通过同一组 oracle；原报告、财务输入、计划/报告数量及完整性保持
- 仅在独立测试进程内恢复旧摘要实现，3 个新 API 用例全部在目录原文摘要处失败；文件保持修正版本，新用例正常运行全部通过

这是真实 ASGI API 合同，不是原生 UI 结果，也不证明浏览器展开、滚轮、可见范围、同节点草稿或像素可读性。原生 UI 的原断言完整保留，必须由未来准确提交的托管重跑及原件审查另行证明。

## 本次执行记录

- 原旅程 84 项纯合同与新增 3 项真实 API 合同：87 通过
- 连同证据绑定、资料阅读、当前已查看引用、行动生命周期的正反例：168 通过
- 全部前端测试：1068 通过，0 失败/跳过
- Python 编译、TypeScript typecheck/build、source guard 和 `git diff --check`：通过；编译产物无差异
- 新增 API 用例覆盖的应用网络/监听器尝试及供应商尝试均为 0。复用已有 venv 与 node 依赖，没有安装软件

前端首次执行时独立工作树尚未链接既有 TypeScript，报 `ERR_MODULE_NOT_FOUND`；链接已有依赖后完整重跑通过，没有删减测试。按本次约束未启动本地浏览器、Uvicorn 或网络监听器，未重新执行完整后端套件及 HTTP/SSE/restart/backup 链；上述局部与前端通过不能替代这些验证，也不能替代新的两平台原生结果。
