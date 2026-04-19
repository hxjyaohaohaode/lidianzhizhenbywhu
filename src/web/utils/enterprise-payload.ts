/* eslint-disable @typescript-eslint/no-explicit-any */
import type {
  EnterpriseAnalysisRequest,
  EnterpriseCollectionRequest,
  InvestorProfileRequest,
  UserProfileResponse,
} from "../../shared/business.js";
import type { InvestorOnboardingDraft } from "./helpers.js";
import {
  DEFAULT_ENTERPRISE_NAME,
  dedupeStrings,
  splitInputTags,
  toFiniteNumber,
  toPositiveNumber,
} from "./helpers.js";
import type { EnterpriseOnboardingDraft } from "../../shared/types.js";

export function buildEnterpriseCollectionPayload(
  userId: string,
  draft: EnterpriseOnboardingDraft,
  userProfile?: UserProfileResponse | null,
): EnterpriseCollectionRequest {
  const enterpriseName = draft.enterpriseName.trim() || userProfile?.profile.enterpriseNames[0] || DEFAULT_ENTERPRISE_NAME;
  const currentRevenue = toPositiveNumber(draft.currentRevenue, 52000);
  const baselineRevenue = toPositiveNumber(draft.baselineRevenue, 48000);
  const currentCost = toPositiveNumber(draft.currentCost, 42400);
  const baselineCost = toPositiveNumber(draft.baselineCost, 36900);
  const currentSalesVolume = toPositiveNumber(draft.currentSalesVolume, 850);
  const baselineSalesVolume = toPositiveNumber(draft.baselineSalesVolume, 720);
  const currentInventoryExpense = toPositiveNumber(draft.currentInventoryExpense, 3200);
  const baselineInventoryExpense = toPositiveNumber(draft.baselineInventoryExpense, 2620);
  const currentOperatingCostRaw = toPositiveNumber(draft.currentOperatingCost, currentCost);
  const currentManufacturingExpenseRaw = toPositiveNumber(draft.currentManufacturingExpense, currentOperatingCostRaw * 0.66);
  const currentOperatingCost = Math.max(currentOperatingCostRaw, currentManufacturingExpenseRaw);
  const currentManufacturingExpense = Math.min(currentManufacturingExpenseRaw, currentOperatingCost);
  const baselineManufacturingRatio = Math.min(Math.max(currentManufacturingExpense / currentOperatingCost, 0.35), 0.9);
  const baselineOperatingCost = baselineCost;
  const baselineManufacturingExpense = Math.min(
    Number((baselineOperatingCost * baselineManufacturingRatio).toFixed(2)),
    baselineOperatingCost,
  );
  const currentTotalAssetsRaw = toPositiveNumber(draft.currentTotalAssets, 120000);
  const currentTotalLiabilitiesRaw = toPositiveNumber(draft.currentTotalLiabilities, 35000);
  const currentTotalAssets = Math.max(currentTotalAssetsRaw, currentTotalLiabilitiesRaw);
  const currentTotalLiabilities = Math.min(currentTotalLiabilitiesRaw, currentTotalAssets);
  const baselineTotalAssets = Math.max(
    Number((currentTotalAssets * 0.96).toFixed(2)),
    Number((currentTotalLiabilities * 1.05).toFixed(2)),
  );
  const baselineTotalLiabilities = Math.min(
    Number((currentTotalLiabilities * 0.93).toFixed(2)),
    baselineTotalAssets,
  );
  const currentOperatingCashFlow = toFiniteNumber(draft.currentOperatingCashFlow, 8500);
  const baselineOperatingCashFlow = Number((currentOperatingCashFlow * 1.08).toFixed(2));
  const currentNetProfit = toFiniteNumber(draft.currentNetProfit, 8200);
  const baselineNetProfit = toFiniteNumber(draft.baselineNetProfit, 7600);
  const currentBeginNetAssets = toPositiveNumber(draft.currentBeginNetAssets, 65000);
  const currentEndNetAssets = toPositiveNumber(draft.currentEndNetAssets, 68000);
  const baselineBeginNetAssets = toPositiveNumber(draft.baselineBeginNetAssets, 60000);
  const baselineEndNetAssets = toPositiveNumber(draft.baselineEndNetAssets, 63000);
  const currentRevenueForDQI = toPositiveNumber(draft.currentRevenueForDQI, currentRevenue);
  const baselineRevenueForDQI = toPositiveNumber(draft.baselineRevenueForDQI, baselineRevenue);
  const currentOCFNet = toFiniteNumber(draft.currentOCFNet, currentOperatingCashFlow);
  const baselineOCFNet = toFiniteNumber(draft.baselineOCFNet, baselineOperatingCashFlow);
  const currentProductionVolume = Math.max(
    toPositiveNumber(draft.currentProductionVolume, currentSalesVolume * 1.06),
    currentSalesVolume,
  );
  const baselineProductionVolume = Math.max(baselineSalesVolume, Number((baselineSalesVolume * 1.04).toFixed(2)));
  const grossMarginGap = toFiniteNumber(draft.currentGrossMargin, 18.5) - toFiniteNumber(draft.baselineGrossMargin, 23.2);

  return {
    userId,
    role: "enterprise" as const,
    enterpriseName,
    hasFullQuarterHistory: draft.hasFullHistory,
    currentQuarterLabel: draft.currentQuarterLabel.trim() || "本季",
    baselineQuarterLabel: draft.baselineQuarterLabel.trim() || "去年同季",
    recentQuarterLabels: draft.hasFullHistory
      ? ["Q2'24", "Q3'24", "Q4'24", draft.currentQuarterLabel.trim() || "本季"]
      : [],
    grossMarginInput: {
      currentGrossMargin: toFiniteNumber(draft.currentGrossMargin, 18.5),
      baselineGrossMargin: toFiniteNumber(draft.baselineGrossMargin, 23.2),
      currentRevenue,
      baselineRevenue,
      currentCost,
      baselineCost,
      currentSalesVolume,
      baselineSalesVolume,
      currentInventoryExpense,
      baselineInventoryExpense,
    },
    operatingQualityInput: {
      currentSalesVolume,
      baselineSalesVolume,
      currentProductionVolume,
      baselineProductionVolume,
      currentManufacturingExpense,
      baselineManufacturingExpense,
      currentOperatingCost,
      baselineOperatingCost,
      currentOperatingCashFlow,
      baselineOperatingCashFlow,
      currentRevenue,
      baselineRevenue,
      currentTotalLiabilities,
      baselineTotalLiabilities,
      currentTotalAssets,
      baselineTotalAssets,
      currentNetProfit,
      baselineNetProfit,
      currentBeginNetAssets,
      currentEndNetAssets,
      baselineBeginNetAssets,
      baselineEndNetAssets,
      currentRevenueForDQI,
      baselineRevenueForDQI,
      currentOCFNet,
      baselineOCFNet,
    },
    industryContext: {
      marketDemandIndex: Math.max(55, Math.min(130, Math.round((currentSalesVolume / currentProductionVolume) * 100))),
      materialCostTrend: grossMarginGap < -2 ? "up" : grossMarginGap < 0 ? "flat" : "down",
      policySignals: dedupeStrings([
        "储能项目招标放量",
        draft.hasFullHistory ? "近四季度对比已接入" : "已启用同期对比",
      ]).slice(0, 6),
    },
    notes: dedupeStrings([
      `企业${enterpriseName}`,
      draft.hasFullHistory ? "近四季度历史已同步" : "本期与同期对比已同步",
      ...(userProfile?.profile.preferences.attentionTags ?? []).slice(0, 4),
    ]).slice(0, 8),
    enterpriseBaseInfo: userProfile?.profile.enterpriseBaseInfo ?? {},
  };
}

