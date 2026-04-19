import type {
  EditableBusinessInfo,
  UserProfileResponse,
  UserPreferencesUpdateRequest,
} from "../../shared/business.js";
import type { PortalAuditReport, PortalAuditChannelStatus } from "../api.js";

export type AppState = 'loading' | 'role' | 'collect-e' | 'collect-i' | 'app-e' | 'app-i' | 'mem';
export type AppTab = 'home' | 'ana' | 'set';
export type RoleKey = 'e' | 'i';

export type PortalAuditDriverStatus = 'active' | 'partial' | 'stored_only';
export type PortalAuditFindingSeverity = 'high' | 'medium' | 'low';

export { PortalAuditReport, PortalAuditChannelStatus };

// Memory types
export type MemoryVisualMode = 'startup' | 'balanced' | 'full' | 'light';

export const DEFAULT_ENTERPRISE_NAME = "";
export const THEME_COLOR_KEYS = ["blue-violet", "emerald-cyan", "amber-coral", "rose-violet"] as const;
export const USER_ID_STORAGE_KEY = "battery-diagnostic.userId";
export const USER_ROLE_STORAGE_KEY = "battery-diagnostic.preferredRole";
export const USER_THEME_MODE_STORAGE_KEY = "battery-diagnostic.themeMode";
export const USER_THEME_COLOR_STORAGE_KEY = "battery-diagnostic.themeColor";
export const USER_REMEMBER_ROLE_STORAGE_KEY = "battery-diagnostic.rememberRole";

export type InvestorOnboardingDraft = {
  investorName: string;
  investedEnterprises: string;
  capitalCostRate: string;
  investmentTotal: string;
  investmentHorizon: "short" | "medium" | "long" | "";
  riskAppetite: "low" | "medium" | "high" | "";
  industryInterest: string;
  focusTopic: string;
  notes: string;
};

export const DEFAULT_INVESTOR_ONBOARDING: InvestorOnboardingDraft = {
  investorName: "",
  investedEnterprises: "",
  capitalCostRate: "",
  investmentTotal: "",
  investmentHorizon: "",
  riskAppetite: "",
  industryInterest: "",
  focusTopic: "",
  notes: "",
};

export function isEnterpriseOnboardingComplete(draft: import("../../shared/types.js").EnterpriseOnboardingDraft): boolean {
  const requiredFields: (keyof typeof draft)[] = [
    "enterpriseName",
  ];
  return requiredFields.every((field) => {
    const value = draft[field];
    return typeof value === "string" && value.trim().length > 0;
  });
}

export function isInvestorOnboardingComplete(draft: InvestorOnboardingDraft): boolean {
  const requiredFields: (keyof InvestorOnboardingDraft)[] = [
    "investorName",
  ];
  return requiredFields.every((field) => {
    const value = draft[field];
    return typeof value === "string" && value.trim().length > 0;
  });
}

export const DEFAULT_UPLOAD_DRAFT = {
  fileName: "",
  mimeType: "text/plain",
  content: "",
};

export type BaseInfoDraftRow = {
  id: string;
  field: string;
  value: string;
  inputKind: BaseInfoInputKind;
  placeholder?: string;
  unit?: string;
  preset: boolean;
};

export type BaseInfoInputKind = "number" | "tags" | "companies" | "text";

export type BaseInfoPresetField = {
  field: string;
  inputKind: BaseInfoInputKind;
  placeholder: string;
  unit?: string;
};

export type BaseInfoPresetGroup = {
  title: string;
  description: string;
  fields: BaseInfoPresetField[];
};

export const ENTERPRISE_BASE_INFO_GROUPS: BaseInfoPresetGroup[] = [
  {
    title: "经营表现",
    description: "数字字段仅输入数值，保存后会自动补充单位。",
    fields: [
      { field: "营业收入", inputKind: "number", unit: "万元", placeholder: "例如：186000" },
      { field: "毛利率", inputKind: "number", unit: "%", placeholder: "例如：21.4" },
      { field: "净利率", inputKind: "number", unit: "%", placeholder: "例如：8.2" },
      { field: "出货量", inputKind: "number", unit: "GWh", placeholder: "例如：9.8" },
    ],
  },
  {
    title: "经营与周转",
    description: "订单适合用标签补充结构，库存与应收适合填写周转水平。",
    fields: [
      { field: "订单", inputKind: "tags", placeholder: "例如：海外储能、工商业、头部集成商" },
      { field: "库存", inputKind: "number", unit: "天", placeholder: "例如：52" },
      { field: "应收", inputKind: "number", unit: "天", placeholder: "例如：68" },
    ],
  },
];

export const INVESTOR_BASE_INFO_GROUPS: BaseInfoPresetGroup[] = [
  {
    title: "资金与配置",
    description: "数字字段仅输入数值，标签字段支持用顿号、逗号、分号或换行分隔。",
    fields: [
      { field: "可投资资产", inputKind: "number", unit: "万元", placeholder: "例如：250000" },
      { field: "资产分布", inputKind: "tags", placeholder: "例如：一级股权、可转债、二级持仓" },
      { field: "流动性需求", inputKind: "tags", placeholder: "例如：保留并购额度、6个月内可退出部分仓位" },
    ],
  },
  {
    title: "布局与偏好",
    description: "企业列表可一行一个，也可用顿号、逗号、分号分隔。",
    fields: [
      { field: "已投资公司", inputKind: "companies", placeholder: "例如：宁德时代、亿纬锂能" },
      { field: "关注企业", inputKind: "companies", placeholder: "例如：海辰储能、鹏辉能源" },
      { field: "风险偏好", inputKind: "tags", placeholder: "例如：稳健、接受阶段性波动、重视下行保护" },
      { field: "投资周期", inputKind: "tags", placeholder: "例如：3-5年、可接受季度波动" },
    ],
  },
];

