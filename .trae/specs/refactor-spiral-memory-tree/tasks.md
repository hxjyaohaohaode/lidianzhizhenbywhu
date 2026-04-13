# Tasks

- [x] Task 1: 定义多级树结构与螺旋坐标算法
  - [x] SubTask 1.1: 在 `App.tsx` 的 `MemoryScreen` 内或外部独立出基于极坐标（Radius/Angle）转换为笛卡尔坐标（x,y）的阿基米德/黄金螺旋布局算法。
  - [x] SubTask 1.2: 设计新的 `MemoryTreeNode` 数据结构（包含 `id`, `parentId`, `title`, `summary`, `detail`, `expanded`, `level` 等字段）。
- [x] Task 2: 对接后端数据并生成树状节点
  - [x] SubTask 2.1: 将传入 `MemoryScreen` 的 `userProfile` 与系统画像数据，转换为 1 个根节点（用户档案）和 N 个一级分类节点（如：基本信息、偏好、长期记忆）。
  - [x] SubTask 2.2: 将具体字段和长期记忆条目映射为二级子节点，初始状态设为隐藏（折叠）。
- [x] Task 3: 实现节点交互与连线渲染
  - [x] SubTask 3.1: 在节点卡片点击时触发展开/折叠状态切换，并触发坐标重新计算（确保子节点围绕父节点或其他规则螺旋排列）。
  - [x] SubTask 3.2: 提取当前激活节点及其可见后代节点，通过 `<svg><line></line></svg>` 动态渲染从父节点到子节点的连接线。
- [x] Task 4: 适配现有记忆弹窗与细节打磨
  - [x] SubTask 4.1: 修改节点卡片 UI，使卡片直接显示 `summary`，并提供一个独立的“详情”点击区域（或区分单击展开/双击查看）。
  - [x] SubTask 4.2: 确认节点打开现有的详情弹窗（`.ndo`）正常工作。

# Task Dependencies
- [Task 2] depends on [Task 1]
- [Task 3] depends on [Task 1, Task 2]
- [Task 4] depends on [Task 3]
