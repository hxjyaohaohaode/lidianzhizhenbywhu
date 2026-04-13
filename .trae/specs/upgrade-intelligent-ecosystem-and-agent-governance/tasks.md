# Tasks
- [x] Task 1: 盘点并重构系统配置与治理开关
  - [x] SubTask 1.1: 审查环境变量、服务端配置校验、模型接入配置与数据源配置，补齐缺失项
  - [x] SubTask 1.2: 增加缓存、限流、异步任务、智能体预算、实时信息治理等系统级配置入口
  - [x] SubTask 1.3: 建立面向开发、测试、生产的配置分层与健康检查扩展

- [x] Task 2: 建立持久化的数据与记忆底座
  - [x] SubTask 2.1: 设计并实现用户、画像、会话、长期记忆、任务记录、分析结果的数据模型
  - [x] SubTask 2.2: 将现有进程内存的会话与记忆能力迁移为可持久化实现，并保留兼容接口
  - [x] SubTask 2.3: 为历史分析资产查询、恢复与复用补充服务端接口与权限边界

- [x] Task 3: 升级数学建模执行链路
  - [x] SubTask 3.1: 为建模输入增加结构校验、缺失处理、口径归一与异常兜底
  - [x] SubTask 3.2: 为模型参数、版本、解释摘要与结果快照建立治理与审计输出
  - [x] SubTask 3.3: 为企业分析与投资分析任务接入可复现的模型执行记录

- [x] Task 4: 升级实时信息与外部数据接入能力
  - [x] SubTask 4.1: 将关键外部数据源从模拟实现升级为真实抓取或标准化连接器
  - [x] SubTask 4.2: 为实时检索链路增加缓存、来源白名单、可信度排序、去重与时效过滤
  - [x] SubTask 4.3: 为实时信息缺失、冲突与超时场景补充降级与提示策略

- [x] Task 5: 建立跨角色个性化服务能力
  - [x] SubTask 5.1: 扩展企业用户、投资用户的长期偏好、阶段画像与反馈学习字段
  - [x] SubTask 5.2: 将个性化信息接入推荐、表达生成、任务提醒与证据排序链路
  - [x] SubTask 5.3: 为运营人员与管理员补充用户分层、失败洞察与服务机会视图

- [x] Task 6: 强化性能、稳定性与任务反馈机制
  - [x] SubTask 6.1: 为长链路任务建立异步执行、状态流转、进度反馈与结果回填机制
  - [x] SubTask 6.2: 为模型调用、实时检索与数据抓取增加超时、重试、缓存、限流与失败恢复
  - [x] SubTask 6.3: 增加关键链路的可观测性指标、结构化日志与诊断追踪信息

- [x] Task 7: 升级智能体协同治理与生态闭环
  - [x] SubTask 7.1: 为数据采集、理解、建模、审校、表达等智能体建立统一状态机与节点追踪
  - [x] SubTask 7.2: 为智能体执行增加预算控制、交叉校验、重试策略与人工接管入口
  - [x] SubTask 7.3: 面向企业用户、投资用户、运营人员与管理员验证多角色闭环体验

- [x] Task 8: 完成系统级验证与竞争力验收
  - [x] SubTask 8.1: 补充存储、建模、实时信息、个性化与智能体协同的自动化验证
  - [x] SubTask 8.2: 执行关键用户路径、异常场景与性能场景验证
  - [x] SubTask 8.3: 对照市场竞争维度输出数据时效性、可信度、个性化与流畅性的验收结果

- [x] Task 9: 建立可量化的竞争力验收基线
  - [x] SubTask 9.1: 为时效性、可信度、个性化与协同效率定义明确指标
  - [x] SubTask 9.2: 补充可重复执行的基准数据集与验收脚本
  - [x] SubTask 9.3: 输出基于当前系统结果的竞争力验收报告

- [x] Task 10: 打通真实用户绑定与个性化配置闭环
  - [x] SubTask 10.1: 消除前端固定用户标识，建立首次进入可生成并持久化的用户身份机制
  - [x] SubTask 10.2: 将主题模式、主题色、角色偏好与关键画像绑定到用户档案并跨会话恢复
  - [x] SubTask 10.3: 为用户历史、会话、记忆与分析结果接口补充端到端联调用例

- [x] Task 11: 打通真实记忆展示与分析工作台数据闭环
  - [x] SubTask 11.1: 将记忆页从静态占位数据切换为真实后端记忆、会话与历史数据驱动
  - [x] SubTask 11.2: 补充企业端与投资端关键工作台对真实接口的接入校验
  - [x] SubTask 11.3: 验证用户数据沉淀后能够在后续分析与展示中被正确复用

- [x] Task 12: 完成浅色与深色模式的系统级显示验收
  - [x] SubTask 12.1: 排查全站核心页面、弹层、图表与记忆视图在浅色/深色模式下的可读性与层次问题
  - [x] SubTask 12.2: 修复主题切换后异常颜色、边框、阴影与遮罩不一致的问题
  - [x] SubTask 12.3: 建立主题回归检查清单并补充关键界面验证

- [x] Task 13: 完成 API 即可运行的接入验收
  - [x] SubTask 13.1: 核对实时数据源、RAG、模型路由、Agent 编排与降级链路的真实配置要求
  - [x] SubTask 13.2: 修复阻碍“仅填写 API/必要凭证即可运行”的默认配置、校验与回退问题
  - [x] SubTask 13.3: 补充一份覆盖建模、记忆、最新数据、模型调用与用户绑定的最终验收结果

# Task Dependencies
- [Task 2] depends on [Task 1]
- [Task 3] depends on [Task 1]
- [Task 4] depends on [Task 1]
- [Task 5] depends on [Task 2]
- [Task 5] depends on [Task 3]
- [Task 5] depends on [Task 4]
- [Task 6] depends on [Task 2]
- [Task 6] depends on [Task 4]
- [Task 7] depends on [Task 3]
- [Task 7] depends on [Task 4]
- [Task 7] depends on [Task 5]
- [Task 7] depends on [Task 6]
- [Task 8] depends on [Task 2]
- [Task 8] depends on [Task 3]
- [Task 8] depends on [Task 4]
- [Task 8] depends on [Task 5]
- [Task 8] depends on [Task 6]
- [Task 8] depends on [Task 7]
- [Task 9] depends on [Task 4]
- [Task 9] depends on [Task 5]
- [Task 9] depends on [Task 7]
- [Task 9] depends on [Task 8]
- [Task 10] depends on [Task 2]
- [Task 10] depends on [Task 5]
- [Task 11] depends on [Task 2]
- [Task 11] depends on [Task 5]
- [Task 11] depends on [Task 7]
- [Task 12] depends on [Task 5]
- [Task 12] depends on [Task 7]
- [Task 13] depends on [Task 4]
- [Task 13] depends on [Task 6]
- [Task 13] depends on [Task 7]
