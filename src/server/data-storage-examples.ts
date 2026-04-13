/**
 * DQI/GMPS 数据存储机制 - 使用示例
 *
 * 本文件展示如何使用扩展后的 PlatformStore 来管理企业财务数据、
 * 行业外部数据以及 DQI/GMPS 计算结果的完整生命周期。
 */

import { PlatformStore } from "./platform-store.js";
import { calculateDQI, calculateGMPS } from "./models.js";
import type {
  EnterpriseFinancialData,
  IndustryExternalData,
} from "./platform-store.js";

// ==================== 初始化存储实例 ====================

const store = new PlatformStore("./data");

// ================================================================
// 示例1：存储企业财务数据
// ================================================================

async function example1_SaveFinancialData() {
  console.log("=== 示例1: 存储企业财务数据 ===\n");

  // 场景：宁德时代2026年Q1财务数据
  const catlData = await store.saveFinancialData({
    enterpriseId: "CATL_300750",
    periodDate: "2026-Q1",

    // 利润表数据（单位：万元）
    revenue: 987650, // 营业收入 98.77亿
    operatingCost: 756430, // 营业成本
    grossProfit: 231220, // 毛利润
    grossMargin: 23.42, // 毛利率 23.42%
    netProfit: 98760, // 净利润

    // 资产负债表数据
    totalAssets: 5678900,
    totalLiabilities: 2890450,
    beginningEquity: 2654320,
    endingEquity: 2788450,
    inventory: 1234567,

    // 现金流量表
    operatingCashFlow: 156789,

    // 经营数据
    salesVolume: 85.5, // GWh
    productionVolume: 92.3, // GWh
    manufacturingExpense: 45678,

    // 元数据
    dataSource: "manual", // 手动录入
  });

  console.log("✅ 财务数据保存成功:");
  console.log(`   企业ID: ${catlData.enterpriseId}`);
  console.log(`   报告期: ${catlData.periodDate}`);
  console.log(`   营收: ${catlData.revenue.toLocaleString()} 万元`);
  console.log(`   毛利率: ${catlData.grossMargin}%`);
  console.log(`   创建时间: ${catlData.createdAt}\n`);

  return catlData;
}

// ================================================================
// 示例2：存储行业外部数据
// ================================================================

async function example2_SaveIndustryData() {
  console.log("=== 示例2: 存储行业外部数据 ===\n");

  // 场景：2026年3月碳酸锂价格和创业板指数
  const industryData = await store.saveIndustryData({
    recordId: `industry_${Date.now()}`,
    dataDate: "2026-03-31",

    lithiumPrice: {
      priceDate: "2026-03-31",
      price: 115000, // 11.5万元/吨
      source: "上海有色网(SMM)",
    },

    industryIndex: {
      indexDate: "2026-03-31",
      indexType: "GEM",
      indexValue: 2350.67,
      volatility: 0.18, // 波动率18%
    },
  });

  console.log("✅ 行业数据保存成功:");
  console.log(`   记录ID: ${industryData.recordId}`);
  console.log(`   数据日期: ${industryData.dataDate}`);
  console.log(`   碳酸锂价格: ${(industryData.lithiumPrice.price / 10000).toFixed(2)} 万元/吨`);
  console.log(
    `   创业板指数: ${industryData.industryIndex?.indexValue?.toFixed(2)} (波动率: ${(industryData.industryIndex!.volatility * 100).toFixed(2)}%)\n`,
  );

  return industryData;
}

// ================================================================
// 示例3：计算并存储DQI结果
// ================================================================

