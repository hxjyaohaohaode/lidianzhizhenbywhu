# 依赖与许可核对

2026-10-01：依赖用途/漏洞记录与许可核对分开维护，见 [第三方许可来源清单](THIRD_PARTY_NOTICES.md)。直接运行依赖还包括 `cryptography==50.0.1`，用于私有连接加密。Python仅锁定直接依赖，以下“锁定清单”不代表全部传递依赖可重现；本地安装与既有审计快照的四项版本差异见清单。

## 依赖审计历史记录（2026-09-30）

本轮锁定清单在Linux/Python3.12.14/Node24.19.0安装，pip check通过；pip-audit解析20项Python依赖、npm audit检查1项开发依赖，当次均未报告已知漏洞。记录见evidence/dependency-audit-current.json和npm-audit-current.json。该结果不是未来漏洞或生产安全保证。

以下为2026-09-27历史说明：

# 依赖与构建环境

2026-09-27 在 Windows/Python 3.12.13/Node 24.15.0 上从锁定清单安装并构建。GitHub 源码保留编译后的 `web/dist`，便于不安装 Node 的本地启动；开发和验收仍须运行 `npm ci --ignore-scripts` 与 `npm run build`，核对编译产物与源码一致。仓库不包含 `node_modules`、虚拟环境或业务数据库。前端运行无 CDN 或运行时框架依赖。

|核心包|锁定版本|用途|
|---|---|---|
|FastAPI|0.141.1|HTTP API 与请求合同|
|Starlette|1.3.1|ASGI 与安全中间件|
|Pydantic|2.13.4|严格数据验证|
|Uvicorn|0.48.0|单进程服务|
|python-multipart|0.0.32|受限文件上传解析|
|openpyxl|3.1.5|受限 XLSX 解析|
|defusedxml|0.7.1|XML 解析边界|
|TypeScript|5.8.3|前端构建，仅开发依赖|

最初的锁定版本 Starlette 0.50.0 与 python-multipart 0.0.29 在当前 `pip-audit --strict` 中被报告存在已知问题；升级后重新执行全量回归、真实 HTTP 链、原生 Chromium 和显式 DOM/API 桥接。`evidence/dependency-audit.json` 记录 17 项解析依赖、0 项当次已知漏洞；这只覆盖 `requirements.txt` 的供应链元数据，不是源码审计、全部可选依赖或未来安全保证。GitHub CI 在 Ubuntu 与 Windows 重新安装并运行同一依赖审计。

PDF 解析不属于核心依赖；`requirements-pdf.txt` 是独立可选路径，需要额外安装与安全验收。项目不打包第三方字体文件。当前执行范围见 `docs/VALIDATION.md` 及 `evidence/verification.json`。
