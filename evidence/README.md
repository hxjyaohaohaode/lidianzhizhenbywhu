# 证据目录

当前验收入口：`verification.json`、`full-chain-http.json`、`native-service-browser.json`、`service-browser-check.json`、`source-guard.json`、`dependency-audit.json` 和 `brand-integrity.json`。本机日志与 JUnit 报告由验收命令生成，未纳入源码；GitHub Actions 运行时作为单独工件保留。旧版记录保存在 `history/`，不代表当前扫描。

“通过”仅指相应命令与范围。2026-09-27 在 Windows 上原生浏览器与独立 DOM/API 桥接分别通过，命令及是否使用桥接记录在 `native-service-command.json` 和 `bridge-service-command.json`；真实外部模型调用 0，不把测试替身当实际供应商连接。

`ui-current-empty.png` 显示全新注册、业务数据全空；`ui-current-copilot.png`、`ui-current-approval.png`、`ui-current-services.png`、`ui-current-mobile.png` 是本轮原生浏览器在隔离测试数据下的当前界面。生产代码无自动演示入口；测试数据库不打包。`brand-integrity.json` 记录原始 PNG/MP4 摘要。文件权属不由散列证明。

最终ZIP散列与从ZIP重新解压复验的记录在交付包外，避免将包内容与自身散列循环依赖。
