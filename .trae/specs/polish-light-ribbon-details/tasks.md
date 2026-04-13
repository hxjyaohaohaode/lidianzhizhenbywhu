# Tasks

- [x] Task 1: 分析现有光带实现，确定优化方向
  - [x] SubTask 1.1: 审查当前光带绘制代码（App.tsx中的ribbons和sparkles）
  - [x] SubTask 1.2: 识别视觉效果上的不足（渐变、辉光、动画等）
  - [x] SubTask 1.3: 制定具体优化方案

- [x] Task 2: 优化光带渐变色彩
  - [x] SubTask 2.1: 设计更自然的金色到暖黄色渐变方案
  - [x] SubTask 2.2: 实现多色渐变（添加淡紫/橙色调）
  - [x] SubTask 2.3: 优化渐变过渡，消除硬边

- [x] Task 3: 增强光带辉光效果
  - [x] SubTask 3.1: 调整阴影参数（shadowBlur、shadowColor）以获得更柔和的光晕
  - [x] SubTask 3.2: 实现多层辉光叠加（内发光、外发光）
  - [x] SubTask 3.3: 优化辉光透明度，使其能自然透过节点

- [x] Task 4: 改进光带动画曲线
  - [x] SubTask 4.1: 优化getRibbonPoint函数中的正弦波组合
  - [x] SubTask 4.2: 添加流动速度随机变化（Perlin噪声或类似）
  - [x] SubTask 4.3: 错开不同光带的流动相位，避免同步

- [x] Task 5: 提升光带粒子效果
  - [x] SubTask 5.1: 增强粒子闪烁亮度（调整alpha和大小）
  - [x] SubTask 5.2: 为粒子添加随机大小和亮度变化
  - [x] SubTask 5.3: 改进粒子运动轨迹（添加随机偏移）

- [x] Task 6: 添加光带深度层次感
  - [x] SubTask 6.1: 根据光带索引调整模糊度和透明度（远处更模糊透明）
  - [x] SubTask 6.2: 实现光带间的自然遮挡关系
  - [x] SubTask 6.3: 优化光带与星空背景的融合

- [x] Task 7: 整体效果调优与测试
  - [x] SubTask 7.1: 验证所有优化效果在深色模式下正常显示
  - [x] SubTask 7.2: 确保浅色模式不受影响
  - [x] SubTask 7.3: 性能测试，确保动画流畅（60fps）

- [ ] Task 8: 建立光带动画的 60fps 验收机制
  - [ ] SubTask 8.1: 为光带与粒子动画采集帧率与绘制耗时
  - [ ] SubTask 8.2: 在不同主题与性能档位下记录基线结果
  - [ ] SubTask 8.3: 将 60fps 门槛纳入自动化或半自动回归流程

# Task Dependencies
- [Task 2] depends on [Task 1]
- [Task 3] depends on [Task 2]
- [Task 4] depends on [Task 1]
- [Task 5] depends on [Task 4]
- [Task 6] depends on [Task 3]
- [Task 7] depends on [Task 2, Task 3, Task 4, Task 5, Task 6]
- [Task 8] depends on [Task 6]
- [Task 8] depends on [Task 7]
