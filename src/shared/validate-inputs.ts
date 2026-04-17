import type { EnterpriseOnboardingDraft } from "../web/chart-data.js";

export type ValidationSeverity = "error" | "warning";

export type ValidationIssue = {
  field: string;
  label: string;
  severity: ValidationSeverity;
  message: string;
  models: ("DQI" | "GMPS")[];
};

export type ValidationResult = {
  isValid: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  missingFields: ValidationIssue[];
  summary: string;
};

type DraftField = keyof EnterpriseOnboardingDraft;

function gv(draft: EnterpriseOnboardingDraft, field: string): string | undefined {
  const raw = (draft as unknown as Record<string, unknown>)[field];
  if (raw === undefined || raw === null) return undefined;
  return String(raw);
}

function toNumber(value: string | undefined): number | null {
  if (value === undefined || value === null || value === "") return null;
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? n : null;
}

const REQUIRED_FIELDS: Array<{ field: string; label: string; models: ("DQI" | "GMPS")[] }> = [
  { field: "currentGrossMargin", label: "当期毛利率", models: ["DQI", "GMPS"] },
  { field: "baselineGrossMargin", label: "基期毛利率", models: ["DQI", "GMPS"] },
  { field: "currentRevenue", label: "当期营收", models: ["DQI", "GMPS"] },
  { field: "baselineRevenue", label: "基期营收", models: ["DQI", "GMPS"] },
  { field: "currentCost", label: "当期成本", models: ["DQI", "GMPS"] },
  { field: "baselineCost", label: "基期成本", models: ["DQI", "GMPS"] },
  { field: "currentSalesVolume", label: "当期销量", models: ["DQI", "GMPS"] },
  { field: "baselineSalesVolume", label: "基期销量", models: ["DQI", "GMPS"] },
  { field: "currentProductionVolume", label: "当期产量", models: ["DQI", "GMPS"] },
  { field: "baselineProductionVolume", label: "基期产量", models: ["DQI", "GMPS"] },
  { field: "currentInventoryExpense", label: "当期库存费用", models: ["DQI"] },
  { field: "baselineInventoryExpense", label: "基期库存费用", models: ["DQI"] },
  { field: "currentManufacturingExpense", label: "当期制造费用", models: ["DQI", "GMPS"] },
  { field: "baselineManufacturingExpense", label: "基期制造费用", models: ["DQI", "GMPS"] },
  { field: "currentOperatingCost", label: "当期营业成本", models: ["DQI", "GMPS"] },
  { field: "baselineOperatingCost", label: "基期营业成本", models: ["DQI", "GMPS"] },
  { field: "currentOperatingCashFlow", label: "当期经营现金流", models: ["DQI", "GMPS"] },
  { field: "baselineOperatingCashFlow", label: "基期经营现金流", models: ["DQI", "GMPS"] },
  { field: "currentTotalLiabilities", label: "当期总负债", models: ["DQI", "GMPS"] },
  { field: "baselineTotalLiabilities", label: "基期总负债", models: ["DQI", "GMPS"] },
  { field: "currentTotalAssets", label: "当期总资产", models: ["DQI", "GMPS"] },
  { field: "baselineTotalAssets", label: "基期总资产", models: ["DQI", "GMPS"] },
];