let baseInfoDraftSeed = 0;

export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function classifyQueryIntent(query: string): "diagnostic" | "chitchat" | "meta" {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return "chitchat";

  const chitchatPatterns = [
    /^(你好|hi|hello|hey|嗨|您好|早上好|下午好|晚上好|早安|晚安)[\s!。]*$/i,
    /^(谢谢|感谢|多谢|thanks|thank you|thx)[\s!。]*$/i,
    /^(再见|拜拜|bye|goodbye|see you)[\s!。]*$/i,
    /^(好的|ok|okay|嗯|哦|了解|明白|收到)[\s!。]*$/i,
    /^(你是谁|你叫什么|你是什么|who are you|你叫什么)[?？]*/i,
    /^(今天天气|天气怎么样|现在几点|几点了|what time)[?？]*/i,
    /^(哈哈|嘻嘻|呵呵|lol)/i,
  ];

  const metaPatterns = [
    /^(你能做什么|你能帮我什么|你有什么功能|系统功能|使用说明|帮助|help|怎么用|如何使用|功能介绍|使用指南)[?？]*/i,
    /^(什么是dqi|什么是gmps|dqi是什么|gmps是什么|毛利承压是什么|经营质量指数|诊断流程是什么)[?？]*/i,
    /^(怎么采集数据|如何输入数据|数据从哪来|数据来源)/i,
  ];

  const diagnosticPatterns = /分析|诊断|评估|测算|计算|查询|指标|比率|指数|得分|分数|毛利|承压|经营|现金流|营收|利润|成本|库存|负债|资产|roe|gmps|dqi|景气|趋势|建议|推荐|深度|拆解|投资|辩论|策略|行动|风险|画像|行业|锂|电池|碳酸锂|产能|产销/;

  for (const pattern of chitchatPatterns) {
    if (pattern.test(normalized)) return "chitchat";
  }

  for (const pattern of metaPatterns) {
    if (pattern.test(normalized)) return "meta";
  }

  if (diagnosticPatterns.test(normalized)) return "diagnostic";

  if (normalized.length <= 4) return "chitchat";

  return "diagnostic";
}

export function nextBaseInfoDraftId() {
  baseInfoDraftSeed += 1;
  return `base-info-${baseInfoDraftSeed}`;
}

export function dedupeStrings(items: Array<string | undefined>) {
  return Array.from(new Set(items.map((item) => item?.trim()).filter((item): item is string => Boolean(item))));
}

export function splitInputTags(source: string) {
  return dedupeStrings(source.split(/[，；;\n]/));
}

export function toFiniteNumber(value: string | number | undefined, fallback: number) {
  const resolved = typeof value === "number" ? value : Number.parseFloat(value ?? "");
  if (Number.isFinite(resolved)) return resolved;
  return Number.isFinite(fallback) ? fallback : 0;
}

export function toPositiveNumber(value: string | number | undefined, fallback: number) {
  const result = toFiniteNumber(value, fallback);
  return Math.max(result, 0.01);
}

export function formatEditableBusinessInfoValue(value?: EditableBusinessInfo[string]) {
  if (Array.isArray(value)) {
    return value.join("、");
  }
  return value ?? "";
}

export function flattenBaseInfoPresetFields(groups: BaseInfoPresetGroup[]) {
  return groups.flatMap((group) => group.fields);
}

export function stripBaseInfoUnit(value: string, unit?: string) {
  if (!unit) {
    return value.trim();
  }

  return value.endsWith(unit)
    ? value.slice(0, Math.max(0, value.length - unit.length)).trim()
    : value.trim();
}

const AMOUNT_UNIT_SCALE: Record<string, number> = { "元": 1, "万元": 10000, "亿元": 100000000 };

export function reformatBaseInfoValue(storedValue: string | undefined, currentUnit?: string): string {
  if (!storedValue || !currentUnit) return storedValue ?? "";
  const match = storedValue.match(/^([\d,.]+)\s*(.*)$/);
  if (!match) return storedValue;
  const num = parseFloat(match[1]!.replace(/,/g, ""));
  if (!Number.isFinite(num)) return storedValue;
  const oldUnit = match[2]!.trim();
  if (!oldUnit || oldUnit === currentUnit) return storedValue;
  const oldScale = AMOUNT_UNIT_SCALE[oldUnit];
  const newScale = AMOUNT_UNIT_SCALE[currentUnit];
  if (!oldScale || !newScale) return storedValue;
  const converted = num * oldScale / newScale;
  return `${converted}${currentUnit}`;
}

export function createCustomBaseInfoRow(field = "", value = ""): BaseInfoDraftRow {
  return {
    id: nextBaseInfoDraftId(),
    field,
    value,
    inputKind: "text",
    preset: false,
  };
}

export function createBaseInfoDraftRows(baseInfo: EditableBusinessInfo | undefined, presetGroups: BaseInfoPresetGroup[]): BaseInfoDraftRow[] {
  const presetFields = flattenBaseInfoPresetFields(presetGroups);
  const presetFieldMap = new Map(presetFields.map((field) => [field.field, field]));
  const presetRows = presetFields.map((field) => {
    const currentValue = formatEditableBusinessInfoValue(baseInfo?.[field.field]);
    return {
      id: nextBaseInfoDraftId(),
      field: field.field,
      value: field.inputKind === "number" ? stripBaseInfoUnit(currentValue, field.unit) : currentValue,
      inputKind: field.inputKind,
      placeholder: field.placeholder,
      unit: field.unit,
      preset: true,
    } satisfies BaseInfoDraftRow;
  });
  const customRows = Object.entries(baseInfo ?? {}).reduce<BaseInfoDraftRow[]>((result, [field, value]) => {
    if (presetFieldMap.has(field)) {
      return result;
    }

    result.push(createCustomBaseInfoRow(field, formatEditableBusinessInfoValue(value)));
    return result;
  }, []);

  return [...presetRows, ...customRows];
}

