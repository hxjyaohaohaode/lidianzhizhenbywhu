# 系统UI优化与数据收集完善 Spec

## Why
当前系统存在多个UI显示问题和数据收集不完整的问题，影响用户体验和数学模型的准确性。需要完善数据收集字段、修复UI显示问题、优化主题适配，以提升系统的专业性和可用性。

## What Changes
- 新增基期数据收集字段：基期产量、基期制造费用、基期营业成本、基期营业现金流、基期总负债、基期总资产
- 完善数学模型所需的所有数据收集字段
- 调整图表布局：图表靠左、长度增加、右侧数据区域宽度优化
- 修复企业端和投资端分析页面对话框显示不全的问题
- 美化企业端和投资端左下角的图表显示按钮
- 修复按钮内容显示问题
- 完善选择栏在深色/浅色模式下的显示适配
- 修复数据单位弹窗位置跟随按钮的问题
- 实现锂价格实时更新功能
- 优化"配置立场"内容说明，提升用户理解度

## Impact
- Affected specs: 数据收集模块、UI组件、主题系统
- Affected code: 
  - `src/web/components/CollectEnterpriseScreen.tsx` - 数据收集表单
  - `src/web/components/EnterpriseScreen.tsx` - 企业端界面
  - `src/web/components/InvestorScreen.tsx` - 投资端界面
  - `src/web/UnitSelector.tsx` - 单位选择器
  - `src/web/styles.css` - 样式文件
  - `src/shared/types.ts` - 类型定义
  - `src/web/chart-data.ts` - 图表数据

## ADDED Requirements

### Requirement: 基期数据收集完善
系统SHALL收集以下基期数据字段：
- 基期产量 (baselineProductionVolume)
- 基期制造费用 (baselineManufacturingExpense)
- 基期营业成本 (baselineOperatingCost)
- 基期营业现金流 (baselineOperatingCashFlow)
- 基期总负债 (baselineTotalLiabilities)
- 基期总资产 (baselineTotalAssets)

#### Scenario: 用户填写基期数据
- **WHEN** 用户进入数据收集页面的第4步（历史季度对比数据）
- **THEN** 系统应显示所有基期数据输入字段
- **AND** 所有字段应有合适的默认值和占位符

### Requirement: 图表布局优化
系统SHALL优化首页图表布局：
- 图表区域向左偏移，减少左侧空白
- 图表长度适当增加，以完整显示图表内容
- 右侧数据面板宽度适当增加

#### Scenario: 用户查看首页图表
- **WHEN** 用户访问企业端或投资端首页
- **THEN** 图表应靠左显示
- **AND** 图表内容应完整可见
- **AND** 右侧数据区域应有足够宽度显示数据

### Requirement: 对话框显示修复
系统SHALL确保企业端和投资端分析页面的对话框完整显示，不被遮挡。

#### Scenario: 用户查看分析页面
- **WHEN** 用户进入企业端或投资端分析页面
- **THEN** 对话框应完整显示
- **AND** 对话框内容不应被其他元素遮挡

### Requirement: 图表按钮美化
系统SHALL美化企业端和投资端左下角的图表显示按钮，提升视觉效果。

#### Scenario: 用户查看侧边栏
- **WHEN** 用户查看分析页面侧边栏
- **THEN** 图表显示按钮应有美观的样式
- **AND** 按钮应有清晰的图标和文字说明

### Requirement: 按钮内容显示修复
系统SHALL确保所有按钮内容能正常显示，包括企业端和投资端的所有按钮。

#### Scenario: 用户查看界面按钮
- **WHEN** 用户查看任意页面的按钮
- **THEN** 按钮内容应完整显示
- **AND** 按钮文字不应被截断

### Requirement: 选择栏主题适配
系统SHALL确保所有选择栏在深色模式和浅色模式下都能正常显示。

#### Scenario: 用户切换主题模式
- **WHEN** 用户在深色模式和浅色模式之间切换
- **THEN** 所有选择栏应正确显示
- **AND** 选择栏内容应有适当的对比度

### Requirement: 单位选择弹窗位置跟随
系统SHALL确保数据单位选择弹窗始终跟随触发按钮的位置显示。

#### Scenario: 用户点击单位选择器
- **WHEN** 用户点击单位选择按钮
- **THEN** 弹窗应显示在按钮附近
- **AND** 弹窗位置应随按钮位置变化而调整

### Requirement: 锂价格实时更新
系统SHALL确保首页显示的锂价格是最新的实时价格。

#### Scenario: 用户查看锂价格
- **WHEN** 用户访问首页
- **THEN** 锂价格应为最新获取的价格
- **AND** 价格应定期自动更新

### Requirement: 配置立场说明优化
系统SHALL优化"配置立场"内容的说明，使普通用户能够理解其含义。

#### Scenario: 用户查看配置立场
- **WHEN** 用户查看首页的配置立场指标
- **THEN** 应显示清晰的说明文字
- **AND** 用户应能理解该指标的含义

## MODIFIED Requirements

### Requirement: 数据收集表单扩展
在现有数据收集表单基础上，增加基期数据字段的收集，确保数学模型所需的所有数据都能被收集。

## REMOVED Requirements
无移除的需求。
