# 系统全面审查与升级 Spec

## Why
当前系统已实现了基础的双门户架构、8个智能体协作、简化版数学模型等核心功能，但需要全面对比《系统设计方案》和《数学模型集成补充方案》，确保系统能够：
1. **完全符合**两个核心数学模型（DQI和GMPS）的完整定义
2. **完整实现**设计方案中的所有功能模块
3. **确保前后端**数据流、API接口、UI展示的一致性
4. **验证系统**能够稳定运行并提供准确的诊断结果

## What Changes
- **核心数学模型升级**：将现有简化模型升级为完整的DQI（经营质量动态评价）模型和GMPS（毛利承压分析）模型
- **智能体集成优化**：确保8个智能体与数学模型的深度集成
- **API接口完善**：补充缺失的模型计算和数据查询接口
- **前端可视化增强**：基于数学模型输出完善图表和仪表盘
- **数据验证加强**：确保输入输出数据的完整性和准确性
- **测试覆盖补充**：增加单元测试和集成测试

## Impact
- Affected specs: 数学模型集成、多智能体协作、双门户架构
- Affected code:
  - `src/server/models.ts` - 核心数学模型实现
  - `src/shared/diagnostics.ts` - 模型Schema定义
  - `src/server/agent-service.ts` - 智能体服务
  - `src/web/App.tsx` - 前端主应用
  - `src/web/chart-data.ts` - 图表数据处理
  - `src/server/app.ts` - API路由

---

## ADDED Requirements

### Requirement: 完整DQI模型实现
系统 SHALL 提供符合《经营质量变化的动态评价模型》文档的完整DQI模型实现：

#### Scenario: DQI模型计算
- **WHEN** 用户提交企业财务数据（当期和基期）
- **THEN** 系统 SHALL 计算以下指标：
  - ROE = 净利润 / 平均净资产 × 100%
  - Growth = (当期营收 - 上期营收) / 上期营收
  - OCF比率 = 经营现金流 / 营业收入
  - DQI指数 = w1·(ROE_t/ROE_{t-1}) + w2·(Growth_t/Growth_{t-1}) + w3·(OCF_t/OCF_{t-1})
  - 权重配置：w1=0.4（盈利能力）, w2=0.3（成长能力）, w3=0.3（现金流质量）
- **AND** 系统 SHALL 识别驱动因素（argmax{ROE比率, Growth比率, OCF比率}）
- **AND** 系统 SHALL 判断趋势状态（DQI>1改善，DQI=1稳定，DQI<1恶化）

### Requirement: 完整GMPS模型实现
系统 SHALL 提供符合《毛利承压建模》文档的完整GMPS模型实现：

#### Scenario: GMPS模型计算
- **WHEN** 用户提交企业数据和行业外部数据
- **THEN** 系统 SHALL 计算五层维度指标：
  - **A层（毛利率结果）**：毛利率同比、营收成本增速差
  - **B层（材料成本冲击）**：碳酸锂价格同比、单位成本同比
  - **C层（产销负荷）**：库存同比、产销率、制造费用占比
  - **D层（外部风险）**：行业指数波动率
  - **E层（现金流安全）**：现金流比率、资产负债率
- **AND** 系统 SHALL 对10个特征变量进行标准化打分（0-100分）
- **AND** 系统 SHALL 计算加权综合得分：GMPS = Σ w_k · score_k
- **AND** 系统 SHALL 划分承压等级（<40低压，40-70中压，≥70高压）
- **AND** 系统 SHALL 使用Logistic回归预测下季度承压概率

### Requirement: 数学模型API接口
系统 SHALL 提供完整的RESTful API接口支持模型计算：

#### Scenario: 调用DQI计算接口
- **WHEN** 前端调用 POST `/api/models/dqi/calculate`
- **THEN** 后端 SHALL 返回包含以下字段的结果：
  ```json
  {
    "success": true,
    "data": {
      "dqi": 1.08,
      "status": "改善",
      "driver": "盈利能力",
      "decomposition": {
        "profitabilityContribution": 0.432,
        "growthContribution": 0.285,
        "cashflowContribution": 0.324
      },
      "roe": 18.18,
      "growth": 0.15,
      "ocfRatio": 0.12,
      "confidence": 0.87
    }
  }
  ```

#### Scenario: 调用GMPS计算接口
- **WHEN** 前端调用 POST `/api/models/gmps/calculate`
- **THEN** 后端 SHALL 返回包含以下字段的结果：
  ```json
  {
    "success": true,
    "data": {
      "gmps": 65.3,
      "level": "中压",
      "probabilityNextQuarter": 0.58,
      "riskLevel": "中风险",
      "dimensionScores": {
        "A_毛利率结果": 58,
        "B_材料成本冲击": 72,
        "C_产销负荷": 45,
        "D_外部风险": 38,
        "E_现金流安全": 62
      },
      "featureScores": {...}
    }
  }
  ```

### Requirement: 智能体与模型深度集成
系统 SHALL 确保8个智能体与数学模型的完整协作：