const REASONABLE_RANGES: Array<{
  field: string;
  label: string;
  min: number;
  max: number;
  models: ("DQI" | "GMPS")[];
  unit: string;
}> = [
  { field: "currentGrossMargin", label: "当期毛利率", min: -20, max: 60, models: ["DQI", "GMPS"], unit: "%" },
  { field: "baselineGrossMargin", label: "基期毛利率", min: -20, max: 60, models: ["DQI", "GMPS"], unit: "%" },
  { field: "currentRevenue", label: "当期营收", min: 1, max: 1e9, models: ["DQI", "GMPS"], unit: "万元" },
  { field: "baselineRevenue", label: "基期营收", min: 1, max: 1e9, models: ["DQI", "GMPS"], unit: "万元" },
  { field: "currentCost", label: "当期成本", min: 1, max: 1e9, models: ["DQI", "GMPS"], unit: "万元" },
  { field: "baselineCost", label: "基期成本", min: 1, max: 1e9, models: ["DQI", "GMPS"], unit: "万元" },
  { field: "currentSalesVolume", label: "当期销量", min: 0.1, max: 1e8, models: ["DQI", "GMPS"], unit: "万件" },
  { field: "baselineSalesVolume", label: "基期销量", min: 0.1, max: 1e8, models: ["DQI", "GMPS"], unit: "万件" },
  { field: "currentProductionVolume", label: "当期产量", min: 0.1, max: 1e8, models: ["DQI", "GMPS"], unit: "万件" },
  { field: "baselineProductionVolume", label: "基期产量", min: 0.1, max: 1e8, models: ["DQI", "GMPS"], unit: "万件" },
  { field: "currentInventoryExpense", label: "当期库存费用", min: 0, max: 1e8, models: ["DQI"], unit: "万元" },
  { field: "baselineInventoryExpense", label: "基期库存费用", min: 0, max: 1e8, models: ["DQI"], unit: "万元" },
  { field: "currentManufacturingExpense", label: "当期制造费用", min: 0, max: 1e9, models: ["DQI", "GMPS"], unit: "万元" },
  { field: "baselineManufacturingExpense", label: "基期制造费用", min: 0, max: 1e9, models: ["DQI", "GMPS"], unit: "万元" },
  { field: "currentOperatingCost", label: "当期营业成本", min: 1, max: 1e9, models: ["DQI", "GMPS"], unit: "万元" },
  { field: "baselineOperatingCost", label: "基期营业成本", min: 1, max: 1e9, models: ["DQI", "GMPS"], unit: "万元" },
  { field: "currentOperatingCashFlow", label: "当期经营现金流", min: -1e8, max: 1e9, models: ["DQI", "GMPS"], unit: "万元" },
  { field: "baselineOperatingCashFlow", label: "基期经营现金流", min: -1e8, max: 1e9, models: ["DQI", "GMPS"], unit: "万元" },
  { field: "currentTotalLiabilities", label: "当期总负债", min: 0, max: 1e9, models: ["DQI", "GMPS"], unit: "万元" },
  { field: "baselineTotalLiabilities", label: "基期总负债", min: 0, max: 1e9, models: ["DQI", "GMPS"], unit: "万元" },
  { field: "currentTotalAssets", label: "当期总资产", min: 1, max: 1e9, models: ["DQI", "GMPS"], unit: "万元" },
  { field: "baselineTotalAssets", label: "基期总资产", min: 1, max: 1e9, models: ["DQI", "GMPS"], unit: "万元" },
];

function checkMissingFields(draft: EnterpriseOnboardingDraft): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const req of REQUIRED_FIELDS) {
    const numValue = toNumber(gv(draft, req.field));
    if (numValue === null) {
      issues.push({
        field: req.field,
        label: req.label,
        severity: "error",
        message: `${req.label}未填写，${req.models.join("和")}模型将无法计算。`,
        models: req.models,
      });
    }
  }
  return issues;
}

function checkReasonableRanges(draft: EnterpriseOnboardingDraft): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const range of REASONABLE_RANGES) {
    const value = toNumber(gv(draft, range.field));
    if (value === null) continue;

    if (value < range.min || value > range.max) {
      let warningMsg = `${range.label}当前值为 ${value}`;
      if (value < range.min) {
        warningMsg += `，低于合理下限 ${range.min}`;
      } else {
        warningMsg += `，超出合理上限 ${range.max}`;
      }
      warningMsg += `（单位${range.unit}），请确认数据是否准确。`;

      issues.push({
        field: range.field,
        label: range.label,
        severity: "warning",
        message: warningMsg,
        models: range.models,
      });
    }
  }
  return issues;
}

type NumDict = Record<string, number>;

