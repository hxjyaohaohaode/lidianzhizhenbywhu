# 2026-09-27 本机验收记录

本记录对应当前源码及本机重新构建的 `web/dist`。环境为 Windows、Python 3.12.13、Node 24.15.0、TypeScript 5.8.3。运行库使用隔离目录；UI 与自动测试中的企业均为明确标记的合成数据。原始 PNG 和 MP4 的 SHA-256 与 `evidence/brand-integrity.json` 一致。

|实际执行|结果|记录|
|---|---|---|
|`npm ci`、`npm run build`、TypeScript 严格检查、Python 编译|通过|`evidence/frontend-build.log`、`evidence/typecheck.log`、`evidence/python-compile.log`|
|`python scripts/verify.py --full-chain`|所有列出的检查通过|`evidence/verification.json`|
|后端正向、逆向及故障注入回归|387 passed，2 个上游弃用警告|`evidence/pytest.log`、`evidence/pytest.xml`|
|前端渲染、转义、事件竞争及传输合同|34 passed|`evidence/frontend-tests.log`|
|后端覆盖率回归|387 passed；语句 2958/3128，分支 816/990|`evidence/coverage.json`、`evidence/coverage-test.log`|
|真实 Uvicorn HTTP、SSE、强制退出重启、人工演进与在线备份|12 组检查通过|`evidence/full-chain-http.json`、`evidence/full-chain-http.log`|
|原生 Chromium 经真实本机网络、ESM、Cookie、CSP 运行|35 个业务检查通过；390px 页面无文档级横向溢出|`evidence/native-browser.json`、`evidence/native-browser.log`；源码仓库保留 4 张当前界面截图|
|Chromium 渲染与显式本地 HTTPX API 桥接|35 个业务检查通过；单独记录，不能替代原生浏览器|`evidence/dom-check.json`、`evidence/dom-final.log`|
|限定源码守卫|51 个文件；0 项规则发现|`evidence/source-guard.json`|
|`pip-audit -r requirements.txt --strict`|17 项解析依赖、当次 0 项已知漏洞|`evidence/dependency-audit.json`|

浏览器检查实测桌面导航从 224px 收缩至 70px 并恢复；研究助手展示当前修订的公式、输入路径和季度轨迹；同一账户切换顾问及企业视角后得到不同追问。角色切换的 API 使用所有者会话和版本条件写入；无效角色及旧版本请求分别被拒绝。助手越权数据集请求返回 404，用户资料片段按企业范围检索。前端对查询、证据文本、路径和链接进行转义或安全协议限制。

真实供应商模型及公网搜索调用为 0。测试替身只验证协议、失败处理与授权边界，不能说明任何真实账户、额度或外部模型效果。未在本轮验证 Docker 构建、公网 HTTPS 部署、跨设备兼容、长期负载、完整联网依赖漏洞审计、可选 PDF 解析器或领域预测的外部校准。系统默认在本机单进程运行；生产部署仍需按 `docs/DEPLOY.md` 完成独立验收。

全量回归最初在 Windows 因 Pytest 把超长参数写入环境变量而产生 2 个准备阶段错误；给该参数添加短测试 ID 后，原测试输入保持不变且全量通过。真实 HTTP 链最初在退出时因测试脚本未关闭备份数据库连接而失败；显式关闭连接后 12 组检查通过。原生浏览器脚本最初使用受 CSP 禁止的 `eval` 式等待；改用 Playwright locator 等待后通过，没有放宽产品 CSP。