export function buildEditableBusinessInfo(rows: BaseInfoDraftRow[]): EditableBusinessInfo {
  return rows.reduce<EditableBusinessInfo>((result, row) => {
    const field = row.field.trim();
    const value = row.value.trim();

    if (!field || !value) {
      return result;
    }

    if (row.inputKind === "number") {
      result[field] = row.unit ? `${value}${row.unit}` : value;
      return result;
    }

    const parsedValues = splitInputTags(value);
    result[field] = parsedValues.length > 1 ? parsedValues : parsedValues[0] ?? value;
    return result;
  }, {});
}

export function toBaseInfoDisplayItems(value?: EditableBusinessInfo[string]) {
  if (Array.isArray(value)) {
    return value;
  }

  return value ? [value] : [];
}

export function getBaseInfoInputHint(inputKind: BaseInfoInputKind, unit?: string) {
  if (inputKind === "number") {
    return unit ? `请输入数字，保存后自动展示为 ${unit}。` : "请输入数字。";
  }
  if (inputKind === "companies") {
    return "支持一行一个企业，或使用顿号、逗号、分号分隔。";
  }
  if (inputKind === "tags") {
    return "支持多个标签，使用顿号、逗号、分号或换行分隔。";
  }
  return "可自由补充字段和值。";
}

export function summarizeEditableBusinessInfo(baseInfo?: EditableBusinessInfo, maxEntries = 2) {
  const entries = Object.entries(baseInfo ?? {}).map(([field, value]) => `${field}：${formatEditableBusinessInfoValue(value)}`);
  return entries.length > 0 ? entries.slice(0, maxEntries).join(" · ") : "暂无关键信息";
}

export function isBaseInfoValueFilled(value?: EditableBusinessInfo[string]) {
  if (Array.isArray(value)) {
    return value.some((item) => item.trim().length > 0);
  }
  return typeof value === "string" ? value.trim().length > 0 : false;
}

export function countFilledPresetFields(baseInfo: EditableBusinessInfo | undefined, presetGroups: BaseInfoPresetGroup[]) {
  return flattenBaseInfoPresetFields(presetGroups).reduce((count, field) => (
    isBaseInfoValueFilled(baseInfo?.[field.field]) ? count + 1 : count
  ), 0);
}

export function countFilledPresetDraftFields(draftRows: BaseInfoDraftRow[], presetGroups: BaseInfoPresetGroup[]) {
  return flattenBaseInfoPresetFields(presetGroups).reduce((count, field) => {
    const row = draftRows.find((item) => item.preset && item.field === field.field);
    return row?.value.trim() ? count + 1 : count;
  }, 0);
}

export function getBaseInfoInputTypeLabel(inputKind: BaseInfoInputKind) {
  if (inputKind === "number") {
    return "数字输入";
  }
  if (inputKind === "companies") {
    return "多企业列表";
  }
  if (inputKind === "tags") {
    return "标签输入";
  }
  return "文本输入";
}

export function getBaseInfoPanelTheme(title: string) {
  if (title.includes("企业")) {
    return {
      accent: "rgba(101, 143, 255, 0.96)",
      accentSoft: "rgba(101, 143, 255, 0.18)",
      accentBorder: "rgba(121, 160, 255, 0.32)",
      surface: "linear-gradient(135deg, rgba(65, 90, 190, 0.34) 0%, rgba(24, 30, 56, 0.14) 58%, rgba(12, 16, 28, 0.08) 100%)",
      fieldSurface: "linear-gradient(180deg, rgba(255,255,255,0.06) 0%, rgba(88, 120, 255, 0.10) 100%)",
      shadow: "0 22px 48px rgba(18, 24, 44, 0.24)",
    };
  }

  return {
    accent: "rgba(183, 121, 255, 0.96)",
    accentSoft: "rgba(183, 121, 255, 0.18)",
    accentBorder: "rgba(199, 148, 255, 0.34)",
    surface: "linear-gradient(135deg, rgba(109, 53, 170, 0.34) 0%, rgba(29, 18, 52, 0.14) 58%, rgba(12, 16, 28, 0.08) 100%)",
    fieldSurface: "linear-gradient(180deg, rgba(255,255,255,0.06) 0%, rgba(165, 114, 255, 0.10) 100%)",
    shadow: "0 22px 48px rgba(28, 18, 44, 0.24)",
  };
}

export function buildEditableBusinessInfoDetails(baseInfo?: EditableBusinessInfo, emptyMessage = "暂无关键信息") {
  const entries = Object.entries(baseInfo ?? {});
  if (entries.length === 0) {
    return emptyMessage;
  }
  return entries.map(([field, value], index) => `${index + 1}. ${field}：${formatEditableBusinessInfoValue(value)}`).join("\n");
}

export function roleKeyToPreference(role: RoleKey) {
  return role === "e" ? "enterprise" : "investor";
}

export function preferenceToRoleKey(role?: UserProfileResponse["profile"]["preferences"]["preferredRole"] | UserProfileResponse["profile"]["roles"][number]) {
  if (role === "enterprise") {
    return "e";
  }
  if (role === "investor") {
    return "i";
  }
  return null;
}

