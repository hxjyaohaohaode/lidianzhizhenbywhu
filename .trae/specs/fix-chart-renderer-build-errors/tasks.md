# Tasks

- [x] Task 1: 修复饼图 Cell 组件的三元运算符语法错误
  - [x] SubTask 1.1: 将第346-353行的错误嵌套三元运算符修正为 `hoveredIndex === i ? "brightness(1.1)" : "none"`
  - [x] SubTask 1.2: 验证修复后饼图 hover 滤镜逻辑正确

- [x] Task 2: 修复柱状图 Bar 组件的三元运算符语法错误
  - [x] SubTask 2.1: 将第473-480行的错误嵌套三元运算符修正为 `hoveredIndex !== null ? "brightness(1.1)" : "none"`
  - [x] SubTask 2.2: 验证修复后柱状图 hover 滤镜逻辑正确

- [x] Task 3: 验证构建通过
  - [x] SubTask 3.1: 执行 `tsc -p tsconfig.app.json --noEmit` 确认0错误
  - [x] SubTask 3.2: 执行 `vite build` 确认构建成功

# Task Dependencies
- [Task 2] 可与 [Task 1] 并行执行
- [Task 3] depends on [Task 1, Task 2]
