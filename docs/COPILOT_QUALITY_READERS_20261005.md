# 研究助手质量提示读者修正（2026-10-05 UTC）

保存消息的质量卡现在显示每条原提示的季度、中文字段和原文，并注明原消息的企业、修订与目标季度。11项保存提示先显示6/11，展开其余5项后可以阅读全部11项。当前输入复核使用自己的响应和范围，实际返回5/11时只显示这5项，并说明其余6项没有返回。

首次实现提交：`4a5ce5cc8465ae3fb21289e78c6456ce3b598b42`；基点：`b69a68a7941c89fdf36bdc20a5dfeb2e075a5235`。

## 首次读者实现与边界

- `web/copilot-quality.ts` 是无状态只读读者；`web/copilot-ui.ts` 传入原消息的质量产物、context 和 research_brief.scope，`web/assistant.ts` 传入本次复核的完整响应
- 逐条提示不借用 field_coverage 的末季度，也不从当前页面企业、金额偏好或旧消息补齐字段、数值、单位、来源或未返回项目
- 空白期间、未知字段、不可读清单和缺失总数各自保留未知；总数小于实际返回条数时显示不一致。原字符串继续转义，长文本沿用现有换行样式
- ZERO_REVENUE 保留“收入为零，相关比率不可计算”；空清单只表示未列出提示，不表示全部输入完整、全部指标可算或来源已核实
- 明确到“经营数据”核对本卡企业及对应季度，保存新修订后重新提问或主动复核；来源问题到“证据资料”补充并审阅。没有新增导航、写入、自动重算或草稿处理
- 原始质量 JSON 和本次复核响应均可展开。服务端、公式、供应商调用、旧消息、报告、原生检查脚本和预算合同没有修改

## 真实 API 样本与渲染验证

`tests/fixtures/copilot-quality/` 的三份 JSON 来自基点上独立空数据库和真实认证 API 的合成企业请求：生产 ProviderService 未配置，捕获时网络尝试与 provider transport 调用均为0，未创建研判报告。它们不是原生截图当时整份响应，也不是真实财报。本轮按捕获文件原字节复用，manifest 保留各文件 SHA-256。

实际编译的 `messageView` 和 `assistantView` 读取这三份样本，得到以下结果；没有重新采集或改写 API 样本：

|样本|保存消息初始/展开|当前复核|核对结果|
|---|---|---|---|
|缺销量、产量及来源地址|6/11 → 11/11|5/11|2022-Q1起逐季度显示销量、产量，末项保留2024-Q2来源地址提示；当前响应不补齐余项|
|2024-Q2收入为0|1/1|1/1|保留零收入原提示，没有误称收入未提供|
|2024-Q2销量、产量为0|0/0|0/0|不把无提示当成全部规则可算或来源已核实|

三份输入对象在渲染前后严格相同。新增11条回归还覆盖历史与当前绑定隔离、旧记录没有期间/字段、未来字段及原标识、畸形清单/条目、未知和矛盾总数、长字段、原提示及HTML转义。相关生产者与旧原生脚本散列与基点相同。

## 首次执行记录

使用已有 Python venv 和 node_modules，未安装依赖。命令均在候选仓库根运行：

- `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json` 与正常 build：通过
- `node --test tests/copilot-quality.frontend.test.mjs tests/copilot-message-trace.frontend.test.mjs tests/frontend.test.mjs`：63条通过，其中11条为新增质量读者回归
- `python scripts/verify.py --full-chain`：2026-10-05 22:10:19 UTC结束；Python编译、typecheck、build、1063条前端测试、source guard、真实 Uvicorn HTTP/SSE/强制退出重启/SQLite备份链通过
- 同次完整后端：3638条通过、1条失败（另有3个subtests通过），不能标成全绿

唯一失败是 `tests/test_product_read_transport.py::test_probe_is_the_only_direct_product_api_request_entrypoint`：基点已有的 `product_historical_warning_journey.py` 导出检查直接使用 `p.page.context.request.get`，而静态门禁仅允许 `Probe.get` 的一个入口。单独重跑同一测试仍失败；从 `git show b69a68a:...` 核对全部 product*.py 与测试文件，原字节相同且基点已有两个匹配。此处没有削弱断言或修改该脚本。

汇总与分项证据位于 `evidence/copilot-quality-readers-20261005/`。这是实际编译读者、DOM/API合同和HTTP链证据；本轮未运行原生浏览器，展开点击、桌面/移动端的实际换行、溢出与滚动尚未取得新的原生验收。没有运行真实供应商、推送、CI、合并或部署。

## 最终冻结与恢复检查（2026-10-05 UTC）

最终源码冻结为 `754352ec84c8bf16260bd04d239c013fff9b5131`。主文改成“本次复核显示5项，共11项；其余6项未包含在本次复核结果中”，已知规则标识留在原始详情，未知标识仍明确展示。数量、季度、原提示、字段及新旧范围不变。独立只读检查重新核对源码/编译一致性并运行11条读者合同，未发现新增语义或普通用户文案阻断；它不授予原生浏览器验收。

在此之前，单独吸收已经确认的 transport 修复 `35ca6c8`（本分支为 `a90acbf`）：历史导出原字节通过 `Probe.get(as_bytes=True)` 的同一次GET取得，默认JSON、200状态要求、Connection: close、异常和无重试合同保留。25条transport检查及63条质量/消息复核/基础前端检查通过。没有吸收其他主包资产任务变更。

针对最终冻结代码新执行 `python scripts/verify.py --full-chain --tsc <已有TypeScript编译器>`：3643条后端（另有3个subtests）、Python编译、typecheck、build、source guard及真实HTTP/SSE/重启/备份链通过。前端阶段起初有8份测试文件无法启动，因为候选的 node_modules 链接已清理，显式 --tsc 路径只满足编译，不能满足测试直接 import typescript。因此该次verify原始汇总仍为失败，原日志没有改成全绿。

恢复已有 node_modules 链接后，在相同冻结代码上单独重跑完整前端：2026-10-05 22:28:13 UTC结束，1063条全部通过，未改源码、测试或断言，未安装依赖。源码与编译散列仍与独立复核和最新三份实际样本渲染一致。最终各必需本地阶段已通过；这包含一次明确记录的前端环境恢复，不是一次全绿的原始aggregate。

首次3638通过/1失败的证据原字节保留在 `evidence/copilot-quality-readers-20261005/`。最终代码的新verify原结果、前端恢复结果、渲染散列及汇总分开保存在 `evidence/copilot-quality-readers-final-20261005/`。旧失败不会被后续通过覆盖。仍未运行原生浏览器、真实供应商、推送、CI、合并或部署。
