# Tasks
- [x] Task 1: 盘点并定义图表指标映射基线
  - [x] SubTask 1.1: 梳理数学模型输出、锂电池行业标准信息、投资分析口径与现有前后端数据结构的对应关系
  - [x] SubTask 1.2: 定义企业端与普通用户端各自需要展示的核心指标、默认排序、口径说明与行业对标字段
  - [x] SubTask 1.3: 产出统一的图表数据结构、刷新元信息与降级占位规则

- [x] Task 2: 建立多形态图表与表格组件编排层
  - [x] SubTask 2.1: 为柱状图、斑马纹表格、对标对照表、热力矩阵表、迷你图嵌入表、条件格式预警表建立统一组件协议
  - [x] SubTask 2.2: 增加卡片式分组表格、树状层级折叠表格、多维交叉透视矩阵表与日历视图表格组件
  - [x] SubTask 2.3: 建立按角色、页面、分析模式与数据完备度进行编排和降级的注册机制

- [x] Task 3: 落实企业端图表升级
  - [x] SubTask 3.1: 在企业端首页接入经营总览、关键预警、趋势拆解与对标展示图表
  - [x] SubTask 3.2: 在企业端分析页接入模型结论解释、问题归因、成本/盈利/运营多维表格与交叉分析矩阵
  - [x] SubTask 3.3: 在企业端相关表格中补充层级展开、条件高亮、迷你趋势与自动刷新状态

- [x] Task 4: 落实普通用户端图表升级
  - [x] SubTask 4.1: 在普通用户端行业与推荐视图接入行业景气、竞争对标、风险收益、催化因素相关图表
  - [x] SubTask 4.2: 在普通用户端深度分析视图接入证据对照表、日历节奏表、热力矩阵与透视矩阵
  - [x] SubTask 4.3: 为普通用户端强化标的切换、时间窗切换、风险视角切换与结论联动

- [x] Task 5: 建立统一动态交互与自动刷新机制
  - [x] SubTask 5.1: 为全部图表与表格补充悬浮详情、排序、筛选、联动高亮、展开折叠与空态反馈
  - [x] SubTask 5.2: 将会话上下文、实时信息与分析结果刷新接入图表更新链路
  - [x] SubTask 5.3: 增加刷新时间、刷新状态、数据来源与异常降级提示

- [x] Task 6: 完成视觉统一与主题适配
  - [x] SubTask 6.1: 统一浅色模式与深色模式下的图表配色、热力色阶、文本对比度与状态色
  - [x] SubTask 6.2: 优化所有表格的玻璃质感、留白、边框、圆角、滚动与卡片化表现
  - [x] SubTask 6.3: 修复主题切换下的可读性、重叠、裁切与交互反馈问题

- [x] Task 7: 完成验证与回归
  - [x] SubTask 7.1: 补充图表编排、角色差异、主题切换与自动刷新的关键测试或验证用例
  - [x] SubTask 7.2: 验证企业端与普通用户端主要图表在多数据状态下均可正常展示和降级
  - [x] SubTask 7.3: 进行浅色/深色模式与主要交互路径的界面验收

# Task Dependencies
- [Task 2] depends on [Task 1]
- [Task 3] depends on [Task 1]
- [Task 3] depends on [Task 2]
- [Task 4] depends on [Task 1]
- [Task 4] depends on [Task 2]
- [Task 5] depends on [Task 2]
- [Task 5] depends on [Task 3]
- [Task 5] depends on [Task 4]
- [Task 6] depends on [Task 2]
- [Task 6] depends on [Task 3]
- [Task 6] depends on [Task 4]
- [Task 7] depends on [Task 3]
- [Task 7] depends on [Task 4]
- [Task 7] depends on [Task 5]
- [Task 7] depends on [Task 6]