#### Scenario: 数学分析智能体执行模型计算
- **WHEN** 任务编排智能体分配诊断任务给数学分析智能体
- **THEN** 数学分析智能体 SHALL 根据任务类型选择合适的模型（DQI/GMPS/两者）
- **AND** 数学分析智能体 SHALL 从数据收集智能体获取企业财务数据
- **AND** 数学分析智能体 SHALL 从行业检索智能体获取碳酸锂价格和行业指数
- **AND** 数学分析智能体 SHALL 执行模型计算并返回结构化结果

#### Scenario: 证据审查智能体验证模型结果
- **WHEN** 数学分析智能体返回计算结果
- **THEN** 证据审查智能体 SHALL 验证结果合理性：
  - DQI范围检查（通常0.5-2.0）
  - GMPS范围检查（0-100）
  - 概率范围检查（0-1）
- **AND** 证据审查智能体 SHALL 进行交叉验证

### Requirement: 前端可视化增强
系统 SHALL 基于完整数学模型输出提供丰富的可视化：

#### Scenario: DQI趋势图展示
- **WHEN** 用户查看经营质量评价页面
- **THEN** 系统 SHALL 展示DQI指数折线图（含基准线1.0）
- **AND** 系统 SHALL 展示驱动因素雷达图（盈利能力、成长能力、现金流质量）

#### Scenario: GMPS仪表盘展示
- **WHEN** 用户查看毛利承压分析页面
- **THEN** 系统 SHALL 展示GMPS半圆仪表盘（根据等级着色：绿/黄/红）
- **AND** 系统 SHALL 展示五维度雷达图（A/B/C/D/E层）
- **AND** 系统 SHALL 展示特征得分瀑布图（10个特征变量）

### Requirement: 数据模型完整性
系统 SHALL 确保数据存储结构支持完整模型需求：

#### Scenario: 企业财务数据存储
- **WHEN** 系统接收企业财务数据
- **THEN** 数据库 SHALL 存储完整的利润表、资产负债表、现金流量表数据
- **AND** 数据库 SHALL 支持按企业和报告期唯一索引
- **AND** 数据库 SHALL 包含经营数据（销量、产量、库存、制造费用）

#### Scenario: 行业外部数据存储
- **WHEN** 系统更新行业数据
- **THEN** 数据库 SHALL 存储碳酸锂价格历史数据
- **AND** 数据库 SHALL 存储行业指数数据（创业板指数、中证动力电池指数）
- **AND** 数据库 SHALL 支持按日期唯一索引

#### Scenario: 模型计算结果存储
- **WHEN** 模型完成计算
- **THEN** 数据库 SHALL 存储DQI计算结果（含分解指标）
- **AND** 数据库 SHALL 存储GMPS计算结果（含维度得分和特征得分）
- **AND** 数据库 SHALL 支持历史趋势查询

---

## MODIFIED Requirements

### Requirement: 现有简化模型升级
**当前实现**：`src/server/models.ts` 中的 `analyzeGrossMarginPressure` 和 `analyzeOperatingQuality` 函数使用简化的5指标和6指标评分体系。

**修改为**：
1. 保留现有函数作为向后兼容的简化版本
2. 新增 `calculateDQI()` 和 `calculateGMPS()` 函数实现完整模型
3. 更新 Schema 定义以支持新的输入参数
4. 在API路由中同时暴露新旧两套接口

### Requirement: 智能体配置更新
**当前实现**：`src/shared/agents.ts` 中定义了8个智能体的基本角色和类型。

**修改为**：
1. 扩展 `MathAnalysisOutput` 类型以包含完整的DQI和GMPS结果
2. 增加 `ModelRequest` 和 `ModelResponse` 接口定义
3. 更新智能体请求Schema以支持模型类型选择（DQI/GMPS/BOTH）

### Requirement: 前端图表系统增强
**当前实现**：`src/web/chart-data.ts` 提供基础的图表数据构建函数。

**修改为**：
1. 新增DQI趋势图、驱动因素雷达图的构建函数
2. 新增GMPS仪表盘、五维雷达图、特征瀑布图的构建函数
3. 更新可视化组件以支持新的图表类型
4. 添加模型参数配置界面的数据绑定

---

## REMOVED Requirements

无移除需求。本次升级为增量式改进，保留所有现有功能。

---

## 验收标准

### 功能验收
- [ ] DQI模型能正确计算ROE、Growth、OCF比率和综合指数
- [ ] GMPS模型能正确计算10个特征变量和五维得分
- [ ] Logistic回归预测功能正常工作
- [ ] 所有API接口返回正确的数据格式
- [ ] 智能体能成功调用模型并传递结果
- [ ] 前端能正确展示所有新增的可视化图表

### 性能验收
- [ ] 单次DQI计算响应时间 < 500ms
- [ ] 单次GMPS计算响应时间 < 800ms
- [ ] 完整诊断流程（8个智能体）响应时间 < 30s
- [ ] 并发处理能力 ≥ 10个同时请求

### 兼容性验收
- [ ] 现有API接口保持向后兼容
- [ ] 现有前端功能不受影响
- [ ] 数据库迁移脚本可安全执行
- [ ] 配置文件格式保持一致

### 安全性验收
- [ ] 输入参数校验完整（Zod Schema）
- [ ] SQL注入防护到位
- [ ] 敏感数据加密存储
- [ ] API访问权限控制正确
