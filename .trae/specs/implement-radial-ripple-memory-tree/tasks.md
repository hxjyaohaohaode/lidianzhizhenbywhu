# Tasks

- [x] Task 1: 实现画布的自由拖拽与缩放 (Pan & Zoom)
  - [x] SubTask 1.1: 移除 `MemoryScreen` 中原有的依靠 `scrollLeft/scrollTop` 的 `onMouseDown/Move` 逻辑。
  - [x] SubTask 1.2: 引入内部状态 `transform: {x, y, scale}`，在 `MemoryTreeLayer` 的包裹容器（如 `#mtr` 内部的统一内容层）上应用 `style={{ transform: translate... scale... }}`。
  - [x] SubTask 1.3: 监听 `onWheel` 事件更新 `scale`，并监听背景拖拽更新 `{x, y}`，确保缩放以鼠标指针（或屏幕中心）为原点。
- [x] Task 2: 实现圆心点放射形（同心圆）坐标算法
  - [x] SubTask 2.1: 重构 `buildMemoryNodes` 中的 `generateSpiralPos` 为 `generateRadialPos`：中心节点固定为画布绝对中心（例如 2000x2000 的 1000, 1000）。
  - [x] SubTask 2.2: 计算 Level 1 节点：根据 6 个一级节点，按 `360 / 6 = 60` 度的间隔，分布在半径 `R1 = 300` 的同心圆上。
  - [x] SubTask 2.3: 计算 Level 2 节点：对于某个一级节点，根据其自身的极角，向外发散一个半径 `R2 = 600` 且在 `[-30, 30]` 度夹角范围内的扇形，分配给其下的二级节点。
- [x] Task 3: 优化涟漪展开动效与连线
  - [x] SubTask 3.1: 为 Level 2 节点初始生成时增加类似于“从父节点飞出”的初始坐标 `transform` 过渡，或使用 CSS 的 `transition: all 0.4s` 配合坐标瞬间改变来实现涟漪扩散动效。
  - [x] SubTask 3.2: 确保 `svg > line` 在 Level 1 到 Level 2 的连线能够与 Level 2 节点的扇形放射位置正确匹配并平滑重绘。
- [x] Task 4: 验证交互与修复边界情况
  - [x] SubTask 4.1: 验证放大到极致（如 2x）和缩小到全局（如 0.5x）时，点击详情弹窗（`.ndo`）能否正确居中在屏幕上，不受 `scale` 的影响。
  - [x] SubTask 4.2: 确认背景拖拽不会触发节点内部卡片的误点击。

# Task Dependencies
- [Task 2] depends on [Task 1]
- [Task 3] depends on [Task 2]
- [Task 4] depends on [Task 1, Task 2, Task 3]
