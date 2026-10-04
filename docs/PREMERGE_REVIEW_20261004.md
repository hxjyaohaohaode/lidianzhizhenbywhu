# 合并前核查与提醒来源修复（2026-10-04）

目标是可运行、可审阅并可继续整理软件著作权技术材料的候选。合并由用户操作；本轮不增加业务功能、不部署，不表示正式登记资格、权属或申报材料已核定。

核查基线：`24775f1634df7ddef29605b4f107187402499322`，tree `e8488aadc1c19f910bce253b4b4744b9f0567a9a`。已逐项读取PR #2的16条行内意见与2条只在review正文出现的意见；GitHub“未解决”或“已过时”标志不作为是否修复的证据。最终提交与检查终态以 [PR #2](https://github.com/hxjyaohaohaode/lidianzhizhenbywhu/pull/2) 顶部和同SHA工件为准。

## 本轮复现与修复

报告→行动（可选）→跟踪规则→数值提醒→新行动/跟踪的转交会丢失规则原始来源。隔离复现中，上游报告产物已损坏，直接报告来源会被拒绝，但提醒来源仍返回201且标记current。

现在保留独立的`rule_origin`，逐级核查已冻结祖先，最多八层。损坏报告不能通过历史确认继续生成新业务记录；格式无效的已记录来源和不匹配的提醒指纹也不能通过确认绕过。确实没有保存的旧来源显示unknown，要求明确历史选择。已有旧行动从指纹一致的原提醒只读检查遗漏祖先，新派生记录再冻结可查到的来源，不回写旧记录。

提醒自身的数值、阈值、期间、输入修订仍来自原本的数值计算。来源适用性变化是附加说明，不把当前输入替换成祖先的旧输入，也不重算或删除旧提醒/报告。原业务依据已有变化时继续使用原有历史确认机制；撤回策略回放同意不等于撤回普通数值业务用途。

独立复核还发现“schema_version=1但内容为空/类型错误”的来源可绕过核验或导致500；现校验公共字段、类型、各来源必要ID/指纹、依赖列表和对照摘要。缺失与损坏分别处理，拒绝写入时无附带业务修改。

实际HTTP链在隔离备份副本中故意损坏报告产物，再核对提醒来源的新行动返回409/REPORT_INTEGRITY，即使明确选择历史依据也不能绕过。原服务、提醒数值与其余业务记录不受该测试污染。

## 全部审查意见映射

下表ID为GitHub行内评论数字ID；两条正文意见使用review ID。标为“已有”表示核查基线已实现，并已读代码、执行指定聚焦回归；不是本轮重复修复。

