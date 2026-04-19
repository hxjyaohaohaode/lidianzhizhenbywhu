# Tasks

## 数据收集完善

- [x] Task 1: 扩展数据收集表单字段
  - [x] SubTask 1.1: 在 `EnterpriseOnboardingDraft` 类型中添加基期数据字段定义
  - [x] SubTask 1.2: 在 `CollectEnterpriseScreen.tsx` 第4步添加基期产量、基期制造费用输入字段
  - [x] SubTask 1.3: 在 `CollectEnterpriseScreen.tsx` 第4步添加基期营业成本、基期营业现金流输入字段
  - [x] SubTask 1.4: 在 `CollectEnterpriseScreen.tsx` 第4步添加基期总负债、基期总资产输入字段
  - [x] SubTask 1.5: 更新数据验证逻辑，确保新字段有合理的验证规则

- [x] Task 2: 更新数据传递和处理逻辑
  - [x] SubTask 2.1: 更新 `buildEnterpriseCollectionPayload` 函数以包含新字段
  - [x] SubTask 2.2: 更新后端数据模型以接收新字段
  - [x] SubTask 2.3: 确保数学模型能正确使用新收集的数据

## UI布局优化

- [x] Task 3: 优化首页图表布局
  - [x] SubTask 3.1: 调整 `.homepage-all-charts` 样式，使图表靠左显示
  - [x] SubTask 3.2: 增加图表容器的宽度，确保图表内容完整显示
  - [x] SubTask 3.3: 调整右侧数据面板 `.csb` 的宽度

- [x] Task 4: 修复分析页面对话框显示问题
  - [x] SubTask 4.1: 检查 `.cms` 容器的 `max-height` 和 `overflow` 设置
  - [x] SubTask 4.2: 确保对话框内容不被侧边栏遮挡
  - [x] SubTask 4.3: 调整 `.m.a .mb` 的 `max-height` 限制

- [x] Task 5: 美化图表显示按钮
  - [x] SubTask 5.1: 重新设计 `.iwb-upload-entry` 按钮样式
  - [x] SubTask 5.2: 添加图标和悬停效果
  - [x] SubTask 5.3: 确保按钮在深色和浅色模式下都美观

- [x] Task 6: 修复按钮内容显示问题
  - [x] SubTask 6.1: 检查 `.unit-selector-trigger` 按钮样式
  - [x] SubTask 6.2: 修复按钮文字截断问题
  - [x] SubTask 6.3: 确保所有按钮有足够的 padding 和 min-width

## 主题适配优化

- [x] Task 7: 完善选择栏主题适配
  - [x] SubTask 7.1: 为 `.unit-selector-dropdown` 添加深色模式样式
  - [x] SubTask 7.2: 为 `.unit-selector-option` 添加深色/浅色模式适配
  - [x] SubTask 7.3: 确保所有选择框在两种模式下都有适当的对比度

- [x] Task 8: 修复单位选择弹窗位置
  - [x] SubTask 8.1: 更新 `UnitSelector.tsx` 中的位置计算逻辑
  - [x] SubTask 8.2: 确保弹窗在窗口边界时能自动调整位置
  - [x] SubTask 8.3: 添加滚动事件监听，使弹窗跟随按钮

## 数据实时更新

- [x] Task 9: 实现锂价格实时更新
  - [x] SubTask 9.1: 检查现有锂价格获取逻辑
  - [x] SubTask 9.2: 确保价格数据来自最新数据源
  - [x] SubTask 9.3: 添加定时刷新机制（如每分钟刷新一次）

## 内容优化

- [x] Task 10: 优化配置立场说明
  - [x] SubTask 10.1: 为"配置立场"添加 tooltip 说明
  - [x] SubTask 10.2: 添加说明文字解释"积极"、"保守"、"均衡"的含义
  - [x] SubTask 10.3: 优化指标卡片的显示样式

# Task Dependencies
- [Task 2] depends on [Task 1]
- [Task 4] depends on [Task 3]
- [Task 8] depends on [Task 7]
