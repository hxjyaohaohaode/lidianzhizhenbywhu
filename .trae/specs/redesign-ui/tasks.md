# Tasks

- [x] Task 1: 复制载入动画视频到 public 目录并更新 LoadingScreen 组件
  - [x] SubTask 1.1: 将 `载入动画.mp4` 复制到 `public/loading-video.mp4`
  - [x] SubTask 1.2: 更新 LoadingScreen.tsx，确保视频源路径正确，播放10秒后淡出进入角色选择页
  - [x] SubTask 1.3: 添加视频加载失败的降级方案（logo + 进度条），确保最低等待10秒

- [x] Task 2: 重构 CSS 变量体系与全局样式（浅色主题）
  - [x] SubTask 2.1: 在 styles.css 中重写 `:root` CSS 变量，定义浅色主题完整变量集
  - [x] SubTask 2.2: 更新 AppContext.tsx 中浅色主题的 CSS 变量赋值逻辑
  - [x] SubTask 2.3: 定义企业端蓝绿色调变量和投资端紫金色调变量
  - [x] SubTask 2.4: 重写全局基础样式（滚动条等）适配浅色方案

- [x] Task 3: 重新设计角色选择页面（RoleScreen）
  - [x] SubTask 3.1: 更新 RoleScreen.tsx，添加品牌 logo 展示区域
  - [x] SubTask 3.2: 重设计角色卡片为浅色毛玻璃效果，企业端蓝绿渐变图标，投资端紫金渐变图标
  - [x] SubTask 3.3: 添加卡片悬停动画（上浮 + 品牌色边框渐显 + 图标缩放）
  - [x] SubTask 3.4: 使用 Icon 组件和 RippleButton 组件

- [x] Task 4: 重新设计企业端数据收集页面（CollectEnterpriseScreen）
  - [x] SubTask 4.1: 按 GMPS 五维度（A-E）和 DQI 三维度重新组织表单字段分组
  - [x] SubTask 4.2: 每组添加模型维度标签（如"GMPS-A"、"DQI-盈利"）
  - [x] SubTask 4.3: 更新表单样式为浅色毛玻璃卡片 + 圆角输入框
  - [x] SubTask 4.4: 补充 DQI 模型所需字段（净利润、期初/期末净资产、营业收入、经营现金流净额）
  - [x] SubTask 4.5: 更新 EnterpriseOnboardingDraft 类型定义以包含新增字段
  - [x] SubTask 4.6: 更新 validate-inputs.ts 添加 DQI 字段验证
  - [x] SubTask 4.7: 更新 enterprise-payload.ts 添加 DQI 字段到 payload
  - [x] SubTask 4.8: 更新 diagnostics.ts operatingQualityInputSchema 添加 DQI 字段

- [x] Task 5: 重新设计投资端数据收集页面（CollectInvestorScreen）
  - [x] SubTask 5.1: 更新表单样式为浅色毛玻璃卡片风格
  - [x] SubTask 5.2: 使用 Icon 组件替代 emoji

- [x] Task 6: 重新设计企业端主界面（EnterpriseScreen）
  - [x] SubTask 6.1: 更新导航栏为浅色风格，使用 SVG Icon 组件替代 emoji
  - [x] SubTask 6.2: 导航图标支持 hoverable 和 active 属性

- [x] Task 7: 重新设计投资端主界面（InvestorScreen）
  - [x] SubTask 7.1: 更新导航栏为浅色风格，使用 SVG Icon 组件替代 emoji
  - [x] SubTask 7.2: 导航图标支持 hoverable 和 active 属性

- [x] Task 8: 重新设计记忆中的你页面（MemoryScreen）
  - [x] SubTask 8.1: 添加 Icon 组件导入
  - [x] SubTask 8.2: 更新返回按钮使用 Icon 组件

- [x] Task 9: 实现图表缩放功能
  - [x] SubTask 9.1: 创建 ChartZoomWrapper 组件，支持鼠标滚轮整体缩放（50%~200%）
  - [x] SubTask 9.2: 支持拖拽选择区域放大
  - [x] SubTask 9.3: 添加缩放控件（+/−/重置按钮）到图表右上角
  - [x] SubTask 9.4: 缩放时带平滑过渡动画

- [x] Task 10: 创建 SVG 图标组件系统
  - [x] SubTask 10.1: 创建 Icon 组件，支持 SVG 图标渲染 + 颜色 + 尺寸 + 动画属性
  - [x] SubTask 10.2: 实现首页、分析、设置、记忆、企业、投资六个导航图标的 SVG 路径
  - [x] SubTask 10.3: 实现图标悬停动画（缩放1.15 + 上移 + 颜色渐变）
  - [x] SubTask 10.4: 实现图标激活状态（品牌色 + 脉冲动画）
  - [x] SubTask 10.5: 实现 RippleButton 点击涟漪效果组件

- [x] Task 11: 更新主题切换逻辑
  - [x] SubTask 11.1: 修改 AppContext.tsx 默认主题为浅色（isDark 默认 false）
  - [x] SubTask 11.2: 确保深色主题仍可作为选项切换

- [x] Task 12: 构建验证
  - [x] SubTask 12.1: vite build 构建成功，无 TypeScript 错误
  - [x] SubTask 12.2: 开发服务器正常运行

# Task Dependencies

- Task 2 → Task 3, Task 4, Task 5, Task 6, Task 7, Task 8（CSS 变量体系是所有样式更新的基础）
- Task 10 → Task 6, Task 7（SVG 图标组件是导航栏重设计的前置条件）
- Task 1 → 独立（载入动画可并行开发）
- Task 9 → 独立（图表缩放可并行开发）
- Task 11 → Task 2（主题切换依赖 CSS 变量体系）
- Task 4.4, 4.5 → Task 4.1, 4.2（类型定义和字段补充依赖分组设计）
- Task 12 → Task 6, Task 7, Task 8（全面样式重写在组件重设计之后）
