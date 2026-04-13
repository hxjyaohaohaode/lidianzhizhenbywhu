# Tasks

## 阶段一：数据精确性与单位集成（基础层）

- [ ] Task 1: 统一小数精度为两位
  - [ ] SubTask 1.1: 修改 `src/server/realtime-rag.ts` 中 `roundScore` 函数，将 `toFixed(3)` 改为 `toFixed(2)`
  - [ ] SubTask 1.2: 搜索并修复所有 `toFixed(1)`、`toFixed(3)`、`toFixed(4)` 等非两位精度的硬编码（排除已知合理的 `toFixed(0)` 用于整数显示的场景）
  - [ ] SubTask 1.3: 在 `src/web/data-formatter.ts` 中添加全局精度常量 `GLOBAL_DECIMAL_DIGITS = 2`，所有格式化函数引用此常量
  - [ ] SubTask 1.4: 检查 `src/web/chart-system.tsx`、`src/web/chart-renderer.tsx`、`src/web/dqi-gmps-panels.tsx` 中的数值显示，确保全部使用 `formatFixed` 或 `DataFormatter` 方法

- [ ] Task 2: 集成单位选择器到主界面
  - [ ] SubTask 2.1: 在 `src/web/App.tsx` 中导入 `UnitSelector` 和 `useUnitPreferences`
  - [ ] SubTask 2.2: 在首页（EntHome/InvHome）添加 `UnitSelector` 组件入口
  - [ ] SubTask 2.3: 在设置页（EntSet/InvSet）添加完整的 `UnitSelector` 配置面板
  - [ ] SubTask 2.4: 将 `useUnitPreferences` 的单位状态传递到 `VisualizationBoard` 和所有数据展示组件
  - [ ] SubTask 2.5: 修改 `buildEnterpriseVisualization` 和 `buildInvestorHomeVisualization` 接受单位偏好参数，使用 `DataFormatter` 格式化所有数值
  - [ ] SubTask 2.6: 修改分析页的 DQI/GMPS 面板，使其响应单位偏好变化
  - [ ] SubTask 2.7: 单位偏好同时保存到 localStorage 和服务端 `updateUserPreferences` API

## 阶段二：实时数据与记忆恢复（可靠性层）

- [ ] Task 3: 修复首页真实数据自动刷新
  - [ ] SubTask 3.1: 移除 App.tsx 中仅更新时间戳的假性 `setInterval`
  - [ ] SubTask 3.2: 实现真正的定时数据拉取 hook `useAutoRefresh`，默认间隔 60 秒，调用后端 API 获取最新数据
  - [ ] SubTask 3.3: 在首页组件中集成 `useAutoRefresh`，刷新时显示加载指示器
  - [ ] SubTask 3.4: 在设置页添加刷新间隔配置选项（30s/60s/120s/关闭）
  - [ ] SubTask 3.5: 添加手动刷新按钮到首页

- [ ] Task 4: 强化用户数据记忆与恢复
  - [ ] SubTask 4.1: 在 App 初始化时，从 localStorage 读取 userId 后立即调用 `fetchUserProfile` 恢复完整用户档案
  - [ ] SubTask 4.2: 确保主题偏好（themeMode、themeColor）从服务端档案恢复，而非仅依赖 localStorage
  - [ ] SubTask 4.3: 确保单位偏好从服务端档案恢复
  - [ ] SubTask 4.4: 确保用户角色偏好（preferredRole）从服务端恢复
  - [ ] SubTask 4.5: 页面刷新后会话历史列表完整恢复

- [ ] Task 5: 优化 RAG 缓存与实时性
  - [ ] SubTask 5.1: 在 RAG 搜索查询中融入用户画像的兴趣标签和关注领域
  - [ ] SubTask 5.2: 添加 RAG 缓存手动清除 API 端点 `POST /api/rag/cache/clear`
  - [ ] SubTask 5.3: 前端分析页添加"刷新行业数据"按钮，调用缓存清除后重新检索
  - [ ] SubTask 5.4: 确保 RAG 缓存 TTL 严格生效，过期条目不返回

## 阶段三：智能性与个性化增强（智能层）

