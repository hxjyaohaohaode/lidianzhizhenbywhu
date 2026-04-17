import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import request from "supertest";
import { describe, expect, it } from "vitest";

import { createApp } from "./app.js";
import { createLogger } from "./logger.js";
import type { ServerEnv } from "../shared/config.js";

const testEnv: ServerEnv = {
  NODE_ENV: "test",
  PORT: 3001,
  LOG_LEVEL: "silent" as never,
  CORS_ORIGIN: "http://localhost:5173",
  VITE_APP_TITLE: "测试平台",
  VITE_API_BASE_URL: "/api",
  PERSISTENCE_MODE: "file",
  STORAGE_DIR: mkdtempSync(path.join(os.tmpdir(), "battery-api-test-")),
  CACHE_TTL_SECONDS: 300,
  CACHE_STALE_TTL_SECONDS: 1800,
  RATE_LIMIT_WINDOW_MS: 60000,
  RATE_LIMIT_MAX_REQUESTS: 120,
  ASYNC_TASK_CONCURRENCY: 2,
  AGENT_BUDGET_TOTAL_TOKENS: 16000,
  AGENT_BUDGET_MAX_STEPS: 12,
  AGENT_RETRY_LIMIT: 2,
  EXTERNAL_FETCH_TIMEOUT_MS: 4000,
  EXTERNAL_FETCH_RETRY_COUNT: 2,
  RAG_SOURCE_WHITELIST: ["example.com", "example.org", "example.net", "example.edu"],
  RAG_MAX_SOURCE_AGE_DAYS: 60,
  HEALTHCHECK_INCLUDE_DETAILS: true,
  ENABLE_BACKGROUND_TASKS: true,
  DEEPSEEK_API_KEY: "deepseek",
  GLM_API_KEY: undefined,
  QWEN_API_KEY: "qwen",
  DEEPSEEK_BASE_URL: "https://api.deepseek.com/v1",
  GLM_BASE_URL: "https://open.bigmodel.cn/api/paas/v4",
  QWEN_BASE_URL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
  DATA_STALE_THRESHOLD_DAYS: 7,
};

