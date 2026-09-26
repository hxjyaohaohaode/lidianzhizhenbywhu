# 证据目录

当前验收入口：verification.json、pytest.xml/pytest.log、coverage.json、frontend-tests.log、full-chain-http.json、dom-check.json、native-browser.json、brand-integrity.json、source-guard.json、current-dependency-advisories.json、source-delta-current.json。

“通过”仅指相应命令与范围。原生浏览器明确失败，不用DOM桥接覆盖；真实外部模型调用0，不把测试替身当实际供应商连接。current构建和UI日志代表本轮。history/记录上一交付遗留记录，不能用作本轮验证。

ui-empty-workspace.png显示全新注册、业务数据全空；其他截图内“验收专用企业（合成测试）”仅为隔离测试数据。生产代码无自动演示入口；测试数据库不打包。brand-integrity.json记录恢复的原始PNG/MP4摘要。文件权属不由散列证明。

最终ZIP散列与从ZIP重新解压复验的记录在交付包外，避免将包内容与自身散列循环依赖。