export function themeIndexToColorKey(themeIndex: number) {
  return THEME_COLOR_KEYS[themeIndex] ?? THEME_COLOR_KEYS[0];
}

export function themeColorKeyToIndex(themeColor?: string) {
  const nextIndex = themeColor ? THEME_COLOR_KEYS.indexOf(themeColor as (typeof THEME_COLOR_KEYS)[number]) : -1;
  return nextIndex >= 0 ? nextIndex : 0;
}

export function formatAbsoluteTime(source?: string) {
  if (!source) {
    return "暂无记录";
  }
  const date = new Date(source);
  if (Number.isNaN(date.getTime())) {
    return source;
  }
  return `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, "0")}-${date.getDate().toString().padStart(2, "0")} ${date.getHours().toString().padStart(2, "0")}:${date.getMinutes().toString().padStart(2, "0")}`;
}

export function truncateText(source: string, maxLength: number) {
  if (source.length <= maxLength) {
    return source;
  }
  return `${source.slice(0, Math.max(0, maxLength - 1))}…`;
}

export function toRiskLabel(risk?: "low" | "medium" | "high") {
  if (risk === "low") {
    return "保守";
  }
  if (risk === "high") {
    return "积极";
  }
  return "稳健";
}

export function toHorizonLabel(horizon?: "short" | "medium" | "long") {
  if (horizon === "short") {
    return "短期";
  }
  if (horizon === "long") {
    return "长期";
  }
  return "中期";
}

export function toThemeLabel(themeIndex: number) {
  return ["蓝紫渐变", "青绿极光", "暖金流光", "粉紫霓虹"][themeIndex] ?? "蓝紫渐变";
}

export function createWorkbenchId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

export function readFileContent(file: File) {
  if (typeof file.text === "function") {
    return file.text();
  }

  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(reader.error ?? new Error("文件读取失败"));
    reader.readAsText(file);
  });
}

export function formatClockTime(source?: string) {
  const date = source ? new Date(source) : new Date();
  const resolved = Number.isNaN(date.getTime()) ? new Date() : date;
  return `${resolved.getHours().toString().padStart(2, "0")}:${resolved.getMinutes().toString().padStart(2, "0")}`;
}

export function formatSessionTime(source: string) {
  const date = new Date(source);
  if (Number.isNaN(date.getTime())) {
    return "--";
  }
  return `${date.getMonth() + 1}/${date.getDate()} ${date.getHours().toString().padStart(2, "0")}:${date.getMinutes().toString().padStart(2, "0")}`;
}

export function formatCompetitiveTimestamp(source?: string) {
  if (!source) {
    return "--";
  }
  const date = new Date(source);
  if (Number.isNaN(date.getTime())) {
    return "--";
  }
  return `${date.getMonth() + 1}/${date.getDate()} ${date.getHours().toString().padStart(2, "0")}:${date.getMinutes().toString().padStart(2, "0")}`;
}

export function getAuditStatusLabel(status: PortalAuditChannelStatus) {
  switch (status) {
    case "real":
      return "真实接入";
    case "simulated":
      return "模拟演示";
    case "degraded":
      return "降级可用";
    case "placeholder":
      return "预留占位";
    default:
      return "待确认";
  }
}

export function getAuditStatusClassName(status: PortalAuditChannelStatus) {
  switch (status) {
    case "real":
      return "real";
    case "simulated":
      return "simulated";
    case "degraded":
      return "degraded";
    case "placeholder":
      return "placeholder";
    default:
      return "neutral";
  }
}

export function getAuditAudienceLabel(audience: PortalAuditReport["channels"][number]["role"] | PortalAuditReport["drivers"][number]["audience"]) {
  switch (audience) {
    case "enterprise":
      return "企业";
    case "investor":
      return "投资";
    case "shared":
      return "共享底座";
    default:
      return "链路";
  }
}

export function getAuditLayerLabel(layer: PortalAuditReport["channels"][number]["layer"]) {
  switch (layer) {
    case "frontendInput":
      return "前端输入";
    case "frontendApi":
      return "前端接口";
    case "serverRoute":
      return "服务路由";
    case "service":
      return "服务";
    case "storage":
      return "存储";
    case "chart":
      return "图表";
    case "externalSource":
      return "外部数据";
    default:
      return "链路";
  }
}

export function getAuditDriverStatusLabel(status: PortalAuditDriverStatus) {
  switch (status) {
    case "active":
      return "已消费";
    case "partial":
      return "部分消费";
    case "stored_only":
      return "仅存储";
    default:
      return "待确认";
  }
}

export function getAuditDriverStatusClassName(status: PortalAuditDriverStatus) {
  switch (status) {
    case "active":
      return "real";
    case "partial":
      return "degraded";
    case "stored_only":
      return "placeholder";
    default:
      return "neutral";
  }
}

export function getAuditFindingSeverityLabel(severity: PortalAuditFindingSeverity) {
  switch (severity) {
    case "high":
      return "高风险";
    case "medium":
      return "中风险";
    case "low":
      return "低风险";
    default:
      return "风险";
  }
}

export function getAuditFindingSeverityClassName(severity: PortalAuditFindingSeverity) {
  switch (severity) {
    case "high":
      return "placeholder";
    case "medium":
      return "degraded";
    case "low":
      return "simulated";
    default:
      return "neutral";
  }
}

