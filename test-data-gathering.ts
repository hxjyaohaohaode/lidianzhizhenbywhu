
import { DataGatheringAgent } from "./src/server/data/data-fetcher.js";
import { createLogger } from "./src/server/logger.js";
import { loadEnv } from "./src/server/env.js";

async function main() {
  console.log("=== 锂电池企业智能诊断系统 - 真实数据搜集测试 ===\n");
  
  const env = loadEnv();
  const logger = createLogger(env);
  const agent = new DataGatheringAgent({ env, logger });

  const results: Record<string, unknown> = {};

  // 1. 测试上交所数据获取 - 宁德时代 (300750)
  console.log("1. 测试上交所/深交所数据获取 - 宁德时代 (300750)...");
  try {
    const sseResult = await agent.fetchSZSEReports("300750", "2024");
    results.shenzhenExchange = {
      success: sseResult.success,
      degraded: sseResult.degraded,
      reports: sseResult.reports
    };
    console.log("   ✓ 深交所数据获取完成");
    console.log(`   报告数量: ${sseResult.reports.length}`);
    if (sseResult.reports.length > 0) {
      console.log(`   最新报告: ${sseResult.reports[0].title}`);
    }
  } catch (error) {
    results.shenzhenExchange = { success: false, error: String(error) };
    console.log("   ✗ 深交所数据获取失败:", error);
  }

  console.log();

  // 2. 测试上交所数据获取 - 上汽集团 (600104)
  console.log("2. 测试上交所数据获取 - 上汽集团 (600104)...");
  try {
    const sseResult = await agent.fetchSSEReports("600104", "2024");
    results.shanghaiExchange = {
      success: sseResult.success,
      degraded: sseResult.degraded,
      reports: sseResult.reports
    };
    console.log("   ✓ 上交所数据获取完成");
    console.log(`   报告数量: ${sseResult.reports.length}`);
    if (sseResult.reports.length > 0) {
      console.log(`   最新报告: ${sseResult.reports[0].title}`);
    }
  } catch (error) {
    results.shanghaiExchange = { success: false, error: String(error) };
    console.log("   ✗ 上交所数据获取失败:", error);
  }

  console.log();

  // 3. 测试东方财富行业研报 - 锂电池行业
  console.log("3. 测试东方财富行业研报 - 锂电池行业...");
  try {
    const emResult = await agent.fetchEastmoneyIndustryReports("103");
    results.eastmoneyIndustry = {
      success: emResult.success,
      degraded: emResult.degraded,
      reports: emResult.data
    };
    console.log("   ✓ 东方财富行业研报获取完成");
    console.log(`   研报数量: ${emResult.data.length}`);
    if (emResult.data.length > 0) {
      console.log(`   最新研报: ${emResult.data[0].title}`);
      console.log(`   摘要: ${emResult.data[0].summary.substring(0, 50)}...`);
    }
  } catch (error) {
    results.eastmoneyIndustry = { success: false, error: String(error) };
    console.log("   ✗ 东方财富行业研报获取失败:", error);
  }

  console.log();

  // 4. 测试东方财富个股研报 - 宁德时代
  console.log("4. 测试东方财富个股研报 - 宁德时代 (300750)...");
  try {
    const emStockResult = await agent.fetchEastmoneyStockReports("300750", "2024");
    results.eastmoneyStock = {
      success: emStockResult.success,
      degraded: emStockResult.degraded,
      reports: emStockResult.data
    };
    console.log("   ✓ 东方财富个股研报获取完成");
    console.log(`   研报数量: ${emStockResult.data.length}`);
    if (emStockResult.data.length > 0) {
      console.log(`   最新研报: ${emStockResult.data[0].title}`);
      console.log(`   摘要: ${emStockResult.data[0].summary.substring(0, 50)}...`);
    }
  } catch (error) {
    results.eastmoneyStock = { success: false, error: String(error) };
    console.log("   ✗ 东方财富个股研报获取失败:", error);
  }

  console.log();

  // 5. 测试企业金融数据整体采集
  console.log("5. 测试企业金融数据整体采集 - 宁德时代 (300750)...");
  try {
    const enterpriseResult = await agent.collectEnterpriseFinancialData("300750", "2024");
    results.enterpriseData = {
      success: enterpriseResult.success,
      degraded: enterpriseResult.degraded,
      securityProfile: enterpriseResult.securityProfile,
      exchangeReportsCount: enterpriseResult.exchangeReports.length,
      eastmoneyReportsCount: enterpriseResult.eastmoneyReports.length
    };
    console.log("   ✓ 企业金融数据整体采集完成");
    console.log(`   公司代码: ${enterpriseResult.securityProfile.securityCode}`);
    console.log(`   交易所报告: ${enterpriseResult.exchangeReports.length} 份`);
    console.log(`   券商研报: ${enterpriseResult.eastmoneyReports.length} 份`);
  } catch (error) {
    results.enterpriseData = { success: false, error: String(error) };
    console.log("   ✗ 企业金融数据整体采集失败:", error);
  }

  console.log();
  console.log("=== 数据搜集测试完成 ===");
  console.log();
  console.log("汇总结果:");
  console.log(`- 深交所数据: ${results.shenzhenExchange?.success ? "✓ 成功" : "✗ 失败"}`);
  console.log(`- 上交所数据: ${results.shanghaiExchange?.success ? "✓ 成功" : "✗ 失败"}`);
  console.log(`- 东方财富行业研报: ${results.eastmoneyIndustry?.success ? "✓ 成功" : "✗ 失败"}`);
  console.log(`- 东方财富个股研报: ${results.eastmoneyStock?.success ? "✓ 成功" : "✗ 失败"}`);
  console.log(`- 企业金融数据整体采集: ${results.enterpriseData?.success ? "✓ 成功" : "✗ 失败"}`);

  // 保存详细结果
  const fs = await import("fs");
  fs.writeFileSync(
    "./data-gathering-results.json",
    JSON.stringify(results, null, 2),
    "utf-8"
  );
  console.log();
  console.log("详细结果已保存至: data-gathering-results.json");
}

main().catch(console.error);
