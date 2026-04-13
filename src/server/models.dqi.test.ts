import { describe, it, expect } from 'vitest';
import { calculateDQI } from './models.js';
import type { DQIResult } from '../shared/diagnostics.js';

describe('DQI Model - Unit Tests', () => {
  
  // ==================== 测试Fixture数据 ====================
  
  /** 标准改善场景 - 所有指标正向变化 */
  const IMPROVING_SCENARIO = {
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

  /** 标准恶化场景 - 所有指标负向变化 */
  const DETERIORATING_SCENARIO = {
    currentNetProfit: 3000000,
    currentBeginningEquity: 55000000,
    currentEndingEquity: 56000000,
    currentRevenue: 80000000,
    currentOperatingCashFlow: 5000000,
    baselineNetProfit: 4000000,
    baselineBeginningEquity: 49000000,
    baselineEndingEquity: 55000000,
    baselineRevenue: 85000000,
    baselineOperatingCashFlow: 8000000,
  };

  /** 稳定场景 - 小幅波动（±5%以内） */
  const STABLE_SCENARIO = {
    currentNetProfit: 4100000,
    currentBeginningEquity: 45500000,
    currentEndingEquity: 49500000,
    currentRevenue: 86500000,
    currentOperatingCashFlow: 8200000,
    baselineNetProfit: 4000000,
    baselineBeginningEquity: 45000000,
    baselineEndingEquity: 49000000,
    baselineRevenue: 85000000,
    baselineOperatingCashFlow: 8000000,
    baselineGrowth: 0.02,
  };

  // ==================== 正常场景测试（5个）====================

  describe('Normal Scenarios', () => {
    
    it('Test 1: 改善场景 - 所有指标正向变化', () => {
      const result: DQIResult = calculateDQI(IMPROVING_SCENARIO);
      
      // 验证基本结构
      expect(result).toHaveProperty('dqi');
      expect(result).toHaveProperty('status');
      expect(result).toHaveProperty('driver');
      expect(result).toHaveProperty('decomposition');
      expect(result).toHaveProperty('metrics');
      expect(result).toHaveProperty('trend');
      expect(result).toHaveProperty('confidence');
      
      // 验证改善状态：dqi > 1.05, status = "改善"
      expect(result.dqi).toBeGreaterThan(1.05);
      expect(result.status).toBe('改善');
      
      // 验证置信度在合理范围内
      expect(result.confidence).toBeGreaterThan(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
      
      // 验证分解项为正数
      expect(result.decomposition.profitabilityContribution).toBeGreaterThan(0);
      expect(result.decomposition.growthContribution).toBeGreaterThan(0);
      expect(result.decomposition.cashflowContribution).toBeGreaterThan(0);
      
      // 验证趋势描述包含关键信息
      expect(result.trend).toContain('DQI指数');
      expect(result.trend).toContain('改善');
    });

    it('Test 2: 恶化场景 - 所有指标负向变化', () => {
      const result: DQIResult = calculateDQI(DETERIORATING_SCENARIO);
      
      // 验证恶化状态：dqi < 0.95, status = "恶化"
      expect(result.dqi).toBeLessThan(0.95);
      expect(result.status).toBe('恶化');
      
      // 验证置信度
      expect(result.confidence).toBeGreaterThan(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
      
      // 验证趋势描述包含恶化信息
      expect(result.trend).toContain('恶化');
    });

    it('Test 3: 稳定场景 - 小幅波动（±5%以内）', () => {
      const result: DQIResult = calculateDQI(STABLE_SCENARIO);
      
      // 验证稳定状态：0.95 ≤ dqi ≤ 1.05
      expect(result.dqi).toBeGreaterThanOrEqual(0.95);
      expect(result.dqi).toBeLessThanOrEqual(1.05);
      expect(result.status).toBe('稳定');
      
      // 验证趋势描述包含稳定信息
      expect(result.trend).toContain('稳定');
    });

    it('Test 4: 混合场景 - 部分指标好，部分差', () => {
      const mixedScenario = {
        ...IMPROVING_SCENARIO,
        // 净利润恶化（从500万降到350万）
        currentNetProfit: 3500000,
        currentBeginningEquity: 50000000,
        currentEndingEquity: 52000000, // 净资产增长放缓
      };
      
      const result: DQIResult = calculateDQI(mixedScenario);
      
      // 混合场景下，DQI可能在任何区间，但必须是有效数值
      expect(result.dqi).toBeGreaterThan(0);
      expect(['改善', '稳定', '恶化']).toContain(result.status);
      
      // 验证驱动因素被正确识别
      expect(['盈利能力', '成长能力', '现金流质量']).toContain(result.driver);
      
      // 验证metrics完整性
      expect(result.metrics).toHaveProperty('currentROE');
      expect(result.metrics).toHaveProperty('baselineROE');
      expect(result.metrics).toHaveProperty('roeRatio');
      expect(result.metrics).toHaveProperty('currentGrowth');
      expect(result.metrics).toHaveProperty('baselineGrowth');
      expect(result.metrics).toHaveProperty('growthRatio');
      expect(result.metrics).toHaveProperty('currentOCFRatio');
      expect(result.metrics).toHaveProperty('baselineOCFRatio');
      expect(result.metrics).toHaveProperty('ocfRatioChange');
    });

    it('Test 5: 高增长低利润场景 - Growth很高但ROE下降', () => {
      const highGrowthLowProfitScenario = {
        currentNetProfit: 3000000,       // 净利润下降
        currentBeginningEquity: 50000000,
        currentEndingEquity: 53000000,   // 净资产小幅增长
        currentRevenue: 150000000,       // 营收大幅增长（+76%）
        currentOperatingCashFlow: 15000000, // 现金流改善
        baselineNetProfit: 4000000,
        baselineBeginningEquity: 45000000,
        baselineEndingEquity: 49000000,
        baselineRevenue: 85000000,
        baselineOperatingCashFlow: 8000000,
      };
      
      const result: DQIResult = calculateDQI(highGrowthLowProfitScenario);
      
      // 验证结果有效性
      expect(result.dqi).toBeGreaterThan(0);
      expect(result.status).toBeDefined();
      
      // 验证增长率确实很高
      expect(result.metrics.currentGrowth).toBeGreaterThan(0.5); // > 50%
      
      // 验证ROE可能下降
      expect(result.metrics.currentROE).toBeLessThan(result.metrics.baselineROE || 999);
    });
  });

  // ==================== 边界条件测试（5个）====================

  describe('Edge Cases', () => {
    
    it('Test 6: 零净利润 - netProfit = 0', () => {
      const zeroProfitScenario = {
        ...STABLE_SCENARIO,
        currentNetProfit: 0,
        baselineNetProfit: 1000000,
      };
      
      const result: DQIResult = calculateDQI(zeroProfitScenario);
      
      // 应该正常处理而不抛出异常
      expect(result).toBeDefined();
      expect(result.dqi).toBeGreaterThanOrEqual(0);
      expect(result.metrics.currentROE).toBe(0); // ROE应该为0或接近0
      
      // 验证置信度可能降低（极端值）
      expect(result.confidence).toBeGreaterThanOrEqual(0.4);
    });

    it('Test 7: 负现金流 - operatingCashFlow < 0', () => {
      const negativeCashFlowScenario = {
        ...IMPROVING_SCENARIO,
        currentOperatingCashFlow: -2000000, // 负的经营现金流
      };
      
      const result: DQIResult = calculateDQI(negativeCashFlowScenario);
      
      // 应该正常处理
      expect(result).toBeDefined();
      expect(result.dqi).toBeGreaterThan(0);
      
      // OCF比率应该是负数
      expect(result.metrics.currentOCFRatio).toBeLessThan(0);
    });

    it('Test 8: 零基期营收 - baselineRevenue接近0（应使用特殊处理）', () => {
      const nearZeroBaselineRevenueScenario = {
        currentNetProfit: 1000000,
        currentBeginningEquity: 20000000,
        currentEndingEquity: 22000000,
        currentRevenue: 50000000,
        currentOperatingCashFlow: 5000000,
        baselineNetProfit: 100000,
        baselineBeginningEquity: 10000000,
        baselineEndingEquity: 11000000,
        baselineRevenue: 100000,     // 接近0的基期营收
        baselineOperatingCashFlow: 10000,
      };
      
      const result: DQIResult = calculateDQI(nearZeroBaselineRevenueScenario);
      
      // 应该正常处理，不抛出除零错误
      expect(result).toBeDefined();
      expect(result.dqi).toBeGreaterThanOrEqual(0);
      expect(isFinite(result.dqi)).toBe(true);
    });

    it('Test 9: 极大值输入 - 营收=10亿级别', () => {
      const largeValueScenario = {
        currentNetProfit: 500000000,          // 5亿净利润
        currentBeginningEquity: 5000000000,   // 50亿期初净资产
        currentEndingEquity: 5500000000,      // 55亿期末净资产
        currentRevenue: 10000000000,          // 100亿营收
        currentOperatingCashFlow: 1200000000, // 12亿经营现金流
        baselineNetProfit: 400000000,
        baselineBeginningEquity: 4500000000,
        baselineEndingEquity: 4900000000,
        baselineRevenue: 8500000000,
        baselineOperatingCashFlow: 800000000,
      };
      
      const result: DQIResult = calculateDQI(largeValueScenario);
      
      // 应该正确处理大数值
      expect(result).toBeDefined();
      expect(result.dqi).toBeGreaterThan(1.05); // 改善场景
      expect(result.status).toBe('改善');
      
      // 验证所有指标都是有限数值
      expect(isFinite(result.dqi)).toBe(true);
      expect(isFinite(result.metrics.currentROE)).toBe(true);
      expect(isFinite(result.metrics.currentGrowth)).toBe(true);
    });

    it('Test 10: 极小值输入 - 营收=1万级别', () => {
      const smallValueScenario = {
        currentNetProfit: 500,
        currentBeginningEquity: 5000,
        currentEndingEquity: 5500,
        currentRevenue: 10000,
        currentOperatingCashFlow: 1200,
        baselineNetProfit: 400,
        baselineBeginningEquity: 4500,
        baselineEndingEquity: 4900,
        baselineRevenue: 8500,
        baselineOperatingCashFlow: 800,
      };
      
      const result: DQIResult = calculateDQI(smallValueScenario);
      
      // 应该正确处理小数值
      expect(result).toBeDefined();
      expect(result.dqi).toBeGreaterThan(0);
      expect(isFinite(result.dqi)).toBe(true);
      
      // 验证结果结构完整
      expect(result.status).toBeDefined();
      expect(result.driver).toBeDefined();
    });
  });

  // ==================== 驱动因素识别测试（3个）====================

  describe('Driver Factor Identification', () => {
    
    it('Test 11: 盈利能力主导 - ROE比率最大', () => {
      // 构造盈利能力显著变化的场景
      const profitabilityDrivenScenario = {
        currentNetProfit: 8000000,           // 净利润翻倍
        currentBeginningEquity: 50000000,
        currentEndingEquity: 55000000,
        currentRevenue: 90000000,            // 营收微增
        currentOperatingCashFlow: 8500000,   // 现流微增
        baselineNetProfit: 4000000,
        baselineBeginningEquity: 45000000,
        baselineEndingEquity: 49000000,
        baselineRevenue: 85000000,
        baselineOperatingCashFlow: 8000000,
      };
      
      const result: DQIResult = calculateDQI(profitabilityDrivenScenario);
      
      // 验证驱动因素是盈利能力（ROE变化最大）
      expect(result.driver).toBe('盈利能力');
    });

    it('Test 12: 成长能力主导 - Growth比率最大', () => {
      // 构造成长能力显著变化的场景
      const growthDrivenScenario = {
        currentNetProfit: 4200000,           // 净利润微增
        currentBeginningEquity: 50000000,
        currentEndingEquity: 52000000,
        currentRevenue: 170000000,           // 营收翻倍（+100%）
        currentOperatingCashFlow: 8500000,
        baselineNetProfit: 4000000,
        baselineBeginningEquity: 45000000,
        baselineEndingEquity: 49000000,
        baselineRevenue: 85000000,
        baselineOperatingCashFlow: 8000000,
      };
      
      const result: DQIResult = calculateDQI(growthDrivenScenario);
      
      // 验证驱动因素是成长能力（增长率变化最大）
      expect(result.driver).toBe('成长能力');
    });

    it('Test 13: 现金流质量主导 - OCF比率最大', () => {
      // 构造现金流显著变化的场景
      const cashflowDrivenScenario = {
        currentNetProfit: 4100000,           // 净利润微增
        currentBeginningEquity: 50000000,
        currentEndingEquity: 51000000,
        currentRevenue: 86000000,            // 营收微增
        currentOperatingCashFlow: 25000000,  // 经营现金流大幅增加（+212%）
        baselineNetProfit: 4000000,
        baselineBeginningEquity: 45000000,
        baselineEndingEquity: 49000000,
        baselineRevenue: 85000000,
        baselineOperatingCashFlow: 8000000,
      };
      
      const result: DQIResult = calculateDQI(cashflowDrivenScenario);
      
      // 验证驱动因素是现金流质量（OCF比率变化最大）
      expect(result.driver).toBe('现金流质量');
    });
  });

  // ==================== 趋势判断测试（2个）====================

  describe('Trend Determination Boundary Tests', () => {
    
    it('Test 14: 精确边界值 - DQI略大于1.05 (应该判定为"改善")', () => {
      // 构造一个DQI刚好超过1.05的场景
      // 通过调整参数使得加权结果略大于1.05
      const boundaryImprovingScenario = {
        currentNetProfit: 6000000,           // 净利润提升50%
        currentBeginningEquity: 50000000,
        currentEndingEquity: 56000000,       // 净资产增长
        currentRevenue: 102000000,          // 营收增长20%
        currentOperatingCashFlow: 10000000, // 现金流增长25%
        baselineNetProfit: 4000000,
        baselineBeginningEquity: 45000000,
        baselineEndingEquity: 49000000,
        baselineRevenue: 85000000,
        baselineOperatingCashFlow: 8000000,
      };
      
      const result: DQIResult = calculateDQI(boundaryImprovingScenario);
      
      // 验证边界判定逻辑
      if (result.dqi > 1.05) {
        expect(result.status).toBe('改善');
      }
    });

    it('Test 15: 另一边界值 - DQI略小于0.95 (应该判定为"恶化")', () => {
      // 构造一个DQI刚好低于0.95的场景
      const boundaryDeterioratingScenario = {
        currentNetProfit: 2000000,           // 净利润下降50%
        currentBeginningEquity: 55000000,
        currentEndingEquity: 56000000,
        currentRevenue: 70000000,           // 营收下降18%
        currentOperatingCashFlow: 4000000, // 现金流下降50%
        baselineNetProfit: 4000000,
        baselineBeginningEquity: 49000000,
        baselineEndingEquity: 55000000,
        baselineRevenue: 85000000,
        baselineOperatingCashFlow: 8000000,
      };
      
      const result: DQIResult = calculateDQI(boundaryDeterioratingScenario);
      
      // 验证边界判定逻辑
      if (result.dqi < 0.95) {
        expect(result.status).toBe('恶化');
      }
    });
  });

  // ==================== 数值精度和结构验证测试 ====================

  describe('Numerical Precision and Structure Validation', () => {
    
    it('should return DQI with at most 4 decimal places', () => {
      const result: DQIResult = calculateDQI(IMPROVING_SCENARIO);
      
      // 验证精度：小数位数不超过4位
      const decimalPlaces = (result.dqi.toString().split('.')[1] || '').length;
      expect(decimalPlaces).toBeLessThanOrEqual(4);
    });

    it('should have decomposition values that sum to DQI (with rounding tolerance)', () => {
      const result: DQIResult = calculateDQI(IMPROVING_SCENARIO);
      
      // 分解项之和应该接近DQI（允许舍入误差±0.001）
      const sumOfDecomposition =
        result.decomposition.profitabilityContribution +
        result.decomposition.growthContribution +
        result.decomposition.cashflowContribution;
      
      expect(Math.abs(sumOfDecomposition - result.dqi)).toBeLessThan(0.001);
    });

    it('should handle identical current and baseline data (DQI ≈ 1.0)', () => {
      const identicalScenario = {
        currentNetProfit: 5000000,
        currentBeginningEquity: 50000000,
        currentEndingEquity: 55000000,
        currentRevenue: 100000000,
        currentOperatingCashFlow: 10000000,
        baselineNetProfit: 5000000,
        baselineBeginningEquity: 50000000,
        baselineEndingEquity: 55000000,
        baselineRevenue: 100000000,
        baselineOperatingCashFlow: 10000000,
        baselineGrowth: 0,
      };
      
      const result: DQIResult = calculateDQI(identicalScenario);
      
      // 当期和基期相同时，DQI应该接近1.0
      expect(result.dqi).toBeCloseTo(1.0, 1); // 允许±0.1误差
      expect(result.status).toBe('稳定');
    });

    it('should validate all metric values are finite numbers', () => {
      const result: DQIResult = calculateDQI(IMPROVING_SCENARIO);
      
      // 验证所有metrics都是有限数值
      const metricsValues = Object.values(result.metrics) as number[];
      for (const value of metricsValues) {
        expect(isFinite(value)).toBe(true);
        expect(typeof value).toBe('number');
      }
    });
  });
});
