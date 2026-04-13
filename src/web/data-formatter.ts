/**
 * 数据格式化与单位转换系统
 * 
 * 功能：
 * 1. 所有数值精确到小数点后两位
 * 2. 支持用户选择数据单位（万元、亿元、元）
 * 3. 自动单位转换和显示
 */

// ==================== 单位类型定义 ====================

export type AmountUnit = "yuan" | "wan" | "yi"; // 元、万元、亿元
export type PercentageUnit = "percent" | "decimal"; // 百分比、小数
export type VolumeUnit = "piece" | "k" | "m"; // 件、千件、百万件

export interface UnitPreferences {
  amountUnit: AmountUnit;
  percentageUnit: PercentageUnit;
  volumeUnit: VolumeUnit;
}

// ==================== 默认配置 ====================

export const DEFAULT_UNIT_PREFERENCES: UnitPreferences = {
  amountUnit: "wan", // 默认万元
  percentageUnit: "percent", // 默认百分比
  volumeUnit: "k", // 默认千件
};

// ==================== 全局小数位数常量 ====================

/** 全局小数位数：所有用户可见数值统一保留2位小数 */
export const GLOBAL_DECIMAL_DIGITS = 2;

// ==================== 单位标签映射 ====================

const UNIT_LABELS = {
  amount: {
    yuan: "元",
    wan: "万元",
    yi: "亿元",
  },
  percentage: {
    percent: "%",
    decimal: "",
  },
  volume: {
    piece: "件",
    k: "千件",
    m: "百万件",
  },
} as const;

// ==================== 核心格式化函数 ====================

/**
 * 将数值格式化为固定小数位数（默认2位）
 */
export function formatFixed(value: number | string | undefined, digits = GLOBAL_DECIMAL_DIGITS): string {
  const num = typeof value === "string" ? parseFloat(value) : value;
  if (num === undefined || num === null || !Number.isFinite(num)) return "—";
  return num.toFixed(digits);
}

/**
 * 格式化百分比（精确到2位小数）
 */
export function formatPercent(value: number | string | undefined, digits = GLOBAL_DECIMAL_DIGITS): string {
  const num = typeof value === "string" ? parseFloat(value) : value;
  if (num === undefined || num === null || !Number.isFinite(num)) return "—";
  return `${num.toFixed(digits)}%`;
}

/**
 * 金额单位转换
 * @param value 原始金额（万元）
 * @param targetUnit 目标单位
 * @returns 转换后的金额
 */
export function convertAmount(value: number | string | undefined, targetUnit: AmountUnit): number {
  const num = typeof value === "string" ? parseFloat(value) : value;
  if (num === undefined || num === null || !Number.isFinite(num)) return 0;
  
  switch (targetUnit) {
    case "yuan":
      return num * 10000; // 万元 -> 元
    case "wan":
      return num; // 万元保持不变
    case "yi":
      return num / 10000; // 万元 -> 亿元
    default:
      return num;
  }
}

/**
 * 格式化金额（带单位转换）
 */
export function formatAmount(
  value: number | string | undefined,
  unit: AmountUnit = "wan",
  digits = GLOBAL_DECIMAL_DIGITS
): string {
  const converted = convertAmount(value, unit);
  if (!Number.isFinite(converted)) return "—";
  const label = UNIT_LABELS.amount[unit] ?? "";
  return `${converted.toFixed(digits)}${label}`;
}

/**
 * 数量单位转换
 * @param value 原始数量（件）
 * @param targetUnit 目标单位
 * @returns 转换后的数量
 */
export function convertVolume(value: number | string | undefined, targetUnit: VolumeUnit): number {
  const num = typeof value === "string" ? parseFloat(value) : value;
  if (num === undefined || num === null || !Number.isFinite(num)) return 0;
  
  switch (targetUnit) {
    case "piece":
      return num; // 件保持不变
    case "k":
      return num / 1000; // 件 -> 千件
    case "m":
      return num / 1000000; // 件 -> 百万件
    default:
      return num;
  }
}

