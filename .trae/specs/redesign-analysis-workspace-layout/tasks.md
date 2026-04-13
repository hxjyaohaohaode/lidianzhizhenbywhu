# Tasks

- [x] Task 1: 优化分析工作台容器与信息排版
  - [x] SubTask 1.1: 审查并调整 `styles.css` 中 `.cp`, `.cms`, `.cia`, `.iwb-top`, `.iwb-meta` 的布局与内边距，减少不必要的头部空间浪费。
  - [x] SubTask 1.2: 增大消息气泡（`.mb`）行间距、字体层级对比，改善内部信息的长文本阅读体验。
- [x] Task 2: 实现真实的文档上传交互
  - [x] SubTask 2.1: 在 `App.tsx`（`InvAna` 或对应的分析工作台组件）中添加隐藏的 `<input type="file">`，以及绑定其 Ref。
  - [x] SubTask 2.2: 将 `.iwb-upload-entry`（`＋`按钮）的点击事件代理到文件输入框，并在触发 `onChange` 后捕获文件对象。
  - [x] SubTask 2.3: 更新上传反馈逻辑（如修改附件数、将文件名显示为一条系统提示，或在输入框上方显示小标签）。
- [x] Task 3: 验证排版与上传功能
  - [x] SubTask 3.1: 检查极端长文本和不同窗口尺寸下对话流的滚动、展示是否顺畅且无重叠。
  - [x] SubTask 3.2: 触发上传流程，确保文件选择窗口正常调出，并给出明确上传反馈。

# Task Dependencies
- [Task 2] depends on [Task 1]
- [Task 3] depends on [Task 1, Task 2]
