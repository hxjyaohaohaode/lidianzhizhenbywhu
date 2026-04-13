# Tasks

- [x] Task 1: 清理前端设置面板中的外部价格 API 模块
  - [x] SubTask 1.1: 删除企业端设置区域中的“外部数据 API”卡片及其输入控件
  - [x] SubTask 1.2: 删除投资端设置区域中的“外部数据 API”卡片及其输入控件
  - [x] SubTask 1.3: 清理遗留文案、占位符和样式依赖，确保界面结构稳定

- [x] Task 2: 对齐价格获取口径为服务端 RAG 自动获取
  - [x] SubTask 2.1: 盘点当前碳酸锂、六氟磷酸锂价格在前后端的调用入口与说明文案
  - [x] SubTask 2.2: 将前端展示与交互口径改为“系统自动获取价格证据”，不再引导用户输入外部 API 密钥
  - [x] SubTask 2.3: 确认服务端价格证据链返回来源、时间或降级状态，供现有结果区复用展示

- [x] Task 3: 补齐回归验证
  - [x] SubTask 3.1: 更新前端测试或快照，确保不再渲染“外部数据 API”“碳酸锂价格 API”“六氟磷酸锂 API”等元素
  - [x] SubTask 3.2: 验证价格相关流程在默认配置下仍走 RAG/治理链路，而非要求前端提供密钥
  - [x] SubTask 3.3: 执行必要的类型检查、测试或最小界面回归，确认删除模块后无明显破坏

# Task Dependencies
- [Task 2] depends on [Task 1]
- [Task 3] depends on [Task 1]
- [Task 3] depends on [Task 2]