async function example3_CalculateAndSaveDQI() {
  console.log("=== 示例3: 计算并存储DQI结果 ===\n");

  // 步骤1：获取当期和基期财务数据
  const currentData = store.getFinancialData("CATL_300750", "2026-Q1");
  const baselineData = store.getFinancialData("CATL_300750", "2025-Q1"); // 假设已有基期数据

  if (!currentData || !baselineData) {
    console.log("❌ 缺少财务数据，无法计算DQI");
    return null;
  }

  // 步骤2：调用DQI模型进行计算
  const dqiResult = calculateDQI({
    // 当期数据
    currentNetProfit: currentData.netProfit,
    currentBeginningEquity: currentData.beginningEquity,
    currentEndingEquity: currentData.endingEquity,
    currentRevenue: currentData.revenue,
    currentOperatingCashFlow: currentData.operatingCashFlow,

    // 基期数据
    baselineNetProfit: baselineData.netProfit,
    baselineBeginningEquity: baselineData.beginningEquity,
    baselineEndingEquity: baselineData.endingEquity,
    baselineRevenue: baselineData.revenue,
    baselineOperatingCashFlow: baselineData.operatingCashFlow,
  });

  console.log("📊 DQI计算完成:");
  console.log(`   DQI指数: ${dqiResult.dqi.toFixed(2)}`);
  console.log(`   状态: ${dqiResult.status}`);
  console.log(`   驱动因素: ${dqiResult.driver}`);
  console.log(`   置信度: ${(dqiResult.confidence * 100).toFixed(2)}%`);

  // 步骤3：保存计算结果到持久化存储
  const savedResult = await store.saveDQIResult({
    enterpriseId: "CATL_300750",
    periodDate: "2026-Q1",
    dqi: dqiResult.dqi,
    status: dqiResult.status,
    driver: dqiResult.driver,
    decomposition: dqiResult.decomposition,
    metrics: dqiResult.metrics,
    trend: dqiResult.trend,
    confidence: dqiResult.confidence,
  });

  console.log(`\n✅ DQI结果已持久化 (ID: ${savedResult.resultId})\n`);

  return savedResult;
}

// ================================================================
// 示例4：计算并存储GMPS结果
// ================================================================

async function example4_CalculateAndSaveGMPS() {
  console.log("=== 示例4: 计算并存储GMPS结果 ===\n");

  // 步骤1：获取财务数据和行业数据
  const currentData = store.getFinancialData("CATL_300750", "2026-Q1");
  const baselineData = store.getFinancialData("CATL_300750", "2025-Q1");
  const latestIndustry = store.getLatestIndustryData();

  if (!currentData || !baselineData || !latestIndustry) {
    console.log("❌ 缺少必要数据，无法计算GMPS");
    return null;
  }

  // 步骤2：调用GMPS模型进行计算
  const gmpsResult = calculateGMPS({
    // 当期财务数据
    currentGrossMargin: currentData.grossMargin,
    currentRevenue: currentData.revenue,
    currentCost: currentData.operatingCost,
    currentSalesVolume: currentData.salesVolume,
    currentProductionVolume: currentData.productionVolume,
    currentInventory: currentData.inventory,
    currentManufacturingExpense: currentData.manufacturingExpense,
    currentOperatingCost: currentData.operatingCost,
    currentOperatingCashFlow: currentData.operatingCashFlow,
    currentTotalLiabilities: currentData.totalLiabilities,
    currentTotalAssets: currentData.totalAssets,

    // 基期财务数据
    baselineGrossMargin: baselineData.grossMargin,
    baselineRevenue: baselineData.revenue,
    baselineCost: baselineData.operatingCost,
    baselineSalesVolume: baselineData.salesVolume,
    baselineProductionVolume: baselineData.productionVolume,
    baselineInventory: baselineData.inventory,
    baselineManufacturingExpense: baselineData.manufacturingExpense,
    baselineOperatingCost: baselineData.operatingCost,
    baselineOperatingCashFlow: baselineData.operatingCashFlow,
    baselineTotalLiabilities: baselineData.totalLiabilities,
    baselineTotalAssets: baselineData.totalAssets,

    // 行业外部数据
    currentLithiumPrice: latestIndustry.lithiumPrice.price / 10000, // 转换为万元/吨
    baselineLithiumPrice: 98000 / 10000, // 假设基期价格为9.8万/吨
    industryVolatility: latestIndustry.industryIndex?.volatility ?? 0.18,
  });

  console.log("📊 GMPS计算完成:");
  console.log(`   GMPS得分: ${gmpsResult.gmps}`);
  console.log(`   压力等级: ${gmpsResult.level}`);
  console.log(`   下季度风险概率: ${(gmpsResult.probabilityNextQuarter * 100).toFixed(2)}%`);
  console.log(`   风险等级: ${gmpsResult.riskLevel}`);

  // 步骤3：保存计算结果
  const savedResult = await store.saveGMPSResult({
    enterpriseId: "CATL_300750",
    periodDate: "2026-Q1",
    gmps: gmpsResult.gmps,
    level: gmpsResult.level,
    probabilityNextQuarter: gmpsResult.probabilityNextQuarter,
    riskLevel: gmpsResult.riskLevel,
    dimensionScores: gmpsResult.dimensionScores,
    featureScores: gmpsResult.featureScores,
  });

  console.log(`\n✅ GMPS结果已持久化 (ID: ${savedResult.resultId})\n`);

  return savedResult;
}

