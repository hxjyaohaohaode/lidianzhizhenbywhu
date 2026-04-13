# API 接口使用说明

## 新增的 DQI 和 GMPS 模型计算接口

### 1. POST `/api/models/dqi/calculate` - DQI模型计算接口

**功能说明**：计算经营质量动态评价指数（DQI），评估企业盈利能力、成长能力和现金流质量的综合变化。

**请求体示例**：
```json
{
  "currentNetProfit": 5000000,
  "currentBeginningEquity": 50000000,
  "currentEndingEquity": 55000000,
  "currentRevenue": 100000000,
  "currentOperatingCashFlow": 12000000,
  "baselineNetProfit": 4000000,
  "baselineBeginningEquity": 45000000,
  "baselineEndingEquity": 49000000,
  "baselineRevenue": 85000000,
  "baselineOperatingCashFlow": 8000000
}
```

**响应示例** (200 OK)：
```json
{
  "success": true,
  "data": {
    "dqi": 1.183,
    "status": "改善",
    "driver": "现金流质量",
    "decomposition": {
      "profitabilityContribution": 0.4476,
      "growthContribution": 0.3529,
      "cashflowContribution": 0.3825
    },
    "metrics": {
      "currentROE": 9.5238,
      "baselineROE": 8.5075,
      "roeRatio": 1.1194,
      "currentGrowth": 0.1765,
      "baselineGrowth": 0,
      "growthRatio": 1.1765,
      "currentOCFRatio": 0.12,
      "baselineOCFRatio": 0.0941,
      "ocfRatioChange": 1.2753
    },
    "trend": "DQI指数为1.183（较基期提升18.30%），经营质量呈改善态势...",
    "confidence": 0.95
  }
}
```

**字段说明**：
- `dqi`: DQI综合指数，>1.05表示改善，<0.95表示恶化
- `status`: 趋势状态（"改善"、"稳定"、"恶化"）
- `driver`: 主要驱动因素（盈利能力/成长能力/现金流质量）
- `decomposition`: 三维度贡献分解
- `metrics`: 详细指标数据
- `trend`: 趋势描述文本
- `confidence`: 置信度（0-1）

---

### 2. POST `/api/models/gmps/calculate` - GMPS模型计算接口

**功能说明**：计算毛利承压综合评分（GMPS），从五层十维角度全面分析企业毛利压力状况。

**请求体示例**：
```json
{
  "currentGrossMargin": 18.5,
  "currentRevenue": 1000000,
  "currentCost": 815000,
  "currentSalesVolume": 50000,
  "currentProductionVolume": 55000,
  "currentInventory": 2000000,
  "currentManufacturingExpense": 200000,
  "currentOperatingCost": 815000,
  "currentOperatingCashFlow": 120000,
  "currentTotalLiabilities": 4000000,
  "currentTotalAssets": 10000000,

  "baselineGrossMargin": 22.0,
  "baselineRevenue": 850000,
  "baselineCost": 663000,
  "baselineSalesVolume": 45000,
  "baselineProductionVolume": 50000,
  "baselineInventory": 1500000,
  "baselineManufacturingExpense": 180000,
  "baselineOperatingCost": 663000,
  "baselineOperatingCashFlow": 100000,
  "baselineTotalLiabilities": 3500000,
  "baselineTotalAssets": 9000000,

  "currentLithiumPrice": 180000,
  "baselineLithiumPrice": 150000,
  "industryVolatility": 0.25
}
```

**响应示例** (200 OK)：
```json
{
  "success": true,
  "data": {
    "gmps": 58.83,
    "level": "中压",
    "probabilityNextQuarter": 0.9976,
    "riskLevel": "高风险",
    "dimensionScores": {
      "A_毛利率结果": 45.2,
      "B_材料成本冲击": 62.5,
      "C_产销负荷": 55.8,
      "D_外部风险": 48.0,
      "E_现金流安全": 42.3
    },
    "featureScores": {
      "gpmYoy": 52.3,
      "revCostGap": 38.1,
      "liPriceYoy": 65.2,
      "unitCostYoy": 59.8,
      "invYoy": 52.0,
      "saleProdRatio": 58.5,
      "mfgCostRatio": 53.6,
      "indVol": 48.0,
      "cfoRatio": 45.2,
      "lev": 39.4
    },
    "normalizedMetrics": {...},
    "keyFindings": [
      "毛利率同比下降 15.91%，毛利承压显著。",
      "成本增速较收入快 12.35%，利润挤压严重。",
      ...
    ],
    "governance": {
      "modelVersion": "gmps-2026.04",
      "parameterVersion": "gmps-baseline-v2",
      "reproducibilityKey": "a1b2c3d4e5f6g7h8",
      "confidenceScore": 0.9976,
      "inputQuality": "high",
      "normalizedAt": "2026-04-08T10:30:00.000Z",
      "auditTrail": [...]
    }
  }
}
```

