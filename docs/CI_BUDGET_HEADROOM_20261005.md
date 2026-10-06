# 后端全套预算余量调整（2026-10-05）

本次只把 `scripts/verify.py` 的 pytest 总预算从 1200 秒调整为 1500 秒，以及 Windows/Linux regression 作业从 30 分钟调整为 35 分钟。具体失败另行修复；延时不把失败变为通过，不增加浏览器等待，不跳过、分片或重试测试。

## 原始测量及失败仍保留

应用提交 `9376956f72497f1607038024cf0ad20d8134d89f` 的两份 Windows 原始验收工件都完成全部 2821 个测试，结果均为 2820 通过、1 失败，另有 3 个子测试通过。测试与子测试不相加成独立用例数。

- [Push 37322170829](https://github.com/hxjyaohaohaode/lidianzhizhenbywhu/actions/runs/37322170829)：pytest 进程阶段 1196.572 秒，距 1200 秒仅 3.428 秒；pytest 内部用时 1187.36 秒。工件 `11351837044`，SHA-256 `ce5d53bfa3971304b83e6171c2d422491f327f717052e976c94c814c02eca744`
- [PR 37322179804](https://github.com/hxjyaohaohaode/lidianzhizhenbywhu/actions/runs/37322179804)：pytest 进程阶段 950.699 秒，内部用时 943.76 秒。执行身份是合成 merge `67f75b9f453a2f38da18dac9c0b30efca95f50d9`，不能写成 HEAD SHA。工件 `11352745130`，SHA-256 `30bd9c485bce20f57432cbbefa90e1b1714270c93fd304ea0df6862bab16d486`

两份失败均是 `test_product_question_scope.py::test_oracles_match_actual_staged_csv_messages_and_trace_in_process` 的网络禁止钩子拦截 Windows Proactor 测试宿主创建唤醒 socketpair；不是 pytest 总预算超时。原失败日志、失败退出码与 PR 来源旅程的取消结论均保留。宿主保护修正有独立说明与验证，不能由预算变更替代。

1500 秒是在已完成但接近上限的实际运行基础上留出 300 秒有限余量，不按单次 Chromium 安装耗时推高任何 UI 预算。35 分钟相应容纳后端全套与既有安装、原生验收、启动和工件上传阶段；不保证所有阶段同时用满各自上限仍完成。再次触界时应检查新进度与线程证据，不能自动继续加时。

## 保持的门槛

- 每个测试 setup/call/teardown 合计 120 秒硬 watchdog，逐阶段进度账本和完整收集/完成检查
- 其余每个 verify 阶段 240 秒；原生浏览器命令 300 秒；每套独立 product job 15 分钟
- 全部既有业务断言、原生/HTTP/重启/备份/启动链、失败退出及不重试语义
- 每套证据最多 16 个 24 MiB 分片，原有失败截图、trace/video、摘要和始终上传路径
- 应用代码、编译产物、Logo/视频、数学公式与历史报告

本差异需要独立静审和新精确提交的完整七阶段及 Windows/Linux CI。既有失败和通过均只属于原身份，本说明不宣称新预算下或新代码已经完整通过。
