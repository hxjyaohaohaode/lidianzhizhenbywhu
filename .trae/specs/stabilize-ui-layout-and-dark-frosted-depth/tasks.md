# Tasks

- [x] Task 1: 盘点并收敛全局布局稳定性问题
  - [x] SubTask 1.1: 审查主框架、分栏容器、卡片和滚动区域的宽高、对齐、溢出与层级规则。
  - [x] SubTask 1.2: 为易错位区域补齐统一的最小尺寸、间距、定位和响应式约束。
- [x] Task 2: 稳定弹层、详情面板与工作区显示
  - [x] SubTask 2.1: 统一 tooltip、modal、上传面板、记忆详情等弹层的定位、尺寸和遮罩表现。
  - [x] SubTask 2.2: 修正主题切换或内容切换时可能产生的显示跳动、裁切和重叠问题。
- [x] Task 3: 增强深色模式下的真实磨砂质感
  - [x] SubTask 3.1: 调整深色模式背景、面板透明度、边框高光和阴影层次，提升材质真实感。
  - [x] SubTask 3.2: 为深色模式增加克制的微噪点或磨砂纹理，并确保不影响文本、图表和交互可读性。
- [x] Task 4: 完成验证与回归检查
  - [x] SubTask 4.1: 补充或更新与主题切换、关键布局和弹层显示相关的验证。
  - [x] SubTask 4.2: 逐项对照验收清单检查，确保界面稳定性和深色模式质感同时达标。

# Task Dependencies
- [Task 2] depends on [Task 1]
- [Task 3] depends on [Task 1]
- [Task 4] depends on [Task 2, Task 3]
