# Tasks

- [x] Task 1: 实现噪点纹理与全新浅色背景
  - [x] SubTask 1.1: 在 `App.tsx` (或者 `index.css`) 中，为浅色模式创建底层的清透蓝紫渐变背景，匹配参考图的色调。
  - [x] SubTask 1.2: 使用内联 SVG 或 CSS 背景纹理生成并应用噪点（Noise）图层，以极低的透明度叠加在背景和玻璃面板上，达到图片中的微粒感。
- [x] Task 2: 深度重构玻璃态面板样式
  - [x] SubTask 2.1: 在 `index.css` 中优化 `.pg`, `.chart-modal`, `.cp`, `.csb`, `.ndo .nd` 等面板的背景透明度，结合 `backdrop-filter: blur() saturate()` 增强通透度。
  - [x] SubTask 2.2: 为面板添加细腻的半透明白边 (`border: 1px solid rgba(255,255,255,0.4)` 等) 和内侧发光 (`box-shadow: inset ...`)，模拟玻璃边缘的真实反光。
- [x] Task 3: 细节比例与阴影打磨
  - [x] SubTask 3.1: 调整各个卡片、弹窗的 `border-radius`，确保圆角柔和统一，符合现代玻璃拟态的特征。
  - [x] SubTask 3.2: 优化投影 `--shadow-color`，使用大范围、低透明度的带色调投影，增强悬浮感。
  - [x] SubTask 3.3: 检查内部文字和元素的 Padding，确保排版具有呼吸感，不过分拥挤。
- [x] Task 4: 浅色模式全链路检查
  - [x] SubTask 4.1: 确保噪点和玻璃效果在所有组件中正常显示，并且不影响文字的可读性（保持高对比度）。
  - [x] SubTask 4.2: 确保深色模式的视觉体验不受此磨砂质感逻辑的破坏。

# Task Dependencies
- [Task 2] depends on [Task 1]
- [Task 3] depends on [Task 2]
- [Task 4] depends on [Task 1, Task 2, Task 3]
