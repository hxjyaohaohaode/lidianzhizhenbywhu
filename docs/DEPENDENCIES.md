# 依赖与构建环境

2026-09-27 在 Windows/Python 3.12.13/Node 24.15.0 上从锁定清单安装并构建。GitHub 源码不包含 `node_modules`、虚拟环境或已编译的 `web/dist`；首次克隆需按 README 执行 `npm ci --ignore-scripts`、`npm run build`、Python 依赖安装。前端运行无 CDN 或运行时框架依赖。

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

PDF 解析不属于核心依赖；`requirements-pdf.txt` 是独立可选路径，需要额外安装与安全验收。项目不打包第三方字体文件。实际环境与执行范围见 `evidence/environment-current.json` 和 `docs/VALIDATION.md`。