/**
 * 格式化数量（带单位转换）
 */
export function formatVolume(
  value: number | string | undefined,
  unit: VolumeUnit = "k",
  digits = GLOBAL_DECIMAL_DIGITS
): string {
  const converted = convertVolume(value, unit);
  if (!Number.isFinite(converted)) return "—";
  const label = UNIT_LABELS.volume[unit] ?? "";
  return `${converted.toFixed(digits)}${label}`;
}

/**
 * 格式化差距值（带正负号）
 */
export function formatGap(
  current: number | string | undefined,
  benchmark: number | string | undefined,
  digits = GLOBAL_DECIMAL_DIGITS
): string {
  const cur = typeof current === "string" ? parseFloat(current) : current ?? 0;
  const bench = typeof benchmark === "string" ? parseFloat(benchmark) : benchmark ?? 0;
  
  if (!Number.isFinite(cur) || !Number.isFinite(bench)) return "—";
  
  const diff = cur - bench;
  const prefix = diff > 0 ? "+" : "";
  return `${prefix}${diff.toFixed(digits)}`;
}

// ==================== 单位选择器组件支持 ====================

export interface UnitOption {
  value: string;
  label: string;
  description?: string;
}

export const AMOUNT_UNIT_OPTIONS: UnitOption[] = [
  { value: "yuan", label: "元", description: "原始金额" },
  { value: "wan", label: "万元", description: "适合财务报表" },
  { value: "yi", label: "亿元", description: "适合大型企业" },
];

export const PERCENTAGE_UNIT_OPTIONS: UnitOption[] = [
  { value: "percent", label: "百分比 (%)", description: "如：23.50%" },
  { value: "decimal", label: "小数", description: "如：0.2350" },
];

export const VOLUME_UNIT_OPTIONS: UnitOption[] = [
  { value: "piece", label: "件", description: "原始数量" },
  { value: "k", label: "千件", description: "适合产销数据" },
  { value: "m", label: "百万件", description: "适合大规模生产" },
];

// ==================== 数据转换工具 ====================

/**
 * 根据用户偏好转换企业采集数据
 */
export function convertEnterpriseData(
  data: Record<string, string | number>,
  preferences: UnitPreferences
): Record<string, string> {
  const result: Record<string, string> = {};
  
  for (const [key, value] of Object.entries(data)) {
    // 根据字段名判断数据类型
    if (key.toLowerCase().includes("margin") || key.toLowerCase().includes("ratio")) {
      // 百分比字段
      const num = typeof value === "string" ? parseFloat(value) : value;
      if (preferences.percentageUnit === "decimal") {
        result[key] = formatFixed((num ?? 0) / 100, GLOBAL_DECIMAL_DIGITS); // 百分比转小数，保留2位
      } else {
        result[key] = formatPercent(num, GLOBAL_DECIMAL_DIGITS);
      }
    } else if (key.toLowerCase().includes("volume") || key.toLowerCase().includes("sales")) {
      // 数量字段（销量、产量）
      result[key] = formatVolume(value, preferences.volumeUnit, GLOBAL_DECIMAL_DIGITS);
    } else if (key.toLowerCase().includes("revenue") || 
               key.toLowerCase().includes("cost") || 
               key.toLowerCase().includes("expense") ||
               key.toLowerCase().includes("asset") ||
               key.toLowerCase().includes("liabilit")) {
      // 金额字段（收入、成本、费用、资产、负债）
      result[key] = formatAmount(value, preferences.amountUnit, GLOBAL_DECIMAL_DIGITS);
    } else {
      // 其他数值字段
      result[key] = formatFixed(value, GLOBAL_DECIMAL_DIGITS);
    }
  }
  
  return result;
}

// ==================== 存储与恢复 ====================