**字段说明**：
- `gmps`: 毛利承压综合评分（0-100），<40低压，40-70中压，>70高压
- `level`: 压力等级（"低压"、"中压"、"高压"）
- `probabilityNextQuarter`: 下季度风险概率（Logistic回归预测）
- `riskLevel`: 风险等级（"低风险"、"中风险"、"高风险"）
- `dimensionScores`: 五层维度得分
- `featureScores`: 十个特征变量得分
- `keyFindings`: 关键发现列表
- `governance`: 治理信息（版本、置信度、审计追踪）

---

## 错误处理

### 参数校验失败（400 Bad Request）
```json
{
  "code": "INVALID_REQUEST",
  "message": "请求参数校验失败。",
  "statusCode": 400,
  "details": [
    {
      "path": "currentNetProfit",
      "message": "Expected number, received null"
    },
    ...
  ]
}
```

### 服务器错误（500 Internal Server Error）
```json
{
  "code": "INTERNAL_ERROR",
  "message": "内部服务器错误。",
  "statusCode": 500
}
```

---

## 使用示例

### cURL 示例

#### DQI 计算
```bash
curl -X POST http://localhost:3000/api/models/dqi/calculate \
  -H "Content-Type: application/json" \
  -d '{
    "currentNetProfit": 5000000,
    "currentBeginningEquity": 50000000,
    "currentEndingEquity": 55000000,
    "currentRevenue": 100000000,
    "currentOperatingCashFlow": 12000000,
    "baselineNetProfit": 4000000,
    "baselineBeginningEquity": 45000000,
    "baselineEndingEquity": 49000000,
    "baselineRevenue": 85000000,
    "baselineOperatingCashFlow": 8000000
  }'
```

#### GMPS 计算
```bash
curl -X POST http://localhost:3000/api/models/gmps/calculate \
  -H "Content-Type: application/json" \
  -d '{
    "currentGrossMargin": 18.5,
    "currentRevenue": 1000000,
    "currentCost": 815000,
    "currentSalesVolume": 50000,
    "currentProductionVolume": 55000,
    "currentInventory": 2000000,
    "currentManufacturingExpense": 200000,
    "currentOperatingCost": 815000,
    "currentOperatingCashFlow": 120000,
    "currentTotalLiabilities": 4000000,
    "currentTotalAssets": 10000000,
    "baselineGrossMargin": 22.0,
    "baselineRevenue": 850000,
    "baselineCost": 663000,
    "baselineSalesVolume": 45000,
    "baselineProductionVolume": 50000,
    "baselineInventory": 1500000,
    "baselineManufacturingExpense": 180000,
    "baselineOperatingCost": 663000,
    "baselineOperatingCashFlow": 100000,
    "baselineTotalLiabilities": 3500000,
    "baselineTotalAssets": 9000000,
    "currentLithiumPrice": 180000,
    "baselineLithiumPrice": 150000,
    "industryVolatility": 0.25
  }'
```

---

## 向后兼容性说明

✅ **完全向后兼容**
- 现有的 `/api/models/gross-margin-pressure` 接口保持不变
- 现有的 `/api/models/operating-quality` 接口保持不变
- 新增接口仅在原有路由之后添加，不影响任何现有功能

---

## 技术实现细节

### DQI 模型算法
- **核心公式**: DQI = w1·(ROE_t/ROE_{t-1}) + w2·(Growth_t/Growth_{t-1}) + w3·(OCF_t/OCF_{t-1})
- **默认权重**: 盈利能力(0.4) + 成长能力(0.3) + 现金流质量(0.3)
- **趋势判断**: DQI > 1.05 改善 | 0.95 ≤ DQI ≤ 1.05 稳定 | DQI < 0.95 恶化
- **置信度计算**: 基于指标一致性和极端值检测

### GMPS 模型算法
- **五层维度**:
  - A层（毛利率结果）权重0.25: gpmYoy, revCostGap
  - B层（材料成本冲击）权重0.22: liPriceYoy, unitCostYoy
  - C层（产销负荷）权重0.31: invYoy, saleProdRatio, mfgCostRatio
  - D层（外部风险）权重0.07: indVol
  - E层（现金流安全）权重0.15: cfoRatio, lev
- **评分方法**: 线性插值打分（20-80分区间）
- **风险预测**: Logistic回归模型预测下季度风险概率