export function mergeLocalUserProfile(
  previous: UserProfileResponse | null,
  payload: Partial<UserPreferencesUpdateRequest>,
) {
  if (!previous) {
    return previous;
  }

  const nextPreferredRole = payload.preferredRole ?? previous.profile.preferences.preferredRole;
  const nextRoles = Array.from(new Set([
    ...previous.profile.roles,
    payload.role,
    payload.preferredRole,
  ].filter((item): item is NonNullable<typeof item> => Boolean(item)))) as UserProfileResponse["profile"]["roles"];

  return {
    ...previous,
    profile: {
      ...previous.profile,
      displayName: typeof payload.displayName === "string" ? payload.displayName : previous.profile.displayName,
      enterpriseNames: typeof payload.enterpriseName === "string"
        ? [payload.enterpriseName]
        : previous.profile.enterpriseNames,
      investedEnterprises: payload.investedEnterprises ?? previous.profile.investedEnterprises,
      enterpriseBaseInfo: payload.enterpriseBaseInfo ?? previous.profile.enterpriseBaseInfo ?? {},
      investorBaseInfo: payload.investorBaseInfo ?? previous.profile.investorBaseInfo ?? {},
      profileSummary: typeof payload.profileSummary === "string" ? payload.profileSummary : previous.profile.profileSummary,
      behaviorSummary: typeof payload.behaviorSummary === "string" ? payload.behaviorSummary : previous.profile.behaviorSummary,
      roles: nextRoles,
      preferences: {
        ...previous.profile.preferences,
        themeMode: payload.themeMode ?? previous.profile.preferences.themeMode,
        themeColor: payload.themeColor ?? previous.profile.preferences.themeColor,
        preferredRole: nextPreferredRole,
        focusModes: payload.focusModes ?? previous.profile.preferences.focusModes,
        riskAppetite: payload.riskAppetite ?? previous.profile.preferences.riskAppetite,
        investmentHorizon: payload.investmentHorizon ?? previous.profile.preferences.investmentHorizon,
        interests: payload.interests ?? previous.profile.preferences.interests,
        attentionTags: payload.attentionTags ?? previous.profile.preferences.attentionTags,
        goals: payload.goals ?? previous.profile.preferences.goals,
        constraints: payload.constraints ?? previous.profile.preferences.constraints,
        decisionStyleHints: payload.decisionStyleHints ?? previous.profile.preferences.decisionStyleHints,
      },
    },
  };
}

export type AuditPanelState = {
  report: PortalAuditReport | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
};

export type InvestorWorkbenchMode = "industryStatus" | "investmentRecommendation" | "deepDive";

export type EnterpriseWorkbenchMode = "operationalDiagnosis" | "deepDive" | "debate";

export const INVESTOR_MODE_OPTIONS: Array<{
  value: InvestorWorkbenchMode;
  label: string;
  icon: string;
  placeholder: string;
  quickPrompts: Array<{ label: string; value: string }>;
}> = [
  {
    value: "industryStatus",
    label: "行业状况分析",
    icon: "📊",
    placeholder: `请输入行业问题，例如"储能链景气修复是否持续？"`,
    quickPrompts: [
      { label: "装机量增速", value: "+18.3%" },
      { label: "碳酸锂均价", value: "9.8" },
      { label: "储能装机增速", value: "+65.2%" },
      { label: "行业平均毛利率", value: "19.8%" },
    ],
  },
  {
    value: "investmentRecommendation",
    label: "投资推荐",
    icon: "💡",
    placeholder: `请输入投资问题，例如"是否值得继续跟踪宁德时代？"`,
    quickPrompts: [
      { label: "行业 PE 中位数", value: "25.3x" },
      { label: "十年期国债收益率", value: "2.35%" },
      { label: "储能海外订单", value: "高增长" },
      { label: "现金流修复节奏", value: "持续改善" },
    ],
  },
  {
    value: "deepDive",
    label: "深度解析",
    icon: "🔬",
    placeholder: `请输入研究问题，例如"拆解公司盈利修复的关键变量"`,
    quickPrompts: [
      { label: "毛利率修复弹性", value: "高于行业均值" },
      { label: "库存去化速度", value: "仍需验证" },
      { label: "资本开支强度", value: "阶段性高位" },
      { label: "海外产能兑现", value: "存在执行风险" },
    ],
  },
];

export const ENTERPRISE_MODE_OPTIONS: Array<{
  value: EnterpriseWorkbenchMode;
  label: string;
  icon: string;
  placeholder: string;
  quickPrompts: Array<{ label: string; value: string }>;
}> = [
  {
    value: "operationalDiagnosis",
    label: "经营诊断",
    icon: "🔍",
    placeholder: "请输入经营诊断问题...",
    quickPrompts: [
      { label: "毛利率承压", value: "21.3%" },
      { label: "产能利用率", value: "72%" },
      { label: "库存周转天数", value: "52天" },
      { label: "现金流安全", value: "中高" },
    ],
  },
  {
    value: "deepDive",
    label: "深度解析",
    icon: "🔬",
    placeholder: "请输入深度解析问题，系统将进行根因拆解...",
    quickPrompts: [
      { label: "原材料成本冲击", value: "高" },
      { label: "毛利修复弹性", value: "低于行业均值" },
      { label: "库存积压根因", value: "需求端走弱" },
      { label: "价格战传导路径", value: "中游→下游" },
    ],
  },
  {
    value: "debate",
    label: "辩论模式",
    icon: "⚖️",
    placeholder: "请输入辩论话题，系统将展开多角度辩论...",
    quickPrompts: [
      { label: "毛利率是否见底", value: "正方/反方" },
      { label: "产能出清节奏", value: "快/慢" },
      { label: "海外扩张风险", value: "高/可控" },
      { label: "技术路线选择", value: "铁锂/三元" },
    ],
  },
];

