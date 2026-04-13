# Tasks

- [x] Task 1: 升级 SVG 连线为玻璃光晕/发光质感
  - [x] SubTask 1.1: 在 `MemoryTreeLayer` 组件的 `<svg id="tsv">` 中定义 `<defs>`（如 `<filter id="glow">` 或 `<linearGradient>`）。
  - [x] SubTask 1.2: 在 `styles.css` 中修改 `.tsv line` 的样式，应用高斯模糊滤镜和半透明渐变色，深浅色主题下赋予不同的光晕色彩（如蓝色/紫色相间的发光线条）。
- [x] Task 2: 优化节点坐标偏移与放射角度排布
  - [x] SubTask 2.1: 在 `generateRadialPos` 中微调 L2 节点的扇形扩散角度（如由原本的 90 度拓宽到 120 度，或按不同节点数量动态缩放），避免拥挤。
  - [x] SubTask 2.2: 根据当前记忆卡片的宽高（如 Level 1 宽200px、Level 2 宽160px）适当将 SVG 连线的起始点与结束点偏移到节点卡片的正中心，而不是卡片左上角（目前是 `+80`、`+45` 硬编码，需重新验证并适配）。
- [x] Task 3: 验收并完善界面
  - [x] SubTask 3.1: 确保展开所有 L1 节点时，L2 的卡片不会严重互相覆盖。
  - [x] SubTask 3.2: 确认连线在拖拽、缩放（Pan/Zoom）时依然跟随。

# Task Dependencies
- [Task 2] depends on [Task 1]
- [Task 3] depends on [Task 1, Task 2]
