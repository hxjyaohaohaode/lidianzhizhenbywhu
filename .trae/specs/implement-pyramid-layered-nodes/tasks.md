# Tasks

- [x] Task 1: 编写分层递增坐标算法
  - [x] SubTask 1.1: 在 `generateRadialPos` 中识别 `level === 2` 的情况。
  - [x] SubTask 1.2: 根据 `siblingsCount` 和 `localIndex` 计算当前节点所属的 `Layer`（第 1 层容量 2，第 2 层容量 3...）。
  - [x] SubTask 1.3: 计算 `Layer` 的法线距离（如 `R2_base = 220`，每层间隔 `+160`），以及当前节点在 `Layer` 中的侧向偏移。
  - [x] SubTask 1.4: 将极坐标转换回笛卡尔坐标，保证所有子节点围绕“中心点 -> L1节点”的射线对称分布。
- [x] Task 2: 优化连线渲染逻辑
  - [x] SubTask 2.1: 调整 `<line>` 的起点。由于二级节点按层排列，可以直接将连线的起点统一绑定到所属的 `L1` 节点中心。
  - [x] SubTask 2.2: 确保所有连线应用现有的 `glowLine` 发光特效。
- [x] Task 3: 验收并完善界面
  - [x] SubTask 3.1: 增大所有测试数据的条目数（例如最近记忆增加至 6 条，历史会话增加至 5 条），以验证 3 层以上的分布效果。
  - [x] SubTask 3.2: 确认展开一级节点时，其下的所有子节点不再出现重叠。
  - [x] SubTask 3.3: 确认图谱依然支持无边界缩放平移（Pan & Zoom），弹窗不受影响。

# Task Dependencies
- [Task 2] depends on [Task 1]
- [Task 3] depends on [Task 1, Task 2]