export type WorkbenchMessage = {
  id: string;
  variant: "user" | "assistant" | "system" | "debate";
  content: string;
  time: string;
  round?: number;
  speakerLabel?: string;
  speakerModel?: string;
  speakerRole?: import("../../shared/business.js").DebateMessage["speakerRole"];
  degraded?: boolean;
};

export const EMPTY_WORKBENCH_MESSAGE = "请输入信息进行对话";

export function getModeOption(mode: InvestorWorkbenchMode | import("../../shared/business.js").SessionContext["activeMode"]) {
  return INVESTOR_MODE_OPTIONS.find((option) => option.value === mode) ?? INVESTOR_MODE_OPTIONS[0]!;
}

export function getEnterpriseModeOption(mode: EnterpriseWorkbenchMode | import("../../shared/business.js").SessionContext["activeMode"]) {
  return ENTERPRISE_MODE_OPTIONS.find((option) => option.value === mode) ?? ENTERPRISE_MODE_OPTIONS[0]!;
}

export function getSessionTitle(summary: Pick<import("../../shared/business.js").SessionHistorySummary, "enterpriseName" | "investedEnterprises">) {
  return summary.enterpriseName ?? summary.investedEnterprises[0] ?? "未命名会话";
}

export function getProgressTitle(mode: InvestorWorkbenchMode) {
  if (mode === "industryStatus") {
    return "行业状况进度";
  }
  if (mode === "deepDive") {
    return "深度解析进度";
  }
  return "正式辩论进度";
}

export function mergeTimelineEntries(entries: import("../../shared/business.js").AnalysisTimelineEntry[], nextEntry: import("../../shared/business.js").AnalysisTimelineEntry | undefined) {
  if (!nextEntry) return entries;
  const exists = entries.some((entry) => entry.id === nextEntry.id);
  const next = exists
    ? entries.map((entry) => (entry.id === nextEntry.id ? nextEntry : entry))
    : [...entries, nextEntry];
  return next.sort((left, right) => left.progressPercent - right.progressPercent);
}

export function buildHistoryFallback(context: import("../../shared/business.js").SessionContext): import("../../shared/business.js").SessionHistorySummary {
  return {
    sessionId: context.sessionId,
    userId: context.userId,
    role: context.role,
    activeMode: context.activeMode,
    enterpriseName: context.enterpriseName,
    summary: context.summary,
    investedEnterprises: context.investedEnterprises,
    updatedAt: context.updatedAt,
    attachmentCount: context.attachments.length,
    hasAttachments: context.attachments.length > 0,
    lastEventType: context.recentEvents[0]?.type,
  };
}

