# 实现架构与数据合同

模块化单体：FastAPI、严格Pydantic合同、SQLite WAL、原生TypeScript模块。服务器唯一计算财务结果；前端不补造数据。应用和有限任务队列同进程；同一数据目录禁止多进程共享执行。不是分布式Agent平台。

|模块|责任|
|---|---|
|schemas / contracts / autonomy_contracts|基础数据、计划、角色路由、假设、控制、验收、策略合同；禁止额外字段和非有限数值|
|store / workspace_store|事务、所有权、迁移、修订、审计、事件锚点、业务对象|
|models / analytics|字段口径、确定性规则、情景、基线回测和末段留出验证|
|intelligence / retrieval|企业目标、主动核查、范围先行的全文检索、实际证据立场和有效期|
|studio / autonomy|快照、外发预览、授权指纹、能力注册、动态DAG、策略与供应商绑定|
|adaptive_runtime / workflows|有界依赖调度、并行批次、动态修订、持久断点、调用台账、暂停/取消/恢复|
|evolution|人工验收、财务内容去重、策略候选、无付费回放、版本门禁、显式激活与回滚|
|providers / network / research|固定供应商连接、严格规划/解释输出、HTTPS白名单、IP固定、超时/熔断|
|app / workspace_api / autonomy_api|认证、CSRF、API、资源所有权、导出、原始品牌资源路由|
|web/views-orchestrator / live / brand / app|实际DAG、断点状态、策略实验、SSE/只读轮询降级、原始开场与微交互|

## 数据与所有权

账户身份仅来自服务器会话，不能用userId、内部Header或代理IP提升权限。数据修订、计划审批、任务控制和策略激活用事务及版本检查。所有工作区对象按user_id隔离。删除会话级联删除运行、图、断点与调用记录；独立批准计划等历史副本按照明确的清理操作处理。

原有表与旧调用兼容路径保留，新增adaptive_schema、adaptive_controls、adaptive_graphs、adaptive_checkpoints、adaptive_calls；workspace_objects增加assessment/strategy/strategy_active/strategy_evaluation。迁移是增量且幂等，遇到未来schema版本拒绝写入。获奖TypeScript库不支持无损直迁。

## 计划与执行

计划冻结财务/证据/已批准记忆/偏好/目标/可选历史。绑定版本、内容哈希、供应商主机/路径/模型、当前策略版本和24小时审批期限。数据或策略变化需要重新预览，不直接用旧授权。执行期间每次外发再次核对当前身份版本、数据版本、批准记忆、资料状态及有效期。

依赖图为受限DAG：只允许注册能力和最多24个节点，严格验证重复ID、未知依赖与环。基础门禁不可被模型删除。只读准备节点并行；模型专家可由限定规划选择并行或显式依赖，反证审阅等待相应产物。最多3并行节点、8次累计外部尝试、2轮有界修订；采用事务预留调用预算，暂停/重启不重置计数。

模型规划只接收问题、目标、研究模式、能力目录、质量警告和证据数量，不接收原文记忆/证据片段。后续专家按原授权上下文、只读工具结果与前序假设工作；实际片段ID、记忆ID、请求摘要、模型身份和usage写入调用台账。候补服务需提前披露同一输入范围。模型不能新增URL、调用任意代码、自动写入业务记录、搜索或交易。

每个节点的输入快照摘要、输出产物摘要、完成事件和执行配置互相对应。继续任务时重新核对，再复用完成产物；只读未完成步骤可重算，未知外部调用保守标记且不重发。它防止普通路径无声错配，不抵御数据库管理员重新生成整个库，不是第三方公证。

## 前端与同步

12个工作区共用企业范围。运行视图读取真实图版本、节点事件、时间、断点和调用记录，不以定时动画冒充Agent工作。原生SSE优先，故障时明确切换到有上限退避的只读轮询；终止事件与在途读取竞争时合并补读，防止状态停留。切页销毁订阅，过期身份/账户切换丢弃迟到响应。

一般变更游标仍只提醒刷新，不覆盖用户草稿。不自动重试任何写入；幂等键和乐观版本是最终保障。缩放/清单/键盘节点详情、焦点保留、断网提示、主题、移动抽屉和减少动效各有明确行为。原始品牌PNG/MP4从web/brand静态提供，同时保留/images/logo.png与/loading-video.mp4路径。

## API

运行时 `/api/openapi.json` 与同源 `/api/docs`；交付文档 `docs/openapi.json` 自动生成。
新增 `/api/workspace/orchestration/catalog`、`/runs/{id}/runtime`、`/runs/{id}/control`、`/runs/{id}/assessment`、`/evolution`、`/evolution/propose`、`/strategies`、`/strategies/{id}/evaluate`、`/strategies/{id}/activate`、`/strategies/rollback`。其他导入/修订/证据/报告/行动API保留。
旧 `/api/runs` 外部调用仍强制 PLAN_REQUIRED；旧样例生成接口返回410。旧计划无execution配置时走兼容执行器，不能假装支持新断点；新前端始终生成新执行合同。
