# 分析页面修复与智能体任务分级 - 验收检查清单

## 一、分析页面滚动修复

- [x] **SCROLL-001**: 投资端分析页面初次打开时不自动滚动到底部
- [x] **SCROLL-002**: 企业端分析页面初次打开时不自动滚动到底部
- [x] **SCROLL-003**: 投资端新消息到达时自动滚动到最新消息
- [x] **SCROLL-004**: 企业端新消息到达时自动滚动到最新消息
- [x] **SCROLL-005**: 页面切换回分析页时不触发滚动

## 二、分析页面默认视图修复

- [x] **VIEW-001**: 投资端默认显示"行业状况分析"模式，非"投资推荐"
- [x] **VIEW-002**: 行业状况分析模式下不显示辩论消息
- [x] **VIEW-003**: 深度解析模式下不显示辩论消息
- [x] **VIEW-004**: 投资推荐模式下正常显示辩论消息和辩论结果
- [x] **VIEW-005**: 分析结果面板中"正式辩论"区块仅在投资推荐模式下显示

## 三、智能体任务分级

### 后端分级逻辑
- [x] **GRADE-001**: `TaskComplexity`类型已定义（simple/moderate/full）
- [x] **GRADE-002**: `classifyQueryComplexity`函数能正确分类简单问题
- [x] **GRADE-003**: `classifyQueryComplexity`函数能正确分类中等复杂问题
- [x] **GRADE-004**: `classifyQueryComplexity`函数能正确分类复杂问题
- [x] **GRADE-005**: simple模式仅执行mathAnalysis，跳过所有LLM调用
- [x] **GRADE-006**: moderate模式跳过taskOrchestrator/memoryManagement/dataUnderstanding的LLM调用
- [x] **GRADE-007**: full模式执行完整8步流水线
- [x] **GRADE-008**: diagnose返回结果包含complexity字段

### 前端分级适配
- [x] **GRADE-009**: 发送请求时自动设置complexity字段
- [x] **GRADE-010**: 进度卡片显示当前任务分级信息
- [x] **GRADE-011**: 简单问题模式下直接显示数学模型结果

### 性能验证
- [x] **GRADE-012**: 简单问题（如"计算DQI指数"）响应时间 < 2秒
- [x] **GRADE-013**: 中等问题响应时间 < 10秒
- [x] **GRADE-014**: 复杂问题正常完成完整流水线

## 四、系统完整性

- [x] **SYS-001**: TypeScript编译0错误
- [x] **SYS-002**: 现有单元测试全部通过
- [x] **SYS-003**: 企业端诊断流程端到端可完成
- [x] **SYS-004**: 投资端分析流程端到端可完成