export function buildMemoryNodes(
  role: RoleKey | null,
  userProfile: UserProfileResponse | null,
  isDark: boolean,
  themeIndex: number,
): MemoryNode[] {
  const profile = userProfile?.profile;
  const stats = userProfile?.stats;
  const preferredRole = role ?? preferenceToRoleKey(profile?.preferences.preferredRole) ?? "i";
  const roleLabel = preferredRole === "e" ? "企业运营分析" : "投资人员";
  const displayName = profile?.displayName || (preferredRole === "e" ? DEFAULT_ENTERPRISE_NAME : "当前用户");
  const themeModeLabel = isDark ? "深色模式" : "浅色模式";
  const themeLabel = toThemeLabel(themeIndex);
  const focusSummary = dedupeStrings([
    ...(profile?.preferences.interests ?? []),
    ...(profile?.preferences.attentionTags ?? []),
  ]).slice(0, 3);
  const goalSummary = dedupeStrings([
    ...(profile?.preferences.goals ?? []),
    ...(profile?.preferences.constraints ?? []),
    ...(profile?.preferences.decisionStyleHints ?? []),
  ]).slice(0, 3);
  const activeBaseInfo = preferredRole === "e" ? profile?.enterpriseBaseInfo : profile?.investorBaseInfo;
  const baseInfoSummary = summarizeEditableBusinessInfo(activeBaseInfo, 2);
  const centerTitle = preferredRole === "e" ? "企业用户档案" : "投资用户档案";
  const centerPreview = preferredRole === "e"
    ? `${profile?.enterpriseNames[0] ?? DEFAULT_ENTERPRISE_NAME} · ${stats?.sessionCount ?? 0} 个历史会话`
    : `${displayName} · ${profile?.investedEnterprises.length ?? 0} 个关注企业`;

  const centerX = 1000;
  const centerY = 1000;
  const R1 = 340; // Base radius for L1

  const generateRadialPos = (index: number, level: number, parentPos?: {x: number, y: number}, localIndex?: number, siblingsCount?: number) => {
    if (level === 1) {
      // L1 nodes are distributed evenly on a circle
      const totalL1 = 6;
      const angle = (index / totalL1) * Math.PI * 2 - Math.PI / 2; // start from top
      return {
        x: centerX + Math.cos(angle) * R1,
        y: centerY + Math.sin(angle) * R1
      };
    } else if (parentPos && localIndex !== undefined && siblingsCount !== undefined) {
      // L2 nodes are distributed in layered pyramid structure
      const baseAngle = Math.atan2(parentPos.y - centerY, parentPos.x - centerX);
      
      // Calculate which layer this node belongs to and its local index within that layer
      let layer = 1;
      let capacity = 2; // Layer 1 holds 2 nodes
      let itemsBeforeLayer = 0;
      
      while (localIndex >= itemsBeforeLayer + capacity) {
        itemsBeforeLayer += capacity;
        layer++;
        capacity++; // Next layer holds one more node (3, 4, 5...)
      }
      
      const indexInLayer = localIndex - itemsBeforeLayer;
      const itemsInThisLayer = Math.min(capacity, siblingsCount - itemsBeforeLayer);
      
      // Calculate position
      const R2_base = 240;
      const layerSpacing = 160;
      const currentRadius = R2_base + (layer - 1) * layerSpacing;
      
      // Tangent offset logic (perpendicular to the base angle ray)
      const tangentAngle = baseAngle + Math.PI / 2;
      const itemSpacing = 190; // Lateral spacing between nodes in the same layer
      
      // Center the items in the current layer
      const totalWidth = (itemsInThisLayer - 1) * itemSpacing;
      const startOffset = -totalWidth / 2;
      const currentOffset = startOffset + indexInLayer * itemSpacing;
      
      // Base point on the ray
      const rayX = parentPos.x + Math.cos(baseAngle) * currentRadius;
      const rayY = parentPos.y + Math.sin(baseAngle) * currentRadius;
      
      // Apply tangent offset
      return {
        x: rayX + Math.cos(tangentAngle) * currentOffset,
        y: rayY + Math.sin(tangentAngle) * currentOffset
      };
    }
    return { x: centerX, y: centerY };
  };

  const pos1 = generateRadialPos(0, 1);
  const pos2 = generateRadialPos(1, 1);
  const pos3 = generateRadialPos(2, 1);
  const pos4 = generateRadialPos(3, 1);
  const pos5 = generateRadialPos(4, 1);
  const pos6 = generateRadialPos(5, 1);

  const nodes: MemoryNode[] = [
    {
      id: 'center',
      ic: '👤',
      t: centerTitle,
      p: centerPreview,
      x: centerX,
      y: centerY,
      c: 1,
      nodeType: 'center',
    },
    {
      id: 'role',
      ic: preferredRole === 'e' ? '🏢' : '📈',
      t: '角色定位',
      p: roleLabel,
      x: pos1.x,
      y: pos1.y,
      level: 1,
      nodeType: 'portrait',
    },
    {
      id: 'theme',
      ic: '🎨',
      t: '主题偏好',
      p: `${themeModeLabel} · ${themeLabel}`,
      x: pos2.x,
      y: pos2.y,
      level: 1,
      nodeType: 'theme',
    },
    {
      id: 'focus',
      ic: '🎯',
      t: '关注重点',
      p: focusSummary.length > 0 ? focusSummary.join(' · ') : '暂无设置',
      x: pos3.x,
      y: pos3.y,
      level: 1,
      nodeType: 'signal',
    },
    {
      id: 'goals',
      ic: '🎭',
      t: '决策风格',
      p: goalSummary.length > 0 ? goalSummary.join(' · ') : '暂无设置',
      x: pos4.x,
      y: pos4.y,
      level: 1,
      nodeType: 'signal',
    },
    {
      id: 'base-info',
      ic: '📋',
      t: '基础信息',
      p: baseInfoSummary,
      x: pos5.x,
      y: pos5.y,
      level: 1,
      nodeType: 'portrait',
    },
    {
      id: 'activity',
      ic: '📊',
      t: '活动概览',
      p: `${stats?.sessionCount ?? 0} 会话 · ${stats?.memoryCount ?? 0} 记忆 · ${stats?.analysisCount ?? 0} 分析`,
      x: pos6.x,
      y: pos6.y,
      level: 1,
      nodeType: 'session',
    },
  ];

  const l2Nodes: MemoryNode[] = [];

  const roleL2 = [
    { id: 'role-type', ic: '🏷️', t: '角色类型', p: roleLabel, ms: '角色类型', md: `当前角色定位为「${roleLabel}」，系统将基于此角色提供个性化的诊断分析和服务。`, mt: [preferredRole === 'e' ? '企业' : '投资', '角色'] },
    { id: 'role-pref', ic: '⚙️', t: '偏好设置', p: `默认: ${roleLabel}`, ms: '偏好角色设置', md: `当前偏好角色设置为「${roleLabel}」，可在设置中修改偏好角色以获得不同视角的分析。`, mt: ['偏好', '设置'] },
  ];
  roleL2.forEach((item, i) => {
    const pos = generateRadialPos(0, 2, pos1, i, roleL2.length);
    l2Nodes.push({ id: item.id, ic: item.ic, t: item.t, p: item.p, x: pos.x, y: pos.y, level: 2, parentId: 'role', nodeType: 'portrait', memorySummary: item.ms, memoryDetails: item.md, memoryTags: item.mt });
  });

  const themeL2 = [
    { id: 'theme-mode', ic: '🌙', t: '显示模式', p: themeModeLabel, ms: '显示模式', md: `当前使用${themeModeLabel}，可在设置中切换深色/浅色模式。`, mt: ['显示', '模式'] },
    { id: 'theme-color', ic: '🎨', t: '配色方案', p: themeLabel, ms: '配色方案', md: `当前配色方案为「${themeLabel}」，可在设置中切换不同配色方案。`, mt: ['配色', '主题'] },
  ];
  themeL2.forEach((item, i) => {
    const pos = generateRadialPos(1, 2, pos2, i, themeL2.length);
    l2Nodes.push({ id: item.id, ic: item.ic, t: item.t, p: item.p, x: pos.x, y: pos.y, level: 2, parentId: 'theme', nodeType: 'theme', memorySummary: item.ms, memoryDetails: item.md, memoryTags: item.mt });
  });

  const focusItems = focusSummary.length > 0 ? focusSummary : ['暂无设置'];
  focusItems.forEach((item, i) => {
    const pos = generateRadialPos(2, 2, pos3, i, focusItems.length);
    l2Nodes.push({ id: `focus-${i}`, ic: '🔍', t: truncateText(item, 12), p: truncateText(item, 20), x: pos.x, y: pos.y, level: 2, parentId: 'focus', nodeType: 'signal', memorySummary: item, memoryDetails: `关注重点: ${item}`, memoryTags: ['关注', '重点'] });
  });

  const goalItems = goalSummary.length > 0 ? goalSummary : ['暂无设置'];
  goalItems.forEach((item, i) => {
    const pos = generateRadialPos(3, 2, pos4, i, goalItems.length);
    l2Nodes.push({ id: `goals-${i}`, ic: '🎯', t: truncateText(item, 12), p: truncateText(item, 20), x: pos.x, y: pos.y, level: 2, parentId: 'goals', nodeType: 'signal', memorySummary: item, memoryDetails: `决策风格: ${item}`, memoryTags: ['决策', '风格'] });
  });

  const baseInfoEntries = Object.entries(activeBaseInfo ?? {}).slice(0, 3);
  if (baseInfoEntries.length > 0) {
    baseInfoEntries.forEach(([field, value], i) => {
      const pos = generateRadialPos(4, 2, pos5, i, baseInfoEntries.length);
      const displayValue = formatEditableBusinessInfoValue(value);
      l2Nodes.push({ id: `base-info-${i}`, ic: '📝', t: field, p: truncateText(displayValue, 20), x: pos.x, y: pos.y, level: 2, parentId: 'base-info', nodeType: 'portrait', memorySummary: field, memoryDetails: `${field}: ${displayValue}`, memoryTags: ['基础信息', field] });
    });
  } else {
    const pos = generateRadialPos(4, 2, pos5, 0, 1);
    l2Nodes.push({ id: 'base-info-empty', ic: '📝', t: '暂无数据', p: '尚未填写基础信息', x: pos.x, y: pos.y, level: 2, parentId: 'base-info', nodeType: 'portrait', memorySummary: '暂无数据', memoryDetails: '尚未填写基础信息，可在设置中补充。', memoryTags: ['基础信息'] });
  }

  const activityL2 = [
    { id: 'activity-sessions', ic: '💬', t: '历史会话', p: `${stats?.sessionCount ?? 0} 个`, ms: '历史会话', md: `共参与 ${stats?.sessionCount ?? 0} 个诊断会话，涵盖企业经营分析和投资决策支持。`, mt: ['会话', '历史'] },
    { id: 'activity-memories', ic: '🧠', t: '记忆条目', p: `${stats?.memoryCount ?? 0} 条`, ms: '记忆条目', md: `共保存 ${stats?.memoryCount ?? 0} 条个人记忆，包括偏好、关注点和决策记录。`, mt: ['记忆', '个人'] },
    { id: 'activity-analysis', ic: '📊', t: '分析报告', p: `${stats?.analysisCount ?? 0} 份`, ms: '分析报告', md: `共生成 ${stats?.analysisCount ?? 0} 份分析报告，覆盖毛利承压诊断和经营质量评估。`, mt: ['分析', '报告'] },
  ];
  activityL2.forEach((item, i) => {
    const pos = generateRadialPos(5, 2, pos6, i, activityL2.length);
    l2Nodes.push({ id: item.id, ic: item.ic, t: item.t, p: item.p, x: pos.x, y: pos.y, level: 2, parentId: 'activity', nodeType: 'session', memorySummary: item.ms, memoryDetails: item.md, memoryTags: item.mt });
  });

  return [...nodes, ...l2Nodes];
}