|意见|核查结果与实际机制|主要回归|
|---|---|---|
|4157290866 同比误加收入增速|已有；question_scope将比较基期与指标分开|test_question_scope|
|4157290872 应收等周转误替存货周转|已有；不支持的周转对象明确拒绝|test_question_scope|
|4158088599 删除评估来源后策略仍有效|已有；store删除事务、evolution.current_active与新规划消费再次检查来源|test_strategy_source_lifecycle、test_strategy_cleanup|
|4158088615 损坏报告成为新写入来源|已有；report_integrity检查快照/数据/产物/事件/完成证据，直接及行动继承共用|test_report_source_integrity|
|4158088621 未派发失败恢复成未知结果|已有保守替代；已验证的失败闭合记录恢复为已知失败，保留错误与调用ID；不自动重试，需新批准计划|test_adaptive_recovery_selection|
|4158088630 未确认预览可以直接执行|已有；非可执行proposal_preview与提案绑定，保存/确认原子，撤销关联未执行预览|test_proposal_execution_binding、proposal-preview.frontend|
|4162962208 提醒丢失规则祖先|本轮修复；冻结/有界复核rule_origin，保留独立数值基期；旧记录只读核查|test_alert_origin_premerge、实际HTTP恢复链|
|4162962214 毛利金额误答毛利率|已有；明确金额请求不支持，不替换单位或事实|test_review_input_contracts|
|4162962217 未披露证据URL外发|已有；model_context.provider_context在新计划和普通/自适应派发边界移除结构化URL字段；不修改本地来源|test_evidence_model_disclosure|
|4162962219 实验可省略已查看修订|已有；契约必填版本/hash，事务内拒绝缺失/陈旧绑定|test_review_input_contracts|
|4163074553 净利润率误答金额|已有；显式比例别名并排除嵌入的净利润金额别名|test_question_scope|
|4163239086 非自适应interrupted计划无法清理|已有；所有本人interrupted运行可显式取消，再版本化归档计划|test_legacy_studio_lifecycle|
|4163239092 只给evidence_ids绕过版本|已有；契约与evidence_snapshots双层强制完整、对应的修订引用|test_action_evidence_binding|
|4164043830 收入增速误称缺少基期|已有；metric_facts和metric-comparison分别呈现增速和收入基期金额|test_cash_growth_semantics、metric-comparison.frontend|
|4164264753 数据来源省略修订|已有；dataset及未绑定消息的Copilot来源必须带已查看版本/hash，单事务读取和写入|test_dataset_source_bindings|
|4164264761 现金余额误答现金流|已有；存量现金请求明确不支持，不替换成流量/比率|test_cash_growth_semantics|
|PRR_kwDOSGgyNM8AAAABQNQnKw planner遗漏challenger仍调用|已有；所有可选专家统一按规划选择过滤，确定性复核/报告仍执行|test_adaptive_recovery_selection|
|PRR_kwDOSGgyNM8AAAABQS6oxQ DNS/TLS授权撤回误记已发送|已有；派发预留与真实发送分开，保留MODEL_AUTHORIZATION_CHANGED和dispatched=false|test_legacy_studio_lifecycle、test_adaptive_transport_disclosure、test_transport_lifecycle|

证据URL修复是结构化元数据最小化，不是任意文本DLP；明确批准的问题、摘录、记忆和历史文本可能仍含URL。旧无整体输出锚点的报告、已经失去关联且无法辨认的旧预览计划，继续适用[已有兼容边界](review-regressions-20261001.md)，不伪造旧证据。已知未派发失败不会被说成“自动重试已实现”。

## 验证与合并门槛

聚焦回归与完整聚合分开记录在`evidence/premerge-review-20261004.json`。独立分组核查执行230项指标/输入后端、109项生命周期后端、21项前端渲染；它们与最终全套重叠，不加总。新增来源链测试包含损坏矩阵、真实嵌套链、旧遗漏祖先、历史许可、身份/账户隔离、策略回放同意、结构坏值及零写入。前端fixture结果不冒充原生浏览器结果。

核查时main分支未受保护、仓库rulesets为空；无需通过Vercel状态才能具备GitHub技术合并资格，但其自动预览失败仍须披露，不能称公网可用。最终建议仍要求新精确SHA完整检查终态、独立复核无未处理阻断和源码/编译产物一致；不由绿色按钮代替代码审核。

软件名称、权属/贡献关系、完成/发表日期、正式图文材料及真实模型/企业样本验收仍需实际依据。Windows双击、生产负载、Docker/公网和真实供应商费用/效果不由本轮隔离测试证明。DeepSeek、GLM、MiMo、Qwen、原财务公式和品牌资源不变。


## 最终本地执行记录

2026-10-04T12:15:43.898263+00:00 完成七阶段：1472后端（0失败/错误/跳过）、347前端、18组真实HTTP全部通过。逐测试进度的收集、开始、完成及setup/call/teardown均为1472，完整结束；不是旧JUnit复用。来源链30项及原损坏复现由独立复核者另行确认，未计作额外独立总数。OpenAPI、依赖一致性、原品牌/公式字节和diff检查通过。

本机原生尝试未进入任何业务页面：默认浏览器文件缺失；使用已安装Chromium的受支持路径后，宿主socket权限阻止启动。原失败保留，未修改策略或通过桥接冒充；最终原生仍须新SHA的CI实跑。GitHub机器人最新公开留言显示自动审查额度耗尽，因此本轮不声称获得新的自动审查批准；本地独立代码复核与测试是另外的证据。
