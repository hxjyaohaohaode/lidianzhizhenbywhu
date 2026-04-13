# Tasks

- [x] Task 1: 优化浅色模式的基础 CSS 变量体系
  - [x] SubTask 1.1: 在 `App.tsx` 的主题逻辑中，更新浅色模式下的背景 (`--bg`, `--bg2`)、文本 (`--t1`, `--t2`, `--t3`) 及边框颜色，使其具有活力与生命感。
  - [x] SubTask 1.2: 调整浅色模式的半透明变量（如 `--glass-bg`, `--overlay`, `--panel-bg`），为磨砂效果做准备。
- [x] Task 2: 实现微磨砂玻璃质感 (Glassmorphism)
  - [x] SubTask 2.1: 在 `index.css` 中，为弹窗 (`.chart-modal`)、提示框 (`.chart-tooltip`)、记忆节点弹窗 (`.ndo .nd`) 等关键组件添加 `backdrop-filter: blur(x)` 属性。
  - [x] SubTask 2.2: 确保面板 (`.pg`, `.cp`, `.csb` 等) 在浅色模式下也具备合适的微磨砂视觉层次。
- [x] Task 3: 修复浅色模式下内容不可见的问题
  - [x] SubTask 3.1: 检查并修复 Tooltip、Modal 及节点详情中的文字颜色，确保对比度充足。
  - [x] SubTask 3.2: 检查表格 (`.dt`) 和数据卡片中的高亮字体颜色，避免在浅色背景下过浅或反差不够。
- [x] Task 4: 细化界面生命感设计
  - [x] SubTask 4.1: 微调浅色模式下的阴影 (box-shadow) 颜色，使其更柔和、真实（如使用带色相的淡阴影代替纯黑/灰阴影）。

# Task Dependencies
- [Task 2] depends on [Task 1]
- [Task 3] depends on [Task 1]
- [Task 4] depends on [Task 2, Task 3]