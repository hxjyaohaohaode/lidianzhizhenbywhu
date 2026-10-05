# 单输入策略回放同意旅程（2026-10-05）

本次只补验收脚本和 CI/证据合同，应用树保持 `server 8621e57f92c821eccaf15fceed5a7bb0265bd31f`、`web 94534eed3a56136f83d837d3f4169f8a9d33db22` 不变。现有十二套产品旅程全部保留，新增独立 `strategy-consent`，场景为 `L9-strategy-consent`，命令为 `python scripts/native_acceptance.py --product-strategy-consent --expected-web-tree 94534eed3a56136f83d837d3f4169f8a9d33db22 --expected-server-tree 8621e57f92c821eccaf15fceed5a7bb0265bd31f`。

## 明确验证的用户结果

旅程使用一个真实隔离空账号、一份含两个已结束季度的合成财务输入、一份本地报告和一份明确标为背景的合成资料。财务值及20%毛利率有固定独立预期，不能复制企业名称或重复同一报表制造独立样本。

所有业务变更通过可见控件完成：先写人工验收而不勾选回放同意，确认案例数为0；明确同意后变为1；提出候选并打开中文逐例表，核对原问题、企业、季度、修订、计划/执行/覆盖、资料分组和数学一致性。单输入、无反向资料应显示零改善和完整门槛原因，界面不提供激活按钮，脚本不会伪造隐藏激活请求。经原报告、浏览器Back、重载回到同一评估，再明确撤回同意恢复0案例；重新回放零案例仍受阻，原评估、报告和输入保留。

这不验证成功激活、回滚、三份输入下的质量提升或真实供应商表现。独立进程内 API 测试中的拒绝激活请求是反例证据，不能称为原生页面点击。自动几何检查及截图也仍需按实际产物做人工像素审阅。

## 运行和证据合同

- 独立报告、清理入口和分片前缀均为 `product-strategy-consent`；失败仍收集当前截图、trace/video和进程日志，成功/失败不继承上一轮
- 新套件与旧十二套均为 Windows/Linux 两平台、每 job 15分钟、原生浏览器命令300秒；每套最多16个24 MiB分片
- 十三套产品共26个作业，加两个regression和一个dependency-audit，每个事件29个作业；Push与PR两事件完整展开共58个。后端1500秒/regression35分钟的独立修订见 [预算余量说明](CI_BUDGET_HEADROOM_20261005.md)
- CSV与当前场景绑定到 `strategy-single-synthetic-input.csv`：必须为该场景显式登记的 `synthetic-input`，文件名、文件字节SHA和报告 `fixture.csv_sha256`一致。另一同hash文件、下载类型、缺文件/记录或错hash均不可替代。其他套件保留原固定文件名合同
- 尚未创建CSV或记录fixture的早期失败仍能打包它实际产生的截图和已登记文件；没有声称生成的资料无需补造。成功场景不能缺fixture记录

## 当前执行状态

合入脚本SHA-256为 `83b7d14086c364ab053a1da480b47e6e19023f63aa251c3e4bde1cdf893726c5`，对应测试文件为 `8921257b203848ce22add0adb6d2b1be318e5f6c2cedacdc61c1bb5e584706c8`，均与冻结源一致。

已合入经过独立检查的统一测试宿主保护，四份文件匹配修订版冻结补丁SHA-256 `412f6314b87a2afb3e0ea68accc9974710d458762bdae77b2fb45a71a24180bb`。它覆盖已说明的应用HTTPS路径和测试socket入口，不是任意原生/Proactor I/O安全沙箱；完整范围和Windows尚待验证边界见 [宿主修正说明](WINDOWS_IN_PROCESS_ORACLE_20261005.md)。

最终本地聚焦七模块共246项通过：L7既有业务、L9进程内API/中文读表反例、宿主guard、runner/清理/失败capture、精确CSV分片、CI证据与预算合同。之前的84项注册/证据和8项预算合同已包含在这246项内，不另行相加。Python脚本/测试编译与差异空白检查通过；结果见 [增量检查清单](../evidence/strategy-consent-registration-20261005.json)。这些是进程内业务及测试适配器合同，不是原生旅程成功。

当前未启动本地浏览器、应用服务监听器或供应商。完整七阶段、新精确提交的Windows宿主及Windows/Linux原生L9、截图/trace审阅仍待执行，不沿用937的旧CI结果。
