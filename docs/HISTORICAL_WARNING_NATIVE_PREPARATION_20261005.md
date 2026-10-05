# 旧报告口径提示：独立原生旅程准备

## 后续独立注册（2026-10-05 UTC）

本地整合已新增独立 `historical-warning` suite、命令 `--product-historical-warning`、报告与证据目录。只有本 suite 同时获得原 scope 和 `legacy-history-preparation` 收据类型；既有 I10 的故障准入不能用于本项，本项也不能登记故障。现有本地 native 拒绝、300秒命令、15分钟产品作业、24MiB分片及完整证据要求保持。正式 GitHub 原生任务尚未执行。

打包器保存原预提交收据字节，并要求成功后的观察值准确等于原收据加 `commit_confirmed=true`。初版注册把两者直接比较，真实 SQLite 准备结果因此被错误拒绝；修正后同一实际生产器可打包，原红保留。提前失败没有收据时仍可保留截图；提交结果未知时只归档预提交收据，不据此授予成功。错误范围、阶段、文件名、类型、hash、缺少或不一致观察值仍拒绝。

本地215项历史准备、注册生命周期、当前证据打包及既有传输合同通过；这些是进程内API和取证工具检查，不是原生用户结果。下面保留独立准备稿当时的来源与边界，公共注册“未接入”描述仅适用于准备稿阶段。

日期：2026-10-05 UTC。基线：`1a77169201268d4b9ab1ee61ec215879e9039797`。

本次交付是独立夹具准入器、旅程模块及合同测试。未修改 `web/`、`server/`、公共场景注册、GitHub workflow、共用运行预算或当前产品 pin；未启动浏览器、Uvicorn 或本次 native 验收，未发布。真实 API 测试使用隔离进程内 TestClient，编译输出检查使用 Node；两者不构成原生阅读或像素证据。

## 唯一样本与原始来源

原文件 `tests/fixtures/percentage-execution-scope-80defc9.json` 来自旧提交 `80defc9b54159155000ac7564fbdd1247c0f0403`、tree `e2ef9e3e482aeebc57e6b63db1fa3058ddfe91d7` 的认证 API 和真实旧 worker。捕获时间为 `2026-10-05T16:28:31.985708+00:00`，数据完全合成，0供应商调用。它并非由当前原生浏览器创建的旧报告。

- 完整原夹具 SHA256：`4c69e0787c384443cd31eebb425d90cb90d60333a2524175b8496690080382fc`
- 本次逐字收入的原49行选择清单：`tests/fixtures/historical-warning-single-report-manifest.json`
- 原清单 SHA256：`c6bf16cc600fb2f3d819255e8250ffaeeec454c1799d7e5dfa5d611fabb9852f`
- case：`legacy_completed`
- run：`a24a13629faa46a586cbcb3fb2995d4d`
- plan：`e090aa41e6514479884710c61abf62e6`
- dataset：`56f504d3099c41e6b7799b09f41be292`
- 原问题：2024-Q2 成本环比增长百分之多少
- 原事实：营业成本 `100000.0 CNY`；报告自己的 `readout.amount_unit=wan`，问题级表格应显示 `10 万元`
- 原 JSON SHA256：`b462099b2f3848bfcbf8ed32f08873f6c8166743ffaa031cd692864f2aa32770`
- 原 MD SHA256：`7eb624c4fbca239a4e14d573e18dcf93a0d6dd34b08eb54bd818ef7f787ef9ef`

清单是此前只读方案的原始快照，保留其当时的状态文字和来源路径，未为了本次实现改写或重新签发。清单里的整行 hash 是按原字典列序生成的审阅摘要；它不是业务指纹、报告 hash 或事件链 hash 的替代品。

## 独立准入与49行事务

`scripts/native_historical_fixture.py` 仅提供测试辅助函数，没有产品入口、HTTP导入端点、命令行启动器或环境变量绕过。原生入口必须同时获得以下两项明确、独立的调用方准入：

1. `admission_scope=historical-cost-percentage-legacy-completed-v1`
2. 当前 Probe 单独允许 `legacy-history-preparation` artifact kind

仅有 I10 或其他场景的 `fault-injection` 许可会立即拒绝。这两个代码参数也不是用户授权或 CI 环境证明。原有 GitHub-only、实际 loopback origin、既存系统临时 `lidian-native-*` 目录、`DATA_DIR`一致性、无供应商密钥和明确 web/server tree 检查仍必须通过；严禁本机设置 CI 标识以冒充 runner。原生入口在注册前核对环境和原夹具/清单；准备器在写入前再次核对。

未来在独立 runner 中，先通过现有真实注册表单建立全新 `@test.example` 账户。目标 owner 必须来自这次真实注册响应，并与当前认证 GET 完全一致。准备步骤单独标为历史夹具设置，不计为用户界面业务操作。

导入只允许：datasets 1、由原 trigger 生成的 dataset_revisions 1、conversations 1、workspace_objects 1、runs 1、messages 2、run_events 18、event_integrity 18、agent_artifacts 6，合计49行。原夹具其余表全为0行；原夹具确有 queued 记录，但从不选入、改状态或交给当前 worker。正常 worker 代码保持原样。

事务先要求捕获业务表为空，拒绝已有标识、其他账户已有业务历史或合并不同捕获；导入前后运行 foreign_key_check。仅映射外层 `user_id`：`b1d5566c1d8e4f1b9e5126e57f4ade0e` → 本次真实注册合成 owner。所有其他列、序列化字符串、ID、时间、状态、版本、批准指纹、事件序号2–19、事件锚和产物逐字保持，不重序列化保存 payload，不重算业务指纹，不关闭/修改 revision trigger。trigger 自动生成的修订必须逐字段等于原行经 owner 映射后的值，否则事务回滚。认证表不复制、不改写。