- [ ] Task 6: 实现真实 LLM 辩论机制
  - [ ] SubTask 6.1: 在 `src/server/business-service.ts` 中重构 `runDebate` 函数，使用 `ModelRouter` 调用真实 LLM
  - [ ] SubTask 6.2: 第一轮：调用 LLM-A 生成正方论点，LLM-B 生成反方论点，LLM-C 生成裁判总结
  - [ ] SubTask 6.3: 第二轮和第三轮：交换辩手角色，基于前一轮结果继续辩论
  - [ ] SubTask 6.4: 当所有 LLM 不可用时，降级为当前模板拼接逻辑，标记 `source: "template"` 和 `degraded: true`
  - [ ] SubTask 6.5: 辩论消息增加 `source` 字段（`"llm"` 或 `"template"`）
  - [ ] SubTask 6.6: 前端在辩论面板中显示 LLM 来源标识，降级时显示提示

- [ ] Task 7: 增强 Agent 工作流失败恢复
  - [ ] SubTask 7.1: 在 `agent-service.ts` 中为每个 Agent 步骤添加 try-catch，失败时生成降级结果而非中断工作流
  - [ ] SubTask 7.2: 非关键 Agent（dataGathering、industryRetrieval）失败时，使用空结果/默认值继续
  - [ ] SubTask 7.3: 关键 Agent（taskOrchestrator、expressionGeneration）失败时，返回已完成的部分结果和错误信息
  - [ ] SubTask 7.4: 前端展示部分分析结果时，标注哪些项使用了降级数据

- [ ] Task 8: 深化个性化服务
  - [ ] SubTask 8.1: 修改 `buildEnterpriseVisualization` 和 `buildInvestorHomeVisualization`，根据用户画像中的兴趣标签调整指标排序和展示优先级
  - [ ] SubTask 8.2: 分析结果文本中优先展示与用户兴趣相关的结论
  - [ ] SubTask 8.3: RAG 检索查询融入用户偏好（已在 Task 5.1 中完成）
  - [ ] SubTask 8.4: 在设置页展示当前个性化配置摘要（兴趣、风险偏好、投资周期等）

## 阶段四：浅色模式完善（视觉层）

- [ ] Task 9: 完善浅色模式适配
  - [ ] SubTask 9.1: 检查并修复 Recharts 图表在浅色模式下的网格线、坐标轴、Tooltip、Legend 颜色
  - [ ] SubTask 9.2: 检查并修复 DQI/GMPS 面板在浅色模式下的背景、文字、仪表盘颜色
  - [ ] SubTask 9.3: 检查并修复所有弹窗和浮层在浅色模式下的毛玻璃效果和文字对比度
  - [ ] SubTask 9.4: 检查并修复记忆树节点在浅色模式下的显示
  - [ ] SubTask 9.5: 检查并修复单位选择器在浅色模式下的显示
  - [ ] SubTask 9.6: 全局搜索硬编码的深色值（如 `#0b0f1a`、`rgba(15,23,42`），确保都有浅色模式对应值

## 阶段五：验证与收尾

- [ ] Task 10: 综合验证
  - [ ] SubTask 10.1: 后端 TypeScript 编译 0 错误
  - [ ] SubTask 10.2: 前端 TypeScript 编译 0 错误
  - [ ] SubTask 10.3: 所有数值显示精确到小数点后两位
  - [ ] SubTask 10.4: 单位选择器在首页、分析页、设置页均可正常使用
  - [ ] SubTask 10.5: 首页自动刷新真实获取新数据
  - [ ] SubTask 10.6: 页面刷新后所有用户数据完整恢复
  - [ ] SubTask 10.7: 浅色模式下所有组件正确显示
  - [ ] SubTask 10.8: 辩论机制在 LLM 可用时使用真实对话

# Task Dependencies
- [Task 2] depends on [Task 1] — 单位集成需要精度统一先完成
- [Task 5] depends on [Task 4] — RAG 个性化查询需要用户画像恢复先完成
- [Task 6] depends on [Task 7] — 辩论机制重构需要失败恢复机制先就位
- [Task 8] depends on [Task 2, Task 5] — 个性化增强需要单位集成和 RAG 优化先完成
- [Task 9] depends on [Task 2] — 浅色模式修复需要单位选择器集成后验证
- [Task 10] depends on [Task 1-9] — 综合验证在所有任务完成后进行