// ================================================================
// 示例5：查询历史记录与趋势分析
// ================================================================

function example5_QueryHistoryAndTrends() {
  console.log("=== 示例5: 查询历史记录与趋势分析 ===\n");

  // 5.1 查询企业的所有历史财务数据
  console.log("📈 宁德时代历史财务数据:");
  const financialHistory = store.listFinancialHistory("CATL_300750");
  financialHistory.slice(0, 4).forEach((record) => {
    console.log(
      `   ${record.periodDate}: 营收${(record.revenue / 10000).toFixed(2)}亿 | 毛利率${record.grossMargin}% | 净利润${(record.netProfit / 10000).toFixed(2)}亿`,
    );
  });

  // 5.2 查询DQI历史趋势
  console.log("\n📊 DQI历史趋势:");
  const dqiHistory = store.listDQIHistory("CATL_300750", 4);
  dqiHistory.forEach((result) => {
    console.log(
      `   ${result.periodDate}: DQI=${result.dqi.toFixed(2)} [${result.status}] 驱动:${result.driver}`,
    );
  });

  // 5.3 查询GMPS历史趋势
  console.log("\n⚠️ GMPS历史趋势:");
  const gmpsHistory = store.listGMPSHistory("CATL_300750", 4);
  gmpsHistory.forEach((result) => {
    console.log(
      `   ${result.periodDate}: GMPS=${result.gmps} [${result.level}] 风险概率:${(result.probabilityNextQuarter * 100).toFixed(2)}%`,
    );
  });

  // 5.4 时间范围查询示例
  console.log("\n🔍 2025年全年财务数据 (时间范围查询):");
  const yearlyData = store.queryFinancialDataByDateRange("CATL_300750", "2025-Q1", "2025-Q4");
  yearlyData.forEach((record) => {
    console.log(`   ${record.periodDate}: 营收${(record.revenue / 10000).toFixed(2)}亿`);
  });
}

// ================================================================
// 示例6：批量导出与备份
// ================================================================

function example6_ExportAndBackup() {
  console.log("\n=== 示例6: 批量导出企业诊断数据 ===\n");

  const exportData = store.exportEnterpriseDiagnosticData("CATL_300750");

  console.log("📦 导出完成:");
  console.log(`   财务数据记录数: ${exportData.financialData.length}`);
  console.log(`   DQI结果记录数: ${exportData.dqiResults.length}`);
  console.log(`   GMPS结果记录数: ${exportData.gmpsResults.length}`);
  console.log(`   导出时间: ${exportData.exportedAt}`);

  // 可以将 exportData 序列化为JSON并保存为备份文件
  // require('fs').writeFileSync('./backup_catl.json', JSON.stringify(exportData, null, 2));

  console.log("\n💡 提示: 可将此数据用于迁移、分析或备份恢复\n");
}

// ================================================================
// 主函数：运行所有示例
// ================================================================

async function main() {
  console.log("╔══════════════════════════════════════════════════════╗");
  console.log("║  DQI/GMPS 数据存储机制 - 完整使用示例               ║");
  console.log("╚══════════════════════════════════════════════════════╝\n");

  try {
    // 执行各示例
    await example1_SaveFinancialData();
    await example2_SaveIndustryData();
    await example3_CalculateAndSaveDQI();
    await example4_CalculateAndSaveGMPS();
    example5_QueryHistoryAndTrends();
    example6_ExportAndBackup();

    // 显示最终统计
    console.log("═════════════════════════════════════════════════════");
    console.log("📊 存储统计信息:");
    const stats = store.getStats();
    console.log(`   企业财务数据: ${stats.financialDataRecords} 条`);
    console.log(`   行业外部数据: ${stats.industryDataRecords} 条`);
    console.log(`   DQI计算结果: ${stats.dqiResults} 条`);
    console.log(`   GMPS计算结果: ${stats.gmpsResults} 条`);
    console.log("═════════════════════════════════════════════════════\n");

    console.log("✅ 所有示例执行完成！\n");
  } catch (error) {
    console.error("❌ 执行出错:", error);
  }
}

// 运行主函数
main();
