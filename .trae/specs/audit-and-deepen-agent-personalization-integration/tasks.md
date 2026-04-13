# Tasks

- [x] Task 1: 完成全项目审查与差距清单梳理
  - [x] SubTask 1.1: 盘点企业端、投资端、记忆页、会话历史、图表系统和服务端主流程的智能体接入点
  - [x] SubTask 1.2: 盘点前端可见配置、服务端环境变量、模型路由、数据源凭证和健康检查边界
  - [x] SubTask 1.3: 输出“已接入 / 未接入 / 旁路 / 风险项”清单，作为后续改造基线

- [x] Task 2: 收口私有 API 与服务端配置治理
  - [x] SubTask 2.1: 统一第三方模型 API、数据源凭证、供应商地址和敏感开关的服务端注册与校验方式
  - [x] SubTask 2.2: 移除或下沉任何普通用户可见的供应商级配置入口，保留业务级偏好设置
  - [x] SubTask 2.3: 建立“必填 API / 可选凭证 / 缺失时降级”规则及启动时错误提示

- [x] Task 3: 将关键用户路径纳入统一 Agent 编排
  - [x] SubTask 3.1: 审查企业诊断、投资分析、历史复盘、证据生成和图表解释链路是否统一经过 Agent 编排
  - [x] SubTask 3.2: 对未纳入治理的路径补齐任务编排、状态跟踪、记忆召回和失败恢复
  - [x] SubTask 3.3: 确保关键工作流都能输出可追踪的智能体执行摘要

- [x] Task 4: 打通跨会话个性化服务闭环
  - [x] SubTask 4.1: 统一用户画像、长期记忆、历史会话、偏好反馈与任务上下文的读取与写回策略
  - [x] SubTask 4.2: 将个性化信息接入建议生成、证据排序、表达风格、提醒内容和默认分析模式
  - [x] SubTask 4.3: 校验企业端与投资端个性化资产复用受控且不会串端

- [x] Task 5: 验证真实数据获取与极简运行能力
  - [x] SubTask 5.1: 核对模型调用、实时检索、外部数据抓取和记忆读写的真实连通性
  - [x] SubTask 5.2: 为必需依赖补充健康检查，为可选依赖补充受控降级验证
  - [x] SubTask 5.3: 验证“仅填写最终 API 即可运行”的最小部署路径

- [x] Task 6: 完成回归验证与交付验收
  - [x] SubTask 6.1: 补充或更新与配置治理、Agent 编排、个性化输出和接口边界相关的自动化验证
  - [x] SubTask 6.2: 执行关键前后端联调与异常场景回归
  - [x] SubTask 6.3: 输出最终验收结论，确认用户侧不暴露 API、主流程可运行且个性化服务有效

# Task Dependencies
- [Task 2] depends on [Task 1]
- [Task 3] depends on [Task 1]
- [Task 4] depends on [Task 1]
- [Task 4] depends on [Task 3]
- [Task 5] depends on [Task 2]
- [Task 5] depends on [Task 3]
- [Task 5] depends on [Task 4]
- [Task 6] depends on [Task 2]
- [Task 6] depends on [Task 3]
- [Task 6] depends on [Task 4]
- [Task 6] depends on [Task 5]
