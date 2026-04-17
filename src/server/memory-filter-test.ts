import {
  evaluateMemoryValue,
  filterMemoryCandidates,
  shouldWriteMemory,
  type MemoryValueScore,
} from "./memory.js";

function formatResult(label: string, result: MemoryValueScore): string {
  const status = result.shouldRemember ? "✅ 应记忆" : "❌ 不应记忆";
  const priority = `优先级: ${result.retentionPriority}`;
  const score = `评分: ${result.valueScore}`;
  const type = `类型: ${result.contentType}`;
  const confidence = `置信度: ${(result.confidence * 100).toFixed(0)}%`;
  
  return `${label}
  ${status} | ${priority} | ${score} | ${type} | ${confidence}
  原因: ${result.reasons.join("; ")}`;
}

function runTests(): void {
  console.log("=".repeat(80));
  console.log("记忆内容智能筛选功能验证测试");
  console.log("=".repeat(80));
  console.log();

  const testCases = [
    {
      category: "应该记忆的内容 - 用户长期偏好",
      cases: [
        { summary: "用户风险偏好为保守型，注重下行保护", tags: ["风险偏好", "保守"] },
        { summary: "投资风格为价值投资，偏好低估值标的", tags: ["投资风格"] },
        { summary: "长期关注新能源和储能领域", tags: ["关注领域", "新能源"] },
        { summary: "投资周期为长期持有，资金成本8%", details: "用户偏好长期持有策略，资金成本适中", tags: ["投资周期"] },
        { summary: "用户偏好稳健型投资，关注现金流质量", tags: ["稳健", "现金流"] },
      ],
    },
    {
      category: "应该记忆的内容 - 企业洞察",
      cases: [
        { summary: "宁德时代行业洞察：动力电池龙头地位稳固", details: "市场份额持续提升，技术路线领先", tags: ["行业洞察", "宁德时代"] },
        { summary: "锂电池行业竞争格局分析：头部集中度提升", tags: ["竞争格局"] },
        { summary: "行业趋势：储能需求快速增长，产能扩张加速", tags: ["行业趋势", "储能"] },
        { summary: "企业核心竞争力分析：技术护城河明显", tags: ["核心竞争力", "护城河"] },
      ],
    },
    {
      category: "应该记忆的内容 - 决策记录",
      cases: [
        { summary: "历史决策依据：基于现金流质量进行配置", tags: ["决策依据", "现金流"] },
        { summary: "决策偏好：分批建仓，左侧交易为主", tags: ["决策偏好", "分批操作"] },
        { summary: "投资决策记录：在行业景气拐点加仓", tags: ["投资决策", "景气拐点"] },
        { summary: "仓位管理策略：单标的不超过20%仓位", tags: ["仓位管理"] },
      ],
    },
    {
      category: "应该记忆的内容 - 知识沉淀",
      cases: [
        { summary: "行业规律：锂电池行业具有周期性特征", details: "每3-4年一个完整周期", tags: ["行业规律", "周期性"] },
        { summary: "经验总结：估值方法采用PEG结合DCF", tags: ["经验总结", "估值方法"] },
        { summary: "分析框架：从盈利质量、经营韧性、证据链三维度评估", tags: ["分析框架"] },
        { summary: "投资逻辑：景气度+估值+催化剂三维验证", tags: ["投资逻辑"] },
      ],
    },
    {
      category: "不应该记忆的内容 - 临时性数据",
      cases: [
        { summary: "今日锂电池价格为12.5万元/吨", tags: ["价格"] },
        { summary: "本周股价波动较大，下跌5%", tags: ["波动"] },
        { summary: "最新公告：公司发布季度报告", tags: ["公告"] },
        { summary: "当前报价：宁德时代报价180元", tags: ["报价"] },
        { summary: "短期走势：本周震荡整理", tags: ["走势"] },
      ],
    },
    {
      category: "不应该记忆的内容 - 用户临时输入",
      cases: [
        { summary: "测试一下这个功能", tags: [] },
        { summary: "查一下宁德时代的股价", tags: [] },
        { summary: "帮我看看这个数据", tags: [] },
        { summary: "试试分析功能", tags: [] },
        { summary: "demo测试数据", tags: ["demo"] },
      ],
    },
    {
      category: "不应该记忆的内容 - 中间过程数据",
      cases: [
        { summary: "正在计算财务指标", tags: [] },
        { summary: "推理过程：第一步分析毛利率", tags: [] },
        { summary: "临时结果：ROE为15%", tags: [] },
        { summary: "中间步骤：处理现金流数据", tags: [] },
      ],
    },
  ];

  let totalTests = 0;
  let passedTests = 0;
  const failedCases: string[] = [];

  for (const group of testCases) {
    console.log(`\n${"-".repeat(60)}`);
    console.log(`📋 ${group.category}`);
    console.log("-".repeat(60));

    const shouldRemember = group.category.includes("应该记忆");
    const shouldNotRemember = group.category.includes("不应该记忆");
    
    for (const testCase of group.cases) {
      totalTests++;
      const result = evaluateMemoryValue(testCase.summary, testCase.details, testCase.tags);
      
      let isCorrect = false;
      if (shouldRemember) {
        isCorrect = result.shouldRemember === true;
      } else if (shouldNotRemember) {
        isCorrect = result.shouldRemember === false;
      } else {
        isCorrect = true;
      }
      
      if (isCorrect) {
        passedTests++;
        console.log(`\n✅ 正确: ${testCase.summary}`);
      } else {
        failedCases.push(`${group.category}: ${testCase.summary}`);
        console.log(`\n❌ 错误: ${testCase.summary}`);
      }
      
      console.log(`   类型: ${result.contentType} | 评分: ${result.valueScore} | 优先级: ${result.retentionPriority}`);
      console.log(`   应记忆: ${result.shouldRemember} | 置信度: ${(result.confidence * 100).toFixed(0)}%`);
      console.log(`   原因: ${result.reasons.slice(0, 2).join("; ")}`);
    }
  }

  console.log("\n" + "=".repeat(80));
  console.log("测试结果汇总");
  console.log("=".repeat(80));
  console.log(`总测试数: ${totalTests}`);
  console.log(`通过数: ${passedTests}`);
  console.log(`失败数: ${totalTests - passedTests}`);
  console.log(`通过率: ${((passedTests / totalTests) * 100).toFixed(1)}%`);

  if (failedCases.length > 0) {
    console.log("\n失败用例:");
    failedCases.forEach((c, i) => console.log(`  ${i + 1}. ${c}`));
  }

  console.log("\n" + "-".repeat(60));
  console.log("批量筛选测试");
  console.log("-".repeat(60));

  const candidates = [
    { summary: "用户风险偏好为稳健型", tags: ["风险偏好"] },
    { summary: "今日股价上涨3%", tags: ["股价"] },
    { summary: "行业洞察：储能赛道高景气", tags: ["行业洞察"] },
    { summary: "测试一下", tags: [] },
    { summary: "决策偏好：分批操作，左侧交易", tags: ["决策偏好"] },
    { summary: "正在分析数据", tags: [] },
    { summary: "长期关注现金流质量", tags: ["现金流", "长期"] },
  ];

  const filtered = filterMemoryCandidates(candidates);
  
  console.log(`\n输入 ${candidates.length} 条候选记忆，筛选后保留 ${filtered.length} 条:`);
  filtered.forEach((item, i) => {
    console.log(`  ${i + 1}. ${item.summary} (评分: ${item.evaluation.valueScore}, 类型: ${item.evaluation.contentType})`);
  });

  console.log("\n" + "-".repeat(60));
  console.log("shouldWriteMemory 函数测试");
  console.log("-".repeat(60));

  const writeTests = [
    { summary: "用户长期偏好价值投资", tags: ["投资风格"] },
    { summary: "临时测试数据", tags: [] },
    { summary: "行业规律：锂电池周期性明显", tags: ["行业规律"] },
  ];

  for (const test of writeTests) {
    const { shouldWrite, evaluation } = shouldWriteMemory(test.summary, undefined, test.tags);
    console.log(`\n"${test.summary}"`);
    console.log(`  是否写入: ${shouldWrite ? "是" : "否"} | 评分: ${evaluation.valueScore} | 原因: ${evaluation.reasons[0]}`);
  }

  console.log("\n" + "=".repeat(80));
  console.log("验证完成");
  console.log("=".repeat(80));
}

runTests();
