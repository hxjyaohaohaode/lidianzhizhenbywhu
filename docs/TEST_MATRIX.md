# 要求—实现—反向测试对应

需求覆盖以本表为边界，不把测试数量当作所有可能情况已穷举。

|范围|实现位置|可复现证据与关键反向情况|
|---|---|---|
|基础获奖业务保留|models/analytics/workspace_api及原工作区|保留307例上一交付测试；数据口径、修订、证据、报告、行动与对象隔离|
|能力白名单与DAG|autonomy/autonomy_contracts|test_adaptive：未知角色/代码/URL、重复节点、未知依赖、环、超范围预算|
|不同研究问题与深度|compile_graph/adapt|问题与显式设置不同→实际节点不同；不应启用的能力不执行|
|真实专家并行与依赖|adaptive_runtime|parallel/evidence_first/analysis_first；观察调用重叠和实际上下文，而非图形截图|
|模型建议实际生效|model/propose/adapt|限定建议增减专家、添加只读预测、非法建议降级；local_recovery退出|
|数学工具与上下文联动|analytics/adaptive_runtime|同一快照预测/情景、缺口与立场进入实际模型输入；不足样本留下blocked|
|调用预算及供应商绑定|reserve_call/authorization_valid|1/2/4/8次数边界、字符上限、供应商更换、授权变化、HTTP429候补范围|
|费用与未知结果|adaptive_calls/model|超时/连接错误/取消未知请求不重发；复用已完成外部断点；重复解释不新增付费修订|
|有界修订|review/adapt|伪造引用、Unicode数字、无效指标、NaN/Infinity、0/1/2轮边界、重审失败保留|
|断点与恢复|adaptive_checkpoints/control_run|暂停边界、并发CAS、队列满、取消不可恢复、伪造产物失败；真实进程SIGKILL后显式继续|
|外发最小化|planner上下文+派发台账|规划职责无记忆/证据原文；专家实际发送ID、角色身份、usage；撤回阻止后续|
|治理性演进|evolution|无人工标签/无授权/无改善拒绝；改名相同输入去重；保留组缺项阻塞；不能重设原深度提高评分|
|评估和激活一致性|activate/rollback|新案例/撤回/候选/活动基线变化拒绝；显式激活后旧计划失效；回滚不改历史|
|预测非泄漏|forecast_baselines|test_holdout_and_brand：改末两期目标不影响开发选择与第一留出预测；少于10期不造留出分数|
|原Logo与开场视频|brand.ts/brand目录/静态别名|原SHA256一致；实际HTTP206 Range；跳过、Escape、减少动效与错误回退|
|事件与前端竞态|live.ts/api.ts/runPage|终态事件竞争补读、读取失败降级、销毁后迟到响应、旧身份数据丢弃、跨接口终态补读|
|数据真实性及XSS|server合同/web组件|新账户零数据、上传暂存不写正式库、输入转义、图表不补缺失季度|
|联动UI|dom_check.py|实际Chromium渲染和真实本地API桥接32流程；不是原生Cookie/CSP/SSE浏览器验收|
|协议端到端|full_chain_check.py|独立Uvicorn真实TCP/HTTP、multipart、SSE+Last-Event-ID、恢复、策略、导出、备份12组|
|环境边界|browser_check/依赖记录|原生导航被管理员阻止；未绕过。外部供应商、Windows/macOS、Docker、公网/长期负载未验证|

Python故障供应商与网络替身都是显式注入测试，不是生产开关，不表示真实账号/模型成功。真实进程测试不使用API假响应。记录哈希不能防御拥有整个数据库写权限的管理员重造整条链。多角色结构性反证不是事实认证。