describe('DQI and GMPS API - Integration Tests', () => {
  const logger = createLogger({
    LOG_LEVEL: "error",
    NODE_ENV: "test",
  });
  const app = createApp({ env: testEnv, logger });

  // ==================== 测试Fixture数据 ====================
  
  /** 标准DQI输入数据 */
  const VALID_DQI_INPUT = {
    userId: "test-user",
    currentNetProfit: 5000000,
    currentBeginningEquity: 50000000,
    currentEndingEquity: 55000000,
    currentRevenue: 100000000,
    currentOperatingCashFlow: 12000000,
    baselineNetProfit: 4000000,
    baselineBeginningEquity: 45000000,
    baselineEndingEquity: 49000000,
    baselineRevenue: 85000000,
    baselineOperatingCashFlow: 8000000,
  };

  /** 缺少必填字段的DQI输入 */
  const INCOMPLETE_DQI_INPUT = {
    userId: "test-user",
    currentNetProfit: 5000000,
    // 缺少其他必填字段
  };

  /** 标准GMPS输入数据 */
  const VALID_GMPS_INPUT = {
    userId: "test-user",
    currentGrossMargin: 18.5,
    currentRevenue: 100000000,
    currentCost: 81500000,
    currentSalesVolume: 1000000,
    currentProductionVolume: 1050000,
    currentInventory: 25000000,
    currentManufacturingExpense: 16000000,
    currentOperatingCost: 65000000,
    currentOperatingCashFlow: 8000000,
    currentTotalLiabilities: 45000000,
    currentTotalAssets: 80000000,

    // 企业财务数据（基期）
    baselineGrossMargin: 20.0,
    baselineRevenue: 90000000,
    baselineCost: 72000000,
    baselineSalesVolume: 950000,
    baselineProductionVolume: 1000000,
    baselineInventory: 20000000,
    baselineManufacturingExpense: 15000000,
    baselineOperatingCost: 60000000,
    baselineOperatingCashFlow: 9000000,
    baselineTotalLiabilities: 40000000,
    baselineTotalAssets: 75000000,

    // 行业外部数据
    currentLithiumPrice: 150000,
    baselineLithiumPrice: 120000,
    industryVolatility: 0.25,
  };

  /** 缺少行业数据的GMPS输入（但应该仍可计算） */
  const GMPS_WITHOUT_INDUSTRY_DATA = {
    ...VALID_GMPS_INPUT,
    // industryVolatility 是可选的，但如果缺失会使用默认值或报错
    // 这里我们测试缺少部分字段的情况
  };

  /** 毛利承压模型向后兼容性测试数据 */
  const GROSS_MARGIN_PRESSURE_INPUT = {
    userId: "test-user",
    currentGrossMargin: 18,
    baselineGrossMargin: 24,
    currentRevenue: 1350,
    baselineRevenue: 1200,
    currentCost: 1110,
    baselineCost: 900,
    currentSalesVolume: 98,
    baselineSalesVolume: 100,
    currentInventoryExpense: 88,
    baselineInventoryExpense: 72,
  };

  /** 经营质量模型向后兼容性测试数据 */
  const OPERATING_QUALITY_INPUT = {
    userId: "test-user",
    currentSalesVolume: 104,
    baselineSalesVolume: 96,
    currentProductionVolume: 106,
    baselineProductionVolume: 100,
    currentManufacturingExpense: 510,
    baselineManufacturingExpense: 520,
    currentOperatingCost: 760,
    baselineOperatingCost: 800,
    currentOperatingCashFlow: 160,
    baselineOperatingCashFlow: 120,
    currentRevenue: 1300,
    baselineRevenue: 1180,
    currentTotalLiabilities: 620,
    baselineTotalLiabilities: 650,
    currentTotalAssets: 1420,
    baselineTotalAssets: 1400,
  };

  // ==================== DQI API测试（3个）====================

  describe('DQI API Endpoints', () => {
    
    it('Test 1: POST /api/models/dqi/calculate - 有效请求返回200', async () => {
      const response = await request(app)
        .post('/api/models/dqi/calculate')
        .send(VALID_DQI_INPUT);

      // 验证HTTP状态码
      expect(response.status).toBe(200);
      
      // 验证响应结构
      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('data');
      
      const data = response.body.data;
      
      // 验证DQI结果结构完整性
      expect(data).toHaveProperty('dqi', expect.any(Number));
      expect(data).toHaveProperty('status', expect.any(String));
      expect(data).toHaveProperty('driver', expect.any(String));
      expect(data).toHaveProperty('decomposition');
      expect(data).toHaveProperty('metrics');
      expect(data).toHaveProperty('trend', expect.any(String));
      expect(data).toHaveProperty('confidence', expect.any(Number));
      
      // 验证数据有效性
      expect(data.dqi).toBeGreaterThan(0);
      expect(['改善', '稳定', '恶化']).toContain(data.status);
      expect(['盈利能力', '成长能力', '现金流质量']).toContain(data.driver);
      expect(data.confidence).toBeGreaterThan(0);
      expect(data.confidence).toBeLessThanOrEqual(1);
      
      // 验证decomposition包含三个维度
      expect(data.decomposition).toHaveProperty('profitabilityContribution');
      expect(data.decomposition).toHaveProperty('growthContribution');
      expect(data.decomposition).toHaveProperty('cashflowContribution');
    });

    it('Test 2: POST /api/models/dqi/calculate - 缺少必填字段返回400', async () => {
      const response = await request(app)
        .post('/api/models/dqi/calculate')
        .send(INCOMPLETE_DQI_INPUT);

      // 验证HTTP状态码为400（请求参数错误）
      expect(response.status).toBe(400);
      
      // 验证错误响应结构
      expect(response.body).toHaveProperty('ok', false);
      expect(response.body).toHaveProperty('error');
      expect(response.body.error).toHaveProperty('code', 'INVALID_REQUEST');
      expect(response.body.error).toHaveProperty('message');
      expect(response.body.error.message).toContain('校验失败');
      
      // 验证错误详情存在
      expect(response.body.error).toHaveProperty('details');
      expect(Array.isArray(response.body.error.details)).toBe(true);
      expect(response.body.error.details.length).toBeGreaterThan(0);
    });

    it('Test 3: POST /api/models/dqi/calculate - 返回数据格式验证', async () => {
      const response = await request(app)
        .post('/api/models/dqi/calculate')
        .send(VALID_DQI_INPUT);

      expect(response.status).toBe(200);
      const data = response.body.data;

      // 验证metrics对象包含所有必需字段
      expect(data.metrics).toMatchObject({
        currentROE: expect.any(Number),
        baselineROE: expect.any(Number),
        roeRatio: expect.any(Number),
        currentGrowth: expect.any(Number),
        baselineGrowth: expect.any(Number),
        growthRatio: expect.any(Number),
        currentOCFRatio: expect.any(Number),
        baselineOCFRatio: expect.any(Number),
        ocfRatioChange: expect.any(Number),
      });

      // 验证所有数值都是有限数
      const metricValues = Object.values(data.metrics) as number[];
      for (const value of metricValues) {
        expect(isFinite(value)).toBe(true);
      }

      // 验证trend是字符串且不为空
      expect(typeof data.trend).toBe('string');
      expect(data.trend.length).toBeGreaterThan(0);
      expect(data.trend).toContain('DQI指数');
    });
  });

  // ==================== GMPS API测试（3个）====================

  describe('GMPS API Endpoints', () => {
    
    it('Test 4: POST /api/models/gmps/calculate - 有效请求返回200', async () => {
      const response = await request(app)
        .post('/api/models/gmps/calculate')
        .send(VALID_GMPS_INPUT);

      // 验证HTTP状态码
      expect(response.status).toBe(200);
      
      // 验证响应结构
      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('data');
      
      const data = response.body.data;
      
      // 验证GMPS结果结构完整性
      expect(data).toHaveProperty('gmps', expect.any(Number));
      expect(data).toHaveProperty('level', expect.any(String));
      expect(data).toHaveProperty('probabilityNextQuarter', expect.any(Number));
      expect(data).toHaveProperty('riskLevel', expect.any(String));
      expect(data).toHaveProperty('dimensionScores');
      expect(data).toHaveProperty('featureScores');
      expect(data).toHaveProperty('normalizedMetrics');
      expect(data).toHaveProperty('keyFindings');
      expect(data).toHaveProperty('governance');
      
      // 验证数据有效性
      expect(data.gmps).toBeGreaterThanOrEqual(0);
      expect(data.gmps).toBeLessThanOrEqual(100);
      expect(['低压', '中压', '高压']).toContain(data.level);
      expect(data.probabilityNextQuarter).toBeGreaterThanOrEqual(0);
      expect(data.probabilityNextQuarter).toBeLessThanOrEqual(1);
      expect(['低风险', '中风险', '高风险']).toContain(data.riskLevel);
    });

    it('Test 5: POST /api/models/gmps/calculate - 包含完整行业数据时正常计算', async () => {
      const response = await request(app)
        .post('/api/models/gmps/calculate')
        .send(VALID_GMPS_INPUT);

      expect(response.status).toBe(200);
      const data = response.body.data;

      // 验证industryVolatility被正确处理
      expect(data.normalizedMetrics).toHaveProperty('indVol');
      expect(data.normalizedMetrics.indVol.rawValue).toBeCloseTo(0.25, 2);
      
      // 验证碳酸锂价格被正确计算
      expect(data.normalizedMetrics).toHaveProperty('liPriceYoy');
      expect(data.featureScores).toHaveProperty('liPriceYoy');
    });

    it('Test 6: POST /api/models/gmps/calculate - 返回包含所有必需字段', async () => {
      const response = await request(app)
        .post('/api/models/gmps/calculate')
        .send(VALID_GMPS_INPUT);

      expect(response.status).toBe(200);
      const data = response.body.data;

      // 验证dimensionScores包含五个维度
      expect(data.dimensionScores).toMatchObject({
        'A_毛利率结果': expect.any(Number),
        'B_材料成本冲击': expect.any(Number),
        'C_产销负荷': expect.any(Number),
        'D_外部风险': expect.any(Number),
        'E_现金流安全': expect.any(Number),
      });

      // 验证featureScores包含全部10个特征
      const expectedFeatures = [
        'gpmYoy', 'revCostGap', 'liPriceYoy', 'unitCostYoy', 'invYoy',
        'saleProdRatio', 'mfgCostRatio', 'indVol', 'cfoRatio', 'lev'
      ];
      
      for (const feature of expectedFeatures) {
        expect(data.featureScores).toHaveProperty(feature);
        expect(typeof data.featureScores[feature]).toBe('number');
      }
      
      expect(Object.keys(data.featureScores)).toHaveLength(10);

      // 验证normalizedMetrics包含所有特征的标准化的指标
      for (const feature of expectedFeatures) {
        expect(data.normalizedMetrics).toHaveProperty(feature);
        const metric = data.normalizedMetrics[feature];
        expect(metric).toHaveProperty('label');
        expect(metric).toHaveProperty('rawValue');
        expect(metric).toHaveProperty('normalizedScore');
      }

      // 验证keyFindings是非空数组
      expect(Array.isArray(data.keyFindings)).toBe(true);
      expect(data.keyFindings.length).toBeGreaterThan(0);

      // 验证governance信息完整
      expect(data.governance).toMatchObject({
        modelVersion: expect.any(String),
        parameterVersion: expect.any(String),
        reproducibilityKey: expect.any(String),
        confidenceScore: expect.any(Number),
        inputQuality: expect.any(String),
        normalizedAt: expect.any(String),
        auditTrail: expect.any(Array),
      });
    });
  });

  // ==================== 向后兼容性测试（2个）====================

  describe('Backward Compatibility Tests', () => {
    
    it('Test 7: GET/POST /api/models/gross-margin-pressure - 仍然可用', async () => {
      const response = await request(app)
        .post('/api/models/gross-margin-pressure')
        .send(GROSS_MARGIN_PRESSURE_INPUT);

      expect(response.status).toBe(200);
      
      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('data');
      const data = response.body.data;
      expect(data).toHaveProperty('modelId', 'grossMarginPressure');
      expect(data).toHaveProperty('modelName');
      expect(data).toHaveProperty('score', expect.any(Number));
      expect(data).toHaveProperty('riskLevel', expect.any(String));
      expect(data).toHaveProperty('trend');
      expect(data).toHaveProperty('normalizedMetrics');
      expect(data).toHaveProperty('keyFindings');
      expect(data).toHaveProperty('governance');

      // 验证趋势方向有效
      expect(['improving', 'stable', 'deteriorating']).toContain(data.trend.direction);
      
      expect(['low', 'medium', 'high']).toContain(data.riskLevel);
    });

    it('Test 8: GET/POST /api/models/operating-quality - 仍然可用', async () => {
      // 测试原有的经营质量分析接口仍然可以正常工作
      const response = await request(app)
        .post('/api/models/operating-quality')
        .send(OPERATING_QUALITY_INPUT);

      // 验证原有接口仍然可用
      expect(response.status).toBe(200);
      
      // 验证返回的是新格式的 {success: true, data: DiagnosticResult} 结构
      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('data');
      
      const data = response.body.data;
      expect(data).toHaveProperty('modelId', 'operatingQuality');
      expect(data).toHaveProperty('modelName');
      expect(data).toHaveProperty('score', expect.any(Number));
      expect(data).toHaveProperty('riskLevel', expect.any(String));
      expect(data).toHaveProperty('trend');
      expect(data).toHaveProperty('normalizedMetrics');
      expect(data).toHaveProperty('keyFindings');
      expect(data).toHaveProperty('governance');

      // 验证趋势方向有效
      expect(['improving', 'stable', 'deteriorating']).toContain(data.trend.direction);
      
      // 风险等级有效
      expect(['low', 'medium', 'high']).toContain(data.riskLevel);
      
      // 经营质量特有的指标验证
      expect(data.normalizedMetrics).toHaveProperty('capacityUtilization');
      expect(data.normalizedMetrics).toHaveProperty('cashConversion');
      expect(data.normalizedMetrics).toHaveProperty('leverageRatio');
    });
  });

  // ==================== API错误处理和边界情况测试 ====================

  describe('API Error Handling and Edge Cases', () => {
    
    it('should return 404 for non-existent endpoints', async () => {
      const response = await request(app)
        .get('/api/models/non-existent-endpoint');

      expect(response.status).toBe(404);
      expect(response.body).toHaveProperty('ok', false);
      expect(response.body.error).toHaveProperty('code', 'NOT_FOUND');
    });

    it('should handle invalid JSON payload gracefully', async () => {
      const response = await request(app)
        .post('/api/models/dqi/calculate')
        .set('Content-Type', 'application/json')
        .send('invalid json');

      expect(response.status).toBeGreaterThanOrEqual(400); // Bad Request 或解析错误（Express可能返回500）
    });

    it('should return 400 for GMPS input with invalid field types', async () => {
      const invalidInput = {
        ...VALID_GMPS_INPUT,
        currentGrossMargin: 'not a number', // 错误的类型
      };

      const response = await request(app)
        .post('/api/models/gmps/calculate')
        .send(invalidInput);

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('ok', false);
      expect(response.body.error).toHaveProperty('code', 'INVALID_REQUEST');
    });

    it('should correctly handle DQI calculation with extreme values via API', async () => {
      const extremeDQIInput = {
        userId: "test-user",
        currentNetProfit: 500000000,          // 5亿净利润
        currentBeginningEquity: 5000000000,   // 50亿净资产
        currentEndingEquity: 5500000000,
        currentRevenue: 10000000000,          // 100亿营收
        currentOperatingCashFlow: 1200000000,
        baselineNetProfit: 400000000,
        baselineBeginningEquity: 4500000000,
        baselineEndingEquity: 4900000000,
        baselineRevenue: 8500000000,
        baselineOperatingCashFlow: 800000000,
      };

      const response = await request(app)
        .post('/api/models/dqi/calculate')
        .send(extremeDQIInput);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.dqi).toBeGreaterThan(0);
      expect(isFinite(response.body.data.dqi)).toBe(true);
    });

    it('should correctly handle GMPS calculation with high pressure scenario via API', async () => {
      const highPressureInput = {
        ...VALID_GMPS_INPUT,
        currentGrossMargin: 14.0,       // 毛利率大幅下降
        baselineGrossMargin: 22.0,
        currentLithiumPrice: 200000,   // 碳酸锂价格大幅上涨
        baselineLithiumPrice: 120000,
        currentInventory: 35000000,    // 库存积压严重
        baselineInventory: 20000000,
        currentOperatingCashFlow: -5000000, // 负现金流
        industryVolatility: 0.40,      // 高波动率
      };

      const response = await request(app)
        .post('/api/models/gmps/calculate')
        .send(highPressureInput);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      
      // 高压场景应该得到较高分数
      expect(response.body.data.gmps).toBeGreaterThanOrEqual(50);
      expect(['中压', '高压']).toContain(response.body.data.level);
    });
  });
});