export function buildEnterpriseAnalysisRequestPayload(
  userId: string,
  sessionId: string,
  query: string,
  draft: EnterpriseOnboardingDraft,
  userProfile?: UserProfileResponse | null,
  complexity?: string,
  focusMode?: "operationalDiagnosis" | "deepDive",
): EnterpriseAnalysisRequest {
  const collectionPayload = buildEnterpriseCollectionPayload(userId, draft, userProfile);
  const effectiveFocusMode = focusMode ?? (/深度|拆解|根因|详细|复盘/.test(query) ? "deepDive" : "operationalDiagnosis");
  return {
    userId,
    role: "enterprise" as const,
    sessionId,
    enterpriseName: collectionPayload.enterpriseName,
    query,
    focusMode: effectiveFocusMode,
    grossMarginInput: collectionPayload.grossMarginInput,
    operatingQualityInput: collectionPayload.operatingQualityInput,
    industryContext: collectionPayload.industryContext,
    memoryNotes: dedupeStrings([
      ...(collectionPayload.notes ?? []),
      ...(userProfile?.profile.preferences.attentionTags ?? []),
    ]).slice(0, 8),
    complexity: (complexity as "simple" | "moderate" | "full") ?? "moderate",
  };
}

export function formatEnterpriseAssistantResponse(response: any) {
  const personalization = response.personalization;
  const insightLines = response.highlights?.combinedInsights?.map((item: any) => `${item}`).join("\n");
  const taskLines = personalization?.nextTasks?.map((item: any) => `${item}`).join("\n");
  const result = [
    "📊 <b>真实接口分析已返回</b>",
    response.diagnostic?.finalAnswer,
    insightLines ? `\n关键关注：\n${insightLines}` : "",
    personalization?.summary ? `\n画像提示${personalization.summary}` : "",
    taskLines ? `\n建议下一步：\n${taskLines}` : "",
  ].filter(Boolean).join("\n");
  return result || "分析完成，但未生成具体内容。";
}

export function buildInvestorProfilePayload(
  userId: string,
  userProfile: UserProfileResponse | null,
  onboarding: InvestorOnboardingDraft,
): InvestorProfileRequest {
  const storedPreferences = userProfile?.profile.preferences;
  const investedEnterprises = splitInputTags(onboarding.investedEnterprises);
  const interests = dedupeStrings([
    onboarding.industryInterest,
    onboarding.focusTopic,
    ...(storedPreferences?.interests ?? []),
  ]).slice(0, 8);
  const notes = dedupeStrings([
    onboarding.notes,
    ...(storedPreferences?.attentionTags ?? []),
    userProfile?.profile.behaviorSummary,
  ]).slice(0, 8);
  return {
    userId,
    role: "investor" as const,
    investorName: onboarding.investorName.trim() || userProfile?.profile.displayName || "投资用户",
    investedEnterprises: investedEnterprises.length > 0 ? investedEnterprises : userProfile?.profile.investedEnterprises ?? [DEFAULT_ENTERPRISE_NAME],
    capitalCostRate: Number.parseFloat(onboarding.capitalCostRate) || 9.2,
    riskAppetite: onboarding.riskAppetite || storedPreferences?.riskAppetite || "medium",
    investmentHorizon: onboarding.investmentHorizon || storedPreferences?.investmentHorizon || "long",
    interests,
    notes,
    investorBaseInfo: userProfile?.profile.investorBaseInfo ?? {},
  };
}
