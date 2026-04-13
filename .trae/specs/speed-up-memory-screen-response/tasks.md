# Tasks

- [x] Task 1: 盘点“记忆中的你”页面的性能热点
  - [x] SubTask 1.1: 审查页面首屏初始化、Canvas 动画、节点树渲染与事件监听结构
  - [x] SubTask 1.2: 识别导致卡顿的高频重绘、高频状态更新与高成本计算点
  - [x] SubTask 1.3: 明确需要保留的核心视觉效果与可降级的装饰效果

- [x] Task 2: 优化页面首屏加载与初始化策略
  - [x] SubTask 2.1: 拆分页面首次进入时的关键渲染与非关键动画初始化
  - [x] SubTask 2.2: 为高成本背景效果增加延迟初始化、分批初始化或按需启动机制
  - [x] SubTask 2.3: 避免首次进入时同步创建过多粒子、星云与流星对象

- [x] Task 3: 优化 Canvas 与动画循环性能
  - [x] SubTask 3.1: 降低不必要的全画布重绘与重复计算
  - [x] SubTask 3.2: 根据设备状态、页面可见性与交互阶段实施粒子数量和绘制频率分级
  - [x] SubTask 3.3: 优化鼠标、滚动、缩放等事件驱动逻辑，减少高频触发带来的卡顿

- [x] Task 4: 优化节点树与详情面板渲染
  - [x] SubTask 4.1: 减少节点数据、布局计算与样式生成的重复执行
  - [x] SubTask 4.2: 让节点选中、详情展开与背景动画更新解耦
  - [x] SubTask 4.3: 为静态节点、辅助线与详情内容引入更细粒度的渲染控制

- [x] Task 5: 建立轻量模式与回退策略
  - [x] SubTask 5.1: 为低性能场景或后台标签页提供自动降级的轻量动画模式
  - [x] SubTask 5.2: 确保深色/浅色主题下视觉表现仍然成立
  - [x] SubTask 5.3: 保证优化后页面在功能、视觉层级与可读性上不退化

- [x] Task 6: 完成验证与性能回归保护
  - [x] SubTask 6.1: 补充页面关键交互与性能相关测试或验证代码
  - [x] SubTask 6.2: 验证页面打开、节点点击、详情切换与返回流程是否更流畅
  - [x] SubTask 6.3: 验证优化后无明显功能回归或视觉异常

- [x] Task 7: 彻底拆分高成本背景对象初始化
  - [x] SubTask 7.1: 将星体、星云、光带粒子改为按档位惰性创建
  - [x] SubTask 7.2: 为启动态与交互态分别建立独立对象池或延迟批处理
  - [x] SubTask 7.3: 补充初始化对象数量与首帧耗时的回归验证

# Task Dependencies
- [Task 2] depends on [Task 1]
- [Task 3] depends on [Task 1]
- [Task 4] depends on [Task 1]
- [Task 5] depends on [Task 2]
- [Task 5] depends on [Task 3]
- [Task 5] depends on [Task 4]
- [Task 6] depends on [Task 2]
- [Task 6] depends on [Task 3]
- [Task 6] depends on [Task 4]
- [Task 6] depends on [Task 5]
- [Task 7] depends on [Task 2]
- [Task 7] depends on [Task 3]
- [Task 7] depends on [Task 6]
