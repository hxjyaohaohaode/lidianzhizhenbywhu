/**
 * DQI 模型测试脚本
 * 验证 DQI（经营质量动态评价）数学模型的正确性
 */

import { calculateDQI } from "./src/server/models.js";
import type { DQIResult } from "./src/shared/diagnostics.js";

console.log("========================================");
console.log("  DQI 经营质量动态评价模型 测试");
console.log("========================================\n");

// 测试用例1：改善场景
const testCase1 = {
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

console.log("【测试用例1】改善场景 - 各项指标均提升");
console.log("- 当期净利润: 500万");
console.log("- 基期净利润: 400万");
console.log("- 当期营收: 1亿");
console.log("- 基期营收: 8500万");
console.log("- 当期经营现金流: 1200万");
console.log("- 基期经营现金流: 800万\n");

const result1 = calculateDQI(testCase1);
printDQIResult(result1);

// 测试用例2：恶化场景
const testCase2 = {
  currentNetProfit: 3000000,
  currentBeginningEquity: 50000000,
  currentEndingEquity: 53000000,
  currentRevenue: 90000000,
  currentOperatingCashFlow: 5000000,

  baselineNetProfit: 4500000,
  baselineBeginningEquity: 48000000,
  baselineEndingEquity: 52500000,
  baselineRevenue: 95000000,
  baselineOperatingCashFlow: 10000000,
};

console.log("\n\n【测试用例2】恶化场景 - 各项指标均下降");
console.log("- 当期净利润: 300万");
console.log("- 基期净利润: 450万");
console.log("- 当期营收: 9000万");
console.log("- 基期营收: 9500万");
console.log("- 当期经营现金流: 500万");
console.log("- 基期经营现金流: 1000万\n");

const result2 = calculateDQI(testCase2);
printDQIResult(result2);

// 测试用例3：稳定场景
const testCase3 = {
  currentNetProfit: 4200000,
  currentBeginningEquity: 50000000,
  currentEndingEquity: 54200000,
  currentRevenue: 88000000,
  currentOperatingCashFlow: 8500000,

  baselineNetProfit: 4100000,
  baselineBeginningEquity: 49000000,
  baselineEndingEquity: 53100000,
  baselineRevenue: 86000000,
  baselineOperatingCashFlow: 8300000,
};

console.log("\n\n【测试用例3】稳定场景 - 指标小幅波动");
console.log("- 当期净利润: 420万");
console.log("- 基期净利润: 410万");
console.log("- 当期营收: 8800万");
console.log("- 基期营收: 8600万");
console.log("- 当期经营现金流: 850万");
console.log("- 基期经营现金流: 830万\n");

const result3 = calculateDQI(testCase3);
printDQIResult(result3);

// 测试用例4：边界条件 - 极端值
const testCase4 = {
  currentNetProfit: -1000000, // 亏损
  currentBeginningEquity: 60000000,
  currentEndingEquity: 59000000,
  currentRevenue: 70000000,
  currentOperatingCashFlow: -2000000, // 负现金流

  baselineNetProfit: 2000000,
  baselineBeginningEquity: 58000000,
  baselineEndingEquity: 60000000,
  baselineRevenue: 80000000,
  baselineOperatingCashFlow: 5000000,
};

console.log("\n\n【测试用例4】边界条件 - 负利润和负现金流");
console.log("- 当期净利润: -100万（亏损）");
console.log("- 基期净利润: 200万");
console.log("- 当期营收: 7000万");
console.log("- 基期营收: 8000万");
console.log("- 当期经营现金流: -200万（负）");
console.log("- 基期经营现金流: 500万\n");

const result4 = calculateDQI(testCase4);
printDQIResult(result4);

// 辅助函数：打印DQI结果
function printDQIResult(result: DQIResult) {
  console.log("========== DQI 计算结果 ==========");
  console.log(`DQI 综合指数: ${result.dqi}`);
  console.log(`状态判断: ${result.status}`);
  console.log(`驱动因素: ${result.driver}`);
  console.log(`置信度: ${result.confidence}\n`);

  console.log("---------- 分解贡献 ----------");
  console.log(`盈利能力贡献 (w1×ROE比率): ${result.decomposition.profitabilityContribution}`);
  console.log(`成长能力贡献 (w2×Growth比率): ${result.decomposition.growthContribution}`);
  console.log(`现金流质量贡献 (w3×OCF比率): ${result.decomposition.cashflowContribution}\n`);

  console.log("---------- 详细指标 ----------");
  console.log(`当期ROE: ${result.metrics.currentROE}%`);
  console.log(`基期ROE: ${result.metrics.baselineROE}%`);
  console.log(`ROE比率 (当期/基期): ${result.metrics.roeRatio}`);
  console.log(`当期增长率: ${(result.metrics.currentGrowth * 100).toFixed(2)}%`);
  console.log(`基期增长率: ${(result.metrics.baselineGrowth * 100).toFixed(2)}%`);
  console.log(`增长比率: ${result.metrics.growthRatio}`);
  console.log(`当期OCF比率: ${result.metrics.currentOCFRatio}`);
  console.log(`基期OCF比率: ${result.metrics.baselineOCFRatio}`);
  console.log(`OCF比率变化: ${result.metrics.ocfRatioChange}\n`);

  console.log("---------- 趋势描述 ----------");
  console.log(`${result.trend}`);
  console.log("========================================\n");

  // 验证结果合理性
  validateDQIResult(result);
}

function validateDQIResult(result: DQIResult) {
  const checks = [
    { condition: result.dqi >= 0 && result.dqi <= 3, message: "DQI指数在[0,3]范围内" },
    { condition: ["改善", "稳定", "恶化"].includes(result.status), message: "状态为有效值" },
    { condition: ["盈利能力", "成长能力", "现金流质量", "无明显驱动"].includes(result.driver), message: "驱动因素为有效值" },
    { condition: result.confidence >= 0.4 && result.confidence <= 1.0, message: "置信度在[0.4,1.0]范围内" },
    {
      condition:
        result.decomposition.profitabilityContribution +
          result.decomposition.growthContribution +
          result.decomposition.cashflowContribution ===
        result.dqi,
      message: "分解贡献之和等于DQI",
    },
    {
      condition: result.status === "改善" ? result.dqi > 1.05 : result.status === "稳定" ? result.dqi >= 0.95 && result.dqi <= 1.05 : result.dqi < 0.95,
      message: "状态与DQI阈值匹配",
    },
  ];

  console.log("---------- 结果验证 ----------");
  checks.forEach((check, index) => {
    const status = check.condition ? "✓ 通过" : "✗ 失败";
    console.log(`${index + 1}. ${status}: ${check.message}`);
  });

  const allPassed = checks.every((check) => check.condition);
  console.log(allPassed ? "\n✓ 所有验证通过！" : "\n✗ 存在验证失败项！");
}