export function toDebateWorkbenchMessage(message: import("../../shared/business.js").DebateMessage): WorkbenchMessage {
  return {
    id: `debate-${message.id}`,
    variant: "debate",
    content: message.content,
    time: formatClockTime(message.occurredAt),
    round: message.round,
    speakerLabel: message.speakerLabel,
    speakerModel: message.speakerModel,
    speakerRole: message.speakerRole,
    degraded: message.source === "template",
  };
}

export function buildDeepDiveContext(
  inputText: string,
  pendingQuestions: string[],
  attachments: import("../../shared/business.js").SessionAttachment[],
) {
  if (pendingQuestions.length === 0) {
    return undefined;
  }

  const answers = inputText
    .split(/\n+/)
    .map((item) => item.trim())
    .filter(Boolean);
  const fallbackAnswer = answers.join(" ").trim() || inputText.trim();
  const context: {
    objective?: string;
    timeWindow?: string;
    riskBoundary?: string;
    constraints: string[];
    answeredQuestions: string[];
  } = {
    constraints: attachments.map((item) => item.fileName).slice(0, 3),
    answeredQuestions: answers.length > 0 ? answers : fallbackAnswer ? [fallbackAnswer] : [],
  };

  pendingQuestions.forEach((question, index) => {
    const answer = answers[index] ?? fallbackAnswer;
    if (!answer) {
      return;
    }

    if (question.includes("研究目标")) {
      context.objective = answer;
      return;
    }

    if (question.includes("时间窗口")) {
      context.timeWindow = answer;
      return;
    }

    if (question.includes("风险边界") || question.includes("下行情景")) {
      context.riskBoundary = answer;
    }
  });

  return context;
}

export type MemoryNode = {
  id: string;
  ic: string;
  t: string;
  p: string;
  x: number;
  y: number;
  c?: number;
  d?: string;
  dm?: string;
  db?: string;
  parentId?: string;
  expanded?: boolean;
  level?: number;
  nodeType?: "center" | "theme" | "portrait" | "session" | "memory" | "analysis" | "signal";
  memoryId?: string;
  memorySummary?: string;
  memoryDetails?: string;
  memoryTags?: string[];
};