`historical-preparation.json` 保存源/目标owner、原整行与映射后整行审阅hash、各序列化列hash、行数和边界。它准确标为 `validated_before_commit`：收据写入或登记失败时整个未提交事务回滚。只有事务实际提交成功后，调用结果及 Probe observations 才增加 `commit_confirmed=true`。失败文件或单独的预提交收据不证明准备成功。

私有事务核心仅供这个原生入口及隔离 TestClient 合同使用，也要求同一个明确 scope。合同测试直接使用它，不伪造 GitHub 环境，不运行原生旅程。

## 准备好的最小原生旅程

`scripts/product_historical_warning_journey.py` 的 `historical_warning_journey` 只接收既存原生 Probe，不创建浏览器或服务。

1. 真实注册、确认空账户和无供应商；明确声明49行业务历史准备。通过当前实际 API 验证原批准绑定、完整性、警示、冻结金额和缺少原文件回执的事实
2. 真实刷新，使用顶部企业选择器，再从普通“研判报告”列表按完整原问题打开报告。读取实际入口文字和真实 URL，不直接改 hash route
3. 完整阅读警示标题、原问题、全部当前限制、全部历史说明、原始导出提示与“明确口径后新建研判”入口；警示位于原金额前。再读原金额标题、当时记录的指标、10万元、原输入和公式，以及全部来源字段、“当时未记录”和来源缺口说明。读取“记录一致性通过”，但它不证明百分比回答正确
4. 点击实际“导出报告”和“完整 JSON”链接，各下载一次，打开真实文件并与上述原hash核对；抽查原问题及100000 CNY，警示不能被补入原导出
5. 通过普通研究助手导航，在同企业默认身份建立新的当前会话，手动发送完全相同的问题。实际响应必须为 `unsupported_topic`、`can_calculate=false`、`topics=[]`、`facts=[]`、`cards=[]`、`external_calls=0`；完整可见答复明确拒绝原始金额/比率/差额替代。新消息没有“历史回答”警示，也没有虚构旧提案绑定
6. 浏览器Back返回原报告，普通列表重新打开，再刷新。再读警示/金额/来源，原49行除先前声明的固定owner映射外逐字不变；用只读导出请求确认与首次真实下载字节相同

阅读共享已审阅的完整文本 Range 与祖先 overflow clip 算法，先明确等待可见，再用原生 scroll-into-view 和鼠标滚轮读取。未使用程序设置 scrollTop、改样式/DOM/应用状态、截断全文、隐藏 API 写入或 bridge 回退。每个到达的视窗留截图与完整读取范围，像素独审状态一直为 pending，不能凭测试自动升为已阅。

允许的真实浏览器写入恰为：注册1次、当前助手会话1份、问题1条。前后闭包检查同时拒绝多余业务行；后检查仅额外容许实际响应指向的当前线程和消息，各1行。准入和终态共用同一组空表限制，memories、evidence、feedback全过程均须保持空；登录与正常审计记录独立处理，不使用 total_changes=0 错误判断整条旅程。0新运行、0新报告、0模型/公网、0损坏故障注入；旧completed的 proposal_id 原本就是 null。

初版 `7e9089db6e87ef52938995b1149ce7e9752bbc80` 的终态oracle遗漏了这三张准入空表。独审通过真实TestClient额外创建memory，证实原49行不变但旧终态检查仍通过。该反例属于oracle覆盖缺口，不证明产品助手产生了未授权副作用；原commit和独审反例保留。后续窄修增加同一空表组的终态检查，并用真实memory/evidence/feedback API创建后的拒绝控制，以及合法当前问题和登录/audit增加后的通过控制验证；未改变49行、原生业务步骤或产品源码。

## 本次本地验证与尚未执行的边界

验证使用既有 `lidian-venv` 依赖域；它不是干净 CI 安装。本机默认 Python 没有 pytest，未安装新依赖，随后选用已有虚拟环境。真实 TestClient 合同检验：双源hash与49行选择、仅owner映射、认证行不变、revision trigger、收据失败回滚、已有历史/非合成owner拒绝、全行未授权修改拒绝、真实报告列表/批准校验/原导出、当前同句拒绝、支持金额正向控制、跨账户拒绝、损坏报告或批准范围不冒充正常历史警示。

同一真实认证 API 响应进入当前 compiled runPage/reportsPage/messageView，检查普通报告入口、警示顺序、10万元、来源缺口、新拒绝与坏报告遮蔽。这仍是显式进程内 API/渲染合同，不是浏览器证据。独立reader反例覆盖缺全文、错误单位/金额、百分比替代、虚构文件/hash/期间、警示次序、无实际可见范围、祖先裁剪、滚轮不移动、等待失败、新问题被标成旧答案等。

本次执行记录、精确commit/tree及日志hash交接在独立验证包中；该包不替代未来native产物。现有公共 suite、runner入口和打包器均尚未接入本项；未来必须单独审阅并显式接入新历史准备范围和收据类型，不可借用既有fault权限或扩大共用预算。

未执行：本次 native、HTTP监听/重启链、真实下载像素、人眼截图核对、供应商、公网、旧真实账户升级登录、整库迁移、旧助手提案完成卡、adaptive英文净利润、缺分母百分比、所有词序/自然语言/视窗或无障碍布局。当前实现、API/编译通过与未来原生用户结果分别记录。
