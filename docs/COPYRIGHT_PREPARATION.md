# 软件材料准备：真实技术信息

软件名称候选：锂电智诊企业经营与证据协同分析软件。内部程序版本4.0.0；正式名称、版本、权利人及日期由用户核定并与最终提交内容一致。本文件不是代填的申请表，不是登记通过承诺。

功能：企业季度财务数据导入与修订、单位归一和口径核验、证据分类审阅检索、声明式自主协同、计划授权的多职责协作诊断、持久断点与人工验收驱动策略演进、上下文与记忆管理、透明规则与情景回测、不可变报告和后续行动管理。

开发语言：Python、TypeScript、HTML、CSS、SQL。应用形态：浏览器+本地或受控服务器，FastAPI服务、SQLite持久化、原生TypeScript前端。该架构没有大型模型本地训练环节。API模型解释是可选外部能力，规则诊断在无密钥时仍可运行。

主要实现：server/autonomy.py、adaptive_runtime.py、evolution.py、autonomy_contracts.py、autonomy_api.py、studio.py、workspace_api.py、workspace_store.py、analytics.py、intelligence.py、models.py、workflows.py和相关基础模块；web/views-orchestrator.ts、live.ts、brand.ts、app.ts、pages.ts、views-data.ts、views-studio.ts、views-analysis.ts及样式。用户手册、架构、方法、接口合同、测试报告和真实运行截图附在包内。

测试截图的公司名称均注明验收合成测试，不应当充作真实客户案例或企业财报。零数据截图展示产品真实初始状态。代码鉴别材料应从确认归属的自有业务实现选择，不用node_modules/site-packages或第三方源码凑页数。本包没有附带第三方字体文件、真实密钥、业务库或node_modules。

获奖事实、参赛成员贡献、个人/合作/职务/委托开发关系、第三方授权、登记名称、完成与发表日期等需提供实际依据。保留比赛原仓库、后续改写差异和AI辅助记录，不删除贡献记录或伪造个人全部权利证明。这里仅整理实现事实，不判断登记资格或法律结论。

品牌图像和视频来自用户原比赛工程，原字节与来源摘要见evidence/brand-integrity.json；来源留存不代表已经代替用户核实第三方授权。