function checkCrossFieldRules(draft: EnterpriseOnboardingDraft): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const v: NumDict = {};
  for (const req of REQUIRED_FIELDS) {
    const n = toNumber(gv(draft, req.field));
    if (n !== null) v[req.field] = n;
  }

  const cmfg = v.currentManufacturingExpense;
  const coc = v.currentOperatingCost;
  if (cmfg !== undefined && coc !== undefined && cmfg > coc) {
    issues.push({ field: "currentManufacturingExpense", label: "制造费用 vs 营业成本", severity: "warning", message: "当期制造费用不应高于当期营业成本。", models: ["DQI", "GMPS"] });
  }

  const bmfg = v.baselineManufacturingExpense;
  const boc = v.baselineOperatingCost;
  if (bmfg !== undefined && boc !== undefined && bmfg > boc) {
    issues.push({ field: "baselineManufacturingExpense", label: "制造费用 vs 营业成本", severity: "warning", message: "基期制造费用不应高于基期营业成本。", models: ["DQI", "GMPS"] });
  }

  const ctl = v.currentTotalLiabilities;
  const cta = v.currentTotalAssets;
  if (ctl !== undefined && cta !== undefined && ctl > cta) {
    issues.push({ field: "currentTotalLiabilities", label: "负债 vs 资产", severity: "warning", message: "当期总负债不应高于当期总资产。", models: ["DQI", "GMPS"] });
  }

  const btl = v.baselineTotalLiabilities;
  const bta = v.baselineTotalAssets;
  if (btl !== undefined && bta !== undefined && btl > bta) {
    issues.push({ field: "baselineTotalLiabilities", label: "负债 vs 资产", severity: "warning", message: "基期总负债不应高于基期总资产。", models: ["DQI", "GMPS"] });
  }

  const cocf = v.currentOperatingCashFlow;
  const crev = v.currentRevenue;
  if (cocf !== undefined && crev !== undefined && Math.abs(cocf) > crev * 2) {
    issues.push({ field: "currentOperatingCashFlow", label: "经营现金流 vs 营收", severity: "warning", message: "当期经营现金流绝对值不应超过营业收入的2倍。", models: ["DQI", "GMPS"] });
  }

  const bocf = v.baselineOperatingCashFlow;
  const brev = v.baselineRevenue;
  if (bocf !== undefined && brev !== undefined && Math.abs(bocf) > brev * 2) {
    issues.push({ field: "baselineOperatingCashFlow", label: "经营现金流 vs 营收", severity: "warning", message: "基期经营现金流绝对值不应超过营业收入的2倍。", models: ["DQI", "GMPS"] });
  }

  return issues;
}

export function validateEnterpriseOnboarding(draft: EnterpriseOnboardingDraft): ValidationResult {
  const missingFields = checkMissingFields(draft);
  const rangeWarnings = checkReasonableRanges(draft);
  const crossFieldWarnings = checkCrossFieldRules(draft);

  const allRequiredEmpty = missingFields.length === REQUIRED_FIELDS.length;

  const errors = allRequiredEmpty ? [] : missingFields;
  const warnings = allRequiredEmpty ? [] : [...rangeWarnings, ...crossFieldWarnings];

  let summary = "";
  if (errors.length === 0 && warnings.length === 0) {
    summary = allRequiredEmpty
      ? "未填写数据，将以默认值进行分析。"
      : "数据完整性检查通过，所有字段值均在合理范围内。";
  } else {
    const parts: string[] = [];
    if (errors.length > 0) {
      parts.push(`${errors.length}个必填字段缺失`);
    }
    if (warnings.length > 0) {
      parts.push(`${warnings.length}个数值超出合理范围或逻辑冲突`);
    }
    summary = `数据校验发现${parts.join("，")}，请修正后再提交。`;
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
    missingFields: allRequiredEmpty ? [] : missingFields,
    summary,
  };
}

export function getValidationSummaryText(result: ValidationResult): string {
  if (result.isValid && result.warnings.length === 0) {
    return result.summary;
  }

  const lines: string[] = [];

  if (result.errors.length > 0) {
    lines.push("【必填字段缺失】");
    for (const err of result.errors) {
      lines.push(`  • ${err.message}`);
    }
  }

  if (result.warnings.length > 0) {
    lines.push("【数值范围警告】");
    for (const warn of result.warnings) {
      lines.push(`  • ${warn.message}`);
    }
  }

  return lines.join("\n");
}
