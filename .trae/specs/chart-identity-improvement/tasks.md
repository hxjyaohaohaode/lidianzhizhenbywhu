# Tasks
- [x] Task 1: 审查图表系统稳定性问题
  - [x] SubTask 1.1: 检查 chart-system.tsx 中的渲染逻辑，识别潜在的性能瓶颈
  - [x] SubTask 1.2: 审查图表数据加载逻辑，确保大数据量下不会导致内存泄漏或崩溃
  - [x] SubTask 1.3: 测试图表交互（hover、click、zoom）的响应性能，记录任何卡顿或延迟
  - [x] SubTask 1.4: 分析浏览器开发者工具中的性能指标，定位渲染耗时操作

- [x] Task 2: 优化图表性能与稳定性
  - [x] SubTask 2.1: 对大数据量图表实现虚拟渲染或分页加载
  - [x] SubTask 2.2: 对频繁交互（如hover）添加防抖（debounce）或节流（throttle）
  - [x] SubTask 2.3: 优化SVG渲染，减少不必要的DOM操作
  - [x] SubTask 2.4: 确保图表组件在卸载时正确清理事件监听器和定时器

- [x] Task 3: 增大图表显示区域
  - [x] SubTask 3.1: 修改 chart-system.tsx 中的容器样式，减少内边距和边距
  - [x] SubTask 3.2: 调整 VisualizationBoard 组件的布局，使图表区域占比提升至90%以上
  - [x] SubTask 3.3: 优化响应式设计，确保在不同屏幕尺寸下图表依然保持较大尺寸
  - [x] SubTask 3.4: 验证所有图表类型（折线图、柱状图、雷达图等）的尺寸增大效果

- [x] Task 4: 优化图表布局美观度
  - [x] SubTask 4.1: 统一图表标题、图例、坐标轴标签的字体大小和颜色
  - [x] SubTask 4.2: 调整图表内部元素的间距和对齐，确保视觉平衡
  - [x] SubTask 4.3: 优化颜色搭配，确保符合当前主题（深色/浅色模式）
  - [x] SubTask 4.4: 对多图表看板进行整体布局调整，确保网格对齐和协调

- [x] Task 5: 设计并实现身份切换器组件
  - [x] SubTask 5.1: 创建 IdentitySwitcher 组件，提供企业端/投资端切换下拉菜单
  - [x] SubTask 5.2: 将 IdentitySwitcher 集成到应用顶部栏或侧边栏
  - [x] SubTask 5.3: 实现切换逻辑，调用现有的 handleRoleSelect 或 handleGoApp 函数
  - [x] SubTask 5.4: 添加切换动画和视觉反馈

- [x] Task 6: 修改身份选择流程
  - [x] SubTask 6.1: 在 AppContext.tsx 中添加“记住身份”选项（本地存储标志）
  - [x] SubTask 6.2: 修改初始化逻辑，使每次页面加载时检查“记住身份”标志，若无则显示角色选择界面
  - [x] SubTask 6.3: 在角色选择界面（RoleScreen）添加“记住我的选择”复选框
  - [x] SubTask 6.4: 确保身份切换器与“记住身份”功能协同工作

- [x] Task 7: 全面测试与验证
  - [x] SubTask 7.1: 运行现有测试，确保没有破坏现有功能
  - [x] SubTask 7.2: 手动测试图表稳定性（大数据量、频繁交互）
  - [x] SubTask 7.3: 测试身份切换流程（初次加载、刷新、切换身份）
  - [x] SubTask 7.4: 验证图表尺寸和布局改进效果
  - [x] SubTask 7.5: 进行跨浏览器（Chrome、Firefox、Edge）兼容性测试

# Task Dependencies
- Task 1 → Task 2（先审查问题，再优化）
- Task 3 → Task 4（先增大尺寸，再优化布局）
- Task 5 → Task 6（身份切换器组件需要与流程修改协同）
- Task 2,4,6 → Task 7（所有优化完成后进行测试）