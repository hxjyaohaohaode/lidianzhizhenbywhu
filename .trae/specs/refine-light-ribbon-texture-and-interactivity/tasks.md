# Tasks

- [x] Task 1: 重构光带绘制逻辑：将原有的宽发光带改为多层细密线条叠加，模拟发丝质感。
  - [x] SubTask 1.1: 在 `MemoryBackgroundCanvas` 中，调整光带生成参数，增加每条光带内的线条数量（例如使用细微偏移绘制多个 stroke）。
  - [x] SubTask 1.2: 优化颜色与透明度：使用低透明度、带轻微渐变的线条交叠，去除部分厚重的 `shadowBlur` 以提升性能和清晰度。
- [x] Task 2: 优化光带动画曲线：使波动更自然丝滑。
  - [x] SubTask 2.1: 调整 `getRibbonPoint` 函数中的正弦函数组合，引入更加有机、柔和的波动频率。
- [x] Task 3: 增加光带交互响应：让鼠标移动影响光带轨迹。
  - [x] SubTask 3.1: 将 `pointerX` / `pointerY` 引入到光带的波动计算公式中，使其产生轻微的排斥或吸引效果。
- [x] Task 4: 提升渲染性能与稳定性。
  - [x] SubTask 4.1: 确保新的绘制方式在不同缩放比例和设备上保持流畅（精简不必要的状态切换和绘制层数）。

# Task Dependencies
- [Task 2] depends on [Task 1]
- [Task 3] depends on [Task 2]
- [Task 4] depends on [Task 1, Task 2, Task 3]
