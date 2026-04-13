# 首页数据表 Bento 七宫格布局 Spec

## Why
当前首页数据表使用 12 列 grid 自适应排列（auto-fit + dense），widget 的跨度由 `getWidgetLayoutClass` 按类型统一分配，无法精确控制每个数据表的固定位置和比例。用户需要按照设计图将首页数据表重新排列为固定的 Bento 七宫格布局，使视觉层次更加清晰、信息分区更加合理。

## What Changes
- 将首页 `.viz-widget-grid` 从 `grid-template-columns: repeat(12, minmax(0, 1fr))` + dense 自动流式布局，改为基于 `grid-template-areas` 的**固定区域命名布局**
- 新增 7 个具名 CSS grid area，对应图中「数据表一号」至「数据表七号」的位置与比例
- 调整 `getWidgetLayoutClass` 或新增映射逻辑，使首页的 widget 按**固定顺序**落入对应 area
- 保持响应式降级：小屏幕下仍回退为单列流式布局

### 目标布局（12 列网格基准）

```
┌─────────────────────────────────────────────┐
│              viz-board-top（顶部区域）          │
│              （保持不变，全宽）                 │
├──────────────────────┬──────────────────────┤
│                      │                      │
│    数据表一号         │     数据表二号         │
│   (span 5 / 5列)     │   (span 7 / 7列)      │
│                      │                      │
├───────────┬──────────┴───────────────────────┤
│           │                                  │
│ 数据表三号 │         数据表四号                │
│(span 3/3列│        (span 9 / 9列)            │
│           │                                  │
├───────────┴───────────┬──────────────────────┤
│                       │                      │
│     数据表五号         │  数据表六号 │ 数据表七号│
│   (span 5 / 5列)      │(span 3/3列)│(span 4/4列)│
│                       │                      │
└───────────────────────┴────────────┴─────────┘
```

## Impact
- Affected specs: 无（独立布局调整）
- Affected code:
  - `src/web/styles.css` — `.viz-widget-grid` 的 grid-template 定义及各 span 类
  - `src/web/chart-system.tsx` — `getWidgetLayoutClass` 函数及 `VisualizationSection` 中 widget 渲染顺序/类名绑定
  - `src/web/chart-data.ts` — `buildInvestorHomeVisualization` 中 widgets 数组的**顺序**需与布局区域一一对应

## ADDED Requirements

### Requirement: Bento 七宫格固定区域布局
系统 SHALL 在首页（home 页面）的数据表网格中提供基于 `grid-template-areas` 的固定命名区域布局，包含 7 个具名区域：

| 区域名称 | CSS Grid 占比 | 对应内容 |
|---------|-------------|---------|
| `area-1` | 5 列（约 42%） | 数据表一号 |
| `area-2` | 7 列（约 58%） | 数据表二号 |
| `area-3` | 3 列（约 25%） | 数据表三号 |
| `area-4` | 9 列（约 75%） | 数据表四号 |
| `area-5` | 5 列（约 42%） | 数据表五号 |
| `area-6` | 3 列（约 25%） | 数据表六号 |
| `area-7` | 4 列（约 33%） | 数据表七号 |

#### Scenario: 首页正常渲染 7 个数据表
- **WHEN** 用户进入投资者首页（home 页面）
- **THEN** 系统 SHALL 按照 `buildInvestorHomeVisualization` 返回的 widgets 数组顺序，依次将 7 个 widget 放入 area-1 至 area-7 的对应位置
- **AND** 各区域的宽高比例 SHALL 与设计图一致：第 1 行两块等高、第 2 行左窄右宽、第 3 行左宽右两窄等高

#### Scenario: 小屏幕响应式降级
- **WHEN** 视口宽度小于 1100px
- **THEN** 所有 7 个数据表 SHALL 降级为单列垂直堆叠（每行占满宽度）
- **AND** `grid-template-areas` SHALL 被覆盖为单列流式布局

### Requirement: Widget 顺序与布局区域映射
系统 SHALL 确保 `buildInvestorHomeVisualization` 返回的 widgets 数组**严格按序**对应 7 个布局区域：

| 序号 | 区域 | 建议 Widget 类型 | 当前可映射组件 |
|-----|------|-----------------|--------------|
| 1 | area-1 | 核心指标/概览 | metricCards（投资指标卡） |
| 2 | area-2 | 图表可视化 | barChart（重点赛道热度柱状图） |
| 3 | area-3 | 精简对比 | benchmarkTable（可比公司对标表） |
| 4 | area-4 | 详细数据 | zebraTable（斑马纹行业数据表） |
| 5 | area-5 | 分组逻辑 | cardTable（卡片式分组表格） |
| 6 | area-6 | 补充信息 | （保留扩展位） |
| 7 | area-7 | 补充信息 | （保留扩展位） |

> **注**：当前首页仅有 5 个 widget，area-6 和 area-7 可预留或用现有 widget 填充，具体由实现时决定。

## MODIFIED Requirements

### Requirement: getWidgetLayoutClass 函数
当前函数按 widget kind 统一返回 span 类。**修改后**：
- 对于首页（home）页面，该函数 SHALL 被**按序索引映射**替代或增强，即根据 widget 在数组中的位置返回对应的 `grid-area: area-N`
- 对于非首页（analysis 等页面），保持原有 span 行为不变

### Requirement: viz-widget-grid 容器
当前使用 `grid-template-columns: repeat(12, minmax(0, 1fr))` + `grid-auto-flow: row dense`。
- **修改后**：首页 grid SHALL 使用显式 `grid-template-areas` 定义 7 个命名区域
- **同时保留** 12 列作为底层栅格基准以维持对齐精度
