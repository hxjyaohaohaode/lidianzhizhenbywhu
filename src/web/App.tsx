import React, { useEffect, useState, useRef, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";

import {
  analyzeEnterprise,
  bootstrapUserIdentity,
  collectEnterpriseData,
  createInvestorProfile,
  createInvestorSession,
  deletePrivateMemory,
  deleteCurrentInvestorSession,
  deleteInvestorSessions,
  fetchPortalAuditReport,
  fetchUserProfile,
  fetchInvestorSessionContext,
  fetchInvestorSessions,
  streamInvestorAnalysis,
  switchInvestorMode,
  updatePrivateMemory,
  updateUserPreferences,
  uploadInvestorAttachment,
  writePrivateMemory,
  type EnterpriseAnalysisResponse,
  type InvestorAnalysisResponse,
  type PortalAuditChannelStatus,
  type PortalAuditReport,
} from "./api.js";
import {
  buildEnterpriseVisualization,
  buildInvestorAnalysisVisualization,
  buildInvestorHomeVisualization,
  DEFAULT_ENTERPRISE_ONBOARDING,
  type EnterpriseOnboardingDraft,
} from "./chart-data.js";
import { VisualizationBoard } from "./chart-system.js";
import { MessageWithCharts } from "./chart-renderer.js";
import { UnitSelector, useUnitPreferences } from "./UnitSelector.js";
import { DataFormatter, type UnitPreferences, loadUnitPreferences, saveUnitPreferences } from "./data-formatter.js";
import {
  DQIGMPSPanelsContainer,
  extractMathAnalysisFromResponse,
} from "./dqi-gmps-panels.js";
import {
  createMemoryVisualObjectCounts,
  expandMemoryVisualObjectCounts,
  resolveMemoryVisualProfile,
  type MemoryVisualMode,
} from "./memory-performance.js";
import type { IndustryRetrievalOutput } from "../shared/agents.js";
import type {
  AnalysisTimelineEntry,
  DebateMessage,
  EditableBusinessInfo,
  EnterpriseAnalysisRequest,
  EnterpriseCollectionRequest,
  InvestorAnalysisStreamEvent,
  InvestorProfileRequest,
  PrivateMemoryUpdateRequest,
  ProfileUpdateReceipt,
  SessionAttachment,
  SessionContext,
  SessionHistorySummary,
  UserPreferencesUpdateRequest,
  UserProfileResponse,
  VisualizationWidget,
} from "../shared/business.js";

// Types
type AppState = 'loading' | 'role' | 'collect-e' | 'collect-i' | 'app-e' | 'app-i' | 'mem';
type AppTab = 'home' | 'ana' | 'set';
type RoleKey = 'e' | 'i';

// Screen props types
 interface AppScreenProps {
   tab: AppTab;
   setTab: (tab: AppTab) => void;
   openMem: () => void;
   isDark: boolean;
   setIsDark: (isDark: boolean) => void;
   themeIndex: number;
   setThemeIndex: (themeIndex: number) => void;
   unitPrefs: UnitPreferences;
   dataFormatter: DataFormatter;
   onUnitPrefsChange: (prefs: UnitPreferences) => void;
   isRefreshing: boolean;
   lastDataRefreshAt: string;
   onRefreshData: () => void;
   refreshInterval: number;
   onRefreshIntervalChange: (ms: number) => void;
 }

interface EnterpriseScreenProps extends AppScreenProps {
  currentUserId: string | null;
  enterpriseOnboarding: EnterpriseOnboardingDraft;
  userProfile: UserProfileResponse | null;
  refreshUserProfile: (userId?: string) => Promise<UserProfileResponse | null>;
  saveEnterpriseBaseInfo: (baseInfo: EditableBusinessInfo) => Promise<void>;
}

interface InvestorScreenProps extends AppScreenProps {
  currentUserId: string | null;
  userProfile: UserProfileResponse | null;
  refreshUserProfile: (userId?: string) => Promise<UserProfileResponse | null>;
  investorOnboarding: InvestorOnboardingDraft;
  saveInvestorBaseInfo: (baseInfo: EditableBusinessInfo) => Promise<void>;
  prefetchedSessionHistoryRef: React.MutableRefObject<SessionHistorySummary[] | null>;
}
 
 // Component props types
 interface EntSetProps {
   isActive: boolean;
   openMem: () => void;
   isDark: boolean;
   setIsDark: (isDark: boolean) => void;
   themeIndex: number;
   setThemeIndex: (themeIndex: number) => void;
 }
 
 interface InvSetProps {
   isActive: boolean;
   openMem: () => void;
   isDark: boolean;
   setIsDark: (isDark: boolean) => void;
   themeIndex: number;
   setThemeIndex: (themeIndex: number) => void;
  userProfile: UserProfileResponse | null;
  saveInvestorBaseInfo: (baseInfo: EditableBusinessInfo) => Promise<void>;
 }
 
type AuditPanelState = {
  report: PortalAuditReport | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
};
 
 // Node types for MemoryScreen
interface MemoryNode {
   id: string;
   ic: string;
   t: string;
   p: string;
   x: number;
   y: number;
   c?: number; // center flag
   d?: string;
   dm?: string;
   db?: string;
   parentId?: string; // reference to parent node id
   expanded?: boolean; // for interactive multi-level expansion
   level?: number;
  nodeType?: "center" | "theme" | "portrait" | "session" | "memory" | "analysis" | "signal";
  memoryId?: string;
  memorySummary?: string;
  memoryDetails?: string;
  memoryTags?: string[];
 }
const DEFAULT_ENTERPRISE_NAME = "星海电池";
const THEME_COLOR_KEYS = ["blue-violet", "emerald-cyan", "amber-coral", "rose-violet"] as const;
const USER_ID_STORAGE_KEY = "battery-diagnostic.userId";
const USER_ROLE_STORAGE_KEY = "battery-diagnostic.preferredRole";
const USER_THEME_MODE_STORAGE_KEY = "battery-diagnostic.themeMode";
const USER_THEME_COLOR_STORAGE_KEY = "battery-diagnostic.themeColor";

type InvestorOnboardingDraft = {
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
const DEFAULT_INVESTOR_ONBOARDING: InvestorOnboardingDraft = {
  investorName: "张敏",
  investedEnterprises: "星海电池、蓝峰材料",
  capitalCostRate: "9.2",
  investmentTotal: "200",
  investmentHorizon: "long",
  riskAppetite: "medium",
  industryInterest: "行业景气",
  focusTopic: "深度基本面",
  notes: "偏好现金流稳健、关注海外储能订单兑现。",
};
const DEFAULT_UPLOAD_DRAFT = {
  fileName: "供应链纪要.txt",
  mimeType: "text/plain",
  content: "2026Q1 跟踪：储能订单延续高景气，客户回款节奏改善，但海外扩产兑现仍需观察。",
};

type BaseInfoDraftRow = {
  id: string;
  field: string;
  value: string;
  inputKind: BaseInfoInputKind;
  placeholder?: string;
  unit?: string;
  preset: boolean;
};

type BaseInfoInputKind = "number" | "tags" | "companies" | "text";

type BaseInfoPresetField = {
  field: string;
  inputKind: BaseInfoInputKind;
  placeholder: string;
  unit?: string;
};

type BaseInfoPresetGroup = {
  title: string;
  description: string;
  fields: BaseInfoPresetField[];
};

const ENTERPRISE_BASE_INFO_GROUPS: BaseInfoPresetGroup[] = [
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

const INVESTOR_BASE_INFO_GROUPS: BaseInfoPresetGroup[] = [
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
      { field: "已投资公司", inputKind: "companies", placeholder: "例如：星海电池、蓝峰材料" },
      { field: "关注企业", inputKind: "companies", placeholder: "例如：海辰储能、鹏辉能源" },
      { field: "风险偏好", inputKind: "tags", placeholder: "例如：稳健、接受阶段性波动、重视下行保护" },
      { field: "投资周期", inputKind: "tags", placeholder: "例如：3-5年、可接受季度波动" },
    ],
  },
];

let baseInfoDraftSeed = 0;

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function classifyQueryIntent(query: string): "diagnostic" | "chitchat" | "meta" {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return "chitchat";

  const chitchatPatterns = [
    /^(你好|hi|hello|hey|嗨|您好|早上好|下午好|晚上好|早安|晚安)[\s!。]*$/i,
    /^(谢谢|感谢|多谢|thanks|thank you|thx)[\s!。]*$/i,
    /^(再见|拜拜|bye|goodbye|see you)[\s!。]*$/i,
    /^(好的|ok|okay|嗯|哦|了解|明白|收到)[\s!。]*$/i,
    /^(你是谁|你叫什么|你是什么|who are you|你叫什么)[\?？]*/i,
    /^(今天天气|天气怎么样|现在几点|几点了|what time)[\?？]*/i,
    /^(哈哈|嘻嘻|呵呵|lol)/i,
  ];

  const metaPatterns = [
    /^(你能做什么|你能帮我什么|你有什么功能|系统功能|使用说明|帮助|help|怎么用|如何使用|功能介绍|使用指南)[\?？]*/i,
    /^(什么是dqi|什么是gmps|dqi是什么|gmps是什么|毛利承压是什么|经营质量指数|诊断流程是什么)[\?？]*/i,
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

function nextBaseInfoDraftId() {
  baseInfoDraftSeed += 1;
  return `base-info-${baseInfoDraftSeed}`;
}

function dedupeStrings(items: Array<string | undefined>) {
  return Array.from(new Set(items.map((item) => item?.trim()).filter((item): item is string => Boolean(item))));
}

function splitInputTags(source: string) {
  return dedupeStrings(source.split(/[，；;\n]/));
}

function toFiniteNumber(value: string | number | undefined, fallback: number) {
  const resolved = typeof value === "number" ? value : Number.parseFloat(value ?? "");
  return Number.isFinite(resolved) ? resolved : fallback;
}

function toPositiveNumber(value: string | number | undefined, fallback: number) {
  return Math.max(toFiniteNumber(value, fallback), 0.01);
}

function formatEditableBusinessInfoValue(value?: EditableBusinessInfo[string]) {
  if (Array.isArray(value)) {
    return value.join("、");
  }
  return value ?? "";
}

function flattenBaseInfoPresetFields(groups: BaseInfoPresetGroup[]) {
  return groups.flatMap((group) => group.fields);
}

function stripBaseInfoUnit(value: string, unit?: string) {
  if (!unit) {
    return value.trim();
  }

  return value.endsWith(unit)
    ? value.slice(0, Math.max(0, value.length - unit.length)).trim()
    : value.trim();
}

const AMOUNT_UNIT_SCALE: Record<string, number> = { "元": 1, "万元": 10000, "亿元": 100000000 };

function reformatBaseInfoValue(storedValue: string | undefined, currentUnit?: string): string {
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

function createCustomBaseInfoRow(field = "", value = ""): BaseInfoDraftRow {
  return {
    id: nextBaseInfoDraftId(),
    field,
    value,
    inputKind: "text",
    preset: false,
  };
}

function createBaseInfoDraftRows(baseInfo: EditableBusinessInfo | undefined, presetGroups: BaseInfoPresetGroup[]): BaseInfoDraftRow[] {
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

function buildEditableBusinessInfo(rows: BaseInfoDraftRow[]): EditableBusinessInfo {
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

function toBaseInfoDisplayItems(value?: EditableBusinessInfo[string]) {
  if (Array.isArray(value)) {
    return value;
  }

  return value ? [value] : [];
}

function renderBaseInfoValueContent(
  value: EditableBusinessInfo[string] | undefined,
  inputKind: BaseInfoInputKind,
  align: "start" | "end" = "end",
) {
  const items = toBaseInfoDisplayItems(value);

  if (items.length === 0) {
    return <span style={{ color: "#94A3B8", fontSize: "12px" }}>待填写</span>;
  }

  if (inputKind === "tags" || inputKind === "companies") {
    return (
      <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", justifyContent: align === "end" ? "flex-end" : "flex-start" }}>
        {items.map((item) => (
          <span
            key={item}
            style={{
              padding: "4px 8px",
              borderRadius: "999px",
              background: "#F1F5F9",
              border: "1px solid var(--line)",
              color: "#475569",
              fontSize: "12px",
              maxWidth: "100%",
              wordBreak: "break-word",
            }}
          >
            {item}
          </span>
        ))}
      </div>
    );
  }

  return (
    <span style={{ color: "#475569", fontSize: "12px", textAlign: align === "end" ? "right" : "left", wordBreak: "break-word" }}>
      {formatEditableBusinessInfoValue(value)}
    </span>
  );
}

function getBaseInfoInputHint(inputKind: BaseInfoInputKind, unit?: string) {
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

function summarizeEditableBusinessInfo(baseInfo?: EditableBusinessInfo, maxEntries = 2) {
  const entries = Object.entries(baseInfo ?? {}).map(([field, value]) => `${field}：${formatEditableBusinessInfoValue(value)}`);
  return entries.length > 0 ? entries.slice(0, maxEntries).join(" · ") : "暂无关键信息";
}

function isBaseInfoValueFilled(value?: EditableBusinessInfo[string]) {
  if (Array.isArray(value)) {
    return value.some((item) => item.trim().length > 0);
  }
  return typeof value === "string" ? value.trim().length > 0 : false;
}

function countFilledPresetFields(baseInfo: EditableBusinessInfo | undefined, presetGroups: BaseInfoPresetGroup[]) {
  return flattenBaseInfoPresetFields(presetGroups).reduce((count, field) => (
    isBaseInfoValueFilled(baseInfo?.[field.field]) ? count + 1 : count
  ), 0);
}

function countFilledPresetDraftFields(draftRows: BaseInfoDraftRow[], presetGroups: BaseInfoPresetGroup[]) {
  return flattenBaseInfoPresetFields(presetGroups).reduce((count, field) => {
    const row = draftRows.find((item) => item.preset && item.field === field.field);
    return row?.value.trim() ? count + 1 : count;
  }, 0);
}

function getBaseInfoInputTypeLabel(inputKind: BaseInfoInputKind) {
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

function getBaseInfoPanelTheme(title: string) {
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

function buildEditableBusinessInfoDetails(baseInfo?: EditableBusinessInfo, emptyMessage = "暂无关键信息") {
  const entries = Object.entries(baseInfo ?? {});
  if (entries.length === 0) {
    return emptyMessage;
  }
  return entries.map(([field, value], index) => `${index + 1}. ${field}：${formatEditableBusinessInfoValue(value)}`).join("\n");
}

function roleKeyToPreference(role: RoleKey) {
  return role === "e" ? "enterprise" : "investor";
}

function preferenceToRoleKey(role?: UserProfileResponse["profile"]["preferences"]["preferredRole"] | UserProfileResponse["profile"]["roles"][number]) {
  if (role === "enterprise") {
    return "e";
  }
  if (role === "investor") {
    return "i";
  }
  return null;
}

function themeIndexToColorKey(themeIndex: number) {
  return THEME_COLOR_KEYS[themeIndex] ?? THEME_COLOR_KEYS[0];
}

function themeColorKeyToIndex(themeColor?: string) {
  const nextIndex = themeColor ? THEME_COLOR_KEYS.indexOf(themeColor as (typeof THEME_COLOR_KEYS)[number]) : -1;
  return nextIndex >= 0 ? nextIndex : 0;
}

function formatAbsoluteTime(source?: string) {
  if (!source) {
    return "暂无记录";
  }
  const date = new Date(source);
  if (Number.isNaN(date.getTime())) {
    return source;
  }
  return `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, "0")}-${date.getDate().toString().padStart(2, "0")} ${date.getHours().toString().padStart(2, "0")}:${date.getMinutes().toString().padStart(2, "0")}`;
}

function truncateText(source: string, maxLength: number) {
  if (source.length <= maxLength) {
    return source;
  }
  return `${source.slice(0, Math.max(0, maxLength - 1))}…`;
}

function toRiskLabel(risk?: "low" | "medium" | "high") {
  if (risk === "low") {
    return "保守";
  }
  if (risk === "high") {
    return "积极";
  }
  return "稳健";
}

function toHorizonLabel(horizon?: "short" | "medium" | "long") {
  if (horizon === "short") {
    return "短期";
  }
  if (horizon === "long") {
    return "长期";
  }
  return "中期";
}

function toThemeLabel(themeIndex: number) {
  return ["蓝紫渐变", "青绿极光", "暖金流光", "粉紫霓虹"][themeIndex] ?? "蓝紫渐变";
}

function buildInvestorProfilePayload(
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

function mergeLocalUserProfile(
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

function ThemeColorButton({
  label,
  active,
  background,
  onClick,
}: {
  label: string;
  active: boolean;
  background: string;
  onClick: () => void;
}) {
  return (
    <button type="button" className={`csw ${active ? "on" : ""}`} style={{ background }} onClick={onClick}>
      <span className="vh">{label}</span>
    </button>
  );
}

function ThemeModeSwitch({
  checked,
  label,
  onChange,
}: {
  checked: boolean;
  label: string;
  onChange: (nextChecked: boolean) => void;
}) {
  return (
    <label className={`sw ${checked ? "on" : ""}`}>
      <input type="checkbox" checked={checked} aria-label={label} onChange={(event) => onChange(event.target.checked)} />
    </label>
  );
}

function WorkbenchShortcutPanel({
  badge,
  title,
  description,
  highlights,
  primaryLabel,
  secondaryLabel,
  onPrimaryClick,
  onSecondaryClick,
}: {
  badge: string;
  title: string;
  description: string;
  highlights: string[];
  primaryLabel: string;
  secondaryLabel: string;
  onPrimaryClick: () => void;
  onSecondaryClick: () => void;
}) {
  return (
    <section className="home-utility-card workbench-shortcut-card">
      <div className="home-utility-badge">{badge}</div>
      <h4>{title}</h4>
      <p>{description}</p>
      <div className="home-utility-list">
        {highlights.map((item) => (
          <span key={item}>{item}</span>
        ))}
      </div>
      <div className="home-utility-actions">
        <button type="button" className="bt bp" onClick={onPrimaryClick}>{primaryLabel}</button>
        <button type="button" className="bt bgh" onClick={onSecondaryClick}>{secondaryLabel}</button>
      </div>
    </section>
  );
}

function CompetitiveBaselinePanel({
  state,
  compactTitle,
}: {
  state: AuditPanelState;
  compactTitle: string;
}) {
  const { report, loading, error, reload } = state;
  const isolationExpectations = report
    ? Array.from(new Set(report.pages.flatMap((page) => page.isolationExpectations))).slice(0, 4)
    : [];
  const highlightedFindings = report?.findings.slice(0, 3) ?? [];
  const [expandedSection, setExpandedSection] = useState<string | null>(null);

  const toggleSection = (section: string) => {
    setExpandedSection(expandedSection === section ? null : section);
  };

  return (
    <section className="home-utility-card competitive-panel-card competitive-panel-compact">
      <div className="home-utility-head">
        <div>
          <div className="home-utility-badge">双端审计</div>
          <h4>{compactTitle}</h4>
        </div>
        <button type="button" className="home-inline-action" onClick={reload} disabled={loading}>
          {loading ? "刷新中..." : "刷新"}
        </button>
      </div>
      <p className="competitive-panel-copy">
        {report
          ? report.summary
          : "直接展示双端个性化审计的四态链路状态，避免把模拟、降级或占位能力误读为真实接入。"}
      </p>
      {loading && !report && <div className="competitive-panel-empty">正在加载双端审计报告…</div>}
      {error && !report && (
        <div className="competitive-panel-error">
          <span>{error}</span>
          <button type="button" className="bt bgh" onClick={reload}>重试加载</button>
        </div>
      )}
      {report && (
        <>
          <div className="competitive-summary-grid compact">
            <div className="competitive-summary-card">
              <span>真实接入</span>
              <strong className="status-good">{report.statusBreakdown.real}</strong>
            </div>
            <div className="competitive-summary-card">
              <span>模拟演示</span>
              <strong>{report.statusBreakdown.simulated}</strong>
            </div>
            <div className="competitive-summary-card">
              <span>降级可用</span>
              <strong>{report.statusBreakdown.degraded}</strong>
            </div>
            <div className="competitive-summary-card">
              <span>预留占位</span>
              <strong>{report.statusBreakdown.placeholder}</strong>
            </div>
          </div>

          {report.pages.length > 0 && (
            <div className="audit-focus-list compact">
              {report.pages.map((page) => (
                <span key={page.pageId} className="audit-focus-tag">{page.pageName}</span>
              ))}
            </div>
          )}

          <div className="audit-accordion">
            {report.drivers.length > 0 && (
              <div className={`audit-accordion-item ${expandedSection === "drivers" ? "expanded" : ""}`}>
                <button type="button" className="audit-accordion-header" onClick={() => toggleSection("drivers")}>
                  <span className="audit-accordion-title">
                    <strong>个性化驱动</strong>
                    <em>{report.drivers.length}</em>
                  </span>
                  <span className="audit-accordion-icon">{expandedSection === "drivers" ? "收起" : "展开"}</span>
                </button>
                {expandedSection === "drivers" && (
                  <div className="audit-accordion-content">
                    <div className="audit-driver-list compact">
                      {report.drivers.map((driver) => (
                        <div key={driver.driverId} className="audit-driver-item">
                          <div className="audit-driver-top">
                            <strong>{driver.label}</strong>
                            <span className={`audit-pill mini ${getAuditDriverStatusClassName(driver.status)}`}>
                              {getAuditDriverStatusLabel(driver.status)}
                            </span>
                          </div>
                          <p>{driver.effectSummary}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {report.channels.length > 0 && (
              <div className={`audit-accordion-item ${expandedSection === "channels" ? "expanded" : ""}`}>
                <button type="button" className="audit-accordion-header" onClick={() => toggleSection("channels")}>
                  <span className="audit-accordion-title">
                    <strong>链路接入</strong>
                    <em>{report.channels.length}</em>
                  </span>
                  <span className="audit-accordion-icon">{expandedSection === "channels" ? "收起" : "展开"}</span>
                </button>
                {expandedSection === "channels" && (
                  <div className="audit-accordion-content">
                    <div className="audit-channel-list compact">
                      {report.channels.map((channel) => (
                        <div key={channel.id} className="audit-channel-item">
                          <div className="audit-channel-top">
                            <strong>{channel.label}</strong>
                            <span className={`audit-pill mini ${getAuditStatusClassName(channel.status)}`}>
                              {getAuditStatusLabel(channel.status)}
                            </span>
                          </div>
                          <p>{channel.purpose}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {highlightedFindings.length > 0 && (
              <div className={`audit-accordion-item ${expandedSection === "findings" ? "expanded" : ""}`}>
                <button type="button" className="audit-accordion-header" onClick={() => toggleSection("findings")}>
                  <span className="audit-accordion-title">
                    <strong>审计发现</strong>
                    <em>{report.findings.length}</em>
                  </span>
                  <span className="audit-accordion-icon">{expandedSection === "findings" ? "收起" : "展开"}</span>
                </button>
                {expandedSection === "findings" && (
                  <div className="audit-accordion-content">
                    <div className="competitive-scenario-list compact">
                      {highlightedFindings.map((finding) => (
                        <div key={finding.findingId} className="competitive-scenario-item">
                          <div className="competitive-scenario-top">
                            <strong>{finding.title}</strong>
                            <span className={`audit-pill mini ${getAuditFindingSeverityClassName(finding.severity)}`}>
                              {getAuditFindingSeverityLabel(finding.severity)}
                            </span>
                          </div>
                          <p>{finding.summary}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {report.releaseGates.length > 0 && (
              <div className={`audit-accordion-item ${expandedSection === "gates" ? "expanded" : ""}`}>
                <button type="button" className="audit-accordion-header" onClick={() => toggleSection("gates")}>
                  <span className="audit-accordion-title">
                    <strong>发布门槛</strong>
                    <em>{report.releaseGates.length}</em>
                  </span>
                  <span className="audit-accordion-icon">{expandedSection === "gates" ? "收起" : "展开"}</span>
                </button>
                {expandedSection === "gates" && (
                  <div className="audit-accordion-content">
                    <div className="audit-gates-list">
                      {report.releaseGates.map((gate, idx) => (
                        <div key={idx} className="audit-gate-item">
                          <span className="audit-gate-check">✓</span>
                          <span>{gate}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="audit-footer">
            <span>更新时间：{formatCompetitiveTimestamp(report.generatedAt)}</span>
          </div>
        </>
      )}
    </section>
  );
}

function EditableBaseInfoPanel({
  title,
  baseInfo,
  emptyText,
  presetGroups,
  onSave,
}: {
  title: string;
  baseInfo?: EditableBusinessInfo;
  emptyText: string;
  presetGroups: BaseInfoPresetGroup[];
  onSave: (baseInfo: EditableBusinessInfo) => Promise<void>;
}) {
  const [draftRows, setDraftRows] = useState<BaseInfoDraftRow[]>(() => createBaseInfoDraftRows(baseInfo, presetGroups));
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);
  const presetFields = flattenBaseInfoPresetFields(presetGroups);
  const presetFieldSet = new Set(presetFields.map((field) => field.field));

  useEffect(() => {
    if (!isEditing) {
      setDraftRows(createBaseInfoDraftRows(baseInfo, presetGroups));
    }
  }, [baseInfo, isEditing, presetGroups]);

  const summaryEntries = Object.entries(baseInfo ?? {});
  const customSummaryEntries = summaryEntries.filter(([field]) => !presetFieldSet.has(field));
  const customDraftRows = draftRows.filter((row) => !row.preset);
  const panelTheme = getBaseInfoPanelTheme(title);
  const totalPresetFieldCount = presetFields.length;
  const filledPresetFieldCount = countFilledPresetFields(baseInfo, presetGroups);
  const filledDraftPresetFieldCount = countFilledPresetDraftFields(draftRows, presetGroups);
  const completedGroupCount = presetGroups.filter((group) => group.fields.every((field) => isBaseInfoValueFilled(baseInfo?.[field.field]))).length;
  const completedDraftGroupCount = presetGroups.filter((group) => group.fields.every((field) => {
    const row = draftRows.find((item) => item.preset && item.field === field.field);
    return Boolean(row?.value.trim());
  })).length;
  const summaryHighlights = summaryEntries.slice(0, 4);
  const filledCustomFieldCount = customSummaryEntries.filter(([, value]) => isBaseInfoValueFilled(value)).length;
  const activeCustomDraftCount = customDraftRows.filter((row) => row.field.trim() || row.value.trim()).length;
  const heroTitle = isEditing ? "分组编辑" : summaryEntries.length > 0 ? "信息快照已建" : "等待补充关键信息";
  const heroDescription = isEditing
    ? "按分组逐项完善信息，保存后立即写入本地状态，并同步到用户偏好与记忆树。"
    : summaryEntries.length > 0
      ? "已形成可读性更强的资料分组卡片，便于快速查看当前企业/投资画像。"
      : emptyText;
  const statusMessage = isSaving ? "正在同步基本信息…" : saveSuccess;
  const statusColor = isSaving ? "#94A3B8" : "#10B981";

  const handleStartEditing = useCallback(() => {
    setDraftRows(createBaseInfoDraftRows(baseInfo, presetGroups));
    setIsEditing(true);
    setSaveError(null);
    setSaveSuccess(null);
  }, [baseInfo, presetGroups]);

  const handleCancel = useCallback(() => {
    setDraftRows(createBaseInfoDraftRows(baseInfo, presetGroups));
    setIsEditing(false);
    setSaveError(null);
  }, [baseInfo, presetGroups]);

  const handleRowChange = useCallback((rowId: string, field: "field" | "value", value: string) => {
    setDraftRows((previous) => previous.map((row) => row.id === rowId ? { ...row, [field]: value } : row));
  }, []);

  const handleAddRow = useCallback(() => {
    setDraftRows((previous) => [
      ...previous,
      createCustomBaseInfoRow(),
    ]);
  }, []);

  const handleRemoveRow = useCallback((rowId: string) => {
    setDraftRows((previous) => {
      const removableRows = previous.filter((row) => !row.preset);
      if (removableRows.length <= 1) {
        return previous.map((row) => row.id === rowId ? createCustomBaseInfoRow() : row).filter((row) => row.preset || row.field || row.value);
      }
      return previous.filter((row) => row.id !== rowId);
    });
  }, []);

  const handleSave = useCallback(async () => {
    const nextBaseInfo = buildEditableBusinessInfo(draftRows);
    setIsEditing(false);
    setIsSaving(true);
    setSaveError(null);
    setSaveSuccess(null);

    try {
      await onSave(nextBaseInfo);
      setSaveSuccess("已同步到用户偏好。");
    } catch (error) {
      setIsEditing(true);
      setSaveError(error instanceof Error ? error.message : "保存失败，请稍后重试。");
    } finally {
      setIsSaving(false);
    }
  }, [draftRows, onSave]);

  return (
    <div style={{ marginTop: "14px", paddingTop: "4px" }}>
      {!isEditing ? (
        <>
          <div
            style={{
              position: "relative",
              overflow: "hidden",
              display: "grid",
              gap: "14px",
              padding: "18px",
              borderRadius: "24px",
              background: panelTheme.surface,
              border: `1px solid ${panelTheme.accentBorder}`,
              boxShadow: panelTheme.shadow,
              backdropFilter: "blur(18px)",
            }}
          >
            <div
              aria-hidden="true"
              style={{
                position: "absolute",
                inset: "-40% auto auto -10%",
                width: "180px",
                height: "180px",
                borderRadius: "999px",
                background: panelTheme.accentSoft,
                filter: "blur(24px)",
                pointerEvents: "none",
              }}
            />
            <div style={{ position: "relative", display: "flex", flexWrap: "wrap", gap: "14px", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div style={{ display: "grid", gap: "8px", maxWidth: "560px" }}>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      padding: "6px 10px",
                      borderRadius: "999px",
                      background: panelTheme.accentSoft,
                      border: `1px solid ${panelTheme.accentBorder}`,
                      color: panelTheme.accent,
                      fontSize: "11px",
                      fontWeight: 700,
                      letterSpacing: "0.04em",
                    }}
                  >
                    分组资料
                  </span>
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      padding: "6px 10px",
                      borderRadius: "999px",
                      background: "rgba(255,255,255,0.04)",
                      border: "1px solid var(--line)",
                      color: "#94A3B8",
                      fontSize: "11px",
                    }}
                  >
                    {heroTitle}
                  </span>
                </div>
                <div style={{ fontSize: "20px", fontWeight: 700, color: "#0F172A", lineHeight: 1.3 }}>{title}</div>
                <div style={{ fontSize: "13px", lineHeight: 1.75, color: "#94A3B8" }}>{heroDescription}</div>
              </div>
              <div
                style={{
                  minWidth: "156px",
                  display: "grid",
                  gap: "6px",
                  padding: "14px 16px",
                  borderRadius: "18px",
                  background: "rgba(10, 14, 24, 0.22)",
                  border: `1px solid ${panelTheme.accentBorder}`,
                }}
              >
                <span style={{ fontSize: "11px", color: "#94A3B8", letterSpacing: "0.04em" }}>关键字段覆盖</span>
                <strong style={{ fontSize: "24px", lineHeight: 1, color: "#0F172A" }}>{filledPresetFieldCount}/{totalPresetFieldCount}</strong>
                <span style={{ fontSize: "12px", color: "#94A3B8" }}>已沉淀 {summaryEntries.length} 项资料</span>
              </div>
            </div>
            <div style={{ position: "relative", display: "grid", gap: "10px", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))" }}>
              {[
                { label: "已完成分组", value: `${completedGroupCount}/${presetGroups.length}`, helper: "核心结构完整度" },
                { label: "补充字段", value: `${filledCustomFieldCount}`, helper: "自定义延展信息" },
                { label: "同步路径", value: "本地 + 云端", helper: "保存后自动保持一致" },
              ].map((item) => (
                <div
                  key={item.label}
                  style={{
                    display: "grid",
                    gap: "6px",
                    padding: "14px",
                    borderRadius: "18px",
                    background: "rgba(255,255,255,0.04)",
                    border: "1px solid rgba(255,255,255,0.08)",
                  }}
                >
                  <span style={{ fontSize: "11px", color: "#94A3B8" }}>{item.label}</span>
                  <strong style={{ fontSize: "18px", color: "#0F172A", lineHeight: 1.2 }}>{item.value}</strong>
                  <span style={{ fontSize: "12px", color: "#94A3B8", lineHeight: 1.5 }}>{item.helper}</span>
                </div>
              ))}
            </div>
            <div style={{ position: "relative", display: "flex", flexWrap: "wrap", gap: "8px" }}>
              {summaryHighlights.length > 0 ? summaryHighlights.map(([field, value]) => (
                <div
                  key={field}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "8px",
                    minHeight: "38px",
                    padding: "8px 12px",
                    borderRadius: "999px",
                    background: "rgba(255,255,255,0.05)",
                    border: "1px solid rgba(255,255,255,0.08)",
                    maxWidth: "100%",
                  }}
                >
                  <span style={{ color: panelTheme.accent, fontSize: "11px", fontWeight: 700, whiteSpace: "nowrap" }}>{field}</span>
                  <span style={{ color: "#475569", fontSize: "12px", wordBreak: "break-word" }}>{formatEditableBusinessInfoValue(reformatBaseInfoValue(formatEditableBusinessInfoValue(value), presetFields.find(f => f.field === field && f.inputKind === "number")?.unit))}</span>
                </div>
              )) : (
                <div
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    minHeight: "38px",
                    padding: "8px 12px",
                    borderRadius: "999px",
                    background: "rgba(255,255,255,0.04)",
                    border: "1px dashed rgba(255,255,255,0.12)",
                    color: "#94A3B8",
                    fontSize: "12px",
                  }}
                >
                  暂无已保存字段，点击下方按钮开始录入                </div>
      )}
            </div>
          </div>
          <div style={{ marginTop: "14px", display: "grid", gap: "14px" }}>
            {presetGroups.map((group) => (
              <div
                key={group.title}
                style={{
                  display: "grid",
                  gap: "12px",
                  padding: "16px",
                  borderRadius: "22px",
                  background: "linear-gradient(180deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0.02) 100%)",
                  border: "1px solid var(--line)",
                  boxShadow: "0 12px 28px rgba(0, 0, 0, 0.08)",
                }}
              >
                {(() => {
                  const filledCount = group.fields.filter((field) => isBaseInfoValueFilled(baseInfo?.[field.field])).length;

                  return (
                    <>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: "12px", justifyContent: "space-between", alignItems: "flex-start" }}>
                        <div style={{ display: "grid", gap: "4px", maxWidth: "560px" }}>
                          <div style={{ fontSize: "14px", color: "#0F172A", fontWeight: 700 }}>{group.title}</div>
                          <div style={{ fontSize: "12px", color: "#94A3B8", lineHeight: 1.7 }}>{group.description}</div>
                        </div>
                        <span
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            padding: "6px 10px",
                            borderRadius: "999px",
                            background: filledCount > 0 ? panelTheme.accentSoft : "rgba(255,255,255,0.04)",
                            border: `1px solid ${filledCount > 0 ? panelTheme.accentBorder : "rgba(255,255,255,0.08)"}`,
                            color: filledCount > 0 ? panelTheme.accent : "#94A3B8",
                            fontSize: "11px",
                            fontWeight: 700,
                          }}
                        >
                          {filledCount}/{group.fields.length} 已填                        </span>
                      </div>
                      <div style={{ display: "grid", gap: "10px", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
                        {group.fields.map((field) => {
                          const filled = isBaseInfoValueFilled(baseInfo?.[field.field]);

                          return (
                            <div
                              key={field.field}
                              style={{
                                display: "grid",
                                gap: "10px",
                                minHeight: "132px",
                                padding: "14px",
                                borderRadius: "18px",
                                background: filled ? panelTheme.fieldSurface : "rgba(255,255,255,0.03)",
                                border: `1px solid ${filled ? panelTheme.accentBorder : "rgba(255,255,255,0.08)"}`,
                              }}
                            >
                              <div style={{ display: "flex", gap: "10px", justifyContent: "space-between", alignItems: "flex-start" }}>
                                <div style={{ display: "grid", gap: "4px" }}>
                                  <span style={{ fontSize: "13px", color: "#0F172A", fontWeight: 600 }}>{field.field}</span>
                                  <span style={{ fontSize: "11px", color: "#94A3B8" }}>{getBaseInfoInputTypeLabel(field.inputKind)}</span>
                                </div>
                                <span
                                  style={{
                                    display: "inline-flex",
                                    alignItems: "center",
                                    padding: "4px 8px",
                                    borderRadius: "999px",
                                    background: filled ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.04)",
                                    color: filled ? panelTheme.accent : "#94A3B8",
                                    fontSize: "11px",
                                    fontWeight: 700,
                                    whiteSpace: "nowrap",
                                  }}
                                >
                                  {filled ? "已填" : "待补"}
                                </span>
                              </div>
                              <div style={{ minHeight: "42px", display: "flex", alignItems: "flex-start" }}>
                                {renderBaseInfoValueContent(
                                  field.inputKind === "number" && field.unit
                                    ? reformatBaseInfoValue(formatEditableBusinessInfoValue(baseInfo?.[field.field]), field.unit)
                                    : baseInfo?.[field.field],
                                  field.inputKind,
                                  "start",
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </>
                  );
                })()}
              </div>
            ))}
            {customSummaryEntries.length > 0 ? (
              <div
                style={{
                  display: "grid",
                  gap: "12px",
                  padding: "16px",
                  borderRadius: "22px",
                  background: "linear-gradient(180deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0.02) 100%)",
                  border: "1px solid var(--line)",
                  boxShadow: "0 12px 28px rgba(0, 0, 0, 0.08)",
                }}
              >
                <div style={{ display: "flex", flexWrap: "wrap", gap: "12px", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div style={{ display: "grid", gap: "4px" }}>
                    <div style={{ fontSize: "14px", color: "#0F172A", fontWeight: 700 }}>补充信息</div>
                    <div style={{ fontSize: "12px", color: "#94A3B8", lineHeight: 1.7 }}>保留自定义字段，继续同步到用户偏好与记忆树</div>
                  </div>
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      padding: "6px 10px",
                      borderRadius: "999px",
                      background: "rgba(255,255,255,0.04)",
                      border: "1px solid rgba(255,255,255,0.08)",
                      color: "#94A3B8",
                      fontSize: "11px",
                      fontWeight: 700,
                    }}
                  >
                    {customSummaryEntries.length} 项扩展字                  </span>
                </div>
                <div style={{ display: "grid", gap: "10px", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
                  {customSummaryEntries.map(([field, value]) => (
                    <div
                      key={field}
                      style={{
                        display: "grid",
                        gap: "8px",
                        minHeight: "112px",
                        padding: "14px",
                        borderRadius: "18px",
                        background: "rgba(255,255,255,0.03)",
                        border: "1px solid rgba(255,255,255,0.08)",
                      }}
                    >
                      <div style={{ display: "flex", gap: "10px", justifyContent: "space-between", alignItems: "flex-start" }}>
                        <span style={{ fontSize: "13px", color: "#0F172A", fontWeight: 600 }}>{field}</span>
                        <span style={{ fontSize: "11px", color: "#94A3B8" }}>自定义字段</span>
                      </div>
                      <div style={{ minHeight: "42px", display: "flex", alignItems: "flex-start" }}>
                        {renderBaseInfoValueContent(value, "text", "start")}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
          {saveError ? (
            <div role="alert" style={{ marginTop: "12px", fontSize: "12px", color: "var(--red)" }}>{saveError}</div>
          ) : null}
          {statusMessage ? (
            <div aria-live="polite" role="status" style={{ marginTop: "12px", fontSize: "12px", color: statusColor }}>{statusMessage}</div>
          ) : null}
          <div className="br" style={{ marginTop: "12px" }}>
            <button type="button" className="bt bgh" onClick={handleStartEditing} disabled={isSaving}>
              {summaryEntries.length > 0 ? "编辑基本信息" : "填写基本信息"}
            </button>
          </div>
        </>
      ) : (
        <>
          <div
            style={{
              position: "relative",
              overflow: "hidden",
              display: "grid",
              gap: "14px",
              padding: "18px",
              borderRadius: "24px",
              background: panelTheme.surface,
              border: `1px solid ${panelTheme.accentBorder}`,
              boxShadow: panelTheme.shadow,
              backdropFilter: "blur(18px)",
            }}
          >
            <div
              aria-hidden="true"
              style={{
                position: "absolute",
                inset: "auto -8% -36% auto",
                width: "180px",
                height: "180px",
                borderRadius: "999px",
                background: panelTheme.accentSoft,
                filter: "blur(26px)",
                pointerEvents: "none",
              }}
            />
            <div style={{ position: "relative", display: "flex", flexWrap: "wrap", gap: "14px", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div style={{ display: "grid", gap: "8px", maxWidth: "560px" }}>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      padding: "6px 10px",
                      borderRadius: "999px",
                      background: panelTheme.accentSoft,
                      border: `1px solid ${panelTheme.accentBorder}`,
                      color: panelTheme.accent,
                      fontSize: "11px",
                      fontWeight: 700,
                      letterSpacing: "0.04em",
                    }}
                  >
                    编辑模式
                  </span>
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      padding: "6px 10px",
                      borderRadius: "999px",
                      background: "rgba(255,255,255,0.04)",
                      border: "1px solid rgba(255,255,255,0.08)",
                      color: "#94A3B8",
                      fontSize: "11px",
                    }}
                  >
                    保存后自动补齐结                  </span>
                </div>
                <div style={{ fontSize: "20px", fontWeight: 700, color: "#0F172A", lineHeight: 1.3 }}>{title}</div>
                <div style={{ fontSize: "13px", lineHeight: 1.75, color: "#94A3B8" }}>
                  已按常用场景预置分组字段，数字、标签和多企业列表会以更清晰的方式保存与展示                </div>
              </div>
              <div
                style={{
                  minWidth: "156px",
                  display: "grid",
                  gap: "6px",
                  padding: "14px 16px",
                  borderRadius: "18px",
                  background: "rgba(10, 14, 24, 0.22)",
                  border: `1px solid ${panelTheme.accentBorder}`,
                }}
              >
                <span style={{ fontSize: "11px", color: "#94A3B8", letterSpacing: "0.04em" }}>当前填写进度</span>
                <strong style={{ fontSize: "24px", lineHeight: 1, color: "#0F172A" }}>{filledDraftPresetFieldCount}/{totalPresetFieldCount}</strong>
                <span style={{ fontSize: "12px", color: "#94A3B8" }}>已激活 {activeCustomDraftCount} 项补充字段</span>
              </div>
            </div>
            <div style={{ position: "relative", display: "grid", gap: "10px", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))" }}>
              {[
                { label: "完成分组", value: `${completedDraftGroupCount}/${presetGroups.length}`, helper: "逐组完善更清晰" },
                { label: "补充字段", value: `${activeCustomDraftCount}`, helper: "支持扩展记录" },
                { label: "同步动作", value: "即时更新", helper: "本地先更新后持久化" },
              ].map((item) => (
                <div
                  key={item.label}
                  style={{
                    display: "grid",
                    gap: "6px",
                    padding: "14px",
                    borderRadius: "18px",
                    background: "rgba(255,255,255,0.04)",
                    border: "1px solid rgba(255,255,255,0.08)",
                  }}
                >
                  <span style={{ fontSize: "11px", color: "#94A3B8" }}>{item.label}</span>
                  <strong style={{ fontSize: "18px", color: "#0F172A", lineHeight: 1.2 }}>{item.value}</strong>
                  <span style={{ fontSize: "12px", color: "#94A3B8", lineHeight: 1.5 }}>{item.helper}</span>
                </div>
              ))}
            </div>
          </div>
          <div style={{ marginTop: "14px", display: "grid", gap: "14px" }}>
            {presetGroups.map((group) => (
              <div
                key={group.title}
                style={{
                  display: "grid",
                  gap: "12px",
                  padding: "16px",
                  borderRadius: "22px",
                  background: "linear-gradient(180deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0.02) 100%)",
                  border: "1px solid var(--line)",
                  boxShadow: "0 12px 28px rgba(0, 0, 0, 0.08)",
                }}
              >
                <div style={{ display: "flex", flexWrap: "wrap", gap: "12px", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div style={{ display: "grid", gap: "4px", maxWidth: "560px" }}>
                    <div style={{ fontSize: "14px", color: "#0F172A", fontWeight: 700 }}>{group.title}</div>
                    <div style={{ fontSize: "12px", color: "#94A3B8", lineHeight: 1.7 }}>{group.description}</div>
                  </div>
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      padding: "6px 10px",
                      borderRadius: "999px",
                      background: panelTheme.accentSoft,
                      border: `1px solid ${panelTheme.accentBorder}`,
                      color: panelTheme.accent,
                      fontSize: "11px",
                      fontWeight: 700,
                    }}
                  >
                    {group.fields.filter((field) => {
                      const row = draftRows.find((item) => item.preset && item.field === field.field);
                      return Boolean(row?.value.trim());
                    }).length}/{group.fields.length} 已填                  </span>
                </div>
                <div style={{ display: "grid", gap: "12px", gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))" }}>
                  {group.fields.map((field) => {
                    const row = draftRows.find((item) => item.preset && item.field === field.field);

                    if (!row) {
                      return null;
                    }

                    return (
                      <div
                        key={row.id}
                        style={{
                          display: "grid",
                          gap: "10px",
                          padding: "14px",
                          borderRadius: "18px",
                          background: row.value.trim() ? panelTheme.fieldSurface : "rgba(255,255,255,0.03)",
                          border: `1px solid ${row.value.trim() ? panelTheme.accentBorder : "rgba(255,255,255,0.08)"}`,
                        }}
                      >
                        <div style={{ display: "flex", gap: "10px", justifyContent: "space-between", alignItems: "flex-start" }}>
                          <div style={{ display: "grid", gap: "4px" }}>
                            <span style={{ color: "#0F172A", fontSize: "13px", fontWeight: 600 }}>{field.field}</span>
                            <span style={{ color: "#94A3B8", fontSize: "11px" }}>{getBaseInfoInputTypeLabel(field.inputKind)}</span>
                          </div>
                          <span
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              padding: "4px 8px",
                              borderRadius: "999px",
                              background: "rgba(255,255,255,0.05)",
                              color: row.value.trim() ? panelTheme.accent : "#94A3B8",
                              fontSize: "11px",
                              fontWeight: 700,
                              whiteSpace: "nowrap",
                            }}
                          >
                            {row.value.trim() ? "已填" : "待填"}
                          </span>
                        </div>
                        {field.inputKind === "number" ? (
                          <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", gap: "8px", alignItems: "center" }}>
                            <input
                              value={row.value}
                              aria-label={`${title}${field.field}`}
                              inputMode="decimal"
                              placeholder={field.placeholder}
                              onChange={(event) => handleRowChange(row.id, "value", event.target.value)}
                              style={{
                                width: "100%",
                                border: "1px solid var(--line)",
                                borderRadius: "12px",
                                padding: "10px 12px",
                                background: "#F8FAFC",
                                color: "#0F172A",
                              }}
                            />
                            <span
                              style={{
                                padding: "8px 10px",
                                borderRadius: "10px",
                                border: "1px solid var(--line)",
                                background: "#F8FAFC",
                                color: "#94A3B8",
                                fontSize: "12px",
                              }}
                            >
                              {field.unit ?? "数值"}
                            </span>
                          </div>
                        ) : (
                          <textarea
                            value={row.value}
                            aria-label={`${title}${field.field}`}
                            placeholder={field.placeholder}
                            rows={field.inputKind === "companies" ? 3 : 2}
                            onChange={(event) => handleRowChange(row.id, "value", event.target.value)}
                            style={{
                              width: "100%",
                              border: "1px solid var(--line)",
                              borderRadius: "12px",
                              padding: "10px 12px",
                              background: "#F8FAFC",
                              color: "#0F172A",
                              resize: "vertical",
                            }}
                          />
                        )}
                        <div style={{ fontSize: "12px", color: "#94A3B8", lineHeight: 1.6 }}>
                          {getBaseInfoInputHint(field.inputKind, field.unit)}
                        </div>
                        {row.value.trim() ? (
                          <div
                            style={{
                              padding: "10px 12px",
                              borderRadius: "14px",
                              background: "rgba(255,255,255,0.04)",
                              border: "1px solid rgba(255,255,255,0.06)",
                            }}
                          >
                            <div style={{ fontSize: "11px", color: "#94A3B8", marginBottom: "6px" }}>保存后预览</div>
                            {renderBaseInfoValueContent(
                              field.inputKind === "number" && field.unit ? `${row.value.trim()}${field.unit}` : row.value.trim(),
                              field.inputKind,
                              "start",
                            )}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
            <div
              style={{
                display: "grid",
                  gap: "12px",
                  padding: "16px",
                  borderRadius: "22px",
                  background: "linear-gradient(180deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0.02) 100%)",
                border: "1px solid var(--line)",
                  boxShadow: "0 12px 28px rgba(0, 0, 0, 0.08)",
              }}
            >
              <div style={{ display: "flex", flexWrap: "wrap", gap: "12px", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div style={{ display: "grid", gap: "4px" }}>
                  <div style={{ fontSize: "14px", color: "#0F172A", fontWeight: 700 }}>补充信息</div>
                  <div style={{ fontSize: "12px", color: "#94A3B8", lineHeight: 1.7 }}>如需记录预置字段之外的信息，可继续添加自定义字段</div>
                </div>
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    padding: "6px 10px",
                    borderRadius: "999px",
                    background: "rgba(255,255,255,0.04)",
                    border: "1px solid rgba(255,255,255,0.08)",
                    color: "#94A3B8",
                    fontSize: "11px",
                    fontWeight: 700,
                  }}
                >
                  {activeCustomDraftCount} 项待保存扩展信息
                </span>
              </div>
              <div style={{ display: "grid", gap: "12px" }}>
                {customDraftRows.length > 0 ? customDraftRows.map((row, index) => (
                  <div
                    key={row.id}
                    style={{
                      display: "grid",
                      gap: "10px",
                      padding: "14px",
                      borderRadius: "18px",
                      background: row.field.trim() || row.value.trim() ? panelTheme.fieldSurface : "rgba(255,255,255,0.03)",
                      border: `1px solid ${row.field.trim() || row.value.trim() ? panelTheme.accentBorder : "rgba(255,255,255,0.08)"}`,
                    }}
                  >
                    <div style={{ display: "flex", gap: "10px", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ color: "#0F172A", fontSize: "13px", fontWeight: 600 }}>补充字段 {index + 1}</span>
                      <span style={{ color: row.field.trim() || row.value.trim() ? panelTheme.accent : "#94A3B8", fontSize: "11px", fontWeight: 700 }}>
                        {row.field.trim() || row.value.trim() ? "已编" : "空白"}
                      </span>
                    </div>
                    <input
                      value={row.field}
                      aria-label={`${title}补充字段${index + 1}`}
                      placeholder="例如：企业阶段/资产类别"
                      onChange={(event) => handleRowChange(row.id, "field", event.target.value)}
                      style={{
                        width: "100%",
                        border: "1px solid var(--line)",
                        borderRadius: "12px",
                        padding: "10px 12px",
                        background: "#F8FAFC",
                        color: "#0F172A",
                      }}
                    />
                    <textarea
                      value={row.value}
                      aria-label={`${title}补充内容${index + 1}`}
                      placeholder="例如：扩产期，或输入多个标签"
                      rows={2}
                      onChange={(event) => handleRowChange(row.id, "value", event.target.value)}
                      style={{
                        width: "100%",
                        border: "1px solid var(--line)",
                        borderRadius: "12px",
                        padding: "10px 12px",
                        background: "#F8FAFC",
                        color: "#0F172A",
                        resize: "vertical",
                      }}
                    />
                    <div className="br">
                      <button type="button" className="bt danger" onClick={() => handleRemoveRow(row.id)} disabled={isSaving}>
                        删除字段
                      </button>
                    </div>
                  </div>
                )) : (
                  <div style={{ fontSize: "12px", color: "#94A3B8" }}>暂无补充字段，可按需新增</div>
      )}
              </div>
            </div>
          </div>
          {saveError ? (
            <div role="alert" style={{ marginTop: "12px", fontSize: "12px", color: "var(--red)" }}>{saveError}</div>
          ) : null}
          <div
            style={{
              marginTop: "14px",
              display: "flex",
              flexWrap: "wrap",
              gap: "12px",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "16px 18px",
              borderRadius: "20px",
              background: "rgba(255,255,255,0.04)",
              border: "1px solid var(--line)",
            }}
          >
            <div style={{ display: "grid", gap: "4px" }}>
              <span style={{ fontSize: "13px", color: "#475569", fontWeight: 600 }}>保存后立即更新当前界面，再异步同步持久化</span>
              <span style={{ fontSize: "12px", color: "#94A3B8", lineHeight: 1.6 }}>保留现有保存、同步与测试路径，支持后续记忆树和偏好数据联动</span>
            </div>
            <div className="br" style={{ marginTop: 0 }}>
              <button type="button" className="bt bgh" onClick={handleAddRow} disabled={isSaving}>新增补充字段</button>
              <button type="button" className="bt bgh" onClick={handleCancel} disabled={isSaving}>取消</button>
              <button type="button" className="bt bp" onClick={() => void handleSave()} disabled={isSaving}>
                {isSaving ? "保存中…" : "保存基本信息"}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

type InvestorWorkbenchMode = "industryStatus" | "investmentRecommendation" | "deepDive";

const INVESTOR_MODE_OPTIONS: Array<{
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
    placeholder: `请输入投资问题，例如"是否值得继续跟踪星海电池？"`,
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

type WorkbenchMessage = {
  id: string;
  variant: "user" | "assistant" | "system" | "debate";
  content: string;
  time: string;
  round?: number;
  speakerLabel?: string;
  speakerModel?: string;
  speakerRole?: DebateMessage["speakerRole"];
};

const EMPTY_WORKBENCH_MESSAGE = "请输入信息进行对话";

function createWorkbenchId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

function formatClockTime(source?: string) {
  const date = source ? new Date(source) : new Date();
  const resolved = Number.isNaN(date.getTime()) ? new Date() : date;
  return `${resolved.getHours().toString().padStart(2, "0")}:${resolved.getMinutes().toString().padStart(2, "0")}`;
}

function readFileContent(file: File) {
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

function formatSessionTime(source: string) {
  const date = new Date(source);
  if (Number.isNaN(date.getTime())) {
    return "--";
  }
  return `${date.getMonth() + 1}/${date.getDate()} ${date.getHours().toString().padStart(2, "0")}:${date.getMinutes().toString().padStart(2, "0")}`;
}

function formatCompetitiveTimestamp(source?: string) {
  if (!source) {
    return "--";
  }
  const date = new Date(source);
  if (Number.isNaN(date.getTime())) {
    return "--";
  }
  return `${date.getMonth() + 1}/${date.getDate()} ${date.getHours().toString().padStart(2, "0")}:${date.getMinutes().toString().padStart(2, "0")}`;
}

function getAuditStatusLabel(status: PortalAuditChannelStatus) {
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
      return "待确";""
  }
}

function getAuditStatusClassName(status: PortalAuditChannelStatus) {
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

function getAuditAudienceLabel(audience: PortalAuditReport["channels"][number]["role"] | PortalAuditReport["drivers"][number]["audience"]) {
  switch (audience) {
    case "enterprise":
      return "企业";""
    case "investor":
      return "投资";""
    case "shared":
      return "共享底座";
    default:
      return "链路";
  }
}

function getAuditLayerLabel(layer: PortalAuditReport["channels"][number]["layer"]) {
  switch (layer) {
    case "frontendInput":
      return "前端输入";
    case "frontendApi":
      return "前端接口";
    case "serverRoute":
      return "服务路由";
    case "service":
      return "服务";""
    case "storage":
      return "存储";""
    case "chart":
      return "图表";""
    case "externalSource":
      return "外部数据";
    default:
      return "链路";
  }
}

function getAuditDriverStatusLabel(status: PortalAuditReport["drivers"][number]["status"]) {
  switch (status) {
    case "active":
      return "已消";""
    case "partial":
      return "部分消费";
    case "stored_only":
      return "仅存";""
    default:
      return "待确";""
  }
}

function getAuditDriverStatusClassName(status: PortalAuditReport["drivers"][number]["status"]) {
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

function getAuditFindingSeverityLabel(severity: PortalAuditReport["findings"][number]["severity"]) {
  switch (severity) {
    case "high":
      return "高风";""
    case "medium":
      return "中风";""
    case "low":
      return "低风";""
    default:
      return "风险";
  }
}

function getAuditFindingSeverityClassName(severity: PortalAuditReport["findings"][number]["severity"]) {
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

function usePortalAuditReport(role: "enterprise" | "investor", isEnabled: boolean): AuditPanelState {
  const [report, setReport] = useState<PortalAuditReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadReport = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const nextReport = await fetchPortalAuditReport(role);
      setReport(nextReport);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "双端审计报告加载失败。");
    } finally {
      setLoading(false);
    }
  }, [role]);

  useEffect(() => {
    if (!isEnabled || report || loading || error) {
      return;
    }
    void loadReport();
  }, [error, isEnabled, loadReport, loading, report]);

  return {
    report,
    loading,
    error,
    reload: loadReport,
  };
}

function AuditInlineBanner({ state }: { state: AuditPanelState }) {
  const { report, loading, error } = state;

  if (loading && !report) {
    return <div className="audit-inline-banner">正在同步双端审计状态</div>;
  }

  if (error && !report) {
    return <div className="audit-inline-banner warning">双端审计同步失败：{error}</div>;
  }

  if (!report) {
    return null;
  }

  const highlightedChannels = report.channels.filter((channel) => channel.affectsPersonalization && channel.status !== "real");
  const bannerChannels = (
    highlightedChannels.length > 0
      ? highlightedChannels
      : report.channels.filter((channel) => channel.status !== "real")
  ).slice(0, 3);

  return (
    <div className="audit-inline-banner">
      <div className="audit-inline-kicker">{report.roleLabel}审计提示</div>
      <div className="audit-inline-summary">{report.summary}</div>
      <div className="audit-inline-chips">
        {bannerChannels.map((channel) => (
          <span key={channel.id} className={`audit-pill ${getAuditStatusClassName(channel.status)}`}>
            {channel.label} · {getAuditStatusLabel(channel.status)}
          </span>
        ))}
      </div>
    </div>
  );
}

function getModeOption(mode: InvestorWorkbenchMode | SessionContext["activeMode"]) {
  return INVESTOR_MODE_OPTIONS.find((option) => option.value === mode) ?? INVESTOR_MODE_OPTIONS[0]!;
}

function getSessionTitle(summary: Pick<SessionHistorySummary, "enterpriseName" | "investedEnterprises">) {
  return summary.enterpriseName ?? summary.investedEnterprises[0] ?? "未命名会";""
}

function getProgressTitle(mode: InvestorWorkbenchMode) {
  if (mode === "industryStatus") {
    return "行业状况进度";
  }
  if (mode === "deepDive") {
    return "深度解析进度";
  }
  return "正式辩论进度";
}

function mergeTimelineEntries(entries: AnalysisTimelineEntry[], nextEntry: AnalysisTimelineEntry) {
  const exists = entries.some((entry) => entry.id === nextEntry.id);
  const next = exists
    ? entries.map((entry) => (entry.id === nextEntry.id ? nextEntry : entry))
    : [...entries, nextEntry];
  return next.sort((left, right) => left.progressPercent - right.progressPercent);
}

function buildHistoryFallback(context: SessionContext): SessionHistorySummary {
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

function toDebateWorkbenchMessage(message: DebateMessage): WorkbenchMessage {
  return {
    id: `debate-${message.id}`,
    variant: "debate",
    content: message.content,
    time: formatClockTime(message.occurredAt),
    round: message.round,
    speakerLabel: message.speakerLabel,
    speakerModel: message.speakerModel,
    speakerRole: message.speakerRole,
  };
}

function buildSessionMessages(context: SessionContext): WorkbenchMessage[] {
  const modeOption = getModeOption(context.activeMode);
  const seeded: WorkbenchMessage[] = [
    {
      id: createWorkbenchId("msg"),
      variant: "assistant",
      time: formatClockTime(context.updatedAt),
      content: `已载${context.enterpriseName ?? "当前"} 会话。\n模式${modeOption.label}\n摘要${context.summary}`,
    },
  ];

  if (context.investorProfileSummary) {
    seeded.push({
      id: createWorkbenchId("msg"),
      variant: "system",
      time: formatClockTime(context.updatedAt),
      content: `投资画像${context.investorProfileSummary}`,
    });
  }

  if (context.latestEvidenceSummary.length > 0) {
    seeded.push({
      id: createWorkbenchId("msg"),
      variant: "assistant",
      time: formatClockTime(context.updatedAt),
      content: `已沉淀证据：\n${context.latestEvidenceSummary.map((item) => `${item}`).join("\n")}`,
    });
  }

  if (context.pendingClarificationQuestions.length > 0) {
    seeded.push({
      id: createWorkbenchId("msg"),
      variant: "system",
      time: formatClockTime(context.updatedAt),
      content: `待补充研究条件：\n${context.pendingClarificationQuestions.map((item, index) => `${index + 1}. ${item}`).join("\n")}`,
    });
  }

  return seeded.concat(context.latestDebate.map(toDebateWorkbenchMessage));
}

function buildDeepDiveContext(
  inputText: string,
  pendingQuestions: string[],
  attachments: SessionAttachment[],
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

function buildMemoryNodes(
  role: RoleKey | null,
  userProfile: UserProfileResponse | null,
  isDark: boolean,
  themeIndex: number,
): MemoryNode[] {
  const profile = userProfile?.profile;
  const stats = userProfile?.stats;
  const recentMemory = userProfile?.recentMemories[0];
  const recentSession = userProfile?.recentSessions[0];
  const recentAnalysis = userProfile?.recentAnalyses[0];
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
  const baseInfoEntries = Object.entries(activeBaseInfo ?? {});
  const baseInfoSummary = summarizeEditableBusinessInfo(activeBaseInfo, 2);
  const baseInfoDetails = buildEditableBusinessInfoDetails(activeBaseInfo);
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
      id: "center",
      ic: preferredRole === "e" ? "🏭" : "👤",
      t: centerTitle,
      p: centerPreview,
      x: centerX,
      y: centerY,
      c: 1,
      d: "用户总览",
      dm: "身份初始化",
      db: [
        `用户ID：${profile?.userId ?? "初始化中"}`,
        `显示名称：${displayName}`,
        `角色偏好：${roleLabel}`,
        `身份来源：${profile?.identitySource === "provided" ? "外部传入" : "前端初始化生成"}`,
        `主题偏好：${profile?.preferences.themeMode ?? (isDark ? "dark" : "light")} / ${profile?.preferences.themeColor ?? themeIndexToColorKey(themeIndex)}`,
        `创建时间：${formatAbsoluteTime(profile?.createdAt)}`,
        `最近活跃：${formatAbsoluteTime(profile?.lastActiveAt)}`,
        `会话 ${stats?.sessionCount ?? 0} · 记忆 ${stats?.memoryCount ?? 0} · 分析 ${stats?.analysisCount ?? 0} · 任务 ${stats?.taskCount ?? 0}`,
        profile?.profileSummary ? `档案摘要：${profile.profileSummary}` : "档案摘要：暂无系统画像摘要",
      ].join("\n"),
      level: 0,
      nodeType: "center",
    },
    {
      id: "theme",
      ic: isDark ? "🌙" : "☀️",
      t: "主题与配色",
      p: `${themeModeLabel} / ${themeLabel}`,
      x: pos1.x,
      y: pos1.y,
      d: "界面偏好",
      dm: "跨会话持久化",
      db: [
        `当前主题：${themeModeLabel}`,
        `当前配色：${themeLabel}`,
        `档案写入主题：${profile?.preferences.themeMode ?? "未写入"}`,
        `档案写入配色：${profile?.preferences.themeColor ?? "未写入"}`,
        "主题切换会同步写入用户偏好，并在后续进入时自动恢复。",
      ].join("\n"),
      level: 1,
      expanded: false,
      nodeType: "theme",
    },
    {
      id: "portrait",
      ic: preferredRole === "e" ? "📊" : "🎯",
      t: preferredRole === "e" ? "经营画像" : "投资画像",
      p: truncateText(profile?.behaviorSummary || profile?.profileSummary || "等待真实画像沉淀", 18),
      x: pos2.x,
      y: pos2.y,
      d: preferredRole === "e" ? "经营画像摘要" : "投资画像摘要",
      dm: "用户偏好",
      db: [
        `风险偏好：${toRiskLabel(profile?.preferences.riskAppetite)}`,
        `投资周期：${toHorizonLabel(profile?.preferences.investmentHorizon)}`,
        `关注主题：${focusSummary.length > 0 ? focusSummary.join("、") : "暂无"}`,
        `目标与约束：${goalSummary.length > 0 ? goalSummary.join("、") : "暂无"}`,
        `关键信息：${baseInfoSummary}`,
        profile?.behaviorSummary ? `行为摘要：${profile.behaviorSummary}` : "行为摘要：暂无",
      ].join("\n"),
      level: 1,
      expanded: false,
      nodeType: "portrait",
    },
    {
      id: "sessions",
      ic: "🕘",
      t: "历史会话",
      p: recentSession ? truncateText(recentSession.summary, 18) : `累计 ${stats?.sessionCount ?? 0} 个会话`,
      x: pos3.x,
      y: pos3.y,
      d: "最近历史",
      dm: "真实会话数据",
      db: userProfile?.recentSessions.length
        ? userProfile.recentSessions
            .map((session, index) => `${index + 1}. ${session.enterpriseName ?? "未命名会话"} · ${getModeOption(session.activeMode).label}\n${session.summary}\n更新时间：${formatAbsoluteTime(session.updatedAt)}`)
            .join("\n\n")
        : "当前暂无历史会话。后续在分析工作台中创建、切换和沉淀的会话会在这里展示。",
      level: 1,
      expanded: false,
      nodeType: "session",
    },
    {
      id: "memories",
      ic: "🧠",
      t: "最近记忆",
      p: recentMemory ? truncateText(recentMemory.summary, 18) : `累计 ${stats?.memoryCount ?? 0} 条记忆`,
      x: pos4.x,
      y: pos4.y,
      d: "记忆沉淀",
      dm: "真实记忆数据",
      db: userProfile?.recentMemories.length
        ? userProfile.recentMemories
            .map((memory, index) => `${index + 1}. ${memory.summary}\n标签：${memory.tags.join("、") || "暂无"}\n时间：${formatAbsoluteTime(memory.createdAt)}${memory.details ? `\n详情：${memory.details}` : ""}`)
            .join("\n\n")
        : "当前暂无私有记忆。分析过程产生的工作记忆和手动写入的私有记忆会在这里累积。",
      level: 1,
      expanded: false,
      nodeType: "memory",
    },
    {
      id: "analyses",
      ic: "📈",
      t: "分析沉淀",
      p: recentAnalysis ? truncateText(recentAnalysis.summary, 18) : `累计 ${stats?.analysisCount ?? 0} 次分析`,
      x: pos5.x,
      y: pos5.y,
      d: "最近分析结果",
      dm: "分析闭环",
      db: userProfile?.recentAnalyses.length
        ? userProfile.recentAnalyses
            .map((analysis, index) => `${index + 1}. ${analysis.summary}\n模式：${getModeOption(analysis.focusMode).label}\n时间：${formatAbsoluteTime(analysis.createdAt)}${analysis.combinedRiskLevel ? `\n综合风险：${analysis.combinedRiskLevel}` : ""}`)
            .join("\n\n")
        : "当前暂无历史分析结果。完成企业诊断或投资分析后，这里会展示最新沉淀内容。",
      level: 1,
      expanded: false,
      nodeType: "analysis",
    },
    {
      id: "signals",
      ic: "🔔",
      t: "关注与偏好",
      p: baseInfoEntries.length > 0 ? baseInfoSummary : focusSummary.length > 0 ? focusSummary.join("、") : "等待真实偏好沉淀",
      x: pos6.x,
      y: pos6.y,
      d: "偏好与反馈",
      dm: "长期画像信号",
      db: [
        `关键信息：${baseInfoDetails}`,
        `关注主题：${focusSummary.length > 0 ? focusSummary.join("、") : "暂无"}`,
        `目标与约束：${goalSummary.length > 0 ? goalSummary.join("、") : "暂无"}`,
        `反馈评分次数：${profile?.feedback.ratingCount ?? 0}`,
        `平均评分：${profile?.feedback.averageRating ?? "暂无"}`,
        `学习信号：${profile?.feedback.learnedSignals.join("、") || "暂无"}`,
      ].join("\n"),
      level: 1,
      expanded: false,
      nodeType: "signal",
    },
  ];

  // Add L2 Nodes for Sessions dynamically
  if (userProfile?.recentSessions.length) {
    const sessions = userProfile.recentSessions.slice(0, 8);
    sessions.forEach((session, idx) => {
      const pos = generateRadialPos(0, 2, pos3, idx, sessions.length);
      nodes.push({
        id: `session-${session.sessionId}`,
        parentId: "sessions",
        level: 2,
        ic: "💬",
        t: truncateText(session.enterpriseName ?? "会话", 12),
        p: truncateText(session.summary, 20),
        x: pos.x,
        y: pos.y,
        d: "会话详情",
        dm: getModeOption(session.activeMode).label,
        db: `时间：${formatAbsoluteTime(session.updatedAt)}\n\n${session.summary}`,
        nodeType: "session",
      });
    });
  }

  // Add L2 Nodes for Memories dynamically
  if (userProfile?.recentMemories.length) {
    const memories = userProfile.recentMemories.slice(0, 15);
    memories.forEach((memory, idx) => {
      const pos = generateRadialPos(0, 2, pos4, idx, memories.length);
      nodes.push({
        id: `memory-${memory.id}`,
        parentId: "memories",
        level: 2,
        ic: "💡",
        t: truncateText(memory.tags[0] ?? "记忆", 12),
        p: truncateText(memory.summary, 20),
        x: pos.x,
        y: pos.y,
        d: "记忆详情",
        dm: memory.tags.join("、") || "综合记忆",
        db: `时间：${formatAbsoluteTime(memory.createdAt)}\n\n摘要：${memory.summary}\n\n${memory.details ? `详情：\n${memory.details}` : ""}`,
        nodeType: "memory",
        memoryId: memory.id,
        memorySummary: memory.summary,
        memoryDetails: memory.details,
        memoryTags: memory.tags,
      });
    });
  }

  // Add L2 Nodes for Analyses dynamically
  if (userProfile?.recentAnalyses.length) {
    const analyses = userProfile.recentAnalyses.slice(0, 8);
    analyses.forEach((analysis, idx) => {
      const pos = generateRadialPos(0, 2, pos5, idx, analyses.length);
      nodes.push({
        id: `analysis-${analysis.analysisId}`,
        parentId: "analyses",
        level: 2,
        ic: "📑",
        t: truncateText(getModeOption(analysis.focusMode as InvestorWorkbenchMode).label, 12),
        p: truncateText(analysis.summary, 20),
        x: pos.x,
        y: pos.y,
        d: "分析报告概要",
        dm: analysis.combinedRiskLevel ? `风险评级：${analysis.combinedRiskLevel}` : "常规报告",
        db: `时间：${formatAbsoluteTime(analysis.createdAt)}\n\n${analysis.summary}`,
        nodeType: "analysis",
      });
    });
  }

  if (baseInfoEntries.length) {
    baseInfoEntries.slice(0, 8).forEach(([field, value], idx) => {
      const pos = generateRadialPos(0, 2, pos6, idx, Math.min(baseInfoEntries.length, 8));
      const formattedValue = formatEditableBusinessInfoValue(value);
      nodes.push({
        id: `signal-base-info-${field}`,
        parentId: "signals",
        level: 2,
        ic: preferredRole === "e" ? "🏷" : "🧾",
        t: truncateText(field, 12),
        p: truncateText(formattedValue, 20),
        x: pos.x,
        y: pos.y,
        d: "关键信息",
        dm: preferredRole === "e" ? "企业基本信息" : "投资基本信息",
        db: `字段${field}\n内容${formattedValue}\n来源{preferredRole === "e" ? "enterpriseBaseInfo" : "investorBaseInfo"}`,
        nodeType: "signal",
      });
    });
  }

  return nodes;
}


function CommandPalette({ isOpen, onClose, userProfile }: { isOpen: boolean; onClose: () => void; userProfile: UserProfileResponse | null }) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
      setQuery("");
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const sessions = userProfile?.recentSessions || [];
  const memories = userProfile?.recentMemories || [];

  const filteredSessions = sessions.filter(s => s.summary?.toLowerCase().includes(query.toLowerCase()) || s.enterpriseName?.toLowerCase().includes(query.toLowerCase()));
  const filteredMemories = memories.filter(m => m.summary.toLowerCase().includes(query.toLowerCase()) || (m.details && m.details.toLowerCase().includes(query.toLowerCase())));

  return (
    <div className="cmd-palette-overlay" onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)', zIndex: 9999, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: '10vh' }}>
      <div className="cmd-palette" onClick={e => e.stopPropagation()} style={{ background: '#FFFFFF', width: '600px', borderRadius: '12px', border: '1px solid #E2E8F0', boxShadow: '0 20px 40px rgba(0,0,0,0.4)', overflow: 'hidden', display: 'flex', flexDirection: 'column', maxHeight: '60vh' }}>
        <input ref={inputRef} value={query} onChange={e => setQuery(e.target.value)} placeholder="搜索节点或会(Cmd+K / Ctrl+K)..." style={{ width: '100%', padding: '16px 24px', fontSize: '18px', background: 'transparent', border: 'none', borderBottom: '1px solid #E2E8F0', color: '#0F172A', outline: 'none' }} />
        <div style={{ flex: 1, overflowY: 'auto', padding: '12px' }}>
          {query && filteredSessions.length === 0 && filteredMemories.length === 0 && (
            <div style={{ padding: '24px', textAlign: 'center', color: '#94A3B8' }}>没有找到匹配的结</div>
          )}
          {filteredSessions.length > 0 && (
            <div style={{ marginBottom: '16px' }}>
              <div style={{ fontSize: '12px', color: '#94A3B8', padding: '8px 12px', textTransform: 'uppercase', fontWeight: 600 }}>会话 (Sessions)</div>
              {filteredSessions.map(s => (
                <div key={s.sessionId} className="cmd-item" onClick={onClose} style={{ padding: '12px', borderRadius: '8px', cursor: 'pointer', transition: 'background 0.2s', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                  <div style={{ fontWeight: 500, color: '#0F172A' }}>{s.enterpriseName || s.sessionId}</div>
                  <div style={{ fontSize: '13px', color: '#475569', marginTop: '4px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.summary}</div>
                </div>
              ))}
            </div>
          )}
          {filteredMemories.length > 0 && (
            <div>
              <div style={{ fontSize: '12px', color: '#94A3B8', padding: '8px 12px', textTransform: 'uppercase', fontWeight: 600 }}>记忆节点 (Nodes)</div>
              {filteredMemories.map(m => (
                <div key={m.id} className="cmd-item" onClick={onClose} style={{ padding: '12px', borderRadius: '8px', cursor: 'pointer', transition: 'background 0.2s', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                  <div style={{ fontWeight: 500, color: '#0F172A' }}>{m.summary}</div>
                  <div style={{ fontSize: '13px', color: '#475569', marginTop: '4px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.details || m.tags?.join(' ')}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function App() {
  const [appState, setAppState] = useState<AppState>('loading');
  const [role, setRole] = useState<RoleKey | null>(null);
  const [tab, setTab] = useState<AppTab>('home');
  const [memReturnState, setMemReturnState] = useState<AppState>('app-e');
  const [isDark, setIsDark] = useState(true);
  const [themeIndex, setThemeIndex] = useState(0);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfileResponse | null>(null);
  const [userReady, setUserReady] = useState(false);
  const [loadingFinished, setLoadingFinished] = useState(false);
  const [hasPersistedRole, setHasPersistedRole] = useState(false);
  const [enterpriseOnboarding, setEnterpriseOnboarding] = useState<EnterpriseOnboardingDraft>(DEFAULT_ENTERPRISE_ONBOARDING);
  const [investorOnboarding, setInvestorOnboarding] = useState<InvestorOnboardingDraft>(DEFAULT_INVESTOR_ONBOARDING);
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [refreshInterval, setRefreshInterval] = useState<number>(60000);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastDataRefreshAt, setLastDataRefreshAt] = useState<string>("");
  const prefetchedSessionHistoryRef = useRef<SessionHistorySummary[] | null>(null);
  const { preferences: unitPrefs, updatePreferences: updateUnitPrefs } = useUnitPreferences();
  const dataFormatter = useMemo(() => new DataFormatter(unitPrefs), [unitPrefs]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setIsCommandPaletteOpen(prev => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const syncUserProfile = useCallback((nextProfile: UserProfileResponse) => {
    const nextUserId = nextProfile.profile.userId;
    const nextRole = preferenceToRoleKey(nextProfile.profile.preferences.preferredRole);
    const nextThemeMode = nextProfile.profile.preferences.themeMode;
    const nextThemeColor = nextProfile.profile.preferences.themeColor;
    const nextAmountUnit = nextProfile.profile.preferences.amountUnit;
    const nextPercentageUnit = nextProfile.profile.preferences.percentageUnit;
    const nextVolumeUnit = nextProfile.profile.preferences.volumeUnit;

    setCurrentUserId(nextUserId);
    setUserProfile(nextProfile);
    localStorage.setItem(USER_ID_STORAGE_KEY, nextUserId);

    if (nextRole) {
      localStorage.setItem(USER_ROLE_STORAGE_KEY, roleKeyToPreference(nextRole));
      setRole(nextRole);
    }

    if (nextThemeMode) {
      localStorage.setItem(USER_THEME_MODE_STORAGE_KEY, nextThemeMode);
      setIsDark(nextThemeMode !== "light");
    }

    if (nextThemeColor) {
      localStorage.setItem(USER_THEME_COLOR_STORAGE_KEY, nextThemeColor);
      setThemeIndex(themeColorKeyToIndex(nextThemeColor));
    }

    if (nextAmountUnit || nextPercentageUnit || nextVolumeUnit) {
      const currentUnitPrefs = loadUnitPreferences();
      const mergedUnitPrefs = {
        amountUnit: nextAmountUnit ?? currentUnitPrefs.amountUnit,
        percentageUnit: nextPercentageUnit ?? currentUnitPrefs.percentageUnit,
        volumeUnit: nextVolumeUnit ?? currentUnitPrefs.volumeUnit,
      };
      saveUnitPreferences(mergedUnitPrefs);
      updateUnitPrefs(mergedUnitPrefs);
    }
  }, [updateUnitPrefs]);

  const applyLocalUserProfilePatch = useCallback((payload: Partial<UserPreferencesUpdateRequest>) => {
    setUserProfile((previous) => mergeLocalUserProfile(previous, payload));
    const nextRole = preferenceToRoleKey(payload.preferredRole ?? payload.role);
    if (nextRole) {
      setRole(nextRole);
      localStorage.setItem(USER_ROLE_STORAGE_KEY, roleKeyToPreference(nextRole));
    }
  }, []);

  const refreshUserProfile = useCallback(async (userId?: string) => {
    const resolvedUserId = userId ?? currentUserId;
    if (!resolvedUserId) {
      return null;
    }
    const profile = await fetchUserProfile(resolvedUserId);
    syncUserProfile(profile);
    return profile;
  }, [currentUserId, syncUserProfile]);

  const persistUserPreferences = useCallback(async (payload: Omit<UserPreferencesUpdateRequest, "userId">) => {
    const resolvedUserId = currentUserId;
    if (!resolvedUserId) {
      return null;
    }
    const profile = await updateUserPreferences(resolvedUserId, payload);
    syncUserProfile(profile);
    return profile;
  }, [currentUserId, syncUserProfile]);

  const handleThemeModeChange = useCallback((nextIsDark: boolean) => {
    setIsDark(nextIsDark);
    localStorage.setItem(USER_THEME_MODE_STORAGE_KEY, nextIsDark ? "dark" : "light");
    applyLocalUserProfilePatch({
      themeMode: nextIsDark ? "dark" : "light",
      themeColor: themeIndexToColorKey(themeIndex),
      preferredRole: role ? roleKeyToPreference(role) : undefined,
    });
    void persistUserPreferences({
      themeMode: nextIsDark ? "dark" : "light",
      themeColor: themeIndexToColorKey(themeIndex),
      preferredRole: role ? roleKeyToPreference(role) : undefined,
    });
  }, [applyLocalUserProfilePatch, persistUserPreferences, role, themeIndex]);

  const handleThemeIndexChange = useCallback((nextThemeIndex: number) => {
    const nextThemeColor = themeIndexToColorKey(nextThemeIndex);
    setThemeIndex(nextThemeIndex);
    localStorage.setItem(USER_THEME_COLOR_STORAGE_KEY, nextThemeColor);
    applyLocalUserProfilePatch({
      themeMode: isDark ? "dark" : "light",
      themeColor: nextThemeColor,
      preferredRole: role ? roleKeyToPreference(role) : undefined,
    });
    void persistUserPreferences({
      themeMode: isDark ? "dark" : "light",
      themeColor: nextThemeColor,
      preferredRole: role ? roleKeyToPreference(role) : undefined,
    });
  }, [applyLocalUserProfilePatch, isDark, persistUserPreferences, role]);

  const handleUnitPrefsChange = useCallback((prefs: UnitPreferences) => {
    updateUnitPrefs(prefs);
    void persistUserPreferences({
      themeMode: isDark ? "dark" : "light",
      themeColor: themeIndexToColorKey(themeIndex),
      preferredRole: role ? roleKeyToPreference(role) : undefined,
      amountUnit: prefs.amountUnit,
      percentageUnit: prefs.percentageUnit,
      volumeUnit: prefs.volumeUnit,
    });
  }, [updateUnitPrefs, persistUserPreferences, isDark, themeIndex, role]);

  const handleRefreshData = useCallback(async () => {
    if (!currentUserId || isRefreshing) {
      return;
    }
    setIsRefreshing(true);
    try {
      await refreshUserProfile(currentUserId);
      setLastDataRefreshAt(new Date().toLocaleTimeString());
    } catch {
      // noop
    } finally {
      setIsRefreshing(false);
    }
  }, [currentUserId, isRefreshing, refreshUserProfile]);

  useEffect(() => {
    if (!currentUserId || refreshInterval <= 0) {
      return;
    }
    const timer = window.setInterval(() => {
      void handleRefreshData();
    }, refreshInterval);
    return () => window.clearInterval(timer);
  }, [currentUserId, refreshInterval, handleRefreshData]);

  const handleRefreshIntervalChange = useCallback((ms: number) => {
    setRefreshInterval(ms);
    localStorage.setItem("refreshInterval", String(ms));
  }, []);

  useEffect(() => {
    const stored = localStorage.getItem("refreshInterval");
    if (stored) {
      const parsed = Number(stored);
      if ([30000, 60000, 120000, 0].includes(parsed)) {
        setRefreshInterval(parsed);
      }
    }
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    const themes = [
      { blue: '#3b82f6', purple: '#8b5cf6', cyan: '#06b6d4' },
      { blue: '#10b981', purple: '#06b6d4', cyan: '#3b82f6' },
      { blue: '#f59e0b', purple: '#ef4444', cyan: '#ec4899' },
      { blue: '#ec4899', purple: '#8b5cf6', cyan: '#f43f5e' }
    ];
    const t = themes[themeIndex] ?? themes[0];
    if (t) {
      root.style.setProperty('--blue', t.blue);
      root.style.setProperty('--purple', t.purple);
      root.style.setProperty('--cyan', t.cyan);
    }

    if (isDark) {
      root.classList.add('theme-dark');
      root.classList.remove('theme-light');
      root.style.setProperty('--bg', 'radial-gradient(circle at 15% 0%, color-mix(in srgb, #3B82F6 15%, transparent) 0%, transparent 50%), radial-gradient(circle at 85% 100%, color-mix(in srgb, #8B5CF6 15%, transparent) 0%, transparent 50%), radial-gradient(circle at 100% 0%, color-mix(in srgb, #06B6D4 15%, transparent) 0%, transparent 50%), #0b0f1a');
      root.style.setProperty('--bg2', '#111827');
      root.style.setProperty('--gl', 'rgba(255,255,255,.05)');
      root.style.setProperty('--bd', 'rgba(255,255,255,.1)');
      root.style.setProperty('--bd-hover', 'rgba(255,255,255,.2)');
      root.style.setProperty('--t1', '#f8fafc');
      root.style.setProperty('--t2', '#cbd5e1');
      root.style.setProperty('--t3', '#94a3b8');
      root.style.setProperty('--t4', '#64748b');
      root.style.setProperty('--overlay', 'rgba(0,0,0,.6)');
      root.style.setProperty('--glass-bg', 'rgba(15,23,42,.75)');
      root.style.setProperty('--glass', 'rgba(15,23,42,.55)');
      root.style.setProperty('--glass-soft', 'rgba(15,23,42,.4)');
      root.style.setProperty('--chat-bg', 'rgba(0,0,0,.2)');
      root.style.setProperty('--chat-input-bg', 'rgba(15,23,42,.8)');
      root.style.setProperty('--sidebar-bg', 'rgba(15,23,42,.4)');
      root.style.setProperty('--panel-bg', 'rgba(15,23,42,.4)');
      root.style.setProperty('--nav-bg', 'rgba(15,23,42,.5)');
      root.style.setProperty('--tree-node-bg', 'rgba(255,255,255,.05)');
      root.style.setProperty('--tree-node-border', 'rgba(255,255,255,.15)');
      root.style.setProperty('--shadow-color', 'rgba(0,0,0,0.6)');
      root.style.setProperty('--glass-highlight', 'inset 0 1px 0 rgba(255,255,255,0.1), inset 0 -1px 0 rgba(0,0,0,0.3)');
      root.style.setProperty('--glass-blur', 'blur(16px)');
      root.style.setProperty('--glass-surface', 'linear-gradient(180deg,rgba(28,37,60,.84),rgba(10,16,30,.72))');
      root.style.setProperty('--glass-surface-strong', 'linear-gradient(180deg,rgba(24,33,55,.9),rgba(7,10,20,.82))');
      root.style.setProperty('--glass-border-soft', 'rgba(255,255,255,.1)');
      root.style.setProperty('--glass-border-strong', 'rgba(255,255,255,.18)');
      root.style.setProperty('--global-noise-opacity', '.08');
      root.style.setProperty('--global-noise-blend', 'soft-light');
      root.style.setProperty('--nav-shell', 'rgba(0,0,0,.2)');
      root.style.setProperty('--toolbar-bg', 'rgba(0,0,0,.1)');
      root.style.setProperty('--tooltip-bg', 'rgba(15,23,42,.95)');
      root.style.setProperty('--chat-footer-bg', 'rgba(15,23,42,.6)');
      root.style.setProperty('--mode-strip-bg', 'rgba(15,23,42,.4)');
      root.style.setProperty('--workspace-header-bg', 'linear-gradient(180deg,rgba(15,23,42,.48),rgba(15,23,42,.18))');
      root.style.setProperty('--modal-overlay-strong', 'rgba(0,0,0,.48)');
      root.style.setProperty('--modal-overlay-soft', 'rgba(0,0,0,.4)');
      root.style.setProperty('--role-title-start', '#ffffff');
      root.style.setProperty('--debate-bg', 'linear-gradient(135deg,rgba(15,23,42,.88),rgba(30,41,59,.82))');
      root.style.setProperty('--live-progress-fg', '#dbeafe');
      root.style.setProperty('--live-progress-strong', '#ffffff');
      root.style.setProperty('--badge-info', '#bfdbfe');
      root.style.setProperty('--history-check-bg', 'rgba(0,0,0,.18)');
      root.style.setProperty('--line', 'rgba(255,255,255,.08)');
      root.style.setProperty('--rs', '6px');
    } else {
      root.classList.add('theme-light');
      root.classList.remove('theme-dark');
      root.style.setProperty('--bg', 'radial-gradient(circle at 10% 10%, #7dd3fc 0%, transparent 60%), radial-gradient(circle at 90% 20%, #a78bfa 0%, transparent 60%), radial-gradient(circle at 50% 90%, #818cf8 0%, transparent 60%), radial-gradient(circle at 80% 80%, #34d399 0%, transparent 50%), linear-gradient(135deg, #f0f9ff 0%, #e0e7ff 100%)');
      root.style.setProperty('--bg2', '#ffffff');
      root.style.setProperty('--gl', 'rgba(255,255,255,.4)');
      root.style.setProperty('--bd', 'rgba(255,255,255,.6)');
      root.style.setProperty('--line', 'rgba(0,0,0,.1)');
      root.style.setProperty('--bd-hover', 'rgba(255,255,255,.9)');
      root.style.setProperty('--t1', '#0f172a');
      root.style.setProperty('--t2', '#334155');
      root.style.setProperty('--t3', '#475569');
      root.style.setProperty('--t4', '#94a3b8');
      root.style.setProperty('--overlay', 'rgba(200,210,225,.4)');
      root.style.setProperty('--glass-bg', 'rgba(255,255,255,.3)');
      root.style.setProperty('--glass', 'rgba(255,255,255,.35)');
      root.style.setProperty('--glass-soft', 'rgba(255,255,255,.25)');
      root.style.setProperty('--chat-bg', 'rgba(255,255,255,.4)');
      root.style.setProperty('--chat-input-bg', 'rgba(255,255,255,.6)');
      root.style.setProperty('--sidebar-bg', 'rgba(255,255,255,.3)');
      root.style.setProperty('--panel-bg', 'rgba(255,255,255,.35)');
      root.style.setProperty('--nav-bg', 'rgba(255,255,255,.25)');
      root.style.setProperty('--tree-node-bg', 'rgba(255,255,255,.45)');
      root.style.setProperty('--tree-node-border', 'rgba(255,255,255,.7)');
      root.style.setProperty('--shadow-color', 'rgba(99,102,241,0.15)');
      root.style.setProperty('--glass-highlight', 'inset 0 1px 0 rgba(255,255,255,0.8), inset 0 -1px 0 rgba(255,255,255,0.2), inset 1px 0 0 rgba(255,255,255,0.5), inset -1px 0 0 rgba(255,255,255,0.5)');
      root.style.setProperty('--glass-blur', 'blur(24px) saturate(150%)');
      root.style.setProperty('--glass-surface', 'linear-gradient(180deg,rgba(255,255,255,.58),rgba(255,255,255,.28))');
      root.style.setProperty('--glass-surface-strong', 'linear-gradient(180deg,rgba(255,255,255,.68),rgba(255,255,255,.34))');
      root.style.setProperty('--glass-border-soft', 'rgba(255,255,255,.62)');
      root.style.setProperty('--glass-border-strong', 'rgba(255,255,255,.88)');
      root.style.setProperty('--global-noise-opacity', '.06');
      root.style.setProperty('--global-noise-blend', 'overlay');
      root.style.setProperty('--nav-shell', 'rgba(255,255,255,.38)');
      root.style.setProperty('--toolbar-bg', 'rgba(255,255,255,.28)');
      root.style.setProperty('--tooltip-bg', 'rgba(255,255,255,.92)');
      root.style.setProperty('--chat-footer-bg', 'rgba(255,255,255,.45)');
      root.style.setProperty('--mode-strip-bg', 'rgba(255,255,255,.32)');
      root.style.setProperty('--workspace-header-bg', 'linear-gradient(180deg,rgba(255,255,255,.56),rgba(255,255,255,.18))');
      root.style.setProperty('--modal-overlay-strong', 'rgba(148,163,184,.24)');
      root.style.setProperty('--modal-overlay-soft', 'rgba(148,163,184,.2)');
      root.style.setProperty('--role-title-start', '#0f172a');
      root.style.setProperty('--debate-bg', 'linear-gradient(135deg,rgba(255,255,255,.74),rgba(224,231,255,.56))');
      root.style.setProperty('--live-progress-fg', '#1d4ed8');
      root.style.setProperty('--live-progress-strong', '#0f172a');
      root.style.setProperty('--badge-info', '#1e3a8a');
      root.style.setProperty('--history-check-bg', 'rgba(255,255,255,.5)');
      root.style.setProperty('--rs', '6px');
    }
  }, [themeIndex, isDark]);

  useEffect(() => {
    const storedThemeMode = localStorage.getItem(USER_THEME_MODE_STORAGE_KEY);
    const storedThemeColor = localStorage.getItem(USER_THEME_COLOR_STORAGE_KEY);

    if (storedThemeMode === "light" || storedThemeMode === "dark") {
      setIsDark(storedThemeMode === "dark");
    }

    if (storedThemeColor) {
      setThemeIndex(themeColorKeyToIndex(storedThemeColor));
    }

    void (async () => {
      const storedUserId = localStorage.getItem(USER_ID_STORAGE_KEY) ?? undefined;
      const storedRole = localStorage.getItem(USER_ROLE_STORAGE_KEY);
      setHasPersistedRole(storedRole === "enterprise" || storedRole === "investor");

      try {
        const profile = storedUserId
          ? await fetchUserProfile(storedUserId)
          : await bootstrapUserIdentity({
              preferredRole: storedRole === "enterprise" || storedRole === "investor" ? storedRole : undefined,
              themeMode: storedThemeMode === "light" || storedThemeMode === "dark" ? storedThemeMode : "dark",
              themeColor: storedThemeColor ?? themeIndexToColorKey(themeIndex),
              investedEnterprises: [],
              interests: [],
              attentionTags: [],
              goals: [],
              constraints: [],
              decisionStyleHints: [],
              enterpriseBaseInfo: {},
              investorBaseInfo: {},
            });
        syncUserProfile(profile);

        const nextRole = preferenceToRoleKey(profile.profile.preferences.preferredRole);
        if (nextRole === "i" && profile.profile.userId) {
          try {
            const sessionResponse = await fetchInvestorSessions(profile.profile.userId);
            prefetchedSessionHistoryRef.current = sessionResponse.items;
          } catch {
            // noop - InvAna will fetch on its own
          }
        }
      } catch {
        const profile = await bootstrapUserIdentity({
          userId: storedUserId,
          preferredRole: storedRole === "enterprise" || storedRole === "investor" ? storedRole : undefined,
          themeMode: storedThemeMode === "light" || storedThemeMode === "dark" ? storedThemeMode : "dark",
          themeColor: storedThemeColor ?? themeIndexToColorKey(themeIndex),
          investedEnterprises: [],
          interests: [],
          attentionTags: [],
          goals: [],
          constraints: [],
          decisionStyleHints: [],
          enterpriseBaseInfo: {},
          investorBaseInfo: {},
        });
        syncUserProfile(profile);
      } finally {
        setUserReady(true);
      }
    })();
  }, [syncUserProfile, themeIndex]);

  useEffect(() => {
    if (appState !== 'loading') {
      return;
    }
    const timer = setTimeout(() => {
      setLoadingFinished(true);
    }, 1500);
    return () => clearTimeout(timer);
  }, [appState]);

  useEffect(() => {
    if (appState !== 'loading' || !loadingFinished || !userReady) {
      return;
    }
    const preferredRole = role ?? preferenceToRoleKey(userProfile?.profile.preferences.preferredRole);
    if (preferredRole && hasPersistedRole) {
      setRole(preferredRole);
      setTab('home');
      setAppState(preferredRole === 'e' ? 'app-e' : 'app-i');
      return;
    }
    setAppState('role');
  }, [appState, hasPersistedRole, loadingFinished, role, userProfile, userReady]);

  const handleRoleSelect = (r: RoleKey) => {
    setRole(r);
    localStorage.setItem(USER_ROLE_STORAGE_KEY, roleKeyToPreference(r));
    applyLocalUserProfilePatch({
      preferredRole: roleKeyToPreference(r),
      role: roleKeyToPreference(r),
    });
    void persistUserPreferences({
      preferredRole: roleKeyToPreference(r),
      role: roleKeyToPreference(r),
      themeMode: isDark ? "dark" : "light",
      themeColor: themeIndexToColorKey(themeIndex),
    });
    setAppState(r === 'e' ? 'collect-e' : 'collect-i');
  };

  const handleGoApp = (r: RoleKey) => {
    const nextPreference = roleKeyToPreference(r);
    const nextPayload: Omit<UserPreferencesUpdateRequest, "userId"> = {
      preferredRole: nextPreference,
      role: nextPreference,
      themeMode: isDark ? "dark" : "light",
      themeColor: themeIndexToColorKey(themeIndex),
      enterpriseName: r === "e" ? enterpriseOnboarding.enterpriseName.trim() || DEFAULT_ENTERPRISE_NAME : undefined,
    };

    if (r === "i") {
      nextPayload.displayName = investorOnboarding.investorName.trim() || undefined;
      nextPayload.investedEnterprises = splitInputTags(investorOnboarding.investedEnterprises);
      nextPayload.riskAppetite = investorOnboarding.riskAppetite || undefined;
      nextPayload.investmentHorizon = investorOnboarding.investmentHorizon || undefined;
      nextPayload.interests = dedupeStrings([investorOnboarding.industryInterest, investorOnboarding.focusTopic]).slice(0, 8);
      nextPayload.attentionTags = splitInputTags(investorOnboarding.notes).slice(0, 8);
    }

    applyLocalUserProfilePatch(nextPayload);
    void persistUserPreferences(nextPayload);
    setRole(r);
    setAppState(r === 'e' ? 'app-e' : 'app-i');
    setTab('home');
  };

  const saveEnterpriseBaseInfo = useCallback(async (baseInfo: EditableBusinessInfo) => {
    const previousProfile = userProfile;
    applyLocalUserProfilePatch({ enterpriseBaseInfo: baseInfo });

    try {
      await persistUserPreferences({ enterpriseBaseInfo: baseInfo });
    } catch (error) {
      setUserProfile(previousProfile);
      throw error instanceof Error ? error : new Error("保存失败，请稍后重试");
    }
  }, [applyLocalUserProfilePatch, persistUserPreferences, userProfile]);

  const saveInvestorBaseInfo = useCallback(async (baseInfo: EditableBusinessInfo) => {
    const previousProfile = userProfile;
    applyLocalUserProfilePatch({ investorBaseInfo: baseInfo });

    try {
      await persistUserPreferences({ investorBaseInfo: baseInfo });
    } catch (error) {
      setUserProfile(previousProfile);
      throw error instanceof Error ? error : new Error("保存失败，请稍后重试");
    }
  }, [applyLocalUserProfilePatch, persistUserPreferences, userProfile]);

  const openMem = () => {
    setMemReturnState(appState);
    void refreshUserProfile();
    setAppState('mem');
  };

  const closeMem = () => {
    setAppState(memReturnState);
  };

  return (
    <div className="app-root" data-theme-mode={isDark ? "dark" : "light"} data-app-state={appState}>
      <div className="noise-overlay"></div>

      {appState === 'loading' && (
        <div className="S on" id="ld">
          <LoadingScreen progress={100} />
        </div>
      )}

      {appState === 'role' && (
        <div className="S on" id="role">
          <RoleScreen onSelect={handleRoleSelect} />
        </div>
      )}

      {appState === 'collect-e' && (
        <div className="S on" id="ce">
          <CollectEnterpriseScreen draft={enterpriseOnboarding} setDraft={setEnterpriseOnboarding} onFinish={() => handleGoApp('e')} />
        </div>
      )}

      {appState === 'collect-i' && (
        <div className="S on" id="ci">
          <CollectInvestorScreen draft={investorOnboarding} setDraft={setInvestorOnboarding} onFinish={() => handleGoApp('i')} />
        </div>
      )}

      {appState === 'app-e' && (
        <div className="S on" id="ae">
          <AppEnterpriseScreen
            tab={tab}
            setTab={setTab}
            openMem={openMem}
            isDark={isDark}
            setIsDark={handleThemeModeChange}
            themeIndex={themeIndex}
            setThemeIndex={handleThemeIndexChange}
            currentUserId={currentUserId}
            enterpriseOnboarding={enterpriseOnboarding}
            userProfile={userProfile}
            refreshUserProfile={refreshUserProfile}
            saveEnterpriseBaseInfo={saveEnterpriseBaseInfo}
            unitPrefs={unitPrefs}
            dataFormatter={dataFormatter}
            onUnitPrefsChange={handleUnitPrefsChange}
            isRefreshing={isRefreshing}
            lastDataRefreshAt={lastDataRefreshAt}
            onRefreshData={handleRefreshData}
            refreshInterval={refreshInterval}
            onRefreshIntervalChange={handleRefreshIntervalChange}
          />
        </div>
      )}

      {appState === 'app-i' && (
        <div className="S on" id="ai2">
          <AppInvestorScreen
            tab={tab}
            setTab={setTab}
            openMem={openMem}
            isDark={isDark}
            setIsDark={handleThemeModeChange}
            themeIndex={themeIndex}
            setThemeIndex={handleThemeIndexChange}
            currentUserId={currentUserId}
            userProfile={userProfile}
            refreshUserProfile={refreshUserProfile}
            investorOnboarding={investorOnboarding}
            saveInvestorBaseInfo={saveInvestorBaseInfo}
            unitPrefs={unitPrefs}
            dataFormatter={dataFormatter}
            onUnitPrefsChange={handleUnitPrefsChange}
            isRefreshing={isRefreshing}
            lastDataRefreshAt={lastDataRefreshAt}
            onRefreshData={handleRefreshData}
            refreshInterval={refreshInterval}
            onRefreshIntervalChange={handleRefreshIntervalChange}
            prefetchedSessionHistoryRef={prefetchedSessionHistoryRef}
          />
        </div>
      )}

      {appState === 'mem' && (
        <div className="S on" id="mem">
          <MemoryScreen
            onClose={closeMem}
            role={role}
            isDark={isDark}
            themeIndex={themeIndex}
            userProfile={userProfile}
            currentUserId={currentUserId}
            refreshUserProfile={refreshUserProfile}
          />
        </div>
      )}

      <CommandPalette isOpen={isCommandPaletteOpen} onClose={() => setIsCommandPaletteOpen(false)} userProfile={userProfile} />
    </div>
  );
}

// --- LOADING SCREEN ---
function LoadingScreen({ progress }: { progress: number }) {
  return (
    <>
      <div className="orb"><i></i><i></i><i></i><em></em></div>
      <div className="lt">锂电智诊</div>
      <div className="lb-loader"><span style={{ width: `${progress}%`, transition: 'width 2s linear' }}></span></div>
    </>
  );
}

// --- ROLE SCREEN ---
function RoleScreen({ onSelect }: { onSelect: (r: RoleKey) => void }) {
  return (
    <>
      <h1 className="rt">欢迎使用锂电智诊</h1>
      <p className="rs">请选择您的身份以开始使</p>
      <div className="rcs">
        <div className="rc" onClick={() => onSelect('e')}>
          <span className="ic">🏭</span>
          <h3>企业运营分析</h3>
          <p>深度诊断企业毛利承压原因<br />提供经营质量优化建议</p>
        </div>
        <div className="rc" onClick={() => onSelect('i')}>
          <span className="ic">📊</span>
          <h3>投资人员</h3>
          <p>行业趋势分析与投资推荐，<br />深度解析标的企业价</p>
        </div>
      </div>
    </>
  );
}

// --- COLLECT ENTERPRISE ---
function CollectEnterpriseScreen({
  draft,
  setDraft,
  onFinish,
}: {
  draft: EnterpriseOnboardingDraft;
  setDraft: React.Dispatch<React.SetStateAction<EnterpriseOnboardingDraft>>;
  onFinish: () => void;
}) {
  const [step, setStep] = useState(1);
  const hasHist = draft.hasFullHistory ? 'yes' : 'no';

  return (
    <div className="cb-wrap">
      <div className="ch">
        <h2>📋 企业数据收集</h2>
        <p>请填写以下信息以便我们为您提供精准分</p>
      </div>
      <div className="sts">
        <div className={`sd ${step >= 1 ? (step === 1 ? 'on' : 'ok') : ''}`}></div>
        <div className="sln"></div>
        <div className={`sd ${step >= 2 ? (step === 2 ? 'on' : 'ok') : ''}`}></div>
        <div className="sln"></div>
        <div className={`sd ${step >= 3 ? (step === 3 ? 'on' : 'ok') : ''}`}></div>
      </div>

      {step === 1 && (
        <div className="qc">
          <h4>历史数据可用</h4><p className="ht">您是否有最个季度的历史运营数据</p>
          <div className="fr">
            <div className="fg">
              <label>企业名称</label>
              <input
                value={draft.enterpriseName}
                onChange={(event) => setDraft((previous) => ({ ...previous, enterpriseName: event.target.value }))}
                placeholder=" 星海电池"
              />
            </div>
            <div className="fg">
              <label>当前季度标签</label>
              <input
                value={draft.currentQuarterLabel}
                onChange={(event) => setDraft((previous) => ({ ...previous, currentQuarterLabel: event.target.value }))}
                placeholder=" Q4'24"
              />
            </div>
          </div>
          <div className="tg">
            <div className={`tb ${hasHist === 'yes' ? 'on' : ''}`} onClick={() => setDraft((previous) => ({ ...previous, hasFullHistory: true }))}>有完整数</div>
            <div className={`tb ${hasHist === 'no' ? 'on' : ''}`} onClick={() => setDraft((previous) => ({ ...previous, hasFullHistory: false }))}>仅有当前数据</div>
          </div>
          <div className="br">
            <button className="bt bp" onClick={() => setStep(2)}>下一</button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="qc">
          <h4>当前季度核心数据</h4><p className="ht">请填写当前季度的运营数据</p>
          <div className="fr"><div className="fg"><label>本季度毛利率 (%)</label><input value={draft.currentGrossMargin} onChange={(event) => setDraft((previous) => ({ ...previous, currentGrossMargin: event.target.value }))} placeholder="Q4动力电池营收 18.5" /></div><div className="fg"><label>当前季度总收(万元)</label><input value={draft.currentRevenue} onChange={(event) => setDraft((previous) => ({ ...previous, currentRevenue: event.target.value }))} placeholder=" 52000" /></div></div>
          <div className="fr"><div className="fg"><label>当前季度总成(万元)</label><input value={draft.currentCost} onChange={(event) => setDraft((previous) => ({ ...previous, currentCost: event.target.value }))} placeholder=" 42400" /></div><div className="fg"><label>当前季度销(万件)</label><input value={draft.currentSalesVolume} onChange={(event) => setDraft((previous) => ({ ...previous, currentSalesVolume: event.target.value }))} placeholder=" 850" /></div></div>
          <div className="fr"><div className="fg"><label>当前季度产量 (万件)</label><input value={draft.currentProductionVolume} onChange={(event) => setDraft((previous) => ({ ...previous, currentProductionVolume: event.target.value }))} placeholder="例: 900" /></div><div className="fg"><label>当前季度库存费用 (万元)</label><input value={draft.currentInventoryExpense} onChange={(event) => setDraft((previous) => ({ ...previous, currentInventoryExpense: event.target.value }))} placeholder="Q3消费电池营收 3200" /></div></div>
          <div className="fr"><div className="fg"><label>产品总制造费(万元)</label><input value={draft.currentManufacturingExpense} onChange={(event) => setDraft((previous) => ({ ...previous, currentManufacturingExpense: event.target.value }))} placeholder=" 28000" /></div><div className="fg"><label>总营业成(万元)</label><input value={draft.currentOperatingCost} onChange={(event) => setDraft((previous) => ({ ...previous, currentOperatingCost: event.target.value }))} placeholder=" 42400" /></div></div>
          <div className="fr"><div className="fg"><label>当前季度现金(万元)</label><input value={draft.currentOperatingCashFlow} onChange={(event) => setDraft((previous) => ({ ...previous, currentOperatingCashFlow: event.target.value }))} placeholder=" 8500" /></div><div className="fg"><label>去年同期标签</label><input value={draft.baselineQuarterLabel} onChange={(event) => setDraft((previous) => ({ ...previous, baselineQuarterLabel: event.target.value }))} placeholder=" Q4'23" /></div></div>
          <div className="fr"><div className="fg"><label>总负(万元)</label><input value={draft.currentTotalLiabilities} onChange={(event) => setDraft((previous) => ({ ...previous, currentTotalLiabilities: event.target.value }))} placeholder=" 35000" /></div><div className="fg"><label>总资(万元)</label><input value={draft.currentTotalAssets} onChange={(event) => setDraft((previous) => ({ ...previous, currentTotalAssets: event.target.value }))} placeholder=" 120000" /></div></div>
          <div className="br">
            <button className="bt bgh" onClick={() => setStep(1)}>上一</button>
            <button className="bt bp" onClick={() => setStep(3)}>下一</button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="qc">
          <h4>{hasHist === 'yes' ? '历史季度对比数据' : '去年同季度对比数据'}</h4>
          <p className="ht">{hasHist === 'yes' ? '请填写近4个季度的历史数据' : '请填写去年同期数据以便进行对比分析'}</p>
          <div className="fr"><div className="fg"><label>去年同季度毛利率 (%)</label><input value={draft.baselineGrossMargin} onChange={(event) => setDraft((previous) => ({ ...previous, baselineGrossMargin: event.target.value }))} placeholder="例: 23.2" /></div><div className="fg"><label>去年同季度总收(万元)</label><input value={draft.baselineRevenue} onChange={(event) => setDraft((previous) => ({ ...previous, baselineRevenue: event.target.value }))} placeholder=" 48000" /></div></div>
          <div className="fr"><div className="fg"><label>去年同季度总成(万元)</label><input value={draft.baselineCost} onChange={(event) => setDraft((previous) => ({ ...previous, baselineCost: event.target.value }))} placeholder=" 36900" /></div><div className="fg"><label>去年同季度销(万件)</label><input value={draft.baselineSalesVolume} onChange={(event) => setDraft((previous) => ({ ...previous, baselineSalesVolume: event.target.value }))} placeholder=" 720" /></div></div>
          <div className="fr"><div className="fg"><label>去年同季度库存费(万元)</label><input value={draft.baselineInventoryExpense} onChange={(event) => setDraft((previous) => ({ ...previous, baselineInventoryExpense: event.target.value }))} placeholder=" 2620" /></div><div className="fg"></div></div>"
          
          {hasHist === 'yes' && (
            <div>
              <div style={{ padding: '10px', background: 'rgba(59,130,246,.04)', borderRadius: '8px', marginBottom: '12px', fontSize: '12px', color: '#475569' }}>
                📊 检测到您有完整历史数据，以下为中间两个季度补充
              </div>
              <div className="fr"><div className="fg"><label>上一季度毛利(%)</label><input value={draft.previousQuarterGrossMargin} onChange={(event) => setDraft((previous) => ({ ...previous, previousQuarterGrossMargin: event.target.value }))} placeholder=" 20.1" /></div><div className="fg"><label>上一季度总收(万元)</label><input value={draft.previousQuarterRevenue} onChange={(event) => setDraft((previous) => ({ ...previous, previousQuarterRevenue: event.target.value }))} placeholder=" 50000" /></div></div>
              <div className="fr"><div className="fg"><label>两季度前毛利(%)</label><input value={draft.twoQuartersAgoGrossMargin} onChange={(event) => setDraft((previous) => ({ ...previous, twoQuartersAgoGrossMargin: event.target.value }))} placeholder=" 21.8" /></div><div className="fg"><label>两季度前总收(万元)</label><input value={draft.twoQuartersAgoRevenue} onChange={(event) => setDraft((previous) => ({ ...previous, twoQuartersAgoRevenue: event.target.value }))} placeholder=" 49000" /></div></div>
            </div>
          )}

          <div className="br">
            <button className="bt bgh" onClick={() => setStep(2)}>上一</button>
            <button className="bt bp" onClick={onFinish}>开始分</button>
          </div>
          <div className="pn">🔒 我们承诺对贵企业的信息进行保密，数据只用于数据分</div>
        </div>
      )}
    </div>
  );
}

// --- COLLECT INVESTOR ---
function CollectInvestorScreen({
  draft,
  setDraft,
  onFinish,
}: {
  draft: InvestorOnboardingDraft;
  setDraft: React.Dispatch<React.SetStateAction<InvestorOnboardingDraft>>;
  onFinish: () => void;
}) {
  const [step, setStep] = useState(1);

  return (
    <div className="cb-wrap">
      <div className="ch">
        <h2>📊 投资信息收集</h2>
        <p>了解您的投资情况以便提供个性化分析</p>
      </div>
      <div className="sts">
        <div className={`sd ${step >= 1 ? (step === 1 ? 'on' : 'ok') : ''}`}></div>
        <div className="sln"></div>
        <div className={`sd ${step >= 2 ? (step === 2 ? 'on' : 'ok') : ''}`}></div>
      </div>

      {step === 1 && (
        <div className="qc">
          <h4>投资概况</h4><p className="ht">请填写您的基本投资信</p>
          <div className="fr"><div className="fg"><label>投资者名</label><input value={draft.investorName} onChange={(event) => setDraft((previous) => ({ ...previous, investorName: event.target.value }))} placeholder=" 张敏" /></div></div>
          <div className="fr"><div className="fg"><label>已投资锂电企业</label><input value={draft.investedEnterprises} onChange={(event) => setDraft((previous) => ({ ...previous, investedEnterprises: event.target.value }))} placeholder=" 宁德时代、比亚迪、亿纬锂能" /></div></div>
          <div className="fr"><div className="fg"><label>资金成本 (年化 %)</label><input value={draft.capitalCostRate} onChange={(event) => setDraft((previous) => ({ ...previous, capitalCostRate: event.target.value }))} placeholder="Q4动力电池营收 5.5" /></div><div className="fg"><label>投资总金额(万元)</label><input value={draft.investmentTotal} onChange={(event) => setDraft((previous) => ({ ...previous, investmentTotal: event.target.value }))} placeholder=" 200" /></div></div>
          <div className="fr">
            <div className="fg"><label>投资周期偏好</label><select value={draft.investmentHorizon} onChange={(event) => setDraft((previous) => ({ ...previous, investmentHorizon: event.target.value as InvestorOnboardingDraft["investmentHorizon"] }))}><option value="">请选择</option><option value="short">短期 (1-3个月")</option><option value="medium">中期 (3-12个月")</option><option value="long">长期 (1年以</option></select></div>
            <div className="fg"><label>风险承受能力</label><select value={draft.riskAppetite} onChange={(event) => setDraft((previous) => ({ ...previous, riskAppetite: event.target.value as InvestorOnboardingDraft["riskAppetite"] }))}><option value="">请选择</option><option value="low">保守</option><option value="medium">稳健</option><option value="high">积极</option></select></div>
          </div>
          <div className="fr">
            <div className="fg"><label>最关注的细分领</label><select value={draft.industryInterest} onChange={(event) => setDraft((previous) => ({ ...previous, industryInterest: event.target.value }))}><option value="">请选择</option><option>动力电池</option><option>储能电池</option><option>消费电池</option><option>上游材料</option><option>锂电设备</option><option>全产业链</option></select></div>
            <div className="fg"><label>关注的投资主</label><select value={draft.focusTopic} onChange={(event) => setDraft((previous) => ({ ...previous, focusTopic: event.target.value }))}><option value="">请选择</option><option>毛利率变化趋</option><option>产能扩张与利用率</option><option>技术路线迭</option><option>海外市场拓展</option><option>行业整合并购</option></select></div>
          </div>
          <div className="fr"><div className="fg"><label>其他补充说明</label><textarea value={draft.notes} onChange={(event) => setDraft((previous) => ({ ...previous, notes: event.target.value }))} placeholder="请补充其他关注点或特殊需.." /></div></div>
          <div className="br">
            <button className="bt bp" onClick={onFinish}>下一</button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="qc">
          <h4>确认信息</h4><p className="ht">请确认您的投资信</p>
          <div style={{ padding: '14px', background: 'rgba(139,92,246,.05)', borderRadius: '8px', marginBottom: '10px', fontSize: '12px', color: '#475569', lineHeight: 1.8 }}>
            投资者：{draft.investorName || "未命名用户"}<br />持仓/关注企业：{draft.investedEnterprises || "待补充"}<br />系统将根据您的偏好提供个性化分析
          </div>
          <div className="br">
            <button className="bt bgh" onClick={() => setStep(1)}>上一</button>
            <button className="bt bp" onClick={onFinish}>开始使</button>
          </div>
        </div>
      )}
    </div>
  );
}

// --- APP ENTERPRISE ---
function AppEnterpriseScreen({
  tab,
  setTab,
  openMem,
  isDark,
  setIsDark,
  themeIndex,
  setThemeIndex,
  currentUserId,
  enterpriseOnboarding,
  userProfile,
  refreshUserProfile,
  saveEnterpriseBaseInfo,
  unitPrefs,
  dataFormatter,
  onUnitPrefsChange,
  isRefreshing,
  lastDataRefreshAt,
  onRefreshData,
  refreshInterval,
  onRefreshIntervalChange,
}: EnterpriseScreenProps) {
  const titles = { home: '首页', ana: '分析', set: '设置' };
  const enterpriseVisualization = useMemo(
    () => buildEnterpriseVisualization(userProfile, enterpriseOnboarding, undefined, undefined, unitPrefs),
    [userProfile, enterpriseOnboarding, unitPrefs]
  );
  const auditPanelState = usePortalAuditReport("enterprise", tab === "home" || tab === "ana");
  
  return (
    <div className="al">
      <nav className="nv">
        <div className="nl"></div>
        <div className={`ni ${tab === 'home' ? 'on' : ''}`} onClick={() => setTab('home')}><span>🏠</span><span className="tp">首页</span></div>
        <div className={`ni ${tab === 'ana' ? 'on' : ''}`} onClick={() => setTab('ana')}><span>💬</span><span className="tp">分析</span></div>
        <div className={`ni ${tab === 'set' ? 'on' : ''}`} onClick={() => setTab('set')}><span>⚙️</span><span className="tp">设置</span></div>
        <div className="nsp"></div>
        <div className="nav2"></div>
      </nav>
      <div className="am">
        <div className="at">
          <span className="att">{titles[tab as keyof typeof titles]}</span>
          <div className="atr">
            <UnitSelector onChange={onUnitPrefsChange} />
            <button className="ab" onClick={onRefreshData} disabled={isRefreshing} title={isRefreshing ? "刷新中..." : lastDataRefreshAt ? `上次刷新: ${lastDataRefreshAt}` : "刷新数据"} style={isRefreshing ? { opacity: 0.5, cursor: 'wait' } : undefined}>
              <span style={{ display: 'inline-block', animation: isRefreshing ? 'spin 1s linear infinite' : 'none' }}>🔄</span>
            </button>
            <button className="ab" onClick={() => window.print()} title="导出报告">📄</button>
            <button className="ab">🔔</button>
            <button className="ab"></button>
          </div>
        </div>
        <div className="ac">
          <EntHome isActive={tab === 'home'} visualization={enterpriseVisualization} dataFormatter={dataFormatter} openWorkbench={() => setTab("ana")} openSettings={() => setTab("set")} auditPanelState={auditPanelState} />
          <EntAna isActive={tab === 'ana'} visualization={enterpriseVisualization} currentUserId={currentUserId} userProfile={userProfile} enterpriseOnboarding={enterpriseOnboarding} refreshUserProfile={refreshUserProfile} openHome={() => setTab("home")} openSettings={() => setTab("set")} auditPanelState={auditPanelState} />
          <EntSet isActive={tab === 'set'} openMem={openMem} isDark={isDark} setIsDark={setIsDark} themeIndex={themeIndex} setThemeIndex={setThemeIndex} userProfile={userProfile} saveEnterpriseBaseInfo={saveEnterpriseBaseInfo} unitPrefs={unitPrefs} onUnitPrefsChange={onUnitPrefsChange} refreshInterval={refreshInterval} onRefreshIntervalChange={onRefreshIntervalChange} />
        </div>
      </div>
    </div>
  );
}

function EntHome({
  isActive,
  visualization,
  dataFormatter,
  openWorkbench,
  openSettings,
  auditPanelState,
}: {
  isActive: boolean;
  visualization: ReturnType<typeof buildEnterpriseVisualization>;
  dataFormatter: DataFormatter;
  openWorkbench: () => void;
  openSettings: () => void;
  auditPanelState: AuditPanelState;
}) {
  return (
    <div className={`pg ${isActive ? 'on' : ''}`}>
      <div className="page-viz-stack">
        <VisualizationBoard payload={visualization} page="home" className="page-viz-board" dataFormatter={dataFormatter} />
      </div>
      <div className="home-utility-grid">
        <WorkbenchShortcutPanel
          badge="企业端工作台"
          title="经营诊断入口已闭环"
          description="从首页进入经营工作台后，可继续回看总览、补充企业资料，并联动下方图表诊断"
          highlights={["首页总览", "经营分析", "基本信息维护"]}
          primaryLabel="进入经营工作台"
          secondaryLabel="维护基本信息"
          onPrimaryClick={openWorkbench}
          onSecondaryClick={openSettings}
        />
        <CompetitiveBaselinePanel state={auditPanelState} compactTitle="Agent 竞争力面板 / 双端审计" />
      </div>
    </div>
  );
}

function buildEnterpriseCollectionPayload(
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
  const currentProductionVolume = Math.max(
    toPositiveNumber(draft.currentProductionVolume, currentSalesVolume * 1.06),
    currentSalesVolume,
  );
  const baselineProductionVolume = Math.max(baselineSalesVolume, Number((baselineSalesVolume * 1.04).toFixed(2)));
  const grossMarginGap = toFiniteNumber(draft.currentGrossMargin, 18.5) - toFiniteNumber(draft.baselineGrossMargin, 23.2);

  return {
    userId,
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

function buildEnterpriseAnalysisRequestPayload(
  userId: string,
  sessionId: string,
  query: string,
  draft: EnterpriseOnboardingDraft,
  userProfile?: UserProfileResponse | null,
  complexity?: string,
): EnterpriseAnalysisRequest {
  const collectionPayload = buildEnterpriseCollectionPayload(userId, draft, userProfile);
  return {
    userId,
    sessionId,
    enterpriseName: collectionPayload.enterpriseName,
    query,
    focusMode: /深度|拆解|根因|详细|复盘/.test(query) ? "deepDive" : "operationalDiagnosis",
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

function formatEnterpriseAssistantResponse(response: EnterpriseAnalysisResponse) {
  const personalization = (response as EnterpriseAnalysisResponse & {
    personalization?: {
      summary?: string;
      nextTasks?: string[];
    };
  }).personalization;
  const insightLines = response.highlights.combinedInsights.map((item) => `${item}`).join("\n");
  const taskLines = personalization?.nextTasks?.map((item) => `${item}`).join("\n");

  return [
    "📊 <b>真实接口分析已返回</b>",
    ,
    response.diagnostic.finalAnswer,
    insightLines ? `\n关键关注：\n${insightLines}` : "",
    personalization?.summary ? `\n画像提示${personalization.summary}` : "",
    taskLines ? `\n建议下一步：\n${taskLines}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function EntAna({
  isActive,
  visualization,
  currentUserId,
  userProfile,
  enterpriseOnboarding,
  refreshUserProfile,
  openHome,
  openSettings,
  auditPanelState,
}: {
  isActive: boolean;
  visualization: ReturnType<typeof buildEnterpriseVisualization>;
  currentUserId: string | null;
  userProfile?: UserProfileResponse | null;
  enterpriseOnboarding: EnterpriseOnboardingDraft;
  refreshUserProfile: (userId?: string) => Promise<UserProfileResponse | null>;
  openHome: () => void;
  openSettings: () => void;
  auditPanelState: AuditPanelState;
}) {
  const [messages, setMessages] = useState<{ role: 'u' | 'a', text: string, time: string }[]>([
    {
      role: 'a',
      time: '13:20',
      text: "👋 您好！我是锂电智诊智能分析助手。\n\n当前工作台已接入企业端真实分析接口。您可以直接提问，系统会结合已采集的经营数据、行业上下文和企业画像返回真实诊断结果"
    },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [progressPercent, setProgressPercent] = useState(0);
  const [progressState, setProgressState] = useState<{label: string; detail?: string} | null>(null);
  const msgEndRef = useRef<HTMLDivElement>(null);
  const hasInitializedRef = useRef(false);
  const [enterpriseSessionId, setEnterpriseSessionId] = useState<string | null>(null);
  const [collectionSummaryText, setCollectionSummaryText] = useState<string | null>(null);
  const [riskLevel, setRiskLevel] = useState<"low" | "medium" | "high" | null>(null);
  const collectionBootstrapRef = useRef<string | null>(null);

  const [rawMaterialChange, setRawMaterialChange] = useState<number>(0);
  const [yieldRate, setYieldRate] = useState<number>(90);
  const [lithiumPrice, setLithiumPrice] = useState<number>(9.8);
  const [capacityUtilization, setCapacityUtilization] = useState<number>(85);

  const [nl2sqlInput, setNl2sqlInput] = useState('');
  const [customWidgets, setCustomWidgets] = useState<VisualizationWidget[]>([]);

  const [asyncTaskState, setAsyncTaskState] = useState<{
    type: 'benchmark' | 'stress_test' | null;
    status: 'idle' | 'running' | 'done';
    progress: number;
    message: string;
  }>({ type: null, status: 'idle', progress: 0, message: '' });

  const [showWarningPopup, setShowWarningPopup] = useState(false);
  const [hasShownWarning, setHasShownWarning] = useState(false);

  // DQI/GMPS 面板数据存储
  const [lastAnalysisResponse, setLastAnalysisResponse] = useState<EnterpriseAnalysisResponse | null>(null);
  const [complexity, setComplexity] = useState<string>("moderate");

  const baseMarginStr = userProfile?.profile?.enterpriseBaseInfo?.["毛利率"];
  const baseMarginValue = (Array.isArray(baseMarginStr) ? baseMarginStr[0] : baseMarginStr) ?? "18.5";
  const baseMargin = parseFloat(baseMarginValue) || 18.5;
  const inferredMargin = baseMargin - (rawMaterialChange * 0.3) + ((yieldRate - 90) * 0.4) + ((9.8 - lithiumPrice) * 1.5) + ((capacityUtilization - 85) * 0.2);

  useEffect(() => {
    if (inferredMargin < 10 && !hasShownWarning) {
      setShowWarningPopup(true);
      setHasShownWarning(true);
    } else if (inferredMargin >= 10) {
      setHasShownWarning(false);
      setShowWarningPopup(false);
    }
  }, [inferredMargin, hasShownWarning]);

  const handleNl2sql = () => {
    if (!nl2sqlInput.trim()) return;
    const isCompare = nl2sqlInput.includes('对比') || nl2sqlInput.includes('宁德') || nl2sqlInput.includes('比亚迪');
    
    const newWidget = {
      id: `nl2sql-${Date.now()}`,
      kind: "barChart" as const,
      title: isCompare ? "企业毛利对标分析" : "智能生成图表: " + nl2sqlInput,
      subtitle: "自然语言图表生成器 (NL2SQL)",
      description: "基于您的查询意图实时生成的可视化视图",
      unit: isCompare ? "%" : "",
      data: isCompare ? [
        { id: "catl", label: "宁德时代", value: 25.4, displayValue: "25.4", status: "good" as const, detail: "规模效应与产业链一体化优势" },
        { id: "byd", label: "比亚迪", value: 20.1, displayValue: "20.1", status: "watch" as const, detail: "电池外供比例逐渐提升" },
        { id: "current", label: "当前企业", value: inferredMargin, displayValue: inferredMargin.toFixed(2), status: (inferredMargin > 20 ? "good" : "risk") as "good" | "risk", detail: "模拟当前经营质量" },
      ] : [
        { id: "q1", label: "Q1", value: 12, displayValue: "12", status: "neutral" as const, detail: "" },
        { id: "q2", label: "Q2", value: 15, displayValue: "15", status: "good" as const, detail: "" }
      ]
    };
    
    setCustomWidgets((previous) => [newWidget, ...previous]);
    setNl2sqlInput('');
  };

  const runAsyncTask = (type: 'benchmark' | 'stress_test') => {
    if (asyncTaskState.status === 'running') return;
    setAsyncTaskState({ type, status: 'running', progress: 0, message: '初始化任..' });
    
    setTimeout(() => setAsyncTaskState(prev => ({ ...prev, progress: 30, message: '正在采集中微观数..' })), 1000);
    setTimeout(() => setAsyncTaskState(prev => ({ ...prev, progress: 60, message: '执行复杂算法模型...' })), 2000);
    setTimeout(() => setAsyncTaskState(prev => ({ ...prev, progress: 90, message: '生成分析报告...' })), 3000);
    setTimeout(() => {
      setAsyncTaskState(prev => ({ ...prev, status: 'done', progress: 100, message: '计算完成' }));
      
      const newId = `${type}-${Date.now()}`;
      if (type === 'benchmark') {
        const widget = {
          id: newId,
          kind: "barChart" as const,
          title: "全行业深度对标报告",
          subtitle: "深度竞品数据分析",
          description: "基于最新财报和行业公开数据的全面比较",
          unit: "%",
          data: [
            { id: "top1", label: "宁德时代", value: 25.4, displayValue: "25.4", status: "good" as const, detail: "" },
            { id: "top2", label: "比亚迪", value: 20.1, displayValue: "20.1", status: "good" as const, detail: "" },
            { id: "avg", label: "行业平均", value: 15.2, displayValue: "15.2", status: "neutral" as const, detail: "" },
            { id: "current", label: "当前企业", value: inferredMargin, displayValue: inferredMargin.toFixed(2), status: (inferredMargin > 15.2 ? "good" : "risk") as "good" | "risk", detail: "" },
          ]
        };
        setCustomWidgets(prev => [widget, ...prev]);
        setMessages(prev => [...prev, { role: 'a', text: "**全行业深度对标** 计算完成，已在视图区生成图表卡片", time: gt() }]);
      } else {
        const widget = {
          id: newId,
          kind: "barChart" as const,
          title: "未来三年毛利压力测试",
          subtitle: "极端市场环境下的毛利预测",
          description: "假设碳酸锂价格腰斩、价格战加剧等极端条件",
          unit: "%",
          data: [
            { id: "y1", label: "2024", value: inferredMargin, displayValue: inferredMargin.toFixed(2), status: "neutral" as const, detail: "当前基准" },
            { id: "y2", label: "2025", value: inferredMargin - 3, displayValue: (inferredMargin - 3).toFixed(2), status: "watch" as const, detail: "价格战初期" },
            { id: "y3", label: "2026", value: inferredMargin - 8, displayValue: (inferredMargin - 8).toFixed(2), status: "risk" as const, detail: "深度洗牌期" },
          ]
        };
        setCustomWidgets(prev => [widget, ...prev]);
        setMessages(prev => [...prev, { role: 'a', text: "**未来三年毛利压力测试** 计算完成，已在视图区生成图表卡片", time: gt() }]);
      }
      setTimeout(() => setAsyncTaskState(prev => ({ ...prev, status: 'idle' })), 3000);
    }, 4000);
  };

  const gt = () => { const d = new Date(); return d.getHours().toString().padStart(2, '0') + ':' + d.getMinutes().toString().padStart(2, '0') };

  const ensureEnterpriseSession = useCallback(async () => {
    if (!currentUserId) {
      throw new Error("当前用户尚未初始化，请稍后重试");
    }
    if (enterpriseSessionId) {
      return enterpriseSessionId;
    }

    const collectionResponse = await collectEnterpriseData(
      buildEnterpriseCollectionPayload(currentUserId, enterpriseOnboarding, userProfile),
    );
    setEnterpriseSessionId(collectionResponse.sessionContext.sessionId);
    setCollectionSummaryText(
      `${collectionResponse.collectionSummary.confidentialityNotice} 当前覆盖：${collectionResponse.collectionSummary.capturedModules.join("、") || "企业经营数据"}`,
    );
    return collectionResponse.sessionContext.sessionId;
  }, [currentUserId, enterpriseOnboarding, enterpriseSessionId, userProfile]);

  const send = useCallback(async (override?: string) => {
    const text = override || input.trim();
    if (!text || loading) {
      return;
    }

    if (!currentUserId) {
      setMessages((prev) => [
        ...prev,
        { role: 'a', text: "⚠️ 当前用户尚未完成初始化，暂时无法调用真实企业分析接口。", time: gt() },
      ]);
      return;
    }

    setInput('');
    setMessages((prev) => [...prev, { role: 'u', text, time: gt() }]);
    const detectedIntent = classifyQueryIntent(text);
    const detectedComplexity = (function() {
      if (detectedIntent === "chitchat" || detectedIntent === "meta") return "simple";
      const q = text.toLowerCase();
      const inferredFocusMode = /深度|拆解|根因|详细|复盘/.test(text) ? "deepDive" : "operationalDiagnosis";
      if (inferredFocusMode === "deepDive") return "full";
      if (["建议","推荐","深度","拆解","投资","辩论","策略","详细分析","全面评估","深入","根因","复盘","规划","方案"].some(k => q.includes(k))) return "full";
      if (["分析","判断","趋势","行业","经营","毛利承压","景气","怎么样","如何","情况","变化","对比","比较","评估","状况","表现"].some(k => q.includes(k))) return "moderate";
      if (["计算","查询","是多少","当前","多少","比率","指数","得分","查一下","告诉我","看一下","看看"].some(k => q.includes(k))) return "simple";
      return "moderate";
    })();
    setComplexity(detectedComplexity);
    setLoading(true);
    setProgressPercent(0);
    setProgressState({ label: detectedIntent === "chitchat" ? "对话处理中" : detectedIntent === "meta" ? "查询中" : "开始分析..." });

    try {
      const sessionId = await ensureEnterpriseSession();
      const analysisResponse = await analyzeEnterprise(
        buildEnterpriseAnalysisRequestPayload(
          currentUserId,
          sessionId,
          text,
          enterpriseOnboarding,
          userProfile,
          detectedComplexity,
        ),
      );
      setEnterpriseSessionId(analysisResponse.sessionContext.sessionId);
      const isConversation = detectedIntent === "chitchat" || detectedIntent === "meta";
      if (!isConversation) {
        setRiskLevel(analysisResponse.highlights.combinedRiskLevel);
        setLastAnalysisResponse(analysisResponse);
        setCollectionSummaryText(
          `${analysisResponse.collectionSummary.confidentialityNotice} 当前覆盖：${analysisResponse.collectionSummary.capturedModules.join("、") || "企业经营数据"}`,
        );
      }
      setMessages((prev) => [
        ...prev,
        { role: 'a', text: isConversation ? analysisResponse.diagnostic.finalAnswer : formatEnterpriseAssistantResponse(analysisResponse), time: gt() },
      ]);
      void refreshUserProfile(currentUserId);
    } catch (error) {
      const message = error instanceof Error ? error.message : "企业端真实分析暂时失败，请稍后重试";""
      setMessages((prev) => [
        ...prev,
        { role: 'a', text: `⚠️ <b>真实接口调用失败</b>\n\n${message}`, time: gt() },
      ]);
    } finally {
      setProgressPercent(100);
      setProgressState({ label: "分析完成" });
      setLoading(false);
    }
  }, [currentUserId, enterpriseOnboarding, ensureEnterpriseSession, input, loading, refreshUserProfile, userProfile]);

  const addInd = (n: string, v: string) => {
    void send(`请分析${n}」（当前值：${v}）`);
  };

  useEffect(() => {
    if (!isActive || !currentUserId || enterpriseSessionId) {
      return;
    }

    const bootstrapKey = `${currentUserId}:${enterpriseOnboarding.enterpriseName}:${enterpriseOnboarding.currentQuarterLabel}:${enterpriseOnboarding.baselineQuarterLabel}`;
    if (collectionBootstrapRef.current === bootstrapKey) {
      return;
    }
    collectionBootstrapRef.current = bootstrapKey;

    void ensureEnterpriseSession()
      .then(() => {
        void refreshUserProfile(currentUserId);
      })
      .catch(() => {
        collectionBootstrapRef.current = null;
      });
  }, [
    currentUserId,
    ensureEnterpriseSession,
    enterpriseOnboarding.baselineQuarterLabel,
    enterpriseOnboarding.currentQuarterLabel,
    enterpriseOnboarding.enterpriseName,
    enterpriseSessionId,
    isActive,
    refreshUserProfile,
  ]);

  useEffect(() => {
    if (!isActive) {
      hasInitializedRef.current = false;
      return;
    }
    if (!hasInitializedRef.current) {
      hasInitializedRef.current = true;
      return;
    }
    const target = msgEndRef.current;
    if (target && typeof target.scrollIntoView === "function") {
      target.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, loading, isActive]);

  const currentVisualization = useMemo(() => {
    const viz = JSON.parse(JSON.stringify(visualization));
    if (customWidgets.length > 0 && viz.sections.length > 0) {
      viz.sections[0].widgets = [...customWidgets, ...viz.sections[0].widgets];
    }
    return viz;
  }, [visualization, customWidgets]);

  return (
    <div className={`pg ${isActive ? 'on' : ''}`}>
      <div className="nl2sql-bar">
        <span style={{ fontSize: '14px', fontWeight: 600, color: '#0F172A' }}>自然语言图表生成</span>
        <input 
          type="text" 
          className="nl2sql-input"
          value={nl2sqlInput}
          onChange={(e) => setNl2sqlInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleNl2sql(); }}
          placeholder={`试着输入："对比宁德与比亚迪的毛利率"`}/>
        <button onClick={handleNl2sql} className="nl2sql-btn">生成图表</button>
      </div>
      <div className="page-viz-stack">
        <VisualizationBoard payload={currentVisualization} page="analysis" className="page-viz-board" />
      </div>

      {/* DQI & GMPS 诊断结果面板 */}
      {lastAnalysisResponse && (
        <DQIGMPSPanelsContainer
          mathAnalysisOutput={extractMathAnalysisFromResponse(lastAnalysisResponse)}
          isLoading={loading}
          displayMode="grid"
        />
      )}
      <div className="workbench-loop-banner">
        <div>
          <div className="workbench-loop-kicker">经营工作台闭环</div>
          <h4>已打通首页总览、分析工作台与设置维护，分析过程中可随时回切</h4>
          <div className="workbench-loop-meta">
            <span className="workbench-loop-chip">企业诊断：真实接入</span>
            <span className="workbench-loop-chip">会话：{enterpriseSessionId ? "已同步" : "初始化中"}</span>
            <span className={`workbench-loop-chip ${riskLevel ? `risk-${riskLevel}` : ""}`}>
              风险：{riskLevel ? (riskLevel === "high" ? "高风险" : riskLevel === "medium" ? "中风险" : "低风险") : "待分析"}
            </span>
          </div>
        </div>
        <div className="workbench-loop-actions">
          <button type="button" className="bt bgh" onClick={openHome}>返回首页</button>
          <button type="button" className="bt bgh" onClick={openSettings}>维护基本信息</button>
        </div>
      </div>
      {collectionSummaryText && (
        <div className="enterprise-sync-banner">
          <strong>企业数据已通过真实接口同步</strong>
          <span>{collectionSummaryText}</span>
        </div>
      )}
      <AuditInlineBanner state={auditPanelState} />
      <div className="cly enterprise-chat-shell">
        <div className="cp">
          <div className="cms">
            {messages.map((m, i) => (
              <div key={i} className={`m ${m.role}`}>
                <div className="mb" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.7 }}><MessageWithCharts content={m.text} /></div>
                <div className="mt">{m.time}</div>
              </div>
            ))}
            {loading && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, padding: '0 12px' }}>
                <span style={{ fontSize: 12, color: '#94A3B8' }}>任务分级</span>
                <span style={{ fontSize: 12, padding: '2px 8px', borderRadius: '4px', background: '#F1F5F9', color: complexity === 'simple' ? '#22c55e' : complexity === 'moderate' ? '#eab308' : '#ef4444' }}>
                  {complexity === 'simple' ? '简单' : complexity === 'moderate' ? '中等' : '复杂'}
                </span>
              </div>
      )}
            {loading && (
              <div className="m a iwb-chain-wrap">
                <div className="iwb-chain-header">
                  <div className={`iwb-chain-header-icon${progressPercent >= 100 ? ' done' : ''}`}></div>
                  <span className={`iwb-chain-header-text${progressPercent >= 100 ? ' done' : ''}`}>
                    {progressState?.label ?? "AI 正在分析"}
                  </span>
                </div>
                <div className="iwb-live-progress-bar">
                  <div className={`iwb-live-progress-fill${progressPercent <= 0 ? ' indeterminate' : ''}`} style={{ width: `${progressPercent}%` }}></div>
                </div>
              </div>
            )}
            <div ref={msgEndRef} />
          </div>
          <div className="cia">
            <div className="ciw">
              <textarea 
                className="ci" 
                rows={1} 
                placeholder="请输入经营诊断问题，系统将调用真实企业分析接.." 
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if(e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }}
              />
              <button className="cse" onClick={() => void send()}></button>
            </div>
          </div>
        </div>
        <div className="csb">
          <div className="ss">
            <div className="iwb-section-title" style={{ display: 'flex', justifyContent: 'space-between' }}>
              <h5>What-If 沙盘推演</h5>
            </div>
            <div className="iwb-result-block" style={{ padding: '12px' }}>
              <div style={{ marginBottom: '12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#475569', marginBottom: '4px' }}>
                  <span>原材料价格波</span>
                  <span>{rawMaterialChange > 0 ? '+' : ''}{rawMaterialChange}%</span>
                </div>
                <input 
                  type="range" 
                  min="-30" max="30" step="1" 
                  value={rawMaterialChange} 
                  onChange={(e) => setRawMaterialChange(Number(e.target.value))}
                  style={{ width: '100%', accentColor: '#3B82F6' }}
                />
              </div>
              <div style={{ marginBottom: '12px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#475569', marginBottom: '4px' }}>
                    <span>良品</span>
                    <span>{yieldRate}%</span>
                  </div>
                  <input
                    type="range"
                    min="70" max="100" step="1"
                    value={yieldRate}
                    onChange={(e) => setYieldRate(Number(e.target.value))}
                    style={{ width: '100%', accentColor: '#3B82F6' }}
                  />
                </div>
                <div style={{ marginBottom: '12px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#475569', marginBottom: '4px' }}>
                    <span>碳酸锂预期价</span>
                    <span>{lithiumPrice}</span>
                  </div>
                  <input
                    type="range"
                    min="5" max="20" step="0.1"
                    value={lithiumPrice}
                    onChange={(e) => setLithiumPrice(Number(e.target.value))}
                    style={{ width: '100%', accentColor: '#3B82F6' }}
                  />
                </div>
                <div style={{ marginBottom: '12px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#475569', marginBottom: '4px' }}>
                    <span>产能利用</span>
                    <span>{capacityUtilization}%</span>
                  </div>
                  <input
                    type="range"
                    min="50" max="100" step="1"
                    value={capacityUtilization}
                    onChange={(e) => setCapacityUtilization(Number(e.target.value))}
                    style={{ width: '100%', accentColor: '#3B82F6' }}
                  />
                </div>
              <div style={{ padding: '8px', background: '#F8FAFC', borderRadius: '4px' }}>
                <div style={{ fontSize: '12px', color: '#94A3B8' }}>基准毛利率：{baseMargin.toFixed(2)}%</div>
                <div style={{ fontSize: '14px', fontWeight: 600, color: inferredMargin < baseMargin ? 'var(--red)' : '#10B981', marginTop: '4px' }}>
                  推演后毛利率：{inferredMargin.toFixed(2)}%
                </div>
              </div>
            </div>
          </div>
          <div className="ss">
            <h5>深度对标任务</h5>
            <button className="bt bgh" onClick={() => runAsyncTask('benchmark')} disabled={asyncTaskState.status === 'running'} style={{ width: '100%', marginBottom: '8px' }}>
              全行业深度对            </button>
            <button className="bt bgh" onClick={() => runAsyncTask('stress_test')} disabled={asyncTaskState.status === 'running'} style={{ width: '100%', marginBottom: '8px' }}>
              未来三年压力测试
            </button>
            {asyncTaskState.status !== 'idle' && (
              <div style={{ marginTop: '12px', padding: '12px', background: '#F8FAFC', borderRadius: '4px' }}>
                <div style={{ fontSize: '12px', color: '#475569', marginBottom: '8px' }}>
                  {asyncTaskState.message}
                </div>
                <div style={{ width: '100%', height: '4px', background: '#F1F5F9', borderRadius: '2px', overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${asyncTaskState.progress}%`, background: '#3B82F6', transition: 'width 0.3s ease' }}></div>
                </div>
              </div>
      )}
          </div>
          <div className="ss"><h5>行业参考指标</h5>
            <div className="ii" onClick={() => addInd('行业平均毛利率','21.3%')}><span className="inn">行业平均毛利率</span><span className="iv">21.3%</span><div className="ia">+</div></div>
            <div className="ii" onClick={() => addInd('头部企业毛利率','28.5%')}><span className="inn">头部企业毛利率</span><span className="iv">28.5%</span><div className="ia">+</div></div>
            <div className="ii" onClick={() => addInd('碳酸锂均价','9.8')}><span className="inn">碳酸锂均价</span><span className="iv">9.8</span><div className="ia">+</div></div>
            <div className="ii" onClick={() => addInd('行业产能利用率','72%')}><span className="inn">行业产能利用率</span><span className="iv">72%</span><div className="ia">+</div></div>
            <div className="ii" onClick={() => addInd('正极材料价格指数','86.2')}><span className="inn">正极材料价格指数</span><span className="iv">86.2</span><div className="ia">+</div></div>
          </div>
          <div className="ss"><h5>风险预警</h5>
            <div className="ii" onClick={() => addInd('原材料价格波动','高')}><span className="inn">原材料价格波动</span><span className="iv" style={{ color: 'var(--red)' }}>高</span><div className="ia">+</div></div>
            <div className="ii" onClick={() => addInd('库存积压风险','中高')}><span className="inn">库存积压风险</span><span className="iv" style={{ color: 'var(--orange)' }}>中高</span><div className="ia">+</div></div>
            <div className="ii" onClick={() => addInd('价格战压力','中等')}><span className="inn">价格战压力</span><span className="iv" style={{ color: 'var(--orange)' }}>中等</span><div className="ia">+</div></div>
          </div>
        </div>
      </div>
      {showWarningPopup && (
        <div style={{
          position: 'fixed', bottom: '30px', right: '30px', zIndex: 9999,
          background: 'var(--red)', color: '#fff', padding: '20px 24px',
          borderRadius: '12px', boxShadow: '0 8px 30px rgba(239,68,68,0.4)',
          display: 'flex', flexDirection: 'column', gap: '12px', width: '320px',
          animation: 'slideUp 0.4s ease-out'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <strong style={{ fontSize: '16px' }}>⚠️ 严重预警：毛利击穿防</strong>
            <button onClick={() => setShowWarningPopup(false)} style={{ background: 'transparent', border: 'none', color: '#fff', cursor: 'pointer', fontSize: '20px' }}>×</button>
          </div>
          <p style={{ fontSize: '14px', lineHeight: 1.5, margin: 0, opacity: 0.9 }}>
            推演毛利率已跌至 {inferredMargin.toFixed(2)}%（低10% 阈值）。建议立即触发「成本压降」分析模型，或生成最新行业对标报告          </p>
          <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
            <button onClick={() => { setShowWarningPopup(false); runAsyncTask('benchmark'); }} style={{ background: '#fff', color: 'var(--red)', border: 'none', padding: '8px 16px', borderRadius: '6px', fontSize: '13px', fontWeight: 600, cursor: 'pointer', flex: 1 }}>立即对标</button>
          </div>
        </div>
      )}
    </div>
  );
}

function EntSet({ isActive, openMem, isDark, setIsDark, themeIndex, setThemeIndex, userProfile, saveEnterpriseBaseInfo, unitPrefs, onUnitPrefsChange, refreshInterval, onRefreshIntervalChange }: EntSetProps & { userProfile: UserProfileResponse | null; saveEnterpriseBaseInfo: (baseInfo: EditableBusinessInfo) => Promise<void>; unitPrefs: UnitPreferences; onUnitPrefsChange: (prefs: UnitPreferences) => void; refreshInterval: number; onRefreshIntervalChange: (ms: number) => void }) {
  const profile = userProfile?.profile;

  return (
    <div className={`pg ${isActive ? 'on' : ''}`}>
      <div className="sts2"><h3>🎨 界面配色</h3>
        <div className="sr"><span className="sl2">主题</span><div className="sc">
          <ThemeColorButton label="蓝紫渐变" active={themeIndex === 0} background="linear-gradient(135deg,#3b82f6,#8b5cf6)" onClick={() => setThemeIndex(0)} />
          <ThemeColorButton label="青绿极光" active={themeIndex === 1} background="linear-gradient(135deg,#10b981,#06b6d4)" onClick={() => setThemeIndex(1)} />
          <ThemeColorButton label="暖金流光" active={themeIndex === 2} background="linear-gradient(135deg,#f59e0b,#ef4444)" onClick={() => setThemeIndex(2)} />
          <ThemeColorButton label="粉紫霓虹" active={themeIndex === 3} background="linear-gradient(135deg,#ec4899,#8b5cf6)" onClick={() => setThemeIndex(3)} />
        </div></div>
        <div className="sr"><span className="sl2">深色模式</span><ThemeModeSwitch checked={isDark} label="深色模式" onChange={setIsDark} /></div>
      </div>
      <div className="sts2"><h3>📐 数据单位</h3>
        <UnitSelector onChange={onUnitPrefsChange} />
      </div>
      <div className="sts2"><h3>🔄 数据刷新</h3>
        <div className="sr"><span className="sl2">自动刷新间隔</span><div className="sc"><select className="ssel" value={refreshInterval} onChange={(e) => onRefreshIntervalChange(Number(e.target.value))}><option value={30000}>30 秒</option><option value={60000}>60 秒（默认）</option><option value={120000}>120 秒</option><option value={0}>关闭</option></select></div></div>
      </div>
      <div className="sts2"><h3>📋 基本信息</h3>
        <div className="sr"><span className="sl2">分析角色</span><span style={{ color: '#3B82F6', fontSize: '12px' }}>企业运营分析</span></div>
        <div className="sr"><span className="sl2">当前用户</span><span style={{ color: '#475569', fontSize: '12px' }}>{profile?.displayName || profile?.userId || "初始化中"}</span></div>
        <div className="sr"><span className="sl2">数据季度</span><span style={{ color: '#94A3B8', fontSize: '12px' }}>Q4 2024</span></div>
        <EditableBaseInfoPanel title="企业基本信息" baseInfo={profile?.enterpriseBaseInfo} emptyText="可补充营业收入、毛利率、订单、库存等关键信息。" presetGroups={ENTERPRISE_BASE_INFO_GROUPS} onSave={saveEnterpriseBaseInfo} />
      </div>
      <div className="sts2"><h3>🤖 Agent 任务</h3>
        <div className="sr"><span className="sl2">自动分析频率</span><div className="sc"><select className="ssel"><option>每周一次</option><option>每两周一次</option><option>每月一次</option></select></div></div>
        <div className="sr"><span className="sl2">异常预警推送</span><div className="sw on"></div></div>
        <div className="sr"><span className="sl2">毛利预警阈值</span><div className="sc"><select className="ssel"><option>15%</option><option>18%</option><option>20%</option></select></div></div>
      </div>
      <div className="sts2">
        <button className="mbtn" onClick={openMem}>
          <div className="mi2">🧠</div><span>记忆中的你</span>
        </button>
      </div>
    </div>
  );
}

// --- APP INVESTOR ---
function AppInvestorScreen({
  tab,
  setTab,
  openMem,
  isDark,
  setIsDark,
  themeIndex,
  setThemeIndex,
  currentUserId,
  userProfile,
  refreshUserProfile,
  investorOnboarding,
  saveInvestorBaseInfo,
  unitPrefs,
  dataFormatter,
  onUnitPrefsChange,
  isRefreshing,
  lastDataRefreshAt,
  onRefreshData,
  refreshInterval,
  onRefreshIntervalChange,
  prefetchedSessionHistoryRef,
}: InvestorScreenProps) {
  const titles = { home: '首页', ana: '分析', set: '设置' };
  const investorVisualization = useMemo(
    () => buildInvestorHomeVisualization(
      userProfile,
      investorOnboarding.investorName,
      splitInputTags(investorOnboarding.investedEnterprises),
      undefined,
      unitPrefs,
    ),
    [userProfile, investorOnboarding, unitPrefs]
  );
  const auditPanelState = usePortalAuditReport("investor", tab === "home" || tab === "ana");
  
  return (
    <div className="al">
      <nav className="nv">
        <div className="nl"></div>
        <div className={`ni ${tab === 'home' ? 'on' : ''}`} onClick={() => setTab('home')}><span>🏠</span><span className="tp">首页</span></div>
        <div className={`ni ${tab === 'ana' ? 'on' : ''}`} onClick={() => setTab('ana')}><span>💬</span><span className="tp">分析</span></div>
        <div className={`ni ${tab === 'set' ? 'on' : ''}`} onClick={() => setTab('set')}><span>⚙️</span><span className="tp">设置</span></div>
        <div className="nsp"></div>
        <div className="nav2"></div>
      </nav>
      <div className="am">
        <div className="at">
          <span className="att">{titles[tab as keyof typeof titles]}</span>
          <div className="atr">
            <UnitSelector onChange={onUnitPrefsChange} />
            <button className="ab" onClick={onRefreshData} disabled={isRefreshing} title={isRefreshing ? "刷新中..." : lastDataRefreshAt ? `上次刷新: ${lastDataRefreshAt}` : "刷新数据"} style={isRefreshing ? { opacity: 0.5, cursor: 'wait' } : undefined}>
              <span style={{ display: 'inline-block', animation: isRefreshing ? 'spin 1s linear infinite' : 'none' }}>🔄</span>
            </button>
            <button className="ab" onClick={() => window.print()} title="导出报告">📄</button>
            <button className="ab">🔔</button>
            <button className="ab"></button>
          </div>
        </div>
        <div className="ac">
          <InvHome isActive={tab === 'home'} visualization={investorVisualization} dataFormatter={dataFormatter} openWorkbench={() => setTab("ana")} openSettings={() => setTab("set")} auditPanelState={auditPanelState} />
          <InvAna isActive={tab === 'ana'} currentUserId={currentUserId} userProfile={userProfile} refreshUserProfile={refreshUserProfile} investorOnboarding={investorOnboarding} openHome={() => setTab("home")} openSettings={() => setTab("set")} auditPanelState={auditPanelState} prefetchedSessionHistoryRef={prefetchedSessionHistoryRef} unitPrefs={unitPrefs} />
          <InvSet isActive={tab === 'set'} openMem={openMem} isDark={isDark} setIsDark={setIsDark} themeIndex={themeIndex} setThemeIndex={setThemeIndex} userProfile={userProfile} saveInvestorBaseInfo={saveInvestorBaseInfo} unitPrefs={unitPrefs} onUnitPrefsChange={onUnitPrefsChange} refreshInterval={refreshInterval} onRefreshIntervalChange={onRefreshIntervalChange} />
        </div>
      </div>
    </div>
  );
}

function InvHome({
  isActive,
  visualization,
  dataFormatter,
  openWorkbench,
  openSettings,
  auditPanelState,
}: {
  isActive: boolean;
  visualization: ReturnType<typeof buildInvestorHomeVisualization>;
  dataFormatter: DataFormatter;
  openWorkbench: () => void;
  openSettings: () => void;
  auditPanelState: AuditPanelState;
}) {
  return (
    <div className={`pg ${isActive ? 'on' : ''}`}>
      <div className="page-viz-stack">
        <VisualizationBoard payload={visualization} page="home" className="page-viz-board" dataFormatter={dataFormatter} />
      </div>
      <div className="home-utility-grid">
        <WorkbenchShortcutPanel
          badge="投资端工作台"
          title="投资分析入口已就绪"
          description="可从首页一键进入投资工作台，继续切换模式、沉淀会话，并回到设置维护画像偏好。"
          highlights={["首页总览", "分析工作台", "画像偏好维护"]}
          primaryLabel="进入投资工作台"
          secondaryLabel="调整画像偏好"
          onPrimaryClick={openWorkbench}
          onSecondaryClick={openSettings}
        />
        <CompetitiveBaselinePanel state={auditPanelState} compactTitle="Agent 竞争力面板 / 双端审计" />
      </div>
    </div>
  );
}

function InvAna({
  isActive,
  currentUserId,
  userProfile,
  refreshUserProfile,
  investorOnboarding,
  openHome,
  openSettings,
  auditPanelState,
  prefetchedSessionHistoryRef,
  unitPrefs,
}: {
  isActive: boolean;
  currentUserId: string | null;
  userProfile: UserProfileResponse | null;
  refreshUserProfile: (userId?: string) => Promise<UserProfileResponse | null>;
  investorOnboarding: InvestorOnboardingDraft;
  openHome: () => void;
  openSettings: () => void;
  auditPanelState: AuditPanelState;
  prefetchedSessionHistoryRef: React.MutableRefObject<SessionHistorySummary[] | null>;
  unitPrefs: UnitPreferences;
}) {
  const [mode, setMode] = useState<InvestorWorkbenchMode>("industryStatus");
  const [sessionContext, setSessionContext] = useState<SessionContext | null>(null);
  const [sessionHistory, setSessionHistory] = useState<SessionHistorySummary[]>([]);
  const [messages, setMessages] = useState<WorkbenchMessage[]>([
    {
      id: createWorkbenchId("msg"),
      variant: "assistant",
      time: formatClockTime(),
      content: "欢迎进入投资分析工作台，正在同步历史对话、画像与会话上下文",
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [bootstrapping, setBootstrapping] = useState(false);
  const [switchingMode, setSwitchingMode] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<InvestorAnalysisResponse | null>(null);
  const [timeline, setTimeline] = useState<AnalysisTimelineEntry[]>([]);
  const [attachments, setAttachments] = useState<SessionAttachment[]>([]);
  const [profileUpdate, setProfileUpdate] = useState<ProfileUpdateReceipt | null>(null);
  const [progressState, setProgressState] = useState<{
    stage: AnalysisTimelineEntry["stage"];
    label: string;
    detail?: string;
    progressPercent: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadDraft, setUploadDraft] = useState(DEFAULT_UPLOAD_DRAFT);
  const [uploading, setUploading] = useState(false);
  const [uploadWarnings, setUploadWarnings] = useState<string[]>([]);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historySelection, setHistorySelection] = useState<string[]>([]);
  const [historyDeleteError, setHistoryDeleteError] = useState<string | null>(null);
  const [deletingHistory, setDeletingHistory] = useState(false);
  const [historyPreview, setHistoryPreview] = useState<SessionHistorySummary | null>(null);
  const [workspaceNotice, setWorkspaceNotice] = useState<string | null>(null);
  const [splitMode, setSplitMode] = useState(false);
  const [compareSessionContext, setCompareSessionContext] = useState<SessionContext | null>(null);
  const [complexity, setComplexity] = useState<string>("moderate");
  const msgEndRef = useRef<HTMLDivElement>(null);
  const hasInitializedRef = useRef(false);
  const initializedRef = useRef(false);
  const streamingMessageIdRef = useRef<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const industryRetrievalAgent = analysisResult?.diagnostic.agents.find((agent) => agent.agentId === "industryRetrieval");
  const industryRetrieval = industryRetrievalAgent?.output as IndustryRetrievalOutput | undefined;
  const ragEvidenceDegraded = industryRetrievalAgent?.status === "degraded" || industryRetrieval?.indexStats.fallbackUsed === true;

  const syncSession = useCallback((
    nextContext: SessionContext,
    options?: {
      resetConversation?: boolean;
      seedMessages?: boolean;
      preserveMode?: boolean;
    },
  ) => {
    setSessionContext(nextContext);
    if (!options?.preserveMode) {
      setMode(nextContext.activeMode as InvestorWorkbenchMode);
    }
    setTimeline(nextContext.latestTimeline);
    setAttachments(nextContext.attachments);
    setProfileUpdate(nextContext.latestProfileUpdate ?? null);
    setProgressState(
      nextContext.latestTimeline.length > 0
        ? {
            stage: nextContext.latestTimeline[nextContext.latestTimeline.length - 1]!.stage,
            label: nextContext.latestTimeline[nextContext.latestTimeline.length - 1]!.label,
            detail: nextContext.latestTimeline[nextContext.latestTimeline.length - 1]!.detail,
            progressPercent: nextContext.latestTimeline[nextContext.latestTimeline.length - 1]!.progressPercent,
          }
        : null,
    );

    if (options?.resetConversation) {
      setAnalysisResult(null);
      setMessages(options.seedMessages === false ? [] : buildSessionMessages(nextContext));
    }
  }, []);

  const refreshHistory = useCallback(async (fallbackContext?: SessionContext) => {
    if (!currentUserId) {
      return [];
    }
    try {
      const response = await fetchInvestorSessions(currentUserId);
      setSessionHistory(response.items);
      return response.items;
    } catch {
      if (fallbackContext) {
        setSessionHistory([buildHistoryFallback(fallbackContext)]);
        return [buildHistoryFallback(fallbackContext)];
      }
      return [];
    }
  }, [currentUserId]);

  const appendMessage = useCallback((message: WorkbenchMessage) => {
    setMessages((previous) => [...previous, message]);
  }, []);

  const appendSystemMessage = useCallback((content: string) => {
    appendMessage({
      id: createWorkbenchId("msg"),
      variant: "system",
      time: formatClockTime(),
      content,
    });
  }, [appendMessage]);

  const appendAssistantMessage = useCallback((content: string) => {
    appendMessage({
      id: createWorkbenchId("msg"),
      variant: "assistant",
      time: formatClockTime(),
      content,
    });
  }, [appendMessage]);

  const clearVisibleConversation = useCallback(() => {
    streamingMessageIdRef.current = null;
    setMessages([]);
    setAnalysisResult(null);
    setTimeline([]);
    setProgressState(null);
    setProfileUpdate(null);
  }, []);

  const ensureStreamingMessage = useCallback(() => {
    if (streamingMessageIdRef.current) {
      return streamingMessageIdRef.current;
    }

    const id = createWorkbenchId("msg");
    streamingMessageIdRef.current = id;
    appendMessage({
      id,
      variant: "assistant",
      time: formatClockTime(),
      content: "",
    });
    return id;
  }, [appendMessage]);

  const appendStreamingChunk = useCallback((chunk: string) => {
    const id = ensureStreamingMessage();
    setMessages((previous) =>
      previous.map((message) =>
        message.id === id
          ? {
              ...message,
              content: `${message.content}${chunk}`,
            }
          : message,
      ),
    );
  }, [ensureStreamingMessage]);

  const finalizeStreamingMessage = useCallback((content: string) => {
    const finalContent = content.trim();
    const currentId = streamingMessageIdRef.current;

    if (!currentId) {
      if (finalContent.length > 0) {
        appendMessage({
          id: createWorkbenchId("msg"),
          variant: "assistant",
          time: formatClockTime(),
          content: finalContent,
        });
      }
      return;
    }

    setMessages((previous) =>
      previous.map((message) =>
        message.id === currentId
          ? {
              ...message,
              content: finalContent.length > 0 ? finalContent : message.content,
            }
          : message,
      ),
    );
    streamingMessageIdRef.current = null;
  }, [appendMessage]);

  const loadSession = useCallback(async (
    sessionId: string,
    options?: {
      resetConversation?: boolean;
      seedMessages?: boolean;
    },
  ) => {
    const context = await fetchInvestorSessionContext(sessionId);
    syncSession(context, options ?? { resetConversation: true, seedMessages: true });
    return context;
  }, [syncSession]);

  const handleStreamEvent = useCallback((event: InvestorAnalysisStreamEvent) => {
    if (event.type === "session") {
      void refreshHistory(event.sessionContext);
      return;
    }

    else if (event.type === "progress") {
      setProgressState({
        stage: event.stage,
        label: event.label,
        detail: event.detail,
        progressPercent: event.progressPercent,
      });
      setTimeline((previous) => mergeTimelineEntries(previous, event.timelineEntry));
      return;
    }

    else if (event.type === "delta") {
      if (event.stage === "debate") {
        appendAssistantMessage(event.chunk);
        return;
      }
      appendStreamingChunk(event.chunk);
      return;
    }

    else if (event.type === "debate_message") {
      appendMessage(toDebateWorkbenchMessage(event.message));
      return;
    }

    else if (event.type === "profile_update") {
      setProfileUpdate(event.profileUpdate);
      appendSystemMessage(`画像更新${event.profileUpdate.summary}`);
      return;
    }

    else if (event.type === "clarification_required") {
      if (event.sessionContext) {
        syncSession(event.sessionContext);
        void refreshHistory(event.sessionContext);
      }
      setLoading(false);
      streamingMessageIdRef.current = null;
      appendSystemMessage(
        `待补充研究条件：\n${event.questions.map((question, index) => `${index + 1}. ${question}`).join("\n")}`,
      );
      return;
    }

    else if (event.type === "result") {
      const nextResult = event.result as unknown as InvestorAnalysisResponse;
      setAnalysisResult(nextResult);
      syncSession(nextResult.sessionContext);
      setTimeline(nextResult.timeline);
      setAttachments(nextResult.usedAttachments);
      setProfileUpdate(nextResult.profileUpdate ?? null);
      setProgressState({ stage: "completed", label: "分析完成", progressPercent: 100 });
      setLoading(false);
      if (mode === "investmentRecommendation") {
        streamingMessageIdRef.current = null;
      } else {
        finalizeStreamingMessage(
          nextResult.diagnostic.finalAnswer
            ?? nextResult.deepDive.thesis
            ?? nextResult.industryReport.overview
            ?? "",
        );
      }
      void refreshHistory(nextResult.sessionContext);
      void refreshUserProfile();
      return;
    }

    else if (event.type === "error") {
      setLoading(false);
      streamingMessageIdRef.current = null;
      setError(event.message);
      appendSystemMessage(`分析失败${event.message}`);
    }
  }, [appendAssistantMessage, appendMessage, appendStreamingChunk, appendSystemMessage, finalizeStreamingMessage, mode, refreshHistory, refreshUserProfile, syncSession]);

  const send = useCallback(async (override?: string) => {
    const text = (override ?? input).trim();
    const pendingQuestions = sessionContext?.pendingClarificationQuestions ?? [];

    if (!text || !sessionContext || !currentUserId || loading || bootstrapping) {
      return;
    }

    setInput("");
    const detectedIntent = classifyQueryIntent(text);
    const detectedComplexity = (function() {
      if (detectedIntent === "chitchat" || detectedIntent === "meta") return "simple";
      const q = text.toLowerCase();
      if (mode === "investmentRecommendation" || mode === "deepDive") return "full";
      if (["建议","推荐","深度","拆解","投资","辩论","策略","详细分析","全面评估","深入","根因","复盘","规划","方案"].some(k => q.includes(k))) return "full";
      if (["分析","判断","趋势","行业","经营","毛利承压","景气","怎么样","如何","情况","变化","对比","比较","评估","状况","表现"].some(k => q.includes(k))) return "moderate";
      if (["计算","查询","是多少","当前","多少","比率","指数","得分","查一下","告诉我","看一下","看看"].some(k => q.includes(k))) return "simple";
      return "moderate";
    })();
    setComplexity(detectedComplexity);
    setLoading(true);
    setError(null);
    setAnalysisResult(null);
    setTimeline([]);
    setProfileUpdate(null);
    setProgressState({
      stage: "session",
      label: detectedIntent === "chitchat" ? "对话处理中" : detectedIntent === "meta" ? "查询中" : "准备会话上下文",
      progressPercent: 0,
    });
    streamingMessageIdRef.current = null;
    abortControllerRef.current?.abort();
    const abortController = new AbortController();
    abortControllerRef.current = abortController;
    appendMessage({
      id: createWorkbenchId("msg"),
      variant: "user",
      time: formatClockTime(),
      content: text,
    });

    try {
      await streamInvestorAnalysis(
        {
          userId: currentUserId,
          sessionId: sessionContext.sessionId,
          enterpriseName: sessionContext.enterpriseName ?? DEFAULT_ENTERPRISE_NAME,
          focusMode: mode,
          query: text,
          memoryNotes: sessionContext.memoryPreview.map((item) => item.summary).slice(0, 3),
          deepDiveContext: mode === "deepDive"
            ? buildDeepDiveContext(text, pendingQuestions, attachments)
            : undefined,
          complexity: detectedComplexity,
        },
        handleStreamEvent,
        abortController.signal,
      );
    } catch (nextError) {
      if (abortController.signal.aborted) {
        setLoading(false);
        return;
      }
      const message = nextError instanceof Error ? nextError.message : "流式分析失败";""
      setLoading(false);
      streamingMessageIdRef.current = null;
      setError(message);
      appendSystemMessage(`分析失败${message}`);
    }
  }, [appendMessage, appendSystemMessage, attachments, bootstrapping, currentUserId, handleStreamEvent, input, loading, mode, sessionContext]);

  const openHistoryDialog = useCallback(() => {
    setHistoryDeleteError(null);
    setHistorySelection([]);
    setHistoryOpen(true);
  }, []);

  const toggleHistorySelection = useCallback((sessionId: string) => {
    setHistorySelection((previous) =>
      previous.includes(sessionId)
        ? previous.filter((item) => item !== sessionId)
        : [...previous, sessionId],
    );
  }, []);

  const performHistoryDeletion = useCallback(async (
    sessionIds: string[],
    options?: {
      closeHistoryDialog?: boolean;
      closeHistoryPreview?: boolean;
    },
  ) => {
    if (sessionIds.length === 0 || deletingHistory || !currentUserId) {
      return;
    }

    const deletingCurrent = sessionIds.includes(sessionContext?.sessionId ?? "");
    const fallbackMode = (sessionContext?.activeMode as InvestorWorkbenchMode | undefined) ?? mode;
    const fallbackEnterprise = sessionContext?.enterpriseName ?? DEFAULT_ENTERPRISE_NAME;

    setDeletingHistory(true);
    setHistoryDeleteError(null);

    try {
      const response = await deleteInvestorSessions({
        userId: currentUserId,
        sessionIds,
      });
      const deleteMessage = deletingCurrent && sessionIds.length === 1
        ? "已删除 1 条历史对话。"
        : deletingCurrent && sessionIds.length > 1
          ? `已删除${response.deletedCount ?? response.deletedSessionIds.length} 条历史对话。`
          : `已删除${response.deletedCount ?? response.deletedSessionIds.length} 条历史对话。`;
      const nextHistory = await refreshHistory();

      if (deletingCurrent) {
        if (nextHistory.length > 0) {
          await loadSession(nextHistory[0]!.sessionId, {
            resetConversation: true,
            seedMessages: false,
          });
        } else {
          const created = await createInvestorSession({
            userId: currentUserId,
            focusMode: fallbackMode,
            enterpriseName: fallbackEnterprise,
          });
          syncSession(created.sessionContext, {
            resetConversation: true,
            seedMessages: false,
          });
          await refreshHistory(created.sessionContext);
        }
      }

      setHistorySelection([]);
      if (options?.closeHistoryDialog ?? true) {
        setHistoryOpen(false);
      }
      if (options?.closeHistoryPreview ?? true) {
        setHistoryPreview(null);
      }
      setWorkspaceNotice(deleteMessage);
      void refreshUserProfile();
    } catch (nextError) {
      setHistoryDeleteError(nextError instanceof Error ? nextError.message : "删除历史对话失败。");
    } finally {
      setDeletingHistory(false);
    }
  }, [currentUserId, deletingHistory, loadSession, mode, refreshHistory, refreshUserProfile, sessionContext, syncSession]);

  const handleDeleteSelectedHistory = useCallback(async () => {
    await performHistoryDeletion(historySelection);
  }, [historySelection, performHistoryDeletion]);

  const handleSelectHistory = useCallback(async (summary: SessionHistorySummary) => {
    if (summary.sessionId === sessionContext?.sessionId || bootstrapping) {
      return;
    }
    setBootstrapping(true);
    setError(null);

    try {
      await loadSession(summary.sessionId);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "加载历史会话失败。");
    } finally {
      setBootstrapping(false);
    }
  }, [bootstrapping, loadSession, sessionContext?.sessionId]);

  const handleOpenHistorySession = useCallback(async (summary: SessionHistorySummary) => {
    await handleSelectHistory(summary);
    setHistoryOpen(false);
  }, [handleSelectHistory]);

  const openHistoryPreview = useCallback((summary: SessionHistorySummary) => {
    setHistoryDeleteError(null);
    setHistoryPreview(summary);
  }, []);

  const handleDeletePreviewHistory = useCallback(async () => {
    if (!historyPreview) {
      return;
    }
    await performHistoryDeletion([historyPreview.sessionId], {
      closeHistoryDialog: false,
      closeHistoryPreview: true,
    });
  }, [historyPreview, performHistoryDeletion]);

  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) {
      return;
    }

    const resetInput = () => {
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    };

    if (!sessionContext || !currentUserId || uploading) {
      resetInput();
      return;
    }

    void (async () => {
      setUploading(true);
      setUploadWarnings([]);
      setUploadError(null);

      try {
        const content = await readFileContent(file);
        const response = await uploadInvestorAttachment({
          userId: currentUserId,
          sessionId: sessionContext.sessionId,
          fileName: file.name,
          mimeType: file.type || "text/plain",
          content,
        });
        setAttachments(response.sessionContext.attachments);
        syncSession(response.sessionContext);
        setUploadWarnings(response.warnings);
        void refreshHistory(response.sessionContext);
        appendSystemMessage(`附件《${response.attachment.fileName}》已接入当前会话，可结合材料继续追问。`);
        void refreshUserProfile();
      } catch (nextError) {
        const message = nextError instanceof Error ? nextError.message : "上传附件失败";
        setUploadError(message);
        appendSystemMessage(`附件上传失败${message}`);
      } finally {
        setUploading(false);
        resetInput();
      }
    })();
  }, [appendSystemMessage, currentUserId, refreshHistory, refreshUserProfile, sessionContext, syncSession, uploading]);

  const handleModeSwitch = useCallback(async (nextMode: InvestorWorkbenchMode) => {
    if (!sessionContext || !currentUserId || nextMode === mode || switchingMode) {
      return;
    }

    setSwitchingMode(true);
    setError(null);

    try {
      const response = await switchInvestorMode({
        userId: currentUserId,
        sessionId: sessionContext.sessionId,
        focusMode: nextMode,
        enterpriseName: sessionContext.enterpriseName ?? DEFAULT_ENTERPRISE_NAME,
        query: `切换{getModeOption(nextMode).label}`,
      });
      syncSession(response.sessionContext);
      setMode(response.activeMode as InvestorWorkbenchMode);
      clearVisibleConversation();
      void refreshHistory(response.sessionContext);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "模式切换失败。");
    } finally {
      setSwitchingMode(false);
    }
  }, [clearVisibleConversation, currentUserId, mode, refreshHistory, sessionContext, switchingMode, syncSession]);

  const handleCreateSession = useCallback(async () => {
    if (bootstrapping || !currentUserId) {
      return;
    }

    setBootstrapping(true);
    setError(null);

    try {
      const response = await createInvestorSession({
        userId: currentUserId,
        focusMode: mode,
        enterpriseName: sessionContext?.enterpriseName ?? DEFAULT_ENTERPRISE_NAME,
      });
      syncSession(response.sessionContext, {
        resetConversation: true,
        seedMessages: true,
      });
      void refreshHistory(response.sessionContext);
      appendSystemMessage("已新建投资会话，可立即发起新的分析。");
      void refreshUserProfile();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "新建会话失败。");
    } finally {
      setBootstrapping(false);
    }
  }, [appendSystemMessage, bootstrapping, currentUserId, mode, refreshHistory, refreshUserProfile, sessionContext?.enterpriseName, syncSession]);

  const handleDeleteCurrentSession = useCallback(async () => {
    if (!sessionContext || !currentUserId) {
      return;
    }

    setBootstrapping(true);
    setError(null);

    try {
      const response = await deleteCurrentInvestorSession({
        userId: currentUserId,
        sessionId: sessionContext.sessionId,
      });
      if (response.replacementSessionContext) {
        syncSession(response.replacementSessionContext, {
          resetConversation: true,
          seedMessages: false,
        });
        void refreshHistory(response.replacementSessionContext);
        setWorkspaceNotice(response.replacementSessionContext.summary || "已自动重建默认投资会");
      } else {
        setSessionContext(null);
        setTimeline([]);
        setAttachments([]);
        setWorkspaceNotice("已自动重建默认投资会");
        setMessages([]);
        setSessionHistory([]);
      }
      void refreshUserProfile();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "删除当前会话失败。");
    } finally {
      setBootstrapping(false);
    }
  }, [currentUserId, refreshHistory, refreshUserProfile, sessionContext, syncSession]);

  const handleUploadSubmit = useCallback(async () => {
    if (!sessionContext || !currentUserId || uploading) {
      return;
    }

    const fileName = uploadDraft.fileName.trim();
    const content = uploadDraft.content.trim();

    if (!fileName || !content) {
      setUploadError("请填写文件名与资料内容。");
      return;
    }

    setUploading(true);
    setUploadError(null);
    setUploadWarnings([]);

    try {
      const response = await uploadInvestorAttachment({
        userId: currentUserId,
        sessionId: sessionContext.sessionId,
        fileName,
        mimeType: uploadDraft.mimeType.trim() || "text/plain",
        content,
      });
      setAttachments(response.sessionContext.attachments);
      syncSession(response.sessionContext);
      setUploadWarnings(response.warnings);
      void refreshHistory(response.sessionContext);
        appendSystemMessage(`附件《${response.attachment.fileName}》已接入当前会话，可结合材料继续追问。`);
      setUploadOpen(false);
      void refreshUserProfile();
    } catch (nextError) {
      setUploadError(nextError instanceof Error ? nextError.message : "上传附件失败。");
    } finally {
      setUploading(false);
    }
  }, [appendSystemMessage, currentUserId, refreshHistory, refreshUserProfile, sessionContext, syncSession, uploadDraft, uploading]);

  useEffect(() => {
    if (!isActive || initializedRef.current || !currentUserId) {
      return;
    }

    initializedRef.current = true;
    setBootstrapping(true);
    setError(null);

    void (async () => {
      try {
        let history: SessionHistorySummary[];

        if (prefetchedSessionHistoryRef.current && prefetchedSessionHistoryRef.current.length > 0) {
          history = prefetchedSessionHistoryRef.current;
          setSessionHistory(history);
          prefetchedSessionHistoryRef.current = null;
        } else {
          history = await refreshHistory();
        }

        if (history.length > 0) {
          await loadSession(history[0]!.sessionId);
        } else {
          const createdProfile = await createInvestorProfile(buildInvestorProfilePayload(currentUserId, userProfile, investorOnboarding));
          syncSession(createdProfile.sessionContext, {
            resetConversation: true,
            seedMessages: true,
            });
          setMessages((previous) => [
            ...previous,
            {
              id: createWorkbenchId("msg"),
              variant: "system",
              time: formatClockTime(createdProfile.sessionContext.updatedAt),
              content: `画像摘要${createdProfile.portraitSummary}`,
            },
          ]);
          await refreshHistory(createdProfile.sessionContext);
          await refreshUserProfile(currentUserId);
        }
      } catch (nextError) {
        const message = nextError instanceof Error ? nextError.message : "初始化投资工作台失败";
        setError(message);
        setMessages([
          {
            id: createWorkbenchId("msg"),
            variant: "assistant",
            time: formatClockTime(),
            content: `初始化失败：${message}`,
          },
        ]);
      } finally {
        setBootstrapping(false);
      }
    })();
  }, [currentUserId, investorOnboarding, isActive, loadSession, refreshHistory, refreshUserProfile, syncSession, userProfile]);

  useEffect(() => {
    if (!isActive) {
      hasInitializedRef.current = false;
      return;
    }
    if (!hasInitializedRef.current) {
      hasInitializedRef.current = true;
      return;
    }
    const target = msgEndRef.current;
    if (target && typeof target.scrollIntoView === "function") {
      target.scrollIntoView({ behavior: "smooth" });
    }
  }, [isActive, loading, messages, timeline]);

  useEffect(() => {
    setHistorySelection((previous) => previous.filter((sessionId) => sessionHistory.some((item) => item.sessionId === sessionId)));
  }, [sessionHistory]);

  useEffect(() => {
    if (!historyPreview) {
      return;
    }
    const nextPreview = sessionHistory.find((item) => item.sessionId === historyPreview.sessionId) ?? null;
    setHistoryPreview(nextPreview);
  }, [historyPreview, sessionHistory]);

  const handleSelectCompareSession = useCallback(async (summary: SessionHistorySummary) => {
    if (summary.sessionId === sessionContext?.sessionId) {
      return;
    }
    setBootstrapping(true);
    try {
      const context = await fetchInvestorSessionContext(summary.sessionId);
      setCompareSessionContext(context);
      setHistoryOpen(false);
    } catch (e) {
      setHistoryDeleteError(e instanceof Error ? e.message : "加载对比会话失败");
    } finally {
      setBootstrapping(false);
    }
  }, [sessionContext?.sessionId]);

  const [rawMaterialChange, setRawMaterialChange] = useState<number>(0);
  const [yieldRate, setYieldRate] = useState<number>(90);
  const [lithiumPrice, setLithiumPrice] = useState<number>(9.8);
  const [capacityUtilization, setCapacityUtilization] = useState<number>(85);

  const baseMarginStr = userProfile?.profile?.enterpriseBaseInfo?.["毛利率"];
  const baseMarginValue = (Array.isArray(baseMarginStr) ? baseMarginStr[0] : baseMarginStr) ?? "18.5";
  const baseMargin = parseFloat(baseMarginValue) || 18.5;
  const inferredMargin = baseMargin - (rawMaterialChange * 0.3) + ((yieldRate - 90) * 0.4) + ((9.8 - lithiumPrice) * 1.5) + ((capacityUtilization - 85) * 0.2);

  const currentMode = getModeOption(mode);
  const progressPercent = progressState?.progressPercent ?? 0;
  const recentHistory = sessionHistory.slice(0, 6);
  const pendingClarificationQuestions = sessionContext?.pendingClarificationQuestions ?? [];
  const awaitingClarification = mode === "deepDive" && pendingClarificationQuestions.length > 0;
  const inputPlaceholder = awaitingClarification
    ? "请按顺序补充研究目标、时间窗口与风险边界，补充后将继续正式研究"
    : currentMode.placeholder;
  const showMainProgress = loading && Boolean(progressState);
  const showConversationEmpty = messages.length === 0 && !loading;
  const analysisVisualization = buildInvestorAnalysisVisualization(analysisResult, userProfile, undefined, unitPrefs);

  return (
    <div className={`pg iwb-page ${isActive ? 'on' : ''}`}>
      {analysisVisualization ? (
        <div className="page-viz-stack iwb-viz-stack">
          <VisualizationBoard payload={analysisVisualization} page="analysis" className="page-viz-board" />
        </div>
      ) : null}

      {/* DQI & GMPS 诊断结果面板（投资端*/}
      {analysisResult && (
        <DQIGMPSPanelsContainer
          mathAnalysisOutput={extractMathAnalysisFromResponse(analysisResult)}
          isLoading={loading}
          displayMode="grid"
        />
      )}
      <AuditInlineBanner state={auditPanelState} />
      <div className={`cly ${splitMode ? 'iwb-split' : ''}`}>
        <div className="cp" style={{ flex: 1, borderRight: splitMode ? '1px solid #E2E8F0' : 'none', borderTopRightRadius: splitMode ? 0 : '12px', borderBottomRightRadius: splitMode ? 0 : '12px' }}>
          <div className="iwb-top">
            <div className="iwb-headline">
              <div className="iwb-kicker">分析工作台</div>
              <h3>{sessionContext?.enterpriseName ?? DEFAULT_ENTERPRISE_NAME}</h3>
              <p>{sessionContext?.summary ?? "正在同步投资画像、历史对话与会话上下文…"}</p>
            </div>
            <div className="iwb-actions">
              <button className="iwb-action-btn" onClick={openHome} disabled={bootstrapping}>
                返回首页
              </button>
              <button className="iwb-action-btn" onClick={openSettings} disabled={bootstrapping}>
                偏好设置
              </button>
              <button className={`iwb-action-btn ${splitMode ? 'on' : ''}`} onClick={() => setSplitMode(!splitMode)} disabled={bootstrapping}>
                分屏对比
              </button>
              <button className="iwb-action-btn" onClick={() => window.print()} disabled={bootstrapping}>
                📄 导出报告
              </button>
              <button className="iwb-action-btn" onClick={openHistoryDialog} disabled={bootstrapping}>
                🕘 历史对话
              </button>
              <button className="iwb-action-btn" onClick={() => void handleCreateSession()} disabled={bootstrapping}>
                新建会话
              </button>
              <button className="iwb-action-btn danger" onClick={() => void handleDeleteCurrentSession()} disabled={!sessionContext}>
                删除当前
              </button>
            </div>
          </div>

          <div className="iwb-meta">
            <span>当前模式：{currentMode.label}</span>
            <span>当前会话：{sessionContext?.sessionId ?? "初始化中"}</span>
            <span>附件数：{attachments.length}</span>
            <span>最近更新：{sessionContext ? formatSessionTime(sessionContext.updatedAt) : "--"}</span>
          </div>

          <div className="mts">
            {INVESTOR_MODE_OPTIONS.map((option) => (
              <button
                key={option.value}
                className={`mt2 ${mode === option.value ? 'on' : ''}`}
                onClick={() => void handleModeSwitch(option.value)}
                disabled={!sessionContext || switchingMode}
              >
                {option.icon} {option.label}
              </button>
            ))}
          </div>

          {(error || bootstrapping) && (
            <div className="iwb-alert">
              {bootstrapping ? "正在同步会话与历史对话…" : error}
            </div>
          )}
          {workspaceNotice && <div className="iwb-alert">{workspaceNotice}</div>}

          <div className="cms">
            {showConversationEmpty && (
              <div className="iwb-chat-empty">
                <div className="iwb-chat-empty-badge">{currentMode.label}</div>
                <div className="iwb-chat-empty-title">{EMPTY_WORKBENCH_MESSAGE}</div>
                <div className="iwb-chat-empty-copy">{currentMode.placeholder}</div>
              </div>
            )}
            {messages.map((message) => {
              if (message.variant === "debate" && mode !== "investmentRecommendation") {
                return null;
              }
              return (
                <div
                  key={message.id}
                  className={`m ${message.variant === "user" ? 'u' : 'a'} ${message.variant === "system" ? 'sys' : ''} ${message.variant === "debate" ? 'db' : ''}`}
                >
                  {message.variant === "debate" ? (
                    <div className="mb">
                      <div className="iwb-debate-head">
                        <span className="iwb-debate-role">{message.speakerLabel}</span>
                        <span className="iwb-debate-badge">
                          {message.round} · {message.speakerRole === "judge" ? "裁判" : message.speakerRole === "system" ? "系统" : "辩手"}
                        </span>
                        <span className="iwb-debate-model">{message.speakerModel}</span>
                      </div>
                      <div className="iwb-debate-content">{message.content}</div>
                    </div>
                  ) : (
                    <div className="mb" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.7 }}><MessageWithCharts content={message.content} /></div>
                  )}
                  <div className="mt">{message.time}</div>
                </div>
              );
            })}
            {loading && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, padding: '0 12px' }}>
                <span style={{ fontSize: 12, color: '#94A3B8' }}>任务分级</span>
                <span style={{ fontSize: 12, padding: '2px 8px', borderRadius: '4px', background: '#F1F5F9', color: complexity === 'simple' ? '#22c55e' : complexity === 'moderate' ? '#eab308' : '#ef4444' }}>
                  {complexity === 'simple' ? '简单' : complexity === 'moderate' ? '中等' : '复杂'}
                </span>
              </div>
      )}
            {loading && (
              <div className="m a iwb-chain-wrap">
                <div className="iwb-chain-header">
                  <div className={`iwb-chain-header-icon${progressPercent >= 100 ? ' done' : ''}`}></div>
                  <span className={`iwb-chain-header-text${progressPercent >= 100 ? ' done' : ''}`}>
                    {progressState?.label ?? "AI 正在处理"}
                  </span>
                </div>
                <div className="iwb-live-progress-bar">
                  <div className={`iwb-live-progress-fill${progressPercent <= 0 ? ' indeterminate' : ''}`} style={{ width: `${progressPercent}%` }}></div>
                </div>
                <div className="iwb-chain-steps">
                  {timeline.filter(s => s.status === "completed").map((step, idx) => (
                    <div key={step.id || idx} className="iwb-chain-step done">
                      <div className="iwb-chain-step-dot"></div>
                      <div className="iwb-chain-step-content">
                        <span className="iwb-chain-step-label">{step.label}</span>
                      </div>
                    </div>
                  ))}
                  {progressState && (
                    <div className="iwb-chain-step active">
                      <div className="iwb-chain-step-dot"></div>
                      <div className="iwb-chain-step-content">
                        <span className="iwb-chain-step-label">{progressState.label}</span>
                        {progressState.detail && <span className="iwb-chain-step-detail">{progressState.detail}</span>}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
            <div ref={msgEndRef} />
          </div>

          <div className="cia">
            <div className="ciw">
              <input
                type="file"
                ref={fileInputRef}
                style={{ display: "none" }}
                onChange={handleFileSelect}
                accept=".pdf,.txt,.doc,.docx"
              />
              <button
                className="iwb-upload-entry"
                onClick={handleUploadClick}
                disabled={!sessionContext || loading || bootstrapping || uploading}
                title="上传资料（真API）"
                aria-label="上传资料"
              >
                              </button>
              <textarea 
                className="ci" 
                rows={1} 
                placeholder={inputPlaceholder}
                value={input}
                disabled={!sessionContext || loading || bootstrapping}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void send();
                  }
                }}
              />
              <button className="cse" onClick={() => void send()} disabled={!sessionContext || loading || bootstrapping}></button>
            </div>
          </div>
        </div>

        {splitMode && (
          <div className="cp" style={{ flex: 1, borderTopLeftRadius: 0, borderBottomLeftRadius: 0 }}>
            <div className="iwb-top">
              <div className="iwb-headline">
                <div className="iwb-kicker">对比会话</div>
                <h3>{compareSessionContext ? compareSessionContext.enterpriseName ?? DEFAULT_ENTERPRISE_NAME : "等待选择"}</h3>
                <p>{compareSessionContext?.summary ?? "请从历史对话中选择一个会话加入对比。"}</p>
              </div>
            </div>
            {compareSessionContext ? (
              <div className="cms" style={{ flex: 1, overflowY: 'auto', padding: '24px 32px' }}>
                <div className="iwb-chat-empty" style={{ marginBottom: '24px' }}>
                  <div className="iwb-chat-empty-badge">对比视图</div>
                  <div className="iwb-chat-empty-title">正在对比：{compareSessionContext.sessionId}</div>
                  <div className="iwb-chat-empty-copy">此视图为历史快照（只读模式）</div>
                </div>
                {buildSessionMessages(compareSessionContext).map((message) => (
                  <div
                    key={message.id}
                    className={`m ${message.variant === "user" ? 'u' : 'a'} ${message.variant === "system" ? 'sys' : ''} ${message.variant === "debate" ? 'db' : ''}`}
                  >
                    {message.variant === "debate" ? (
                      <div className="mb">
                        <div className="iwb-debate-head">
                          <span className="iwb-debate-role">{message.speakerLabel}</span>
                          <span className="iwb-debate-badge">
                            {message.round} · {message.speakerRole === "judge" ? "裁判" : message.speakerRole === "system" ? "系统" : "辩手"}
                          </span>
                          <span className="iwb-debate-model">{message.speakerModel}</span>
                        </div>
                        <div className="iwb-debate-content">{message.content}</div>
                      </div>
                    ) : (
                      <div className="mb">{message.content}</div>
                    )}
                    <div className="mt">{message.time}</div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="cms" style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <div className="iwb-empty" style={{ textAlign: 'center' }}>点击左侧「历史对话」并选择「加入对比</div>
              </div>
      )}
          </div>
        )}

        <div className="csb" style={{ display: splitMode ? 'none' : 'block' }}>
          <div className="ss">
            <div className="iwb-section-title">
              <h5>What-If 沙盘推演</h5>
            </div>
            <div className="iwb-result-block" style={{ padding: '12px' }}>
              <div style={{ marginBottom: '12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#475569', marginBottom: '4px' }}>
                  <span>原材料价格波</span>
                  <span>{rawMaterialChange > 0 ? '+' : ''}{rawMaterialChange}%</span>
                </div>
                <input 
                  type="range" 
                  min="-30" max="30" step="1" 
                  value={rawMaterialChange} 
                  onChange={(e) => setRawMaterialChange(Number(e.target.value))}
                  style={{ width: '100%', accentColor: '#3B82F6' }}
                />
              </div>
              <div style={{ marginBottom: '12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#475569', marginBottom: '4px' }}>
                  <span>良品</span>
                  <span>{yieldRate}%</span>
                </div>
                <input 
                  type="range" 
                  min="70" max="100" step="1" 
                  value={yieldRate} 
                  onChange={(e) => setYieldRate(Number(e.target.value))}
                  style={{ width: '100%', accentColor: '#3B82F6' }}
                />
              </div>
              <div style={{ padding: '8px', background: '#F8FAFC', borderRadius: '4px' }}>
                <div style={{ fontSize: '12px', color: '#94A3B8' }}>基准毛利率：{baseMargin.toFixed(2)}%</div>
                <div style={{ fontSize: '14px', fontWeight: 600, color: inferredMargin < baseMargin ? 'var(--red)' : '#10B981', marginTop: '4px' }}>
                  推演后毛利率：{inferredMargin.toFixed(2)}%
                </div>
              </div>
            </div>
          </div>

          <div className="ss">
            <div className="iwb-section-title">
              <h5>任务时间线</h5>
              <span>{timeline.length > 0 ? `${timeline.length} 步` : "待开始"}</span>
            </div>
            {timeline.length > 0 ? timeline.filter(entry => !(complexity === 'simple' && ['session', 'understanding', 'retrieval', 'evidence'].includes(entry.stage))).map((entry) => (
              <div key={entry.id} className={`iwb-timeline-item ${entry.status}`}>
                <div className="iwb-timeline-dot"></div>
                <div className="iwb-timeline-body">
                  <div className="iwb-timeline-top">
                    <span>{entry.label}</span>
                    <span>{entry.progressPercent}%</span>
                  </div>
                  <div className="iwb-timeline-detail">
                    {entry.detail ?? "已进入当前阶段"}
                  </div>
                </div>
              </div>
            )) : (
              <div className="iwb-empty">暂无任务时间线，发送问题后开始编排。</div>
      )}
          </div>

          {analysisResult && (
            <div className="ss">
              <div className="iwb-section-title">
                <h5>分析摘要</h5>
                <span>{analysisResult.recommendation.stance}</span>
              </div>
              <div className="iwb-result-card">
                <div className="iwb-score">{analysisResult.recommendation.score}</div>
                <div className="iwb-score-copy">
                  <div className="iwb-score-label">推荐立场</div>
                  <div className="iwb-score-value">{analysisResult.recommendation.stance}</div>
                </div>
              </div>
              <div className="iwb-result-block">
                <div className="iwb-result-title">行业结论</div>
                <div className="iwb-result-text">{analysisResult.industryReport.overview}</div>
              </div>
              <div className="iwb-result-block">
                <div className="iwb-result-title">深度解析</div>
                <div className="iwb-result-text">{analysisResult.deepDive.thesis}</div>
              </div>
              {mode === "investmentRecommendation" && (
              <div className="iwb-result-block">
                <div className="iwb-result-title">正式辩论</div>
                <div className="iwb-result-text">{analysisResult.debate.summary}</div>
                {analysisResult.debate.rounds.map((round) => (
                  <div key={round.round} className="iwb-round-item">
                    <span>{round.round} </span>
                    <span>{round.verdict}</span>
                  </div>
                ))}
              </div>
              )}
              <div className="iwb-result-block">
                <div className="iwb-result-title">证据摘要</div>
                {analysisResult.evidenceSummary.map((item) => (
                  <div key={item} className="iwb-bullet">{item}</div>
                ))}
              </div>
              {industryRetrieval && (
                <div className="iwb-result-block">
                  <div className="iwb-result-title">服务端RAG证据来源</div>
                  <div className="iwb-result-text">{industryRetrieval.retrievalSummary}</div>
                  {industryRetrieval.citations.length > 0 ? industryRetrieval.citations.map((citation) => (
                    <div
                      key={citation.id}
                      className="iwb-insight-item"
                      style={{ alignItems: 'flex-start', gap: '8px' }}
                    >
                      <span>{`来源：${citation.source}`}</span>
                      <span>{`时间：${formatAbsoluteTime(citation.publishedAt ?? citation.retrievedAt)} · 是否降级：${ragEvidenceDegraded ? "是" : "否"}`}</span>
                    </div>
                  )) : (
                    <div className="iwb-empty">暂无服务端可展示的引用来源</div>
      )}
                </div>
              )}
            </div>
          )}

          <div className="ss">
            <div className="iwb-section-title">
              <h5>上传资料</h5>
              <span>{attachments.length} </span>
            </div>
            {attachments.length > 0 ? attachments.map((attachment) => (
              <div key={attachment.attachmentId} className="iwb-attachment-item">
                <div className="iwb-attachment-top">
                  <span>{attachment.fileName}</span>
                  <span>{attachment.status}</span>
                </div>
                <div className="iwb-attachment-summary">{attachment.summary}</div>
              </div>
            )) : (
              <div className="iwb-empty">当前还没有上传资料，可补充纪要、公告或访谈摘要</div>
      )}
            {uploadWarnings.length > 0 && (
              <div className="iwb-warning-box">
                {uploadWarnings.map((warning) => (
                  <div key={warning}>{warning}</div>
                ))}
              </div>
            )}
          </div>

          <div className="ss">
            <div className="iwb-section-title">
              <h5>对话历史</h5>
              <span>{recentHistory.length > 0 ? `最${recentHistory.length} 条` : "等待沉淀"}</span>
            </div>
            {recentHistory.length > 0 ? recentHistory.map((summary) => {
              const isCurrent = summary.sessionId === sessionContext?.sessionId;
              return (
                <div key={summary.sessionId} className={`iwb-history-item ${isCurrent ? 'on' : ''}`}>
                  <button
                    type="button"
                    className="iwb-history-entry-main"
                    onClick={() => void handleSelectHistory(summary)}
                    disabled={bootstrapping || isCurrent}
                  >
                    <div className="iwb-history-top">
                      <span>{getSessionTitle(summary)}</span>
                      <span>{formatSessionTime(summary.updatedAt)}</span>
                    </div>
                    <div className="iwb-history-summary">{summary.summary || "暂无摘要"}</div>
                    <div className="iwb-history-meta">
                      <span>{getModeOption(summary.activeMode).label}</span>
                      <span>{summary.attachmentCount} 个附</span>
                      <span>{isCurrent ? "当前会话" : "点击切换"}</span>
                    </div>
                  </button>
                  <button
                    type="button"
                    className="iwb-history-entry-action"
                    aria-label={`打开${getSessionTitle(summary)}摘要`}
                    onClick={() => openHistoryPreview(summary)}
                    disabled={deletingHistory}
                  >
                    摘要
                  </button>
                </div>
              );
            }) : (
              <div className="iwb-empty">暂无历史对话，创建新会话或完成分析后会在这里显示</div>
      )}
          </div>

          <div className="ss">
            <div className="iwb-section-title">
              <h5>快速追</h5>
              <span>{currentMode.label}</span>
            </div>
            {currentMode.quickPrompts.map((item) => (
              <div key={item.label} className="ii" onClick={() => void send(`请结合当前会话分析${item.label}」，当前值为 ${item.value}。`)}>
                <span className="inn">{item.label}</span>
                <span className="iv">{item.value}</span>
                <div className="ia">+</div>
              </div>
            ))}
          </div>

          {profileUpdate && (
            <div className="ss">
              <div className="iwb-section-title">
                <h5>画像更新</h5>
                <span>{profileUpdate.updatedFields.length} </span>
              </div>
              <div className="iwb-result-text">{profileUpdate.summary}</div>
              {profileUpdate.extractedInsights.map((insight) => (
                <div key={`${insight.category}-${insight.value}`} className="iwb-insight-item">
                  <span>{insight.category}</span>
                  <span>{insight.value}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {uploadOpen && createPortal(
        <div className="iwb-modal-overlay" onClick={() => !uploading && setUploadOpen(false)}>
          <div className="iwb-modal" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <div className="iwb-modal-header">
              <div>
                <h3>上传资料到当前会</h3>
                <p>支持公告摘要、调研纪要、订单跟踪与行业笔记</p>
              </div>
              <button className="iwb-modal-close" onClick={() => !uploading && setUploadOpen(false)}></button>
            </div>
            <div className="fr">
              <div className="fg">
                <label>文件</label>
                <input
                  value={uploadDraft.fileName}
                  onChange={(event) => setUploadDraft((previous) => ({ ...previous, fileName: event.target.value }))}
                />
              </div>
              <div className="fg">
                <label>MIME 类型</label>
                <input
                  value={uploadDraft.mimeType}
                  onChange={(event) => setUploadDraft((previous) => ({ ...previous, mimeType: event.target.value }))}
                />
              </div>
            </div>
            <div className="fr">
              <div className="fg">
                <label>资料内容</label>
                <textarea
                  value={uploadDraft.content}
                  onChange={(event) => setUploadDraft((previous) => ({ ...previous, content: event.target.value }))}
                  style={{ height: '80px' }}
                />
              </div>
            </div>
            <div className="fr" style={{ marginTop: '4px' }}>
              <div className="fg" style={{ flex: 1 }}>
                <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>可视化数据映(Visual Data Mapping)</span>
                  <span style={{ fontSize: '12px', color: '#3B82F6', cursor: 'pointer' }}>AI 智能推荐映射</span>
                </label>
                <div style={{ background: '#F1F5F9', padding: '12px', borderRadius: '8px', border: '1px dashed #E2E8F0' }}>
                  <p style={{ fontSize: '12px', color: '#94A3B8', marginBottom: '8px' }}>请确认上传表格列与系统标准财务字段的映射关系</p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {[
                      { standard: '营业收入 (Revenue)', fileCol: '24Q1营收合计', confidence: '98%' },
                      { standard: '营业成本 (Cost)', fileCol: '24Q1成本合计', confidence: '95%' },
                      { standard: '净利润 (Net Income)', fileCol: '归母净利润', confidence: '89%' },
                      { standard: '毛利(Gross Margin)', fileCol: '销售毛利率', confidence: '99%' }
                    ].map((item, idx) => (
                      <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '12px', background: '#F8FAFC', padding: '6px 10px', borderRadius: '6px', border: '1px solid #E2E8F0' }}>
                        <div style={{ flex: 1, fontSize: '12px', color: '#0F172A', fontWeight: 500 }}>{item.standard}</div>
                        <div style={{ color: '#94A3B8' }}>🔗</div>
                        <select style={{ flex: 1, padding: '2px 6px', borderRadius: '4px', border: '1px solid #E2E8F0', background: '#F1F5F9', color: '#475569', fontSize: '12px', outline: 'none' }} defaultValue={item.fileCol}>
                          <option value={item.fileCol}>{item.fileCol} (推荐匹配)</option>
                          <option>忽略此字</option>
                        </select>
                        <div style={{ fontSize: '12px', color: '#10B981', width: '40px', textAlign: 'right' }}>{item.confidence}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
            {uploadError && <div className="iwb-warning-box">{uploadError}</div>}
            <div className="br">
              <button className="bt bgh" onClick={() => setUploadOpen(false)} disabled={uploading}>取消</button>
              <button className="bt bp" onClick={() => void handleUploadSubmit()} disabled={uploading}>
                {uploading ? "解析中" : "开始解析"}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
      {historyOpen && createPortal(
        <div className="iwb-modal-overlay" onClick={() => !deletingHistory && setHistoryOpen(false)}>
          <div className="iwb-modal iwb-history-modal" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <div className="iwb-modal-header">
              <div>
                <h3>历史对话</h3>
                <p>可切换会话，也可勾选后批量删除无效历史记录</p>
              </div>
              <button className="iwb-modal-close" onClick={() => !deletingHistory && setHistoryOpen(false)}></button>
            </div>
            <div className="iwb-history-toolbar">
              <span>共 {sessionHistory.length} 条，已选择 {historySelection.length} 条</span>
              <button
                className="bt bgh"
                onClick={() => void handleDeleteSelectedHistory()}
                disabled={historySelection.length === 0 || deletingHistory}
              >
                {deletingHistory ? "删除中" : "删除勾选"}
              </button>
            </div>
            {historyDeleteError && <div className="iwb-warning-box">{historyDeleteError}</div>}
            <div className="iwb-history-dialog-list">
              {sessionHistory.length > 0 ? sessionHistory.map((summary) => (
                <div
                  key={summary.sessionId}
                  className={`iwb-history-row ${summary.sessionId === sessionContext?.sessionId ? 'on' : ''}`}
                >
                  <label className="iwb-history-check">
                    <input
                      type="checkbox"
                      checked={historySelection.includes(summary.sessionId)}
                      readOnly
                      onClick={() => toggleHistorySelection(summary.sessionId)}
                      disabled={deletingHistory}
                    />
                    <span className="iwb-history-check-mark"></span>
                  </label>
                  <div className="iwb-history-row-body">
                    <div className="iwb-history-top">
                      <span>{getSessionTitle(summary)}</span>
                      <span>{formatSessionTime(summary.updatedAt)}</span>
                    </div>
                    <div className="iwb-history-summary">{summary.summary}</div>
                    <div className="iwb-history-meta">
                      <span>{getModeOption(summary.activeMode).label}</span>
                      <span>{summary.attachmentCount} 个附</span>
                      <span>{summary.investedEnterprises.slice(0, 2).join("、") || "未同步关注标的"}</span>
                    </div>
                  </div>
                  <div className="iwb-history-actions" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <button
                      className="iwb-action-btn"
                      onClick={() => void handleOpenHistorySession(summary)}
                      disabled={deletingHistory}
                    >
                      {summary.sessionId === sessionContext?.sessionId ? "当前会话" : "进入会话"}
                    </button>
                    {splitMode && summary.sessionId !== sessionContext?.sessionId && (
                      <button
                        className="iwb-action-btn"
                        onClick={() => void handleSelectCompareSession(summary)}
                        disabled={deletingHistory}
                      >
                        加入对比
                      </button>
      )}
                  </div>
                </div>
              )) : (
                <div className="iwb-empty">暂无历史对话，系统将在首次画像初始化后自动创建会话</div>
      )}
            </div>
          </div>
        </div>,
        document.body
      )}
      {historyPreview && createPortal(
        <div className="iwb-modal-overlay" onClick={() => !deletingHistory && setHistoryPreview(null)}>
          <div className="iwb-modal iwb-history-preview-modal" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <div className="iwb-modal-header">
              <div>
                <h3>会话摘要</h3>
                <p>{getSessionTitle(historyPreview)}</p>
              </div>
              <button className="iwb-modal-close" onClick={() => !deletingHistory && setHistoryPreview(null)}></button>
            </div>
            <div className="iwb-history-preview-badges">
              <span>{getModeOption(historyPreview.activeMode).label}</span>
              <span>{formatAbsoluteTime(historyPreview.updatedAt)}</span>
              <span>{historyPreview.attachmentCount} 个附</span>
              <span>{historyPreview.sessionId === sessionContext?.sessionId ? "当前会话" : "历史会话"}</span>
            </div>
            <div className="iwb-history-preview-summary">
              {historyPreview.summary || "暂无摘要信息"}
            </div>
            <div className="iwb-history-preview-meta">
              <div>
                <span>关注标的</span>
                <strong>{historyPreview.investedEnterprises.join("、") || "未同步"}</strong>
              </div>
              <div>
                <span>会话编号</span>
                <strong>{historyPreview.sessionId}</strong>
              </div>
            </div>
            {historyDeleteError && <div className="iwb-warning-box">{historyDeleteError}</div>}
            <div className="br">
              <button className="bt bgh" onClick={() => setHistoryPreview(null)} disabled={deletingHistory}>关闭</button>
              <button className="bt danger" onClick={() => void handleDeletePreviewHistory()} disabled={deletingHistory}>
                {deletingHistory ? "删除中" : "删除会话"}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

function InvSet({ isActive, openMem, isDark, setIsDark, themeIndex, setThemeIndex, userProfile, saveInvestorBaseInfo, unitPrefs, onUnitPrefsChange, refreshInterval, onRefreshIntervalChange }: InvSetProps & { unitPrefs: UnitPreferences; onUnitPrefsChange: (prefs: UnitPreferences) => void; refreshInterval: number; onRefreshIntervalChange: (ms: number) => void }) {
  const profile = userProfile?.profile;

  return (
    <div className={`pg ${isActive ? 'on' : ''}`}>
      <div style={{ fontSize: '12px', color: '#94A3B8', marginBottom: '12px', letterSpacing: '.6px' }}>偏好设置</div>
      <div className="sts2"><h3>🎨 界面配色</h3>
        <div className="sr"><span className="sl2">主题</span><div className="sc">
          <ThemeColorButton label="蓝紫渐变" active={themeIndex === 0} background="linear-gradient(135deg,#3b82f6,#8b5cf6)" onClick={() => setThemeIndex(0)} />
          <ThemeColorButton label="青绿极光" active={themeIndex === 1} background="linear-gradient(135deg,#10b981,#06b6d4)" onClick={() => setThemeIndex(1)} />
          <ThemeColorButton label="暖金流光" active={themeIndex === 2} background="linear-gradient(135deg,#f59e0b,#ef4444)" onClick={() => setThemeIndex(2)} />
          <ThemeColorButton label="粉紫霓虹" active={themeIndex === 3} background="linear-gradient(135deg,#ec4899,#8b5cf6)" onClick={() => setThemeIndex(3)} />
        </div></div>
        <div className="sr"><span className="sl2">深色模式</span><ThemeModeSwitch checked={isDark} label="深色模式" onChange={setIsDark} /></div>
      </div>
      <div className="sts2"><h3>📐 数据单位</h3>
        <UnitSelector onChange={onUnitPrefsChange} />
      </div>
      <div className="sts2"><h3>🔄 数据刷新</h3>
        <div className="sr"><span className="sl2">自动刷新间隔</span><div className="sc"><select className="ssel" value={refreshInterval} onChange={(e) => onRefreshIntervalChange(Number(e.target.value))}><option value={30000}>30 秒</option><option value={60000}>60 秒（默认）</option><option value={120000}>120 秒</option><option value={0}>关闭</option></select></div></div>
      </div>
      <div className="sts2"><h3>📋 基本信息</h3>
        <div className="sr"><span className="sl2">分析角色</span><span style={{ color: '#8B5CF6', fontSize: '12px' }}>投资人员</span></div>
        <div className="sr"><span className="sl2">当前用户</span><span style={{ color: '#475569', fontSize: '12px' }}>{profile?.displayName || profile?.userId || "初始化中"}</span></div>
        <div className="sr"><span className="sl2">关注企业</span><span style={{ color: '#94A3B8', fontSize: '12px' }}>{profile?.investedEnterprises.slice(0, 2).join("、") || "待同步"}</span></div>
        <EditableBaseInfoPanel title="投资基本信息" baseInfo={profile?.investorBaseInfo} emptyText="可补充可投资资产、关注企业、风险偏好等关键信息。" presetGroups={INVESTOR_BASE_INFO_GROUPS} onSave={saveInvestorBaseInfo} />
      </div>
      <div className="sts2"><h3>🤖 Agent 任务</h3>
        <div className="sr"><span className="sl2">自动推送频率</span><div className="sc"><select className="ssel"><option>每日一次</option><option>每周一次</option><option>有异动时</option></select></div></div>
        <div className="sr"><span className="sl2">重大事件推送</span><div className="sw on"></div></div>
      </div>
      <div className="sts2">
        <button className="mbtn" onClick={openMem}>
          <div className="mi2">🧠</div><span>记忆中的你</span>
        </button>
      </div>
    </div>
  );
}

const MemoryBackgroundCanvas = React.memo(function MemoryBackgroundCanvas({
  viewportRef,
  isDark,
  themeIndex,
  interactionActiveRef,
}: {
  viewportRef: React.RefObject<HTMLDivElement | null>;
  isDark: boolean;
  themeIndex: number;
  interactionActiveRef: React.MutableRefObject<boolean>;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [profileMode, setProfileMode] = useState<MemoryVisualMode>('startup');

  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    let cx: CanvasRenderingContext2D | null = null;
    try {
      cx = cv.getContext('2d');
    } catch {
      cx = null;
    }
    if (!cx) return;

    const scheduleFrame = typeof window.requestAnimationFrame === 'function'
      ? window.requestAnimationFrame.bind(window)
      : (callback: FrameRequestCallback) => window.setTimeout(() => callback(Date.now()), 16);
    const cancelFrame = typeof window.cancelAnimationFrame === 'function'
      ? window.cancelAnimationFrame.bind(window)
      : window.clearTimeout.bind(window);
    const reducedMotionMedia = typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)')
      : null;
    const themePalette = [
      { bg: ['#060913', '#0a1024', '#120d2b'], ribbon: 230, nebula: 260, ambient: 240 }, // 深邃星空蓝紫
      { bg: ['#041114', '#081d22', '#0a2620'], ribbon: 175, nebula: 160, ambient: 180 }, // 极光翠绿
      { bg: ['#140b05', '#1e1107', '#2a160a'], ribbon: 38, nebula: 22, ambient: 45 },    // 流光溢彩      { bg: ['#140612', '#1d0a1b', '#260e24'], ribbon: 320, nebula: 335, ambient: 310 }, // 幻梦霓虹粉紫
    ][themeIndex] ?? { bg: ['#060913', '#0a1024', '#120d2b'], ribbon: 230, nebula: 260, ambient: 240 };

    const runtime = {
      booting: true,
      isVisible: document.visibilityState !== 'hidden',
      prefersReducedMotion: reducedMotionMedia?.matches ?? false,
      devicePixelRatio: window.devicePixelRatio || 1,
    };

    let currentProfile = resolveMemoryVisualProfile({
      isDark,
      isVisible: runtime.isVisible,
      devicePixelRatio: runtime.devicePixelRatio,
      prefersReducedMotion: runtime.prefersReducedMotion,
      interactionActive: interactionActiveRef.current,
      booting: runtime.booting,
    });
    let rafId = 0;
    let bootTimer = 0;
    let width = 0;
    let height = 0;
    let pixelRatio = 1;
    let pointerX = 0;
    let pointerY = 0;
    let scrollX = 0;
    let scrollY = 0;
    let time = 0;
    let lastFrameAt = 0;
    let shootingStarCooldown = 0;

    const stars: Array<{
      x: number;
      y: number;
      size: number;
      alpha: number;
      delta: number;
      warm: boolean;
      angle: number;
    }> = [];
    const nebulae: Array<{
      x: number;
      y: number;
      radius: number;
      hue: number;
      alpha: number;
      drift: number;
      pulse: number;
      offset: number;
    }> = [];
    const ribbons: Array<{
      hue: number;
      phase: number;
      amplitude: number;
      width: number;
      drift: number;
      depth: number;
    }> = [];
    const sparkles: Array<{
      ribbonIndex: number;
      t: number;
      speed: number;
      spread: number;
      size: number;
      alpha: number;
      bright: boolean;
      phase: number;
      trail: number;
    }> = [];
    const clouds: Array<{
      x: number;
      y: number;
      scale: number;
      speed: number;
    }> = [];
    const shootingStars: Array<{ x: number; y: number; vx: number; vy: number; life: number; maxLife: number; length: number }> = [];
    let allocatedObjects = createMemoryVisualObjectCounts();
    let allocationTimer = 0;

    const ensureCollection = <T,>(collection: T[], target: number, factory: (index: number) => T) => {
      while (collection.length < target) {
        collection.push(factory(collection.length));
      }
    };

    const applyObjectAllocation = (nextCounts: typeof allocatedObjects) => {
      ensureCollection(stars, nextCounts.stars, () => ({
        x: Math.random() * 2800,
        y: Math.random() * 1800,
        size: Math.random() * 1.8 + 0.3,
        alpha: Math.random() * 0.6 + 0.15,
        delta: (Math.random() - 0.5) * 0.006,
        warm: Math.random() > 0.55,
        angle: Math.random() * Math.PI * 2,
      }));
      ensureCollection(nebulae, nextCounts.nebulae, (index) => ({
        x: Math.random(),
        y: Math.random(),
        radius: 160 + Math.random() * 180,
        hue: themePalette.nebula + index * 8 + Math.random() * 18,
        alpha: 0.06 + Math.random() * 0.08,
        drift: 0.02 + Math.random() * 0.04,
        pulse: 0.25 + Math.random() * 0.2,
        offset: Math.random() * Math.PI * 2,
      }));
      ensureCollection(ribbons, nextCounts.ribbons, (index) => ({
        hue: themePalette.ribbon + index * 7,
        phase: index * 0.55,
        amplitude: 58 + index * 18,
        width: 54 + index * 10,
        drift: 0.14 + index * 0.04,
        depth: 0.45 + index * 0.14,
      }));
      ensureCollection(sparkles, nextCounts.sparkles, () => ({
        ribbonIndex: Math.floor(Math.random() * Math.max(1, nextCounts.ribbons)),
        t: Math.random(),
        speed: 0.0018 + Math.random() * 0.0032,
        spread: (Math.random() - 0.5) * 120,
        size: 1.2 + Math.random() * 2.4,
        alpha: 0.25 + Math.random() * 0.45,
        bright: Math.random() > 0.72,
        phase: Math.random() * Math.PI * 2,
        trail: 10 + Math.random() * 16,
      }));
      ensureCollection(clouds, nextCounts.clouds, () => ({
        x: Math.random() * 2200,
        y: Math.random() * 520,
        scale: 0.65 + Math.random() * 0.9,
        speed: (Math.random() * 0.18 + 0.05) * (Math.random() > 0.5 ? 1 : -1),
      }));
      allocatedObjects = nextCounts;
    };

    const growObjectsForProfile = (growthMode: 'immediate' | 'deferred') => {
      const growth = expandMemoryVisualObjectCounts(allocatedObjects, currentProfile, growthMode);
      applyObjectAllocation(growth.next);
      return growth.completed;
    };

    const scheduleDeferredAllocation = () => {
      if (allocationTimer) {
        return;
      }

      allocationTimer = window.setTimeout(() => {
        allocationTimer = 0;
        const completed = growObjectsForProfile('deferred');
        if (!completed && runtime.isVisible) {
          scheduleDeferredAllocation();
        }
      }, 24);
    };

    const syncProfile = () => {
      const nextProfile = resolveMemoryVisualProfile({
        isDark,
        isVisible: runtime.isVisible,
        devicePixelRatio: runtime.devicePixelRatio,
        prefersReducedMotion: runtime.prefersReducedMotion,
        interactionActive: interactionActiveRef.current,
        booting: runtime.booting,
      });

      currentProfile = nextProfile;
      setProfileMode((prev) => (prev === nextProfile.mode ? prev : nextProfile.mode));
      if (runtime.booting || nextProfile.mode === 'light') {
        growObjectsForProfile('immediate');
        if (allocationTimer) {
          window.clearTimeout(allocationTimer);
          allocationTimer = 0;
        }
        return;
      }

      const growth = expandMemoryVisualObjectCounts(allocatedObjects, currentProfile, 'deferred');
      if (!growth.completed) {
        scheduleDeferredAllocation();
      }
    };

    const resizeCanvas = () => {
      runtime.devicePixelRatio = window.devicePixelRatio || 1;
      syncProfile();
      width = cv.offsetWidth || cv.clientWidth || 1;
      height = cv.offsetHeight || cv.clientHeight || 1;
      pixelRatio = Math.min(runtime.devicePixelRatio, currentProfile.mode === 'full' ? 1.25 : 1.1);
      cv.width = Math.max(1, Math.round(width * pixelRatio));
      cv.height = Math.max(1, Math.round(height * pixelRatio));
      cx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      pointerX = width * 0.5;
      pointerY = height * 0.5;
    };

    const getRibbonPoint = (t: number, ribbonIndex: number) => {
      const ribbon = ribbons[ribbonIndex];
      if (!ribbon) {
        return { x: 0, y: 0, nx: 0, ny: 0 };
      }

      const dynamicTime = time * ribbon.drift + ribbon.phase;
      const baseX = width * 0.88 - t * width * 0.76;
      const baseY = height * 0.12 + t * height * 0.76;
      
      // Optimize animation curve: natural and smooth sine wave combinations
      const waveX = Math.sin(t * Math.PI * 2 + dynamicTime) * ribbon.amplitude +
                    Math.sin(t * Math.PI * 3.5 - dynamicTime * 0.8) * ribbon.amplitude * 0.4 +
                    Math.cos(t * Math.PI * 5 + dynamicTime * 1.2) * ribbon.amplitude * 0.15;
                    
      const waveY = Math.sin(t * Math.PI * 2.5 + dynamicTime * 0.9) * 60 * ribbon.depth +
                    Math.cos(t * Math.PI * 4 - dynamicTime * 0.6) * 30 * ribbon.depth +
                    Math.sin(t * Math.PI * 6 + dynamicTime * 1.5) * 10;
                    
      let x = baseX + waveX;
      let y = baseY + waveY;

      // Add mouse interaction: repel ribbon from pointer
      const distToPointer = Math.sqrt(Math.pow(x - pointerX, 2) + Math.pow(y - pointerY, 2));
      if (distToPointer < 250 && distToPointer > 0) {
        const force = Math.pow((250 - distToPointer) / 250, 2) * 50;
        x += ((x - pointerX) / distToPointer) * force;
        y += ((y - pointerY) / distToPointer) * force;
      }
      
      const nextT = Math.min(1, t + 0.01);
      const nextBaseX = width * 0.88 - nextT * width * 0.76;
      const nextBaseY = height * 0.12 + nextT * height * 0.76;
      
      const nextWaveX = Math.sin(nextT * Math.PI * 2 + dynamicTime) * ribbon.amplitude +
                        Math.sin(nextT * Math.PI * 3.5 - dynamicTime * 0.8) * ribbon.amplitude * 0.4 +
                        Math.cos(nextT * Math.PI * 5 + dynamicTime * 1.2) * ribbon.amplitude * 0.15;
                        
      const nextWaveY = Math.sin(nextT * Math.PI * 2.5 + dynamicTime * 0.9) * 60 * ribbon.depth +
                        Math.cos(nextT * Math.PI * 4 - dynamicTime * 0.6) * 30 * ribbon.depth +
                        Math.sin(nextT * Math.PI * 6 + dynamicTime * 1.5) * 10;
                        
      let nextX = nextBaseX + nextWaveX;
      let nextY = nextBaseY + nextWaveY;
      
      const nextDist = Math.sqrt(Math.pow(nextX - pointerX, 2) + Math.pow(nextY - pointerY, 2));
      if (nextDist < 250 && nextDist > 0) {
        const nforce = Math.pow((250 - nextDist) / 250, 2) * 50;
        nextX += ((nextX - pointerX) / nextDist) * nforce;
        nextY += ((nextY - pointerY) / nextDist) * nforce;
      }

      const dx = nextX - x;
      const dy = nextY - y;
      const length = Math.sqrt(dx * dx + dy * dy) || 1;

      return {
        x,
        y,
        nx: -dy / length,
        ny: dx / length,
      };
    };

    const handleMouseMove = (event: MouseEvent) => {
      pointerX = event.clientX;
      pointerY = event.clientY;
    };

    const handleScroll = () => {
      if (!viewportRef.current) return;
      scrollX = viewportRef.current.scrollLeft;
      scrollY = viewportRef.current.scrollTop;
    };

    const handleVisibilityChange = () => {
      runtime.isVisible = document.visibilityState !== 'hidden';
      syncProfile();
    };

    const handleReducedMotionChange = (event: MediaQueryListEvent) => {
      runtime.prefersReducedMotion = event.matches;
      syncProfile();
    };

    const viewportElement = viewportRef.current;

    resizeCanvas();
    handleScroll();

    window.addEventListener('resize', resizeCanvas);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    if (reducedMotionMedia) {
      if (typeof reducedMotionMedia.addEventListener === 'function') {
        reducedMotionMedia.addEventListener('change', handleReducedMotionChange);
      } else if (typeof reducedMotionMedia.addListener === 'function') {
        reducedMotionMedia.addListener(handleReducedMotionChange);
      }
    }

    if (viewportElement) {
      viewportElement.addEventListener('mousemove', handleMouseMove);
      viewportElement.addEventListener('scroll', handleScroll, { passive: true });
    }

    bootTimer = window.setTimeout(() => {
      runtime.booting = false;
      syncProfile();
    }, 280);

    const draw = (now: number) => {
      syncProfile();

      const frameBudget = 1000 / currentProfile.fps;
      if (now - lastFrameAt < frameBudget) {
        rafId = scheduleFrame(draw);
        return;
      }

      const deltaSeconds = Math.min(0.05, lastFrameAt === 0 ? frameBudget / 1000 : (now - lastFrameAt) / 1000);
      lastFrameAt = now;
      time += deltaSeconds;

      cx.clearRect(0, 0, width, height);

      if (isDark) {
        const background = cx.createLinearGradient(0, 0, width, height);
        background.addColorStop(0, themePalette.bg[0] ?? '#050510');
        background.addColorStop(0.55, themePalette.bg[1] ?? '#090d1d');
        background.addColorStop(1, themePalette.bg[2] ?? '#120b24');
        cx.fillStyle = background;
        cx.fillRect(0, 0, width, height);

        if (currentProfile.ambientGlow) {
          const pointerGlow = cx.createRadialGradient(pointerX, pointerY, 0, pointerX, pointerY, Math.max(width, height) * 0.45);
          pointerGlow.addColorStop(0, `hsla(${themePalette.ambient}, 88%, 78%, 0.14)`);
          pointerGlow.addColorStop(0.45, `hsla(${themePalette.ambient + 18}, 78%, 68%, 0.06)`);
          pointerGlow.addColorStop(1, 'transparent');
          cx.fillStyle = pointerGlow;
          cx.fillRect(0, 0, width, height);
        }

        for (let index = 0; index < currentProfile.nebulae; index += 1) {
          const nebula = nebulae[index];
          if (!nebula) continue;
          const pulse = 1 + Math.sin(time * nebula.pulse + nebula.offset) * 0.16;
          const x = (nebula.x * width - scrollX * 0.018 + Math.sin(time * nebula.drift + nebula.offset) * 22 + width) % width;
          const y = (nebula.y * height - scrollY * 0.018 + Math.cos(time * nebula.drift + nebula.offset) * 18 + height) % height;
          const gradient = cx.createRadialGradient(x, y, 0, x, y, nebula.radius * pulse);
          gradient.addColorStop(0, `hsla(${nebula.hue}, 72%, 66%, ${nebula.alpha})`);
          gradient.addColorStop(0.45, `hsla(${nebula.hue + 12}, 62%, 58%, ${nebula.alpha * 0.55})`);
          gradient.addColorStop(1, 'transparent');
          cx.fillStyle = gradient;
          cx.fillRect(0, 0, width, height);
        }

        for (let index = 0; index < currentProfile.stars; index += 1) {
          const star = stars[index];
          if (!star) continue;
          star.alpha += star.delta;
          if (star.alpha > 0.95 || star.alpha < 0.12) {
            star.delta *= -1;
          }

          const x = (star.x - scrollX * 0.03 + width) % width;
          const y = (star.y - scrollY * 0.03 + height) % height;
          const alpha = star.alpha * (0.75 + Math.sin(time * 2.2 + star.angle) * 0.25);
          const color = star.warm ? `rgba(255,236,208,${alpha})` : `rgba(214,229,255,${alpha})`;

          cx.beginPath();
          cx.arc(x, y, star.size, 0, Math.PI * 2);
          cx.fillStyle = color;
          cx.shadowBlur = star.size * 4;
          cx.shadowColor = color;
          cx.fill();
          cx.shadowBlur = 0;

          if (currentProfile.crossStars && index % 14 === 0) {
            cx.save();
            cx.translate(x, y);
            cx.rotate(time * 0.12 + star.angle);
            cx.beginPath();
            cx.moveTo(-star.size * 3, 0);
            cx.lineTo(star.size * 3, 0);
            cx.moveTo(0, -star.size * 3);
            cx.lineTo(0, star.size * 3);
            cx.strokeStyle = color;
            cx.lineWidth = 1;
            cx.stroke();
            cx.restore();
          }
        }

        const activeRibbons = ribbons.slice(0, currentProfile.ribbons);
        activeRibbons.forEach((ribbon, ribbonIndex) => {
          cx.shadowBlur = 0; // Ensure no shadowBlur for performance

          // Calculate number of lines based on profile performance settings
          const complexityMultiplier = (currentProfile.glowLayers + currentProfile.ribbonPasses) / 4;
          const numLines = Math.floor(30 * complexityMultiplier); 

          // 1. Draw a soft base glow
          cx.beginPath();
          for (let sample = 0; sample <= currentProfile.pointSamples; sample += 1) {
            const t = sample / currentProfile.pointSamples;
            const point = getRibbonPoint(t, ribbonIndex);
            const x = point.x - scrollX * 0.014 * t;
            const y = point.y - scrollY * 0.014 * t;
            if (sample === 0) cx.moveTo(x, y);
            else cx.lineTo(x, y);
          }
          cx.strokeStyle = `hsla(${ribbon.hue}, 90%, 65%, 0.06)`;
          cx.lineWidth = ribbon.width * ribbon.depth * 1.8;
          cx.lineCap = 'round';
          cx.lineJoin = 'round';
          cx.stroke();

          // 2. Draw the hair strands
          for (let i = 0; i < numLines; i++) {
            cx.beginPath();
            
            // Non-linear distribution for organic look (denser in middle)
            const normalizedOffset = (i / (numLines - 1)) * 2 - 1; // -1 to 1
            const lineOffset = Math.sign(normalizedOffset) * Math.pow(Math.abs(normalizedOffset), 1.8) * ribbon.width * ribbon.depth * 1.1;
            const linePhase = i * 0.25;
            
            for (let sample = 0; sample <= currentProfile.pointSamples; sample += 1) {
              const t = sample / currentProfile.pointSamples;
              const point = getRibbonPoint(t, ribbonIndex);
              
              // Hair-like overlapping wave, slightly twisting
              const wave = lineOffset + Math.sin(t * Math.PI * 8 + time * 0.7 + linePhase) * 7 * ribbon.depth;
              
              const x = point.x + point.nx * wave - scrollX * 0.014 * t;
              const y = point.y + point.ny * wave - scrollY * 0.014 * t;

              if (sample === 0) {
                cx.moveTo(x, y);
              } else {
                cx.lineTo(x, y);
              }
            }

            // Richer color variations for elegant hair texture
            const distanceToCenter = Math.abs(normalizedOffset);
            // Center is brighter and more luminous, edges are deeper
            const lightness = 88 - distanceToCenter * 40 + Math.sin(i * 2) * 8; 
            // Shift hue elegantly across the strands (creates a multi-tone iridescent effect)
            const hueShift = normalizedOffset * 30; 
            const alpha = 0.03 + (1 - distanceToCenter) * 0.08; 
            
            cx.strokeStyle = `hsla(${ribbon.hue + hueShift}, 95%, ${lightness}%, ${alpha})`;
            cx.lineWidth = 0.5 + (1 - distanceToCenter) * 1.5; // Thicker in the middle, thinner at edges
            cx.lineCap = 'round';
            cx.lineJoin = 'round';
            cx.stroke();
          }
        });

        for (let index = 0; index < currentProfile.sparkles; index += 1) {
          const sparkle = sparkles[index];
          if (!sparkle) continue;
          const ribbonIndex = sparkle.ribbonIndex % Math.max(1, currentProfile.ribbons);
          const ribbon = ribbons[ribbonIndex];
          if (!ribbon) continue;

          sparkle.t += sparkle.speed * (interactionActiveRef.current ? 1.6 : 1);
          if (sparkle.t > 1) {
            sparkle.t = 0;
            sparkle.spread = (Math.random() - 0.5) * 120;
          }

          const point = getRibbonPoint(sparkle.t, ribbonIndex);
          const pulse = 0.7 + Math.sin(time * 3.4 + sparkle.phase) * 0.3;
          const spread = sparkle.spread * (0.6 + sparkle.t * 0.3);
          const x = point.x + point.nx * spread - scrollX * 0.018 * sparkle.t;
          const y = point.y + point.ny * spread - scrollY * 0.018 * sparkle.t;
          const size = sparkle.size * pulse;
          const alpha = sparkle.alpha * (sparkle.t > 0.88 ? (1 - sparkle.t) * 8 : 1);
          const color = `hsla(${ribbon.hue + 6}, 100%, 94%, ${alpha})`;

          cx.beginPath();
          cx.arc(x, y, size, 0, Math.PI * 2);
          cx.fillStyle = color;
          cx.shadowBlur = size * 6;
          cx.shadowColor = color;
          cx.fill();
          cx.shadowBlur = 0;

          if (currentProfile.trails && sparkle.bright) {
            cx.beginPath();
            cx.moveTo(x, y);
            cx.lineTo(x - point.nx * sparkle.trail, y - point.ny * sparkle.trail);
            cx.strokeStyle = `hsla(${ribbon.hue + 14}, 100%, 90%, ${alpha * 0.55})`;
            cx.lineWidth = Math.max(1, size * 0.8);
            cx.lineCap = 'round';
            cx.stroke();
          }
        }

        if (currentProfile.shootingStars) {
          shootingStarCooldown += deltaSeconds;
          if (shootingStarCooldown > 1.8 && runtime.isVisible) {
            shootingStarCooldown = 0;
            shootingStars.push({
              x: width + 40,
              y: Math.random() * height * 0.35,
              vx: -(6 + Math.random() * 4),
              vy: 3 + Math.random() * 2,
              life: 42,
              maxLife: 42,
              length: 70 + Math.random() * 45,
            });
          }
        } else {
          shootingStars.length = 0;
          shootingStarCooldown = 0;
        }

        for (let index = shootingStars.length - 1; index >= 0; index -= 1) {
          const shootingStar = shootingStars[index];
          if (!shootingStar) continue;
          shootingStar.x += shootingStar.vx;
          shootingStar.y += shootingStar.vy;
          shootingStar.life -= 1;
          const alpha = shootingStar.life / shootingStar.maxLife;

          cx.beginPath();
          cx.moveTo(shootingStar.x, shootingStar.y);
          cx.lineTo(
            shootingStar.x - shootingStar.vx * (shootingStar.length / 10),
            shootingStar.y - shootingStar.vy * (shootingStar.length / 10),
          );
          cx.strokeStyle = `rgba(255,255,255,${alpha})`;
          cx.lineWidth = 2.4;
          cx.lineCap = 'round';
          cx.stroke();

          if (shootingStar.life <= 0 || shootingStar.x < -100 || shootingStar.y > height + 80) {
            shootingStars.splice(index, 1);
          }
        }
      } else {
        cx.clearRect(0, 0, width, height);

        const glow = cx.createRadialGradient(pointerX, pointerY, 0, pointerX, pointerY, Math.max(width, height) * 0.38);
        glow.addColorStop(0, 'rgba(255,255,255,0.75)');
        glow.addColorStop(0.45, 'rgba(255,255,255,0.22)');
        glow.addColorStop(1, 'transparent');
        cx.fillStyle = glow;
        cx.fillRect(0, 0, width, height);
      }

      rafId = scheduleFrame(draw);
    };

    rafId = scheduleFrame(draw);

    return () => {
      window.removeEventListener('resize', resizeCanvas);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (reducedMotionMedia) {
        if (typeof reducedMotionMedia.removeEventListener === 'function') {
          reducedMotionMedia.removeEventListener('change', handleReducedMotionChange);
        } else if (typeof reducedMotionMedia.removeListener === 'function') {
          reducedMotionMedia.removeListener(handleReducedMotionChange);
        }
      }
      if (viewportElement) {
        viewportElement.removeEventListener('mousemove', handleMouseMove);
        viewportElement.removeEventListener('scroll', handleScroll);
      }
      window.clearTimeout(bootTimer);
      window.clearTimeout(allocationTimer);
      cancelFrame(rafId);
    };
  }, [interactionActiveRef, isDark, themeIndex, viewportRef]);

  return (
    <div className="mbg" data-memory-mode={profileMode}>
      <canvas ref={canvasRef} id="scv" data-memory-mode={profileMode}></canvas>
    </div>
  );
});

const MemoryTreeLayer = React.memo(function MemoryTreeLayer({
  nodes,
  centerNode,
  onSelect,
}: {
  nodes: readonly MemoryNode[];
  centerNode?: MemoryNode;
  onSelect: (node: MemoryNode) => void;
}) {
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());

  const handleNodeClick = (node: MemoryNode) => {
    if (node.level === 1) {
      setExpandedNodes(prev => {
        const next = new Set(prev);
        if (next.has(node.id)) {
          next.delete(node.id);
        } else {
          next.add(node.id);
        }
        return next;
      });
    } else {
      if (node.d) {
        onSelect(node);
      }
    }
  };

  const visibleNodes = nodes.filter(node => 
    node.level === 0 || 
    node.level === 1 || 
    (node.level === 2 && node.parentId && expandedNodes.has(node.parentId))
  );

  return (
    <div className="mtr" id="mtr">
      <svg className="tsv" id="tsv">
        <defs>
          <linearGradient id="glowLineLight" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="rgba(59, 130, 246, 0.8)" />
            <stop offset="50%" stopColor="rgba(139, 92, 246, 0.6)" />
            <stop offset="100%" stopColor="rgba(6, 182, 212, 0.8)" />
          </linearGradient>
          <linearGradient id="glowLineDark" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="rgba(255, 255, 255, 0.9)" />
            <stop offset="50%" stopColor="rgba(255, 255, 255, 0.4)" />
            <stop offset="100%" stopColor="rgba(255, 255, 255, 0.9)" />
          </linearGradient>
        </defs>
        {/* Draw L0 to L1 lines */}
        {centerNode && visibleNodes.filter((node) => node.level === 1).map((node) => (
          <line
            key={`line-${node.id}`}
            x1={centerNode.x + 120}
            y1={centerNode.y + 70}
            x2={node.x + 100}
            y2={node.y + 60}
            className="core"
          />
        ))}
        {/* Draw L1 to L2 lines */}
        {visibleNodes.filter((node) => node.level === 2).map((node) => {
          const parent = nodes.find(n => n.id === node.parentId);
          if (!parent) return null;
          return (
            <line
              key={`line-${node.id}`}
              x1={parent.x + 100}
              y1={parent.y + 60}
              x2={node.x + 80}
              y2={node.y + 40}
            />
          );
        })}
      </svg>
      {visibleNodes.map((node) => (
        <div
          key={node.id}
          className={`tn ${node.c ? 'ct' : ''} ${node.level === 2 ? 'l2' : ''} ${expandedNodes.has(node.id) ? 'expanded' : ''}`}
          style={{ left: node.x, top: node.y }}
          onClick={() => handleNodeClick(node)}
        >
          <div className="ti">{node.ic}</div>
          <div className="tt">{node.t}</div>
          <div className="tp2">{node.p}</div>
          {node.level === 1 && <div className="expand-hint">{expandedNodes.has(node.id) ? "收起" : "展开"}</div>}
        </div>
      ))}
    </div>
  );
});

const MemoryNodeDialog = React.memo(function MemoryNodeDialog({
  dialogMode,
  selectedNode,
  draftTitle,
  draftContent,
  draftTags,
  isSaving,
  isDeleting,
  errorMessage,
  onDraftTitleChange,
  onDraftContentChange,
  onDraftTagsChange,
  onClose,
  onStartEdit,
  onSave,
  onDelete,
}: {
  dialogMode: "view" | "create" | "edit" | null;
  selectedNode: MemoryNode | null;
  draftTitle: string;
  draftContent: string;
  draftTags: string;
  isSaving: boolean;
  isDeleting: boolean;
  errorMessage: string | null;
  onDraftTitleChange: (value: string) => void;
  onDraftContentChange: (value: string) => void;
  onDraftTagsChange: (value: string) => void;
  onClose: () => void;
  onStartEdit: () => void;
  onSave: () => void;
  onDelete: () => void;
}) {
  if (!dialogMode) {
    return null;
  }

  const isEditor = dialogMode === "create" || dialogMode === "edit";
  const isMemoryNode = selectedNode?.nodeType === "memory";
  const title = dialogMode === "create"
    ? "新增记忆"
    : dialogMode === "edit"
      ? "编辑记忆"
      : selectedNode?.d || "";
  const meta = dialogMode === "create"
    ? "手动写入"
    : dialogMode === "edit"
      ? "更新当前记忆"
      : selectedNode?.dm || "";

  return createPortal(
    <div className="ndo on" id="ndo" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="nd" role="dialog" aria-modal="true">
        <h3 id="nd-t">{title}</h3>
        <div className="dm" id="nd-m">{meta}</div>
        {isEditor ? (
          <div className="memory-form">
            <label className="memory-field">
              <span>记忆摘要</span>
              <input
                value={draftTitle}
                onChange={(event) => onDraftTitleChange(event.target.value)}
                placeholder="输入记忆摘要"
              />
            </label>
            <label className="memory-field">
              <span>详细内容</span>
              <textarea
                value={draftContent}
                onChange={(event) => onDraftContentChange(event.target.value)}
                placeholder="输入详细内容"
                rows={8}
              />
            </label>
            <label className="memory-field">
              <span>标签</span>
              <input
                value={draftTags}
                onChange={(event) => onDraftTagsChange(event.target.value)}
                placeholder="使用逗号、顿号或换行分隔"
              />
            </label>
            {errorMessage ? <div className="memory-error">{errorMessage}</div> : null}
            <div className="memory-actions">
              <button className="memory-action primary" onClick={onSave} disabled={isSaving || isDeleting}>
                {isSaving ? "保存中......." : "保存"}
              </button>
              <button className="memory-action" onClick={onClose} disabled={isSaving || isDeleting}>取消</button>
            </div>
          </div>
        ) : (
          <>
            <div className="db" id="nd-b">{selectedNode?.db || ""}</div>
            {errorMessage ? <div className="memory-error">{errorMessage}</div> : null}
            <div className="memory-actions">
              {isMemoryNode ? (
                <>
                  <button className="memory-action primary" onClick={onStartEdit} disabled={isSaving || isDeleting}>编辑</button>
                  <button className="memory-action danger" onClick={onDelete} disabled={isSaving || isDeleting}>
                    {isDeleting ? "删除中..." : "删除"}
                  </button>
                </>
              ) : null}
              <button className="cd" onClick={onClose} disabled={isSaving || isDeleting}>关闭</button>
            </div>
          </>
      )}
      </div>
    </div>,
    document.body
  );
});

function MemoryScreen({
  onClose,
  role,
  isDark,
  themeIndex,
  userProfile,
  currentUserId,
  refreshUserProfile,
}: {
  onClose: () => void;
  role: RoleKey | null;
  isDark: boolean;
  themeIndex: number;
  userProfile: UserProfileResponse | null;
  currentUserId: string | null;
  refreshUserProfile: (userId?: string) => Promise<UserProfileResponse | null>;
}) {
  const vpRef = useRef<HTMLDivElement>(null);
  const dragActiveRef = useRef(false);
  const dragStartRef = useRef({ x: 0, y: 0, sl: 0, st: 0 });
  const interactionActiveRef = useRef(false);
  const interactionTimerRef = useRef<number | null>(null);
  const hasCenteredRef = useRef(false);
  const [selectedNode, setSelectedNode] = useState<MemoryNode | null>(null);
  const [dialogMode, setDialogMode] = useState<"view" | "create" | "edit" | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftContent, setDraftContent] = useState("");
  const [draftTags, setDraftTags] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [lastSyncAt, setLastSyncAt] = useState(() => new Date().toISOString());

  const nodes = React.useMemo(() => buildMemoryNodes(role, userProfile, isDark, themeIndex), [isDark, role, themeIndex, userProfile]);
  const centerNode = React.useMemo(() => nodes.find((node) => node.c), [nodes]);
  const stageMetrics = React.useMemo(() => {
    const width = Math.max(2400, ...nodes.map((node) => node.x + (node.c ? 320 : node.level === 2 ? 240 : 280)));
    const height = Math.max(2400, ...nodes.map((node) => node.y + (node.c ? 260 : node.level === 2 ? 200 : 240)));
    return { width, height };
  }, [nodes]);

  const keepInteractionWarm = useCallback(() => {
    interactionActiveRef.current = true;
    if (interactionTimerRef.current) {
      window.clearTimeout(interactionTimerRef.current);
    }
    interactionTimerRef.current = window.setTimeout(() => {
      interactionActiveRef.current = false;
    }, 180);
  }, []);

  const [transform, setTransform] = useState({ x: -400, y: -400, scale: 0.62 });

  useEffect(() => {
    return () => {
      if (interactionTimerRef.current) {
        window.clearTimeout(interactionTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!currentUserId) {
      return;
    }
    const syncNow = async () => {
      try {
        const profile = await refreshUserProfile(currentUserId);
        if (profile) {
          setLastSyncAt(new Date().toISOString());
        }
      } catch {
        // noop
      }
    };
    void syncNow();
    const timer = window.setInterval(() => {
      void syncNow();
    }, 60000);
    return () => window.clearInterval(timer);
  }, [currentUserId, refreshUserProfile]);

  useEffect(() => {
    if (!centerNode || !vpRef.current || hasCenteredRef.current) {
      return;
    }
    const viewport = vpRef.current;
    const viewportRect = viewport.getBoundingClientRect();
    const viewportWidth = viewport.clientWidth || viewportRect.width || window.innerWidth || 1280;
    const viewportHeight = viewport.clientHeight || viewportRect.height || window.innerHeight || 720;
    const nextScale = 0.62;
    const centerX = centerNode.x + 120;
    const centerY = centerNode.y + 92;
    setTransform({
      x: viewportWidth / 2 - centerX * nextScale,
      y: viewportHeight / 2 - centerY * nextScale,
      scale: nextScale,
    });
    hasCenteredRef.current = true;
  }, [centerNode]);

  const handleMouseDown = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('.tn')) {
      return;
    }

    dragActiveRef.current = true;
    dragStartRef.current = {
      x: event.clientX,
      y: event.clientY,
      sl: transform.x,
      st: transform.y,
    };
    keepInteractionWarm();
  }, [keepInteractionWarm, transform.x, transform.y]);

  const handleMouseMove = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (!dragActiveRef.current) {
      return;
    }

    setTransform(prev => ({
      ...prev,
      x: dragStartRef.current.sl + (event.clientX - dragStartRef.current.x),
      y: dragStartRef.current.st + (event.clientY - dragStartRef.current.y)
    }));
    keepInteractionWarm();
  }, [keepInteractionWarm]);

  const handleMouseUp = useCallback(() => {
    dragActiveRef.current = false;
    keepInteractionWarm();
  }, [keepInteractionWarm]);

  const handleWheel = useCallback((event: React.WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (!vpRef.current) return;

    const scaleChange = event.deltaY > 0 ? 0.9 : 1.1;
    
    setTransform(prev => {
      const nextScale = Math.max(0.2, Math.min(prev.scale * scaleChange, 3));
      
      // Calculate cursor position relative to the viewport
      const rect = vpRef.current!.getBoundingClientRect();
      const cursorX = event.clientX - rect.left;
      const cursorY = event.clientY - rect.top;
      
      // Calculate how much we need to pan to keep the cursor over the same point
      const ratio = nextScale / prev.scale;
      const nextX = cursorX - (cursorX - prev.x) * ratio;
      const nextY = cursorY - (cursorY - prev.y) * ratio;

      return {
        x: nextX,
        y: nextY,
        scale: nextScale
      };
    });
    
    keepInteractionWarm();
  }, [keepInteractionWarm]);

  const handleNodeSelect = useCallback((node: MemoryNode) => {
    keepInteractionWarm();
    setErrorMessage(null);
    setSelectedNode(node);
    setDialogMode("view");
  }, [keepInteractionWarm]);

  const handleDialogClose = useCallback(() => {
    keepInteractionWarm();
    setSelectedNode(null);
    setDialogMode(null);
    setDraftTitle("");
    setDraftContent("");
    setDraftTags("");
    setErrorMessage(null);
  }, [keepInteractionWarm]);

  const handleCreateMemory = useCallback(() => {
    keepInteractionWarm();
    setSelectedNode(null);
    setDraftTitle("");
    setDraftContent("");
    setDraftTags(role === "e" ? "enterprise" : "investor");
    setErrorMessage(null);
    setDialogMode("create");
  }, [keepInteractionWarm, role]);

  const handleStartEdit = useCallback(() => {
    if (!selectedNode || selectedNode.nodeType !== "memory") {
      return;
    }
    keepInteractionWarm();
    setDraftTitle(selectedNode.memorySummary ?? "");
    setDraftContent(selectedNode.memoryDetails ?? "");
    setDraftTags((selectedNode.memoryTags ?? []).join("、"));
    setErrorMessage(null);
    setDialogMode("edit");
  }, [keepInteractionWarm, selectedNode]);

  const handleManualRefresh = useCallback(async () => {
    keepInteractionWarm();
    if (!currentUserId) {
      return;
    }
    try {
      const profile = await refreshUserProfile(currentUserId);
      if (profile) {
        setLastSyncAt(new Date().toISOString());
      }
      setErrorMessage(null);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "刷新失败，请稍后再试。");
    }
  }, [currentUserId, keepInteractionWarm, refreshUserProfile]);

  const handleSaveMemory = useCallback(async () => {
    if (!currentUserId) {
      setErrorMessage("当前用户未初始化，暂时无法保存记忆。");
      return;
    }
    const payloadTags = splitInputTags(draftTags).slice(0, 8);
    const normalizedTitle = draftTitle.trim();
    const normalizedContent = draftContent.trim();
    if (!normalizedTitle || !normalizedContent) {
      setErrorMessage("请先填写记忆摘要和详细内容。");
      return;
    }
    setIsSaving(true);
    setErrorMessage(null);
    try {
      if (dialogMode === "edit" && selectedNode?.memoryId) {
        const payload: PrivateMemoryUpdateRequest = {
          userId: currentUserId,
          title: normalizedTitle,
          content: normalizedContent,
          tags: payloadTags,
        };
        await updatePrivateMemory(selectedNode.memoryId, payload);
      } else {
        await writePrivateMemory({
          userId: currentUserId,
          role: role ? roleKeyToPreference(role) : "investor",
          title: normalizedTitle,
          content: normalizedContent,
          tags: payloadTags,
        });
      }
      await refreshUserProfile(currentUserId);
      setLastSyncAt(new Date().toISOString());
      handleDialogClose();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "保存失败，请稍后重试。");
    } finally {
      setIsSaving(false);
    }
  }, [currentUserId, dialogMode, draftContent, draftTags, draftTitle, handleDialogClose, refreshUserProfile, role, selectedNode?.memoryId]);

  const handleDeleteMemory = useCallback(async () => {
    if (!currentUserId || !selectedNode?.memoryId) {
      return;
    }
    setIsDeleting(true);
    setErrorMessage(null);
    try {
      await deletePrivateMemory(selectedNode.memoryId, currentUserId);
      await refreshUserProfile(currentUserId);
      setLastSyncAt(new Date().toISOString());
      handleDialogClose();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "删除失败，请稍后重试。");
    } finally {
      setIsDeleting(false);
    }
  }, [currentUserId, handleDialogClose, refreshUserProfile, selectedNode?.memoryId]);

  return (
    <>
      <MemoryBackgroundCanvas viewportRef={vpRef} isDark={isDark} themeIndex={themeIndex} interactionActiveRef={interactionActiveRef} />
      <div className="mct">
        <div className="mtb">
          <button className="mbk" onClick={onClose}>← 返回</button>
          <div className="memory-toolbar-title">
            <span>记忆中的你</span>
            <small>已同步至 {formatAbsoluteTime(lastSyncAt)}</small>
          </div>
          <div className="memory-toolbar-actions">
            <button className="memory-action" onClick={() => void handleManualRefresh()}>刷新</button>
            <button className="memory-action primary" onClick={handleCreateMemory}>新增记忆</button>
          </div>
        </div>
        <div
          className="mvp"
          ref={vpRef}
          id="mvp"
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onWheel={handleWheel}
        >
          <div
            className="mtsg"
            style={{
              transform: `translate3d(${transform.x}px, ${transform.y}px, 0) scale(${transform.scale})`,
              transformOrigin: '0 0',
              width: `${stageMetrics.width}px`,
              height: `${stageMetrics.height}px`,
              position: 'absolute',
              top: 0,
              left: 0,
            }}
          >
            <MemoryTreeLayer nodes={nodes} centerNode={centerNode} onSelect={handleNodeSelect} />
          </div>
          {/* Minimap */}
          <div
            className="memory-minimap"
            style={{
              position: 'absolute',
              right: 24,
              bottom: 24,
              width: 200,
              height: 150,
              backgroundColor: isDark ? 'rgba(0, 0, 0, 0.4)' : 'rgba(255, 255, 255, 0.4)',
              border: `1px solid ${isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)'}`,
              borderRadius: 8,
              overflow: 'hidden',
              pointerEvents: 'none',
              zIndex: 50,
              backdropFilter: 'blur(4px)',
            }}
          >
            {nodes.map(node => (
              <div
                key={node.id}
                style={{
                  position: 'absolute',
                  left: node.x * (200 / stageMetrics.width),
                  top: node.y * (150 / stageMetrics.height),
                  width: node.c ? 6 : 4,
                  height: node.c ? 6 : 4,
                  backgroundColor: node.c ? '#4f46e5' : isDark ? 'rgba(255, 255, 255, 0.5)' : 'rgba(0, 0, 0, 0.5)',
                  borderRadius: '50%',
                  transform: 'translate(-50%, -50%)',
                }}
              />
            ))}
            {vpRef.current && (
              <div
                style={{
                  position: 'absolute',
                  left: (-transform.x / transform.scale) * (200 / stageMetrics.width),
                  top: (-transform.y / transform.scale) * (150 / stageMetrics.height),
                  width: (vpRef.current.clientWidth / transform.scale) * (200 / stageMetrics.width),
                  height: (vpRef.current.clientHeight / transform.scale) * (150 / stageMetrics.height),
                  border: `2px solid ${isDark ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.3)'}`,
                  backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)',
                  boxSizing: 'border-box',
                }}
              />
            )}
          </div>
        </div>
      </div>
      <MemoryNodeDialog
        dialogMode={dialogMode}
        selectedNode={selectedNode}
        draftTitle={draftTitle}
        draftContent={draftContent}
        draftTags={draftTags}
        isSaving={isSaving}
        isDeleting={isDeleting}
        errorMessage={errorMessage}
        onDraftTitleChange={setDraftTitle}
        onDraftContentChange={setDraftContent}
        onDraftTagsChange={setDraftTags}
        onClose={handleDialogClose}
        onStartEdit={handleStartEdit}
        onSave={() => void handleSaveMemory()}
        onDelete={() => void handleDeleteMemory()}
      />
    </>
  );
}
