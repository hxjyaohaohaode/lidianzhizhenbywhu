# 证据目录

当前验收入口：verification.json、pytest.xml/pytest.log、coverage.json、frontend-tests.log、full-chain-http.json、dom-check.json、native-browser.json、brand-integrity.json、source-guard.json、dependency-audit.json。旧版源码差异与依赖联网尝试保存在 history/，不代表当前扫描。

“通过”仅指相应命令与范围。2026-09-27 在 Windows 上原生浏览器与独立 DOM/API 桥接分别通过，结果记录在各自 JSON；真实外部模型调用 0，不把测试替身当实际供应商连接。history/ 记录上一交付遗留结果，不作为本轮验证。

ui-empty-workspace.png显示全新注册、业务数据全空；其他截图内“验收专用企业（合成测试）”仅为隔离测试数据。生产代码无自动演示入口；测试数据库不打包。brand-integrity.json记录恢复的原始PNG/MP4摘要。文件权属不由散列证明。

最终ZIP散列与从ZIP重新解压复验的记录在交付包外，避免将包内容与自身散列循环依赖。