const STORAGE_KEY = "lidi_unit_preferences";

/**
 * 保存用户单位偏好到本地存储
 */
export function saveUnitPreferences(preferences: UnitPreferences): void {
  if (typeof localStorage !== "undefined") {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
  }
}

/**
 * 从本地存储加载用户单位偏好
 */
export function loadUnitPreferences(): UnitPreferences {
  if (typeof localStorage !== "undefined") {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      try {
        return { ...DEFAULT_UNIT_PREFERENCES, ...JSON.parse(stored) };
      } catch {
        return DEFAULT_UNIT_PREFERENCES;
      }
    }
  }
  return DEFAULT_UNIT_PREFERENCES;
}

// ==================== 格式化器类（用于React组件） ====================

export class DataFormatter {
  private preferences: UnitPreferences;
  
  constructor(preferences?: UnitPreferences) {
    this.preferences = preferences ?? loadUnitPreferences();
  }
  
  /**
   * 更新单位偏好
   */
  setPreferences(preferences: UnitPreferences): void {
    this.preferences = preferences;
    saveUnitPreferences(preferences);
  }
  
  /**
   * 获取当前偏好
   */
  getPreferences(): UnitPreferences {
    return { ...this.preferences };
  }
  
  /**
   * 格式化金额
   */
  amount(value: number | string | undefined, digits = GLOBAL_DECIMAL_DIGITS): string {
    return formatAmount(value, this.preferences.amountUnit, digits);
  }
  
  /**
   * 格式化百分比
   */
  percent(value: number | string | undefined, digits = GLOBAL_DECIMAL_DIGITS): string {
    if (this.preferences.percentageUnit === "decimal") {
      const num = typeof value === "string" ? parseFloat(value) : value;
      if (num === undefined || num === null || !Number.isFinite(num)) return "—";
      return num.toFixed(GLOBAL_DECIMAL_DIGITS); // 小数统一保留2位
    }
    return formatPercent(value, digits);
  }
  
  /**
   * 格式化数量
   */
  volume(value: number | string | undefined, digits = GLOBAL_DECIMAL_DIGITS): string {
    return formatVolume(value, this.preferences.volumeUnit, digits);
  }
  
  /**
   * 格式化固定小数
   */
  fixed(value: number | string | undefined, digits = GLOBAL_DECIMAL_DIGITS): string {
    return formatFixed(value, digits);
  }
  
  /**
   * 格式化差距
   */
  gap(current: number | string, benchmark: number | string, digits = GLOBAL_DECIMAL_DIGITS): string {
    return formatGap(current, benchmark, digits);
  }
  
  /**
   * 获取单位标签
   */
  getUnitLabel(type: "amount" | "percentage" | "volume"): string {
    switch (type) {
      case "amount":
        return UNIT_LABELS.amount[this.preferences.amountUnit] ?? "";
      case "percentage":
        return UNIT_LABELS.percentage[this.preferences.percentageUnit] ?? "";
      case "volume":
        return UNIT_LABELS.volume[this.preferences.volumeUnit] ?? "";
      default:
        return "";
    }
  }
}

// ==================== 导出默认实例 ====================

export const defaultFormatter = new DataFormatter();

// ==================== 向后兼容的快捷函数 ====================

/**
 * 快捷格式化金额（使用默认偏好）
 */
export function fmtAmount(value: number | string | undefined): string {
  return defaultFormatter.amount(value);
}

/**
 * 快捷格式化百分比（使用默认偏好）
 */
export function fmtPercent(value: number | string | undefined): string {
  return defaultFormatter.percent(value);
}

/**
 * 快捷格式化数量（使用默认偏好）
 */
export function fmtVolume(value: number | string | undefined): string {
  return defaultFormatter.volume(value);
}

/**
 * 快捷格式化固定小数（2位）
 */
export function fmtFixed(value: number | string | undefined): string {
  return defaultFormatter.fixed(value);
}
