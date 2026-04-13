# Tasks

## 阶段一：前端UI稳定性修复（最高优先级 - 影响用户可见性）

- [ ] Task 1: 补充缺失的CSS变量定义
  - [ ] SubTask 1.1: 在App.tsx暗色主题（约L2606-2649）中添加`--t4`、`--glass`、`--line`、`--glass-soft`、`--rs`变量定义
  - [ ] SubTask 1.2: 在App.tsx亮色主题（约L2649-2692）中添加对应变量定义
  - [ ] SubTask 1.3: 验证所有`var(--t4)`、`var(--glass)`、`var(--line)`、`var(--glass-soft)`、`var(--rs)`引用在两种主题下都能正确解析

- [ ] Task 2: 修复跑马灯样式冲突
  - [ ] SubTask 2.1: 删除styles.css中第一组跑马灯样式（L35-84），保留第二组（L998-1041，涨红跌绿符合中国市场惯例）
  - [ ] SubTask 2.2: 统一动画名称和速度，确保跑马灯滚动流畅

- [ ] Task 3: 修复前端API调用健壮性
  - [ ] SubTask 3.1: 在api.ts的`streamInvestorAnalysis`中为`JSON.parse(dataLine)`添加try-catch保护，解析失败时跳过该行继续处理
  - [ ] SubTask 3.2: 在api.ts的`requestJson`中为`response.json()`添加try-catch保护，解析失败时抛出友好错误

- [ ] Task 4: 修复其他前端问题
  - [ ] SubTask 4.1: 在styles.css中添加`.iwb-split`样式定义，使splitMode功能生效
  - [ ] SubTask 4.2: 为`dangerouslySetInnerHTML`中的消息内容添加HTML转义函数
  - [ ] SubTask 4.3: 清理App.tsx和dqi-gmps-panels.tsx中未使用的类型导入

## 阶段二：GMPS模型打分逻辑修复（最高优先级 - 影响分析结果可信度）

- [ ] Task 5: 修复GMPS打分方向错误
  - [ ] SubTask 5.1: 将`indVol`的打分函数从`scoreDecreasingRisk`改为`scoreIncreasingRisk`（高波动危险）
  - [ ] SubTask 5.2: 将`mfgCostRatio`的打分函数从`scoreDecreasingRisk`改为`scoreIncreasingRisk`（高占比危险）
  - [ ] SubTask 5.3: 修复`gpmYoy`打分逻辑，区分毛利率上升（改善→低分）和下降（恶化→高分），不再取绝对值
  - [ ] SubTask 5.4: 更新GMPS相关单元测试，验证打分方向正确性

- [ ] Task 6: 修复DQI模型计算逻辑
  - [ ] SubTask 6.1: 修复OCF比率变化计算，移除`Math.abs`，保留现金流正负方向信息；当OCF从正转负时ocfRatioChange应<1
  - [ ] SubTask 6.2: 修复`baselineGrowth`硬编码为0的问题，在DQI输入Schema中添加可选的`baselineGrowth`字段，缺失时使用推算逻辑并在输出中标注
  - [ ] SubTask 6.3: 修复`identifyDriver`在稳定状态下（所有比率接近1）返回"无明显驱动"或类似标识
  - [ ] SubTask 6.4: 更新DQI相关单元测试

## 阶段三：智能体与数学模型集成修复（高优先级 - 影响系统架构正确性）

- [ ] Task 7: 修复数学模型降级事件可见性
  - [ ] SubTask 7.1: 修改`runMathAnalysisAgent`，当DQI/GMPS降级时返回`status: "degraded"`和非空`degradationTrace`
  - [ ] SubTask 7.2: 在`buildMathAnalysisOutput`中，将DQI/GMPS降级事件收集并返回给调用方
  - [ ] SubTask 7.3: 在`diagnose`方法中，将mathAnalysis的degradationTrace合并到工作流级别的degradationTrace中

- [ ] Task 8: 修复DQI/GMPS输入数据推算问题
  - [ ] SubTask 8.1: 在`extractDQIInputFromContext`中添加`dataProvenance`字段，标注哪些数据为推算值及推算方法
  - [ ] SubTask 8.2: 在`extractGMPSInputFromContext`中添加`dataProvenance`字段，标注库存估算方法和碳酸锂价格来源
  - [ ] SubTask 8.3: 将`dataProvenance`信息传递到最终的`MathAnalysisOutput`中，使前端可展示数据来源标注

- [ ] Task 9: 修复GMPS触发条件和默认值
  - [ ] SubTask 9.1: 修改`shouldCalculateGMPS`，使`investmentRecommendation`模式也触发GMPS计算
  - [ ] SubTask 9.2: 优化碳酸锂价格和行业波动率的默认值策略，优先从数据采集结果获取，仅在完全无数据时使用默认值并标注

## 阶段四：类型定义与治理一致性修复（中优先级）

- [ ] Task 10: 统一类型定义和治理字段
  - [ ] SubTask 10.1: 为`DQIResult`添加`governance`字段，与其他模型结果类型保持一致
  - [ ] SubTask 10.2: 将`MathAnalysisOutput`中`dqiModel`/`gmpsModel`的内联类型改为引用`DQIResult`/`GMPSResult`类型
  - [ ] SubTask 10.3: 将DQI的`trend`字段从`string`改为结构化`TrendAssessment`类型
  - [ ] SubTask 10.4: 更新相关前端组件以适配类型变更

## 阶段五：验证与测试

- [ ] Task 11: 全面验证
  - [ ] SubTask 11.1: 运行TypeScript编译检查，确保0错误
  - [ ] SubTask 11.2: 运行现有单元测试，确保全部通过
  - [ ] SubTask 11.3: 手动验证前端UI在暗色/亮色主题下均无样式异常
  - [ ] SubTask 11.4: 手动验证DQI/GMPS API返回结果正确
  - [ ] SubTask 11.5: 验证智能体工作流降级事件正确记录

# Task Dependencies

- [Task 2] depends on [Task 1] — 跑马灯修复依赖CSS变量补充
- [Task 5] depends on nothing — GMPS打分修复可独立进行
- [Task 6] depends on nothing — DQI逻辑修复可独立进行
- [Task 7] depends on [Task 5, Task 6] — 降级事件修复依赖模型逻辑正确
- [Task 8] depends on [Task 7] — 数据标注依赖降级机制就绪
- [Task 9] depends on nothing — GMPS触发条件可独立修复
- [Task 10] depends on [Task 5, Task 6] — 类型统一依赖模型逻辑稳定
- [Task 11] depends on [Task 1-10] — 验证依赖所有修复完成

## 并行执行建议

**第一批（可并行）**：
- Task 1, 2, 3, 4（前端修复）
- Task 5, 6（模型逻辑修复）

**第二批（可并行）**：
- Task 7, 9（智能体修复）

**第三批（需串行）**：
- Task 8 → Task 10（数据标注 → 类型统一）

**第四批**：
- Task 11（全面验证）
