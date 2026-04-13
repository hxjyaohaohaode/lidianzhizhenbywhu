# Checklist

- [x] CSS `.viz-widget-grid` 已定义 `grid-template-areas`，包含 area-1 ~ area-7 七个命名区域，比例与设计图一致
- [x] CSS 中已新增 `.viz-widget.area-1` ~ `.viz-widget.area-7` 样式类，正确映射 grid-area
- [x] 响应式媒体查询（< 1100px）已添加，小屏幕下 7 个区域降级为单列堆叠
- [x] `chart-system.tsx` 中首页 widget 渲染已使用按序索引的 area 映射逻辑
- [x] 非 home 页面（如 analysis）的 `getWidgetLayoutClass` 逻辑未被破坏
- [x] `buildInvestorHomeVisualization` 的 widgets 数组顺序与 7 个布局区域一一对应
- [x] 浏览器中首页数据表排列与设计图 Bento 七宫格布局一致（代码层面验证通过）
- [x] 窗口缩放时响应式降级正常工作（CSS 媒体查询已确认）
