# Tasks
- [x] Task 1: 搭建全栈工程骨架与统一配置层
  - [x] SubTask 1.1: 初始化前端应用、服务端应用与共享类型模块
  - [x] SubTask 1.2: 建立环境变量方案，确保只需填写大模型 API 密钥即可运行
  - [x] SubTask 1.3: 建立日志、错误处理、健康检查与基础测试框架

- [x] Task 2: 实现数学模型驱动的分析内核
  - [x] SubTask 2.1: 将毛利承压模型封装为可调用的计算服务
  - [x] SubTask 2.2: 将经营质量变化动态评价模型封装为可调用的计算服务
  - [x] SubTask 2.3: 建立统一输入校验、指标归一化、结果解释与置信度输出

- [x] Task 3: 实现多模型适配层与 Agent 编排引擎
  - [x] SubTask 3.1: 为 deepseek-reasoner、GLM-5、Qwen3.5-Plus 建立统一适配器
  - [x] SubTask 3.2: 实现任务编排 Agent、数据理解 Agent、数学分析 Agent、行业检索 Agent、证据审校 Agent、表达生成 Agent 与记忆管理 Agent
  - [x] SubTask 3.3: 建立并行执行、失败降级、结果汇总与调用追踪机制

- [x] Task 4: 实现 RAG 与即时信息可信度链路
  - [x] SubTask 4.1: 建立网页检索、抓取、清洗、切片与索引流程
  - [x] SubTask 4.2: 建立多源证据排序、去重、可信度评分与引用摘要输出
  - [x] SubTask 4.3: 将 RAG 输出接入企业分析与投资分析工作流

- [x] Task 5: 构建双角色核心业务流程与 API
  - [x] SubTask 5.1: 实现企业运营分析数据采集、提交、存储与分析接口
  - [x] SubTask 5.2: 实现投资人员画像采集、模式切换、推荐与深度解析接口
  - [x] SubTask 5.3: 实现统一会话上下文、任务状态与私有记忆读写接口

- [x] Task 6: 构建高质感双端前端体验
  - [x] SubTask 6.1: 实现动画缓冲页、身份选择页与双角色初始化流程
  - [x] SubTask 6.2: 实现企业端首页、分析页、设置页与指标侧边栏
  - [x] SubTask 6.3: 实现投资端首页、分析页、设置页与模式切换交互
  - [x] SubTask 6.4: 实现“记忆中的你”3D 玻璃树状界面与私有记忆详情交互

- [x] Task 7: 建立系统级质量保障与交付验证
  - [x] SubTask 7.1: 补充数学模型、Agent 工作流、接口与前端关键路径测试
  - [x] SubTask 7.2: 验证异常回退、安全配置、性能表现与可观测性
  - [x] SubTask 7.3: 进行端到端联调，确认双角色核心流程可用

# Task Dependencies
- [Task 2] depends on [Task 1]
- [Task 3] depends on [Task 1]
- [Task 4] depends on [Task 3]
- [Task 5] depends on [Task 2]
- [Task 5] depends on [Task 3]
- [Task 6] depends on [Task 5]
- [Task 7] depends on [Task 2]
- [Task 7] depends on [Task 3]
- [Task 7] depends on [Task 4]
- [Task 7] depends on [Task 5]
- [Task 7] depends on [Task 6]
