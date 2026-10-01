# 软件材料准备：真实技术信息

软件名称候选：锂电智诊企业经营与证据协同分析软件。内部程序版本4.1.0；正式名称、版本、权利人及日期由用户核定并与最终提交内容一致。本文件不是代填的申请表，不是登记通过承诺。

功能：企业季度财务数据导入与修订、单位归一和口径核验、证据分类审阅检索、声明式自主协同、计划授权的多职责协作诊断、持久断点与人工验收驱动策略演进、上下文与记忆管理、透明规则、情景分析与预测回测、不可变报告和后续行动管理。

开发语言：Python、TypeScript、HTML、CSS、SQL。应用形态：浏览器+本地或受控服务器，FastAPI服务、SQLite持久化、原生TypeScript前端。该架构没有大型模型本地训练环节。API模型解释是可选外部能力，规则诊断在无密钥时仍可运行。

主要实现：server/autonomy.py、adaptive_runtime.py、evolution.py、autonomy_contracts.py、autonomy_api.py、studio.py、workspace_api.py、workspace_store.py、analytics.py、intelligence.py、models.py、workflows.py和相关基础模块；web/views-orchestrator.ts、live.ts、brand.ts、app.ts、pages.ts、views-data.ts、views-studio.ts、views-analysis.ts及样式。仓库含用户手册、架构、方法、接口合同和测试记录；当前版本的真实运行截图来自下述GitHub CI工件，仓库中既有截图为历史基线，不表示已整理成可提交的全套截图材料。

验收截图使用隔离的合成测试输入，不应当充作真实客户案例或企业财报；逐张提交前仍需核对可见标签、遮挡、裁切与界面版本。零数据截图展示测试时的初始状态。代码鉴别材料应从确认归属的自有业务实现选择，不用node_modules/site-packages或第三方源码凑页数。本包没有附带第三方字体文件、真实密钥、业务库或node_modules。

获奖事实、参赛成员贡献、个人/合作/职务/委托开发关系、第三方授权、登记名称、完成与发表日期等需提供实际依据。保留比赛原仓库、后续改写差异和AI辅助记录，不删除贡献记录或伪造个人全部权利证明。这里仅整理实现事实，不判断登记资格或法律结论。

品牌图像和视频来自用户原比赛工程，原字节与来源摘要见evidence/brand-integrity.json；来源留存不代表已经代替用户核实第三方授权。


## 本轮源码与操作材料对齐

2026-09-30第二轮新增：持续导入修订、行动版本化编辑、证据原子作用域与检索出处保留、按身份汇总、完整数学报告导出、回放记录治理。源码入口新增`server/financial_import.py`、`server/report_export.py`、`web/math-results.ts`，操作步骤已加入用户手册。可使用`docs/PRODUCT_COMPLETENESS_20260930.md`核对功能与限制。实际登记名称、权利人、创作时间及来源授权仍应由用户依据事实确认。截图只采用对应最终版本实际运行后取得的图片，不用旧截图、设计稿或模拟界面冒充本轮运行证据。


## 2026-10-01 一致性核对与待确认事项

- 程序版本 `4.1.0` 在 `server/__init__.py`、`package.json`、`pyproject.toml` 和 `docs/openapi.json` 一致；界面简称为“锂电智诊”。`lidian-insight`、`lidian-evidence-workbench`、`lidian-workbench` 是组件/启动标识，不是已确定的登记名称。手册封面、页面页眉、源码材料和最终申请信息需在正式名称核定后统一。
- 最近已核对的应用基线代码树：`859bd2632e4dea97a85b6eeb794c80b9a7ac2df7`；远端提交 `865a43abbd14aeecd0d388bb8b989b092e3afdf8`，本地对应提交 `e97927ff7699c37c6e3d775d9bf46ed3bb4f19f4`。PR合成提交与上述树相同，不表示PR已合并。本轮随后只补诊断/测试/材料，不更改server或web应用字节；新候选全树和新CI截图身份以PR顶部及工件run-context.json、native-service-browser.json中的截图摘要为准，不把基线工件冒称新提交工件。
- 实际原生截图来源：[push验收](https://github.com/hxjyaohaohaode/lidianzhizhenbywhu/actions/runs/36866612001)与[PR验收](https://github.com/hxjyaohaohaode/lidianzhizhenbywhu/actions/runs/36866617534)的Windows/Linux acceptance工件。四份成功报告各含14张截图、48组原生检查；共56张截图不是56种独立页面。PR Windows成功来自attempt 2；首轮44项后读取连接失败，根因未确认，原失败保留。工件身份、压缩包摘要与截图摘要见 [截图来源清单](copyright-screenshot-sources.json)。已存在这些证据不等于已制作符合最终用途的操作手册插图或登记截图集。
- GitHub工件有保存期限，本轮工件标示到期日为2026-10-15。源代码内 `evidence/ui-current-*.png` 仍为历史截图，不能仅凭文件名当成本次图；需要保留当前工件，并按最终版本、页面和操作步骤挑选真实截图。新版本须重新确认截图与源码匹配。
- 多人参与的代码实现、数学模型设计、资料整理、文档协助应分别依据实际记录确认；工作量、编写代码或获奖本身不在这里自动推导个人独占或共同权利。尚未确认的权属安排不写作既定事实；个人身份、协议和证明材料宜另行私下收集，不写入公开仓库。
- 需继续整理：贡献及原工程来源依据、必要素材授权、正式名称与日期、最终冻结版本、连续可追溯的自有源码选取记录、含当前截图的版本化手册。此仓库尚未生成正式提交版鉴别材料，未代签协议或正式申报。
- 第三方依赖许可来源与未核对范围见 [第三方清单](THIRD_PARTY_NOTICES.md)。本次整理不新增托管或部署，不调用真实付费供应商，也不改变项目许可。
