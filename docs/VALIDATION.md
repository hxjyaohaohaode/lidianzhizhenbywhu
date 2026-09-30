# 2026-09-30 4.1 实际验收记录

基线：`cdca0052a23273efb4366ca204b0d9bac40da2a5`。本轮环境：Linux、Python 3.12.14、Node 24.19.0、TypeScript 5.8.3。测试使用隔离临时数据库和明确的合成输入；运行时新账户仍为空。以下结果仅属于本轮代码和注明的检查范围。

|执行项|本轮结果|证据|
|---|---|---|
|Python 编译、TypeScript 严格类型检查、实际前端构建|通过|`evidence/verification.json`、匹配的 `web/dist`|
|完整后端回归|585 passed，0 failed；2项上游弃用警告|`evidence/verification.json`，执行生成的 `pytest.log` / JUnit|
|前端逻辑/DOM合同/异步竞态回归|59 passed，0 failed|`evidence/verification.json`，执行生成的 `frontend-tests.log`|
|真实 Uvicorn / HTTP / SSE / 强制退出恢复 / SQLite 备份|12组通过，无API假响应|`evidence/full-chain-http.json`|
|限定源码检查 / git diff 空白检查|通过；不是完整漏洞扫描|`evidence/source-guard.json`|
|Python依赖一致性|`pip check`通过|本轮命令记录|
|联网依赖审计|20项Python解析依赖和1项npm开发依赖；当次数据未报告已知漏洞|`evidence/dependency-audit-current.json`、`evidence/npm-audit-current.json`|
|原始 Logo / MP4|SHA-256与基线逐字节相同；真实HTTP与Range通过|`evidence/brand-integrity.json`、`evidence/full-chain-http.json`|
|当前原生浏览器验收|**受环境限制，未通过**。Chromium启动因 `socket() failed: Operation not permitted` 中止，尚未进入页面|`evidence/native-service-browser.json`、`evidence/native-service-command.json`|
|当前DOM/API桥接验收|**未运行**，未用它替代原生浏览器|旧桥接记录仅历史资料|
|当前渲染截图、跨设备视觉、暗色/减少动效几何|**未完成**。CI脚本已增加相应检查，需在允许浏览器的环境实际执行|`scripts/service_browser_check.py`；旧截图不作本轮证明|
|真实供应商 / API额度 / 模型质量 / 公网搜索|**未运行，真实外部调用0**。协议验证是显式测试替身|供应商官方文档核对见 `RELEASE_4_1.md`|
|GitHub最终提交与CI|由最终远端提交的独立结果确认，本地通过不代表已推送或CI通过|最终交付的GitHub提交/运行链接|
|Windows/macOS实机、Docker、公网HTTPS、长期负载、可选PDF集成、专业预测外部校准|**本轮未运行**|不能用历史本机记录替代|

## 关键新增反向验证

- 旧标签页删除/归档/取消时版本不符则拒绝；批量删除先校验全部版本，失败不取消任何任务；暂停可继续的任务保留其批准计划
- 口令校验进行期间另一请求更改密码或撤销会话，旧请求不得继续修改密钥、密码、账户或会话；重复安全头/请求长度冲突在读取请求体前拒绝
- 私有模型选择强制账户范围；冻结输入或批准指纹/事件链/图/派发锚点被修改时禁止新调用；未知付费结果不自动重发
- 已完成检查点不可改写；派发预约之前的中断和预约之后结果未知严格区分；旧无批准计划的外部任务只给本地降级结果
- 演进只用人工同意的完成案例，真实执行本地能力，缺证据不能计为改善；保留组不反向参与候选构造，激活重新计算当前案例/基线/候选门槛
- 助手线程/提案/页面读取的迟到结果不覆盖新上下文或重新打开已关闭窗口；重复创建使用稳定幂等键
- 跟踪不把开放或未来季度当成已完成数据，结束日为UTC含当日；归档提醒不因相同输入重复生成
- 两种数据导出来自同一事务快照，扩展对象/运行证据完整且仅属本账户；备份密钥必须真实解密副本凭据，否则失败并清理未完成输出

首次完整整合检查出现一处测试仍将API版本硬编码为4.0.0，运行程序已升级为4.1.0。更新版本断言后重新执行完整检查得到上表结果，没有删除行为或安全断言来换取通过。上游Starlette的httpx/BlockingPortal弃用警告仍保留，未伪装成零警告。

## 原生浏览器与证据诚实性

只尝试支持的本机Chromium启动，未修改管理员策略、未增加绕过参数、未切换桥接把失败改为成功。验收入口现在在尝试开始时清空旧成功标志，启动失败不再遗留上次通过的JSON。

CI原生脚本包含原有15工作区390px流程，另加1440/1280/1024px侧栏和助手组合、900px断点、320px全部工作区、750×500横屏、关闭抽屉inert/焦点恢复、暗色及减少动效。本轮这些新增原生断言只完成编译/审阅，必须由CI实跑才能称通过。

[上一轮2026-09-27 Windows记录](VALIDATION_20260927.md)仅供历史参考。本目录原来的 `ui-current-*.png` 虽保留文件名，其内容来自旧基线，不代表4.1当前屏幕。
