/* eslint-disable react-refresh/only-export-components */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  ZAxis,
  Cell,
  Tooltip,
  ResponsiveContainer,
  RadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Legend,
  CartesianGrid,
  ReferenceLine,
} from "recharts";

import type {
  VisualizationCalendarEntry,
  VisualizationPage,
  VisualizationPayload,
  VisualizationSection,
  VisualizationSourceMeta,
  VisualizationStatus,
  VisualizationWidget,
} from "../shared/business.js";
import type { DataFormatter } from "./data-formatter.js";
import ChartZoomWrapper from "./components/ChartZoomWrapper.js";
import { ErrorBoundary } from "./components/ErrorBoundary.js";

type VisualizationInsight = {
  title: string;
  summary: string;
  source: string;
};

function useIsDark() {
  const [isDark, setIsDark] = useState(true);
  useEffect(() => {
    const check = () => {
      const el = document.documentElement;
      setIsDark(el.getAttribute("data-theme-mode") === "dark" || !el.classList.contains("theme-light"));
    };
    check();
    const observer = new MutationObserver(check);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-theme-mode"] });
    return () => observer.disconnect();
  }, []);
  return isDark;
}

function statusToClass(status: VisualizationStatus) {
  return status === "good" ? "good" : status === "watch" ? "watch" : status === "risk" ? "risk" : "neutral";
}

const NEON_DEFAULT = { bg: "linear-gradient(180deg, #00D4FF 0%, rgba(0,212,255,0.5) 100%)", glow: "rgba(0,212,255,0.25)" };
const NEON_COLORS = [
  { bg: "linear-gradient(180deg, #00D4FF 0%, rgba(0,212,255,0.5) 100%)", glow: "rgba(0,212,255,0.25)" },
  { bg: "linear-gradient(180deg, #FF6B9D 0%, rgba(255,107,157,0.5) 100%)", glow: "rgba(255,107,157,0.25)" },
  { bg: "linear-gradient(180deg, #00E676 0%, rgba(0,230,118,0.5) 100%)", glow: "rgba(0,230,118,0.25)" },
  { bg: "linear-gradient(180deg, #FFD600 0%, rgba(255,214,0,0.5) 100%)", glow: "rgba(255,214,0,0.25)" },
  { bg: "linear-gradient(180deg, #B388FF 0%, rgba(179,136,255,0.5) 100%)", glow: "rgba(179,136,255,0.25)" },
];

function getNeonGradient(status: VisualizationStatus | undefined): string {
  if (status === "good") return "linear-gradient(180deg, #00E676 0%, rgba(0,230,118,0.5) 100%)";
  if (status === "watch") return "linear-gradient(180deg, #FFD600 0%, rgba(255,214,0,0.5) 100%)";
  if (status === "risk") return "linear-gradient(180deg, #FF6B9D 0%, rgba(255,107,157,0.5) 100%)";
  return "linear-gradient(180deg, #00D4FF 0%, rgba(0,212,255,0.5) 100%)";
}

function getStatusColor(status: VisualizationStatus | undefined): string {
  if (status === "good") return "#00E676";
  if (status === "watch") return "#FFD600";
  if (status === "risk") return "#FF6B9D";
  return "var(--t1)";
}

// Chart styling constants for consistent layout and typography
const CHART_FONT_SIZE_AXIS_TICK = 11;
const CHART_FONT_SIZE_AXIS_LABEL = 11;
const CHART_FONT_SIZE_LEGEND = 12;
const CHART_FONT_SIZE_TITLE = "1.1rem"; // eslint-disable-next-line @typescript-eslint/no-unused-vars
const CHART_FONT_SIZE_TOOLTIP = "0.82rem";
const CHART_FONT_SIZE_TOOLTIP_TITLE = "14px";
const CHART_FONT_SIZE_TOOLTIP_VALUE = "15px";
const CHART_FONT_SIZE_SMALL = "0.72rem";
const CHART_FONT_SIZE_XSMALL = "0.68rem";

const CHART_SPACING_MARGIN = { top: 15, right: 25, bottom: 25, left: 15 };
const CHART_SPACING_PADDING = 8; // eslint-disable-next-line @typescript-eslint/no-unused-vars

function barTone(value: number) {
  if (value >= 75) {
    return "good";
  }
  if (value >= 55) {
    return "watch";
  }
  return "risk";
}

function formatRefreshTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "--";
  }
  return `${date.getHours().toString().padStart(2, "0")}:${date.getMinutes().toString().padStart(2, "0")}:${date.getSeconds().toString().padStart(2, "0")}`;
}

function getFilterOptionLabel(payload: VisualizationPayload, filterId: string, value: string) {
  return payload.filters.find((filter) => filter.id === filterId)?.options.find((option) => option.value === value)?.label ?? value;
}

function getBenchmarkLabel(role: VisualizationPayload["role"], benchmark: string) {
  if (benchmark === "leader") {
    return role === "enterprise" ? "头部企业口径" : "龙头估值口径";
  }
  if (benchmark === "portfolio") {
    return role === "enterprise" ? "资本偏好口径" : "组合配置口径";
  }
  return "行业标准口径";
}

function getWindowLabel(windowValue: string) {
  if (windowValue === "rolling") {
    return "滚动12期";
  }
  if (windowValue === "forward") {
    return "未来观察";
  }
  return "近季度";
}

function getConfidenceLabel(confidence: VisualizationSourceMeta["confidence"]) {
  if (confidence === "high") {
    return "高置信度";
  }
  if (confidence === "medium") {
    return "中置信度";
  }
  return "低置信度";
}

function getCategoryLabel(category: VisualizationSourceMeta["category"]) {
  switch (category) {
    case "enterprise_input":
      return "企业输入";
    case "user_profile":
      return "用户画像";
    case "industry_benchmark":
      return "行业基准";
    case "industry_retrieval":
      return "行业检索";
    case "math_model":
      return "数学模型";
    case "evidence_review":
      return "证据审校";
    case "session_context":
      return "会话上下文";
    case "debate":
      return "正式辩论";
    case "attachment":
      return "附件材料";
    default:
      return "其他来源";
  }
}

function getConfidenceStatus(confidence: VisualizationSourceMeta["confidence"]): VisualizationStatus {
  if (confidence === "high") {
    return "good";
  }
  if (confidence === "medium") {
    return "watch";
  }
  return "risk";
}

function isTableLikeWidget(kind: VisualizationWidget["kind"]) {
  if (kind === "sankeyChart") return false;
  return [
    "benchmarkTable",
    "zebraTable",
    "heatmapTable",
    "sparklineTable",
    "alertTable",
    "treeTable",
    "pivotMatrix",
    "calendarTable",
    "cardTable",
  ].includes(kind);
}

function getWidgetLayoutClass(kind: VisualizationWidget["kind"]) {
  switch (kind) {
    case "metricCards":
      return "span-4";
    case "barChart":
    case "lineChart":
    case "waterfallChart":
    case "radarChart":
    case "boxPlotChart":
    case "scatterChart":
    case "bubbleChart":
      return "span-6";
    case "heatmapTable":
    case "heatmapChart":
    case "treeTable":
    case "pivotMatrix":
    case "sankeyChart":
      return "span-12";
    default:
      return "span-3";
  }
}

function getHomeWidgetAreaClass(index: number): string {
  const areaMap: Record<number, string> = {
    0: "area-1",
    1: "area-2",
    2: "area-3",
    3: "area-4",
    4: "area-5",
    5: "area-6",
    6: "area-7",
    7: "area-8",
    8: "area-9",
  };
  return areaMap[index] ?? "";
}

function getWidgetSources(payload: VisualizationPayload, widget: VisualizationWidget) {
  return payload.sourceMeta.filter((source) => widget.sourceIds?.includes(source.id));
}

function createSuggestedQuestion(insight: VisualizationInsight) {
  return `请围绕“${insight.title}”进一步解释：${insight.summary}`;
}

function applyNumberFactor(text: string, factor: number) {
  return text.replace(/-?\d+(\.\d+)?/g, (match) => {
    const value = Number.parseFloat(match);
    if (!Number.isFinite(value)) {
      return match;
    }
    const next = value * factor;
    const originalDigits = match.includes(".") ? match.split(".")[1]?.length ?? 1 : 0;
    const digits = Math.max(Math.min(originalDigits, 2), 1);
    return next.toFixed(digits);
  });
}

function buildFilteredPayload(payload: VisualizationPayload, filterState: Record<string, string>) {
  const windowMode = filterState.window ?? "quarterly";
  const benchmarkMode = filterState.benchmark ?? "industry";
  const factor = windowMode === "rolling" ? 1.03 : windowMode === "forward" ? 1.06 : 1;
  const benchmarkLabel = getBenchmarkLabel(payload.role, benchmarkMode);
  const windowLabel = getWindowLabel(windowMode);

  return {
    ...payload,
    refreshLabel: `${payload.refreshLabel} · ${windowLabel} · ${benchmarkLabel}`,
    sections: payload.sections.map((section) => ({
      ...section,
      widgets: section.widgets.map((widget) => {
        switch (widget.kind) {
          case "metricCards":
            return {
              ...widget,
              cards: widget.cards.map((card) => ({
                ...card,
                benchmark: card.benchmark ? `${benchmarkLabel} · ${card.benchmark}` : benchmarkLabel,
                delta: windowMode === "forward"
                  ? `前瞻视角 · ${card.delta ?? "观察未来变化"}`
                  : windowMode === "rolling"
                    ? `滚动视角 · ${card.delta ?? "关注连续变化"}`
                    : card.delta,
              })),
            };
          case "barChart":
            return {
              ...widget,
              data: widget.data.map((item, index) => ({
                ...item,
                value: Number((item.value * (windowMode === "forward" ? 1 + index * 0.015 : factor)).toFixed(2)),
                displayValue: applyNumberFactor(item.displayValue, windowMode === "forward" ? 1 + index * 0.015 : factor),
                benchmark: `${benchmarkLabel} · ${item.benchmark ?? "对标基准"}`,
                detail: `${item.detail} 当前按${windowLabel}重绘，并使用${benchmarkLabel}进行比较。`,
              })),
            };
          case "lineChart":
            return {
              ...widget,
              data: widget.data.map((item, index) => ({
                ...item,
                value: Number((item.value * (windowMode === "forward" ? 1 + index * 0.015 : factor)).toFixed(2)),
                displayValue: applyNumberFactor(item.displayValue, windowMode === "forward" ? 1 + index * 0.015 : factor),
                benchmark: `${benchmarkLabel} · ${item.benchmark ?? "对标基准"}`,
                detail: `${item.detail} 当前按${windowLabel}重绘，并使用${benchmarkLabel}进行比较。`,
              })),
            };
          case "benchmarkTable":
            return {
              ...widget,
              rows: widget.rows.map((row) => ({
                ...row,
                benchmark: `${benchmarkLabel} · ${row.benchmark}`,
                note: `${row.note} 当前比较维度已切换到${benchmarkLabel}。`,
              })),
            };
          case "zebraTable":
            return {
              ...widget,
            };
          case "heatmapTable":
            return {
              ...widget,
              rows: widget.rows.map((row) => ({
                ...row,
                values: row.values.map((value) => Math.min(120, Number((value * factor).toFixed(0)))),
              })),
            };
          case "sparklineTable":
            return {
              ...widget,
              rows: widget.rows.map((row) => ({
                ...row,
                trend: row.trend.map((value, index) => Number((value * (windowMode === "forward" ? 1 + index * 0.01 : factor)).toFixed(2))),
                benchmark: row.benchmark ? `${benchmarkLabel} · ${row.benchmark}` : benchmarkLabel,
              })),
            };
          case "alertTable":
            return {
              ...widget,
              rows: widget.rows.map((row) => ({
                ...row,
                threshold: `${benchmarkLabel} · ${row.threshold}`,
              })),
            };
          case "cardTable":
            return {
              ...widget,
            };
          case "treeTable":
            return {
              ...widget,
              rows: widget.rows.map((row) => ({
                ...row,
                note: `${row.note} 当前查看口径：${windowLabel}。`,
              })),
            };
          case "pivotMatrix":
            return {
              ...widget,
            };
          case "calendarTable":
            return {
              ...widget,
              entries: widget.entries.map((entry) => ({
                ...entry,
                detail: `${entry.detail} 已按${windowLabel}节奏重新组织。`,
              })),
            };
          case "boxPlotChart":
            return {
              ...widget,
              groups: widget.groups.map((group) => ({
                ...group,
                min: Number((group.min * factor).toFixed(2)),
                q1: Number((group.q1 * factor).toFixed(2)),
                median: Number((group.median * factor).toFixed(2)),
                q3: Number((group.q3 * factor).toFixed(2)),
                max: Number((group.max * factor).toFixed(2)),
                displayValues: {
                  min: `${(group.min * factor).toFixed(2)}`,
                  q1: `${(group.q1 * factor).toFixed(2)}`,
                  median: `${(group.median * factor).toFixed(2)}`,
                  q3: `${(group.q3 * factor).toFixed(2)}`,
                  max: `${(group.max * factor).toFixed(2)}`,
                },
                detail: `${group.detail} 当前按${windowLabel}重绘，并使用${benchmarkLabel}进行比较。`,
              })),
            };
          case "scatterChart":
            return {
              ...widget,
              data: widget.data.map((item, index) => ({
                ...item,
                x: Number((item.x * factor).toFixed(2)),
                y: Number((item.y * (windowMode === "forward" ? 1 + index * 0.015 : factor)).toFixed(2)),
                displayX: applyNumberFactor(item.displayX, factor),
                displayY: applyNumberFactor(item.displayY, windowMode === "forward" ? 1 + index * 0.015 : factor),
                detail: `${item.detail} 当前按${windowLabel}重绘，并使用${benchmarkLabel}进行比较。`,
              })),
            };
          case "bubbleChart":
            return {
              ...widget,
              data: widget.data.map((item, index) => ({
                ...item,
                x: Number((item.x * factor).toFixed(2)),
                y: Number((item.y * (windowMode === "forward" ? 1 + index * 0.015 : factor)).toFixed(2)),
                z: Number((item.z * factor).toFixed(2)),
                displayX: applyNumberFactor(item.displayX, factor),
                displayY: applyNumberFactor(item.displayY, windowMode === "forward" ? 1 + index * 0.015 : factor),
                displayZ: applyNumberFactor(item.displayZ, factor),
                detail: `${item.detail} 当前按${windowLabel}重绘，并使用${benchmarkLabel}进行比较。`,
              })),
            };
          case "heatmapChart":
            return {
              ...widget,
              cells: widget.cells.map((cell) => ({
                ...cell,
                value: Math.min(120, Number((cell.value * factor).toFixed(0))),
                note: `${cell.note} 当前按${windowLabel} / ${benchmarkLabel}重绘。`,
              })),
            };
          case "radarChart":
            return {
              ...widget,
              dimensions: widget.dimensions.map((dim) => ({
                ...dim,
                current: Number((dim.current * factor).toFixed(2)),
                displayCurrent: `${(dim.current * factor).toFixed(2)}`,
                displayBaseline: benchmarkMode === "leader"
                  ? `${(dim.baseline * 1.1).toFixed(2)}`
                  : benchmarkMode === "portfolio"
                    ? `${(dim.baseline * 0.95).toFixed(2)}`
                    : dim.displayBaseline,
              })),
            };
          case "sankeyChart":
            return {
              ...widget,
              links: widget.links.map((link) => ({
                ...link,
                value: Number((link.value * factor).toFixed(2)),
              })),
            };
          default:
            return widget;
        }
      }),
    })),
  };
}

export function extractTableData(widget: VisualizationWidget): Array<Record<string, string | number>> {
  switch (widget.kind) {
    case "barChart":
      return widget.data.map(d => ({ label: d.label, value: d.value, displayValue: d.displayValue, benchmark: d.benchmark ?? "—" }));
    case "lineChart":
      return widget.data.map(d => ({ period: d.label, value: d.value, displayValue: d.displayValue, benchmark: d.benchmark ?? "—" }));
    case "waterfallChart":
      return widget.data.map(d => ({ label: d.label, value: d.value, displayValue: d.displayValue, isTotal: d.isTotal ? 1 : 0 }));
    case "radarChart":
      return widget.dimensions.map(d => ({ dimension: d.dimension, current: d.current, baseline: d.baseline, displayCurrent: d.displayCurrent, displayBaseline: d.displayBaseline }));
    case "boxPlotChart":
      return widget.groups.map(g => ({ label: g.label, min: g.min, q1: g.q1, median: g.median, q3: g.q3, max: g.max }));
    case "scatterChart":
      return widget.data.map(d => ({ label: d.label, x: d.x, y: d.y, displayX: d.displayX, displayY: d.displayY }));
    case "bubbleChart":
      return widget.data.map(d => ({ label: d.label, x: d.x, y: d.y, z: d.z, displayX: d.displayX, displayY: d.displayY, displayZ: d.displayZ }));
    case "heatmapChart":
      return widget.cells.map(c => ({ row: c.row, column: c.column, value: c.value, displayValue: c.displayValue }));
    case "sankeyChart":
      return widget.links.map(l => ({ source: l.source, target: l.target, value: l.value }));
    case "metricCards":
      return widget.cards.map(c => ({ label: c.label, value: c.value, delta: c.delta ?? "—", benchmark: c.benchmark ?? "—" }));
    case "benchmarkTable":
      return widget.rows.map(r => ({ item: r.item, current: r.current, benchmark: r.benchmark, gap: r.gap }));
    case "zebraTable":
      return widget.rows.map((r, i) => {
        const row: Record<string, string | number> = { _index: i + 1 };
        widget.columns.forEach((col, ci) => { row[col] = r.cells[ci] ?? ""; });
        return row;
      });
    case "heatmapTable":
      return widget.rows.flatMap(r => widget.columns.map((col, ci) => ({ label: r.label, column: col, value: r.values[ci] ?? 0, displayValue: r.displayValues[ci] ?? "" })));
    case "sparklineTable":
      return widget.rows.map(r => ({ label: r.label, value: r.value, benchmark: r.benchmark ?? "—", trendLabel: r.trendLabel }));
    case "alertTable":
      return widget.rows.map(r => ({ rule: r.rule, current: r.current, threshold: r.threshold, action: r.action }));
    case "cardTable":
      return widget.groups.flatMap(g => g.items.map(item => ({ group: g.title, label: item.label, value: item.value, meta: item.meta ?? "—" })));
    case "treeTable":
      return widget.rows.map(r => ({ label: r.label, owner: r.owner, metric: r.metric, note: r.note }));
    case "pivotMatrix":
      return widget.rows.map(r => ({ dimension: r.dimension, ...Object.fromEntries(widget.columns.map((col, ci) => [col, r.values[ci] ?? ""])) }));
    case "calendarTable":
      return widget.entries.map(e => ({ date: e.date, label: e.label, value: e.value, detail: e.detail }));
    default:
      return [];
  }
}

export interface MetricCardData {
  label: string;
  value: string;
  yoy: string;
  qoq: string;
  ranking: string;
  status: VisualizationStatus;
}

export function extractMetricCards(widget: VisualizationWidget): MetricCardData[] {
  switch (widget.kind) {
    case "barChart": {
      const data = widget.data;
      if (data.length === 0) return [];
      const latest = data[data.length - 1]!;
      const prev = data.length > 1 ? data[data.length - 2] : null;
      const qoq = prev ? (((latest.value - prev.value) / Math.abs(prev.value || 1)) * 100).toFixed(1) + "%" : "—";
      const yoy = data.length > 3 ? (((latest.value - data[0]!.value) / Math.abs(data[0]!.value || 1)) * 100).toFixed(1) + "%" : "—";
      const avg = data.reduce((s, d) => s + d.value, 0) / data.length;
      return [
        { label: "最新值", value: latest.displayValue, yoy, qoq, ranking: `#${data.length}`, status: latest.status ?? "neutral" },
        { label: "平均值", value: avg.toFixed(2), yoy: "—", qoq: "—", ranking: "—", status: avg >= 60 ? "good" : avg >= 40 ? "watch" : "risk" },
        { label: "最大值", value: Math.max(...data.map(d => d.value)).toFixed(2), yoy: "—", qoq: "—", ranking: "—", status: "good" },
        { label: "最小值", value: Math.min(...data.map(d => d.value)).toFixed(2), yoy: "—", qoq: "—", ranking: "—", status: "risk" },
      ];
    }
    case "lineChart": {
      const data = widget.data;
      if (data.length === 0) return [];
      const latest = data[data.length - 1]!;
      const prev = data.length > 1 ? data[data.length - 2] : null;
      const qoq = prev ? (((latest.value - prev.value) / Math.abs(prev.value || 1)) * 100).toFixed(1) + "%" : "—";
      const yoy = data.length > 3 ? (((latest.value - data[0]!.value) / Math.abs(data[0]!.value || 1)) * 100).toFixed(1) + "%" : "—";
      const avg = data.reduce((s, d) => s + d.value, 0) / data.length;
      return [
        { label: "最新值", value: latest.displayValue, yoy, qoq, ranking: "—", status: latest.status ?? "neutral" },
        { label: "平均值", value: avg.toFixed(2), yoy: "—", qoq: "—", ranking: "—", status: "neutral" },
        { label: "峰值", value: Math.max(...data.map(d => d.value)).toFixed(2), yoy: "—", qoq: "—", ranking: "—", status: "good" },
        { label: "谷值", value: Math.min(...data.map(d => d.value)).toFixed(2), yoy: "—", qoq: "—", ranking: "—", status: "risk" },
      ];
    }
    case "scatterChart": {
      const data = widget.data;
      if (data.length === 0) return [];
      const avgX = data.reduce((s, d) => s + d.x, 0) / data.length;
      const avgY = data.reduce((s, d) => s + d.y, 0) / data.length;
      return [
        { label: "样本数", value: String(data.length), yoy: "—", qoq: "—", ranking: "—", status: "neutral" },
        { label: `平均${widget.xLabel}`, value: avgX.toFixed(2), yoy: "—", qoq: "—", ranking: "—", status: "neutral" },
        { label: `平均${widget.yLabel}`, value: avgY.toFixed(2), yoy: "—", qoq: "—", ranking: "—", status: "neutral" },
        { label: "数据维度", value: "2D", yoy: "—", qoq: "—", ranking: "—", status: "neutral" },
      ];
    }
    case "bubbleChart": {
      const data = widget.data;
      if (data.length === 0) return [];
      const avgX = data.reduce((s, d) => s + d.x, 0) / data.length;
      const avgY = data.reduce((s, d) => s + d.y, 0) / data.length;
      const avgZ = data.reduce((s, d) => s + d.z, 0) / data.length;
      return [
        { label: "样本数", value: String(data.length), yoy: "—", qoq: "—", ranking: "—", status: "neutral" },
        { label: `平均${widget.xLabel}`, value: avgX.toFixed(2), yoy: "—", qoq: "—", ranking: "—", status: "neutral" },
        { label: `平均${widget.yLabel}`, value: avgY.toFixed(2), yoy: "—", qoq: "—", ranking: "—", status: "neutral" },
        { label: `平均${widget.zLabel}`, value: avgZ.toFixed(2), yoy: "—", qoq: "—", ranking: "—", status: "neutral" },
      ];
    }
    case "radarChart": {
      const dims = widget.dimensions;
      if (dims.length === 0) return [];
      const avgCurrent = dims.reduce((s, d) => s + d.current, 0) / dims.length;
      const avgBaseline = dims.reduce((s, d) => s + d.baseline, 0) / dims.length;
      const bestDim = dims.reduce((best, d) => (d.current - d.baseline) > (best.current - best.baseline) ? d : best, dims[0]!);
      const worstDim = dims.reduce((worst, d) => (d.current - d.baseline) < (worst.current - worst.baseline) ? d : worst, dims[0]!);
      return [
        { label: "综合均值", value: avgCurrent.toFixed(2), yoy: "—", qoq: "—", ranking: "—", status: avgCurrent >= avgBaseline ? "good" : "risk" },
        { label: "基准均值", value: avgBaseline.toFixed(2), yoy: "—", qoq: "—", ranking: "—", status: "neutral" },
        { label: "最强维度", value: bestDim?.dimension ?? "—", yoy: "—", qoq: "—", ranking: "—", status: "good" },
        { label: "最弱维度", value: worstDim?.dimension ?? "—", yoy: "—", qoq: "—", ranking: "—", status: "risk" },
      ];
    }
    case "waterfallChart": {
      const data = widget.data;
      if (data.length === 0) return [];
      const total = data.filter(d => d.isTotal).reduce((s, d) => s + d.value, 0);
      const positive = data.filter(d => !d.isTotal && d.value >= 0).reduce((s, d) => s + d.value, 0);
      const negative = data.filter(d => !d.isTotal && d.value < 0).reduce((s, d) => s + d.value, 0);
      return [
        { label: "合计", value: total.toFixed(2), yoy: "—", qoq: "—", ranking: "—", status: total >= 0 ? "good" : "risk" },
        { label: "正贡献", value: positive.toFixed(2), yoy: "—", qoq: "—", ranking: "—", status: "good" },
        { label: "负贡献", value: Math.abs(negative).toFixed(2), yoy: "—", qoq: "—", ranking: "—", status: "risk" },
        { label: "项目数", value: String(data.length), yoy: "—", qoq: "—", ranking: "—", status: "neutral" },
      ];
    }
    case "boxPlotChart": {
      const groups = widget.groups;
      if (groups.length === 0) return [];
      const avgMedian = groups.reduce((s, g) => s + g.median, 0) / groups.length;
      return [
        { label: "组数", value: String(groups.length), yoy: "—", qoq: "—", ranking: "—", status: "neutral" },
        { label: "中位数均值", value: avgMedian.toFixed(2), yoy: "—", qoq: "—", ranking: "—", status: "neutral" },
        { label: "最大值", value: Math.max(...groups.map(g => g.max)).toFixed(2), yoy: "—", qoq: "—", ranking: "—", status: "good" },
        { label: "最小值", value: Math.min(...groups.map(g => g.min)).toFixed(2), yoy: "—", qoq: "—", ranking: "—", status: "risk" },
      ];
    }
    case "heatmapChart": {
      const cells = widget.cells;
      if (cells.length === 0) return [];
      const avgVal = cells.reduce((s, c) => s + c.value, 0) / cells.length;
      return [
        { label: "单元格数", value: String(cells.length), yoy: "—", qoq: "—", ranking: "—", status: "neutral" },
        { label: "平均值", value: avgVal.toFixed(2), yoy: "—", qoq: "—", ranking: "—", status: "neutral" },
        { label: "最大值", value: Math.max(...cells.map(c => c.value)).toFixed(2), yoy: "—", qoq: "—", ranking: "—", status: "good" },
        { label: "最小值", value: Math.min(...cells.map(c => c.value)).toFixed(2), yoy: "—", qoq: "—", ranking: "—", status: "risk" },
      ];
    }
    case "sankeyChart": {
      const totalValue = widget.links.reduce((s, l) => s + l.value, 0);
      return [
        { label: "节点数", value: String(widget.nodes.length), yoy: "—", qoq: "—", ranking: "—", status: "neutral" },
        { label: "链接数", value: String(widget.links.length), yoy: "—", qoq: "—", ranking: "—", status: "neutral" },
        { label: "总流量", value: totalValue.toFixed(2), yoy: "—", qoq: "—", ranking: "—", status: "neutral" },
        { label: "平均流量", value: (totalValue / Math.max(widget.links.length, 1)).toFixed(2), yoy: "—", qoq: "—", ranking: "—", status: "neutral" },
      ];
    }
    case "metricCards":
      return widget.cards.slice(0, 4).map(c => ({
        label: c.label, value: c.value, yoy: "—", qoq: c.delta ?? "—", ranking: c.benchmark ?? "—", status: c.status ?? "neutral",
      }));
    default:
      return [];
  }
}

function generateSuggestedQuestions(widget: VisualizationWidget): string[] {
  const t = widget.title;
  switch (widget.kind) {
    case "barChart":
    case "lineChart":
      return [`${t}的变化趋势如何？`, `${t}有哪些关键风险点？`, `请深入分析${t}的变化原因`];
    case "scatterChart":
    case "bubbleChart":
      return [`${t}中各维度的相关性如何？`, `${t}有哪些异常数据点？`, `请分析${t}的分布特征`];
    case "radarChart":
      return [`${t}中哪些维度表现较好？`, `${t}与基准的差距在哪里？`, `如何改善${t}中的薄弱维度？`];
    case "waterfallChart":
      return [`${t}中哪些因素贡献最大？`, `${t}的负向驱动因素有哪些？`, `如何优化${t}的结构？`];
    case "boxPlotChart":
      return [`${t}中各组数据的分布差异如何？`, `${t}中是否存在异常值？`, `请分析${t}的离散程度`];
    case "heatmapChart":
      return [`${t}中哪些区域数值最高？`, `${t}的分布规律是什么？`, `请分析${t}中的异常热点`];
    case "sankeyChart":
      return [`${t}中主要流量路径是什么？`, `${t}中哪些节点流量最大？`, `请分析${t}的流转效率`];
    case "metricCards":
      return [`请详细解读${t}中各项指标`, `${t}中哪些指标需要重点关注？`, `${t}的整体表现如何？`];
    default:
      return [`请详细分析${t}`, `${t}有哪些关键发现？`, `${t}的趋势如何？`];
  }
}

interface ImmersiveDetailPanelProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  widget?: VisualizationWidget;
  payload?: VisualizationPayload;
  dataFormatter?: DataFormatter;
}

function ImmersiveDetailPanel({
  isOpen,
  onClose,
  title,
  widget,
  payload: _payload,
  dataFormatter: _dataFormatter,
}: ImmersiveDetailPanelProps) {
  const [visible, setVisible] = useState(false);
  const [entering, setEntering] = useState(false);
  const isClosingRef = useRef(false);
  const shouldAnimateRef = useRef(false);
  const rafRef = useRef<number | null>(null);
  const [sortColumn, setSortColumn] = useState<string>("");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isDark = useIsDark();

  useEffect(() => {
    if (isOpen) {
      isClosingRef.current = false;
      shouldAnimateRef.current = true;
      setVisible(true);
      setEntering(false);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = requestAnimationFrame(() => {
          if (shouldAnimateRef.current) {
            setEntering(true);
          }
        });
      });
      return () => {
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
      };
    } else {
      isClosingRef.current = true;
      shouldAnimateRef.current = false;
      setEntering(false);
      const timer = setTimeout(() => {
        setVisible(false);
        isClosingRef.current = false;
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!visible) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [visible, onClose]);

  const tableData = useMemo(() => widget ? extractTableData(widget) : [], [widget]);
  const metrics = useMemo(() => widget ? extractMetricCards(widget) : [], [widget]);
  const questions = useMemo(() => widget ? generateSuggestedQuestions(widget) : [], [widget]);
  const isChart = widget ? !isTableLikeWidget(widget.kind) : false;

  const sortedTableData = useMemo(() => {
    if (!sortColumn || tableData.length === 0) return tableData;
    return [...tableData].sort((a, b) => {
      const aVal = a[sortColumn];
      const bVal = b[sortColumn];
      if (typeof aVal === "number" && typeof bVal === "number") {
        return sortDirection === "asc" ? aVal - bVal : bVal - aVal;
      }
      return sortDirection === "asc"
        ? String(aVal).localeCompare(String(bVal))
        : String(bVal).localeCompare(String(aVal));
    });
  }, [tableData, sortColumn, sortDirection]);

  const handleSort = useCallback((column: string) => {
    setSortColumn(column);
    setSortDirection(prev => {
      if (sortColumn === column) return prev === "asc" ? "desc" : "asc";
      return "asc";
    });
  }, [sortColumn]);

  const handleCopyQuestion = useCallback((question: string, index: number) => {
    navigator.clipboard.writeText(question).then(() => {
      setCopiedIndex(index);
      if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
      copyTimeoutRef.current = setTimeout(() => setCopiedIndex(null), 1500);
    }).catch(() => {});
  }, []);

  useEffect(() => () => {
    if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
  }, []);

  if (!visible) return null;

  const isClosing = isClosingRef.current && !entering;
  const panelScale = entering ? 1 : (isClosing ? 0.95 : 0.9);
  const panelOpacity = entering ? 1 : 0;

  const columns = tableData.length > 0 ? Object.keys(tableData[0]!) : [];

  const panelBg = isDark ? "rgba(15, 23, 42, 0.96)" : "rgba(255, 255, 255, 0.96)";
  const panelBorder = isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)";
  const panelShadow = isDark
    ? "0 25px 60px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.05)"
    : "0 25px 60px rgba(0,0,0,0.15), 0 0 0 1px rgba(0,0,0,0.05)";
  const textPrimary = isDark ? "rgba(226,232,240,0.95)" : "rgba(15,23,42,0.95)";
  const textSecondary = isDark ? "rgba(148,163,184,0.8)" : "rgba(71,85,105,0.8)";
  const tableHeaderBg = isDark ? "rgba(30,41,59,0.8)" : "rgba(241,245,249,0.8)";
  const tableRowEvenBg = isDark ? "rgba(30,41,59,0.3)" : "rgba(241,245,249,0.5)";
  const brandColor = "#00D4FF";

  return (
    <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div
        onClick={onClose}
        style={{
          position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
          background: "rgba(0, 0, 0, 0.6)",
          backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)",
          opacity: panelOpacity, transition: "opacity 300ms ease-out",
        }}
      />
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: "relative", width: "80vw", maxHeight: "85vh",
          background: panelBg, backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)",
          borderRadius: 16, border: `1px solid ${panelBorder}`, boxShadow: panelShadow,
          display: "flex", flexDirection: "column", overflow: "hidden",
          transform: `scale(${panelScale})`, opacity: panelOpacity,
          transition: "transform 300ms ease-out, opacity 300ms ease-out",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 24px", borderBottom: `1px solid ${panelBorder}`, flexShrink: 0 }}>
          <h3 style={{ margin: 0, fontSize: "1.1rem", fontWeight: 700, color: textPrimary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title}</h3>
          <button
            onClick={onClose}
            style={{
              width: 32, height: 32, borderRadius: 8, border: `1px solid ${panelBorder}`,
              background: isDark ? "rgba(30,41,59,0.6)" : "rgba(241,245,249,0.6)",
              color: textSecondary, fontSize: "1rem", cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.2s",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = isDark ? "rgba(255,107,157,0.15)" : "rgba(255,107,157,0.1)"; e.currentTarget.style.color = "#FF6B9D"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = isDark ? "rgba(30,41,59,0.6)" : "rgba(241,245,249,0.6)"; e.currentTarget.style.color = textSecondary; }}
          >✕</button>
        </div>

        <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column", minHeight: 0 }}>
          {isChart && widget && (
            <div style={{ height: "60%", minHeight: 200, borderBottom: `1px solid ${panelBorder}`, position: "relative", overflow: "hidden" }}>
              <ChartZoomWrapper>
                <WidgetBody widget={widget} density="comfortable" onSelectInsight={() => {}} selectedInsight={null} />
              </ChartZoomWrapper>
            </div>
          )}

          <div style={{ flex: 1, overflow: "auto", display: "flex", flexDirection: "column", minHeight: 0 }}>
            <div style={{ display: "flex", gap: 16, padding: 16, flex: 1, minHeight: 0 }}>
              {tableData.length > 0 && (
                <div style={{ flex: 1, overflow: "auto", borderRadius: 10, border: `1px solid ${panelBorder}`, background: isDark ? "rgba(15,23,42,0.5)" : "rgba(255,255,255,0.5)" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem" }}>
                    <thead>
                      <tr>
                        {columns.map(col => (
                          <th
                            key={col}
                            onClick={() => handleSort(col)}
                            style={{
                              padding: "8px 12px", textAlign: "left", background: tableHeaderBg,
                              color: textPrimary, fontWeight: 600, cursor: "pointer",
                              borderBottom: `1px solid ${panelBorder}`, whiteSpace: "nowrap",
                              userSelect: "none", position: "sticky", top: 0, zIndex: 1,
                            }}
                          >
                            {col}
                            {sortColumn === col && <span style={{ marginLeft: 4, fontSize: "0.7rem" }}>{sortDirection === "asc" ? "▲" : "▼"}</span>}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {sortedTableData.map((row, ri) => (
                        <tr
                          key={ri}
                          style={{ background: ri % 2 === 0 ? tableRowEvenBg : "transparent", transition: "background 0.15s" }}
                          onMouseEnter={(e) => { e.currentTarget.style.background = isDark ? "rgba(0,212,255,0.06)" : "rgba(0,212,255,0.04)"; }}
                          onMouseLeave={(e) => { e.currentTarget.style.background = ri % 2 === 0 ? tableRowEvenBg : "transparent"; }}
                        >
                          {columns.map(col => (
                            <td key={col} style={{ padding: "6px 12px", color: typeof row[col] === "number" ? brandColor : textSecondary, borderBottom: `1px solid ${panelBorder}`, whiteSpace: "nowrap" }}>
                              {String(row[col] ?? "")}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {metrics.length > 0 && (
                <div style={{ width: 280, flexShrink: 0, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, alignContent: "start" }}>
                  {metrics.map((m, mi) => (
                    <div key={mi} style={{ padding: "10px 12px", borderRadius: 10, border: `1px solid ${panelBorder}`, background: isDark ? "rgba(15,23,42,0.5)" : "rgba(255,255,255,0.5)", display: "flex", flexDirection: "column", gap: 4 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{ width: 6, height: 6, borderRadius: "50%", background: getStatusColor(m.status), boxShadow: `0 0 6px ${getStatusColor(m.status)}40`, flexShrink: 0 }} />
                        <span style={{ fontSize: "0.72rem", color: textSecondary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.label}</span>
                      </div>
                      <strong style={{ fontSize: "0.95rem", color: getStatusColor(m.status), fontWeight: 700 }}>{m.value}</strong>
                      <div style={{ display: "flex", gap: 8, fontSize: "0.68rem", color: textSecondary }}>
                        <span>同比 {m.yoy}</span>
                        <span>环比 {m.qoq}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {questions.length > 0 && (
              <div style={{ display: "flex", gap: 10, padding: "12px 16px", borderTop: `1px solid ${panelBorder}`, flexShrink: 0, overflow: "auto" }}>
                {questions.map((q, qi) => (
                  <button
                    key={qi}
                    onClick={() => handleCopyQuestion(q, qi)}
                    style={{
                      padding: "6px 14px", borderRadius: 8, border: `1px solid ${brandColor}40`,
                      background: copiedIndex === qi ? `${brandColor}15` : "transparent",
                      color: brandColor, fontSize: "0.78rem", cursor: "pointer",
                      whiteSpace: "nowrap", transition: "all 0.2s",
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = `${brandColor}15`; e.currentTarget.style.borderColor = brandColor; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = copiedIndex === qi ? `${brandColor}15` : "transparent"; e.currentTarget.style.borderColor = `${brandColor}40`; }}
                  >
                    {copiedIndex === qi ? "✓ 已复制" : q}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function HeatChip({ label, status }: { label: string; status: VisualizationStatus }) {
  return <span className={`viz-chip ${statusToClass(status)}`}>{label}</span>;
}

function SourceMetaCard({ source, compact = false }: { source: VisualizationSourceMeta; compact?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", flexWrap: "wrap", padding: compact ? "6px 10px" : "8px 12px", borderRadius: 10, border: "1px solid rgba(148, 163, 184, 0.15)", background: "rgba(99, 102, 241, 0.04)" }}>
      <strong style={{ fontSize: compact ? "0.82rem" : "0.88rem" }}>{source.label}</strong>
      <HeatChip label={getConfidenceLabel(source.confidence)} status={getConfidenceStatus(source.confidence)} />
    </div>
  );
}

function WidgetSourceSummary({
  widget,
  sources,
}: {
  widget: VisualizationWidget;
  sources: VisualizationSourceMeta[];
}) {
  if (sources.length === 0) {
    return null;
  }

  return null;
}

function MiniSparkline({ values }: { values: number[] }) {
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = Math.max(max - min, 1);
  const points = values
    .map((value, index) => {
      const x = (index / Math.max(values.length - 1, 1)) * 100;
      const y = 100 - ((value - min) / range) * 100;
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <svg className="viz-sparkline" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function useChartAnimation(dataLength: number, staggerMs: number = 50) {
  const [animProgress, setAnimProgress] = useState(0);
  const [isAnimating, setIsAnimating] = useState(true);

  useEffect(() => {
    setAnimProgress(0);
    setIsAnimating(true);
    const totalDuration = 500 + dataLength * staggerMs;
    const midPoint = totalDuration / 2;

    const midTimer = setTimeout(() => {
      setAnimProgress(0.5);
    }, midPoint);

    const endTimer = setTimeout(() => {
      setAnimProgress(1);
      setIsAnimating(false);
    }, totalDuration);

    return () => {
      clearTimeout(midTimer);
      clearTimeout(endTimer);
    };
  }, [dataLength, staggerMs]);

  return { animProgress, isAnimating };
}

function useSmoothTransition<T>(targetValue: T, durationMs: number = 500): T {
  const [current, setCurrent] = useState(targetValue);
  const prevRef = useRef(targetValue);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (prevRef.current === targetValue) return;
    const startValue = prevRef.current;
    const startTime = Date.now();
    const animate = () => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / durationMs, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      if (typeof startValue === "number" && typeof targetValue === "number") {
        setCurrent((startValue + (targetValue - startValue) * eased) as T);
      } else {
        setCurrent(targetValue);
      }
      if (progress < 1) {
        rafRef.current = requestAnimationFrame(animate);
      } else {
        prevRef.current = targetValue;
      }
    };
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(animate);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [targetValue, durationMs]);

  return current;
}

function useClickRipple() {
  const [ripples, setRipples] = useState<Array<{ id: number; x: number; y: number; color: string }>>([]);
  const rippleIdRef = useRef(0);
  const timeoutRefs = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    return () => {
      timeoutRefs.current.forEach((timeoutId) => clearTimeout(timeoutId));
      timeoutRefs.current = [];
    };
  }, []);

  const addRipple = useCallback((e: React.MouseEvent, color: string) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const id = rippleIdRef.current++;
    setRipples((prev) => [...prev, { id, x, y, color }]);
    const timeoutId = setTimeout(() => {
      setRipples((prev) => prev.filter((r) => r.id !== id));
      timeoutRefs.current = timeoutRefs.current.filter((tid) => tid !== timeoutId);
    }, 600);
    timeoutRefs.current.push(timeoutId);
  }, []);

  const rippleElements = (
    <>
      {ripples.map((r) => (
        <span
          key={r.id}
          style={{
            position: "absolute" as const,
            left: r.x,
            top: r.y,
            width: 0,
            height: 0,
            borderRadius: "50%",
            background: r.color,
            opacity: 0.3,
            transform: "translate(-50%, -50%)",
            animation: "rippleExpand 600ms ease-out forwards",
            pointerEvents: "none" as const,
            zIndex: 10,
          }}
        />
      ))}
    </>
  );

  return { addRipple, rippleElements };
}

type FloatingInfoState = {
  x: number;
  y: number;
  title: string;
  value: string;
  status?: string;
  comparison?: string;
  sparkData?: number[];
  yoy?: string;
  qoq?: string;
  boxPlotValues?: { median: string; q1: string; q3: string; max: string; min: string };
};

interface GlassTooltipProps {
  x: number;
  y: number;
  title: string;
  value: string;
  status?: string;
  yoy?: string;
  qoq?: string;
  comparison?: string;
  sparkData?: number[];
  visible: boolean;
  boxPlotValues?: { median: string; q1: string; q3: string; max: string; min: string };
}

export function GlassTooltip({ x, y, title, value, status, yoy, qoq, comparison, sparkData, visible, boxPlotValues }: GlassTooltipProps) {
  const [entering, setEntering] = useState(false);
  const [mounted, setMounted] = useState(false);
  const tooltipRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let rafId1: number | null = null;
    let rafId2: number | null = null;
    if (visible) {
      setMounted(true);
      rafId1 = requestAnimationFrame(() => {
        rafId2 = requestAnimationFrame(() => {
          setEntering(true);
        });
      });
    } else {
      setEntering(false);
      const timer = setTimeout(() => setMounted(false), 200);
      return () => {
        clearTimeout(timer);
        if (rafId1) cancelAnimationFrame(rafId1);
        if (rafId2) cancelAnimationFrame(rafId2);
      };
    }
    return () => {
      if (rafId1) cancelAnimationFrame(rafId1);
      if (rafId2) cancelAnimationFrame(rafId2);
    };
  }, [visible]);

  if (!mounted) return null;

  const statusColor = status === "good" ? "#00E676" : status === "watch" ? "#FFD600" : status === "risk" ? "#FF6B9D" : "#00D4FF";
  const statusLabel = status === "good" ? "良好" : status === "watch" ? "观察" : status === "risk" ? "风险" : "中性";

  const vw = typeof window !== "undefined" ? window.innerWidth : 1200;
  const vh = typeof window !== "undefined" ? window.innerHeight : 800;
  const tooltipWidth = boxPlotValues ? 200 : 240;
  const tooltipHeight = boxPlotValues ? 180 : 200;
  const offset = 16;

  let adjustedX = x + offset;
  let adjustedY = y + offset;

  if (adjustedX + tooltipWidth > vw - 8) {
    adjustedX = x - tooltipWidth - offset;
  }
  if (adjustedY + tooltipHeight > vh - 8) {
    adjustedY = y - tooltipHeight - offset;
  }
  adjustedX = Math.max(8, adjustedX);
  adjustedY = Math.max(8, adjustedY);

  return (
    <div
      ref={tooltipRef}
      className="glass-tooltip"
      style={{
        position: "fixed",
        left: adjustedX,
        top: adjustedY,
        zIndex: 9999,
        pointerEvents: "none",
        opacity: entering ? 1 : 0,
        transform: entering ? "scale(1)" : "scale(0.92)",
        transition: "opacity 200ms cubic-bezier(0.16, 1, 0.3, 1), transform 200ms cubic-bezier(0.16, 1, 0.3, 1)",
      }}
    >
      <div className="glass-tooltip-inner">
        <div className="glass-tooltip-title">{title}</div>
        <div className="glass-tooltip-value-row">
          <span className="glass-tooltip-value" style={{ color: statusColor }}>{value}</span>
          <span className="glass-tooltip-badge" style={{ background: `${statusColor}20`, color: statusColor }}>
            {statusLabel}
          </span>
        </div>
        {boxPlotValues && (
          <div className="glass-tooltip-boxplot">
            <div className="glass-tooltip-boxplot-item" style={{ color: statusColor, fontWeight: 700 }}>中位数：{boxPlotValues.median}</div>
            <div className="glass-tooltip-boxplot-item">Q1：{boxPlotValues.q1}</div>
            <div className="glass-tooltip-boxplot-item">Q3：{boxPlotValues.q3}</div>
            <div className="glass-tooltip-boxplot-item">最大值：{boxPlotValues.max}</div>
            <div className="glass-tooltip-boxplot-item">最小值：{boxPlotValues.min}</div>
          </div>
        )}
        {!boxPlotValues && (yoy || qoq) && (
          <div className="glass-tooltip-yoy">
            {yoy && <span>同比 {yoy}</span>}
            {qoq && <span>环比 {qoq}</span>}
          </div>
        )}
        {!boxPlotValues && comparison && (
          <div className="glass-tooltip-comparison">
            {comparison}
          </div>
        )}
        {!boxPlotValues && sparkData && sparkData.length > 1 && (
          <div style={{ marginTop: 4, width: 100, height: 24 }}>
            <MiniSparkline values={sparkData} />
          </div>
        )}
      </div>
    </div>
  );
}

interface DetailPanelProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  widget?: VisualizationWidget;
  payload?: VisualizationPayload;
  dataFormatter?: DataFormatter;
  originX?: number;
  originY?: number;
}

export function DetailPanel({
  isOpen,
  onClose,
  title,
  widget,
  payload: _payload,
  dataFormatter: _dataFormatter,
  originX,
  originY,
}: DetailPanelProps) {
  const [visible, setVisible] = useState(false);
  const [entering, setEntering] = useState(false);
  const isClosingRef = useRef(false);
  const shouldAnimateRef = useRef(false);
  const [sortColumn, setSortColumn] = useState<string>("");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");

  const isDark = useIsDark();

  useEffect(() => {
    if (isOpen) {
      isClosingRef.current = false;
      shouldAnimateRef.current = true;
      setVisible(true);
      setEntering(false);
      let rafId1: number;
      let rafId2: number;
      rafId1 = requestAnimationFrame(() => {
        rafId2 = requestAnimationFrame(() => {
          if (shouldAnimateRef.current) {
            setEntering(true);
          }
        });
      });
      return () => {
        cancelAnimationFrame(rafId1);
        if (rafId2) cancelAnimationFrame(rafId2);
      };
    } else {
      isClosingRef.current = true;
      shouldAnimateRef.current = false;
      setEntering(false);
      const timer = setTimeout(() => {
        setVisible(false);
        isClosingRef.current = false;
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!visible) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [visible, onClose]);

  const tableData = useMemo(() => widget ? extractTableData(widget) : [], [widget]);
  const metrics = useMemo(() => widget ? extractMetricCards(widget) : [], [widget]);
  const questions = useMemo(() => widget ? generateSuggestedQuestions(widget) : [], [widget]);
  const isChart = widget ? !isTableLikeWidget(widget.kind) : false;

  const sortedTableData = useMemo(() => {
    if (!sortColumn || tableData.length === 0) return tableData;
    return [...tableData].sort((a, b) => {
      const aVal = a[sortColumn];
      const bVal = b[sortColumn];
      if (typeof aVal === "number" && typeof bVal === "number") {
        return sortDirection === "asc" ? aVal - bVal : bVal - aVal;
      }
      return sortDirection === "asc"
        ? String(aVal).localeCompare(String(bVal))
        : String(bVal).localeCompare(String(aVal));
    });
  }, [tableData, sortColumn, sortDirection]);

  const handleSort = useCallback((column: string) => {
    setSortColumn(column);
    setSortDirection(prev => {
      if (sortColumn === column) return prev === "asc" ? "desc" : "asc";
      return "asc";
    });
  }, [sortColumn]);

  if (!visible) return null;

  const isClosing = isClosingRef.current && !entering;
  const panelScale = entering ? 1 : (isClosing ? 0.95 : 0.8);
  const panelOpacity = entering ? 1 : 0;

  const columns = tableData.length > 0 ? Object.keys(tableData[0]!) : [];

  const panelBg = isDark ? "rgba(20, 22, 36, 0.95)" : "rgba(255, 255, 255, 0.96)";
  const panelBorder = isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)";
  const panelShadow = isDark
    ? "0 25px 60px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.05)"
    : "0 25px 60px rgba(0,0,0,0.15), 0 0 0 1px rgba(0,0,0,0.05)";
  const textPrimary = isDark ? "rgba(226,232,240,0.95)" : "rgba(15,23,42,0.95)";
  const textSecondary = isDark ? "rgba(148,163,184,0.8)" : "rgba(71,85,105,0.8)";
  const tableHeaderBg = isDark ? "rgba(30,41,59,0.8)" : "rgba(241,245,249,0.8)";
  const tableRowEvenBg = isDark ? "rgba(30,41,59,0.3)" : "rgba(241,245,249,0.5)";
  const brandColor = "#00D4FF";

  const originTransform = originX !== undefined && originY !== undefined
    ? `translate(${(originX / (typeof window !== "undefined" ? window.innerWidth : 1200) - 0.5) * -40}vw, ${(originY / (typeof window !== "undefined" ? window.innerHeight : 800) - 0.5) * -40}vh)`
    : "";

  return (
    <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div
        onClick={onClose}
        style={{
          position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
          background: "rgba(0, 0, 0, 0.6)",
          backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)",
          opacity: panelOpacity, transition: "opacity 300ms ease-out",
        }}
      />
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: "relative", width: "80vw", height: "80vh",
          background: panelBg, backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)",
          borderRadius: 16, border: `1px solid ${panelBorder}`, boxShadow: panelShadow,
          display: "flex", flexDirection: "column", overflow: "hidden",
          transform: `scale(${panelScale})${originTransform}`,
          opacity: panelOpacity,
          transition: "transform 300ms cubic-bezier(0.4, 0, 0.2, 1), opacity 300ms cubic-bezier(0.4, 0, 0.2, 1)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 24px", borderBottom: `1px solid ${panelBorder}`, flexShrink: 0 }}>
          <h3 style={{ margin: 0, fontSize: "1.1rem", fontWeight: 700, color: textPrimary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title}</h3>
          <button
            onClick={onClose}
            style={{
              width: 32, height: 32, borderRadius: 8, border: `1px solid ${panelBorder}`,
              background: isDark ? "rgba(30,41,59,0.6)" : "rgba(241,245,249,0.6)",
              color: textSecondary, fontSize: "1rem", cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.2s",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = isDark ? "rgba(255,107,157,0.15)" : "rgba(255,107,157,0.1)"; e.currentTarget.style.color = "#FF6B9D"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = isDark ? "rgba(30,41,59,0.6)" : "rgba(241,245,249,0.6)"; e.currentTarget.style.color = textSecondary; }}
          >✕</button>
        </div>

        <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column", minHeight: 0 }}>
          {isChart && widget && (
            <div style={{ height: "55%", minHeight: 200, borderBottom: `1px solid ${panelBorder}`, position: "relative", overflow: "hidden" }}>
              <ChartZoomWrapper>
                <WidgetBody widget={widget} density="comfortable" onSelectInsight={() => {}} selectedInsight={null} />
              </ChartZoomWrapper>
            </div>
          )}

          <div style={{ flex: 1, overflow: "auto", display: "flex", flexDirection: "column", minHeight: 0 }}>
            <div style={{ display: "flex", gap: 16, padding: 16, flex: 1, minHeight: 0 }}>
              {tableData.length > 0 && (
                <div style={{ flex: 1, overflow: "auto", borderRadius: 10, border: `1px solid ${panelBorder}`, background: isDark ? "rgba(15,23,42,0.5)" : "rgba(255,255,255,0.5)" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem" }}>
                    <thead>
                      <tr>
                        {columns.map(col => (
                          <th
                            key={col}
                            onClick={() => handleSort(col)}
                            style={{
                              padding: "8px 12px", textAlign: "left", background: tableHeaderBg,
                              color: textPrimary, fontWeight: 600, cursor: "pointer",
                              borderBottom: `1px solid ${panelBorder}`, whiteSpace: "nowrap",
                              userSelect: "none", position: "sticky", top: 0, zIndex: 1,
                            }}
                          >
                            {col}
                            {sortColumn === col && <span style={{ marginLeft: 4, fontSize: "0.7rem" }}>{sortDirection === "asc" ? "▲" : "▼"}</span>}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {sortedTableData.map((row, ri) => (
                        <tr
                          key={ri}
                          style={{ background: ri % 2 === 0 ? tableRowEvenBg : "transparent", transition: "background 0.15s" }}
                          onMouseEnter={(e) => { e.currentTarget.style.background = isDark ? "rgba(0,212,255,0.06)" : "rgba(0,212,255,0.04)"; }}
                          onMouseLeave={(e) => { e.currentTarget.style.background = ri % 2 === 0 ? tableRowEvenBg : "transparent"; }}
                        >
                          {columns.map(col => (
                            <td key={col} style={{ padding: "6px 12px", color: typeof row[col] === "number" ? brandColor : textSecondary, borderBottom: `1px solid ${panelBorder}`, whiteSpace: "nowrap" }}>
                              {String(row[col] ?? "")}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {metrics.length > 0 && (
                <div style={{ width: 280, flexShrink: 0, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, alignContent: "start" }}>
                  {metrics.map((m, mi) => (
                    <div key={mi} style={{ padding: "10px 12px", borderRadius: 10, border: `1px solid ${panelBorder}`, background: isDark ? "rgba(15,23,42,0.5)" : "rgba(255,255,255,0.5)", display: "flex", flexDirection: "column", gap: 4 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{ width: 6, height: 6, borderRadius: "50%", background: getStatusColor(m.status), boxShadow: `0 0 6px ${getStatusColor(m.status)}40`, flexShrink: 0 }} />
                        <span style={{ fontSize: "0.72rem", color: textSecondary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.label}</span>
                      </div>
                      <strong style={{ fontSize: "0.95rem", color: getStatusColor(m.status), fontWeight: 700 }}>{m.value}</strong>
                      <div style={{ display: "flex", gap: 8, fontSize: "0.68rem", color: textSecondary }}>
                        <span>同比 {m.yoy}</span>
                        <span>环比 {m.qoq}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {questions.length > 0 && (
              <div style={{ display: "flex", gap: 10, padding: "12px 16px", borderTop: `1px solid ${panelBorder}`, flexShrink: 0, overflow: "auto", alignItems: "center" }}>
                {questions.map((q, qi) => (
                  <button
                    key={qi}
                    onClick={() => { navigator.clipboard.writeText(q).catch(() => {}); }}
                    style={{
                      padding: "6px 14px", borderRadius: 8, border: `1px solid ${brandColor}40`,
                      background: "transparent",
                      color: brandColor, fontSize: "0.78rem", cursor: "pointer",
                      whiteSpace: "nowrap", transition: "all 0.2s",
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = `${brandColor}15`; e.currentTarget.style.borderColor = brandColor; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.borderColor = `${brandColor}40`; }}
                  >
                    {q}
                  </button>
                ))}
                <button
                  onClick={() => { navigator.clipboard.writeText(questions.join("\n")).catch(() => {}); }}
                  style={{
                    padding: "6px 14px", borderRadius: 8, border: `1px solid ${brandColor}`,
                    background: `${brandColor}15`,
                    color: brandColor, fontSize: "0.78rem", cursor: "pointer",
                    fontWeight: 600, whiteSpace: "nowrap", transition: "all 0.2s",
                  }}
                >
                  追问
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function FloatingInfoCard({ x, y, title, value, status, comparison, sparkData, visible }: {
  x: number; y: number; title: string; value: string; status?: string;
  comparison?: string; sparkData?: number[]; visible: boolean;
}) {
  if (!visible) return null;
  const statusColor = status === "good" ? "#00E676" : status === "watch" ? "#FFD600" : status === "risk" ? "#FF6B9D" : "#00D4FF";
  const statusLabel = status === "good" ? "良好" : status === "watch" ? "观察" : status === "risk" ? "风险" : "中性";
  const adjustedX = Math.min(x + 12, (typeof window !== "undefined" ? window.innerWidth : 1200) - 220);
  const adjustedY = Math.min(y + 12, (typeof window !== "undefined" ? window.innerHeight : 800) - 180);

  return (
    <div
      style={{
        position: "fixed",
        left: adjustedX,
        top: adjustedY,
        zIndex: 9999,
        pointerEvents: "none",
        animation: "fadeInScale 200ms cubic-bezier(0.34, 1.56, 0.64, 1) forwards",
      }}
    >
      <div
        style={{
          background: "rgba(15, 23, 42, 0.75)",
          backdropFilter: "blur(16px)",
          WebkitBackdropFilter: "blur(16px)",
          border: "1px solid rgba(255, 255, 255, 0.12)",
          borderRadius: 14,
          padding: "14px 18px",
          minWidth: 180,
          boxShadow: "0 8px 32px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.05)",
        }}
      >
        <div style={{ fontSize: "0.75rem", color: "rgba(203,213,225,0.7)", marginBottom: 4 }}>{title}</div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 6 }}>
          <span style={{ fontSize: "1.4rem", fontWeight: 800, color: statusColor }}>{value}</span>
          <span style={{
            fontSize: "0.68rem",
            padding: "2px 8px",
            borderRadius: 10,
            background: `${statusColor}20`,
            color: statusColor,
            fontWeight: 600,
          }}>
            {statusLabel}
          </span>
        </div>
        {comparison && (
          <div style={{ fontSize: "0.72rem", color: "rgba(203,213,225,0.6)", marginBottom: sparkData ? 6 : 0 }}>
            {comparison}
          </div>
        )}
        {sparkData && sparkData.length > 1 && (
          <div style={{ marginTop: 4, width: 100, height: 24 }}>
            <MiniSparkline values={sparkData} />
          </div>
        )}
      </div>
    </div>
  );
}

function ChartGlobalStyles() {
  return (
    <style>{`
      @keyframes rippleExpand {
        0% { width: 0; height: 0; opacity: 0.3; }
        100% { width: 80px; height: 80px; opacity: 0; }
      }
      @keyframes fadeInScale {
        0% { transform: scale(0.8); opacity: 0; }
        100% { transform: scale(1); opacity: 1; }
      }
      @keyframes fadeOutScale {
        0% { transform: scale(1); opacity: 1; }
        100% { transform: scale(0.9); opacity: 0; }
      }
      @keyframes glassTooltipIn {
        0% { transform: scale(0.9); opacity: 0; }
        100% { transform: scale(1); opacity: 1; }
      }
      @keyframes barGrowUp {
        0% { transform: scaleY(0); }
        100% { transform: scaleY(1); }
      }
      @keyframes lineDrawClip {
        0% { clip-path: inset(0 100% 0 0); }
        100% { clip-path: inset(0 0 0 0); }
      }
      @keyframes radarScaleOut {
        0% { transform: scale(0); opacity: 0; }
        100% { transform: scale(1); opacity: 1; }
      }
      @keyframes pointFadeIn {
        0% { transform: scale(0); opacity: 0; }
        100% { transform: scale(1); opacity: 1; }
      }
      @keyframes cellFadeIn {
        0% { opacity: 0; transform: scale(0.8); }
        100% { opacity: 1; transform: scale(1); }
      }
      @keyframes sankeyFlow {
        0% { opacity: 0; }
        100% { opacity: 1; }
      }
    `}</style>
  );
}

function getTreeChildren(rows: Extract<VisualizationWidget, { kind: "treeTable" }>["rows"], parentId?: string) {
  return rows.filter((row) => row.parentId === parentId);
}

function TreeTableWidget({
  widget,
  onSelectInsight,
  selectedInsight,
}: {
  widget: Extract<VisualizationWidget, { kind: "treeTable" }>;
  onSelectInsight: (insight: VisualizationInsight) => void;
  selectedInsight: VisualizationInsight | null;
}) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(widget.rows.map((row) => [row.id, true])),
  );
  const roots = getTreeChildren(widget.rows);

  const renderRows = (parentId: string | undefined, depth: number): React.ReactNode =>
    getTreeChildren(widget.rows, parentId).map((row) => {
      const children = getTreeChildren(widget.rows, row.id);
      const isOpen = expanded[row.id] ?? true;
      const isDimmed = selectedInsight && selectedInsight.title !== row.label;
      return (
        <React.Fragment key={row.id}>
          <tr className={`viz-tree-row ${statusToClass(row.status)} ${isDimmed ? "dimmed" : ""}`}>
            <td>
              <div className="viz-tree-cell" style={{ paddingLeft: `${depth * 18}px` }}>
                {children.length > 0 ? (
                  <button
                    type="button"
                    className="viz-tree-toggle"
                    onClick={() => setExpanded((previous) => ({ ...previous, [row.id]: !isOpen }))}
                  >
                    {isOpen ? "−" : "+"}
                  </button>
                ) : (
                  <span className="viz-tree-leaf"></span>
                )}
                <button
                  type="button"
                  className="viz-tree-label-btn"
                  onClick={() => onSelectInsight({ title: row.label, summary: row.note, source: widget.title })}
                >
                  {row.label}
                </button>
              </div>
            </td>
            <td>{row.owner}</td>
            <td className="viz-cell-numeric">{row.metric}</td>
            <td><HeatChip label={row.status === "good" ? "良好" : row.status === "watch" ? "观察" : row.status === "risk" ? "高风险" : "中等"} status={row.status} /></td>
            <td>{row.note}</td>
          </tr>
          {children.length > 0 && isOpen ? renderRows(row.id, depth + 1) : null}
        </React.Fragment>
      );
    });

  return (
    <DataTableShell density="comfortable" columnCount={5}>
      <table className="viz-table viz-tree-table">
        <thead>
          <tr>
            <th>层级</th>
            <th>责任主体</th>
            <th>指标</th>
            <th>状态</th>
            <th>说明</th>
          </tr>
        </thead>
        <tbody>{roots.length > 0 ? renderRows(undefined, 0) : null}</tbody>
      </table>
    </DataTableShell>
  );
}

function CalendarWidget({
  widget,
  onSelectInsight,
  selectedInsight,
}: {
  widget: Extract<VisualizationWidget, { kind: "calendarTable" }>;
  onSelectInsight: (insight: VisualizationInsight) => void;
  selectedInsight: VisualizationInsight | null;
}) {
  const [selectedId, setSelectedId] = useState<string>(widget.entries[0]?.id ?? "");
  const selected = widget.entries.find((entry) => entry.id === selectedId) ?? widget.entries[0];

  return (
    <div className="viz-calendar">
      <div className="viz-calendar-panel">
        <div className="viz-calendar-grid">
          {widget.entries.map((entry) => {
            const isDimmed = selectedInsight && selectedInsight.title !== entry.label;
            return (
              <button
                key={entry.id}
                type="button"
                className={`viz-calendar-day ${statusToClass(entry.status)} ${selectedId === entry.id ? "active" : ""} ${isDimmed ? "dimmed" : ""}`}
                onClick={() => {
                  setSelectedId(entry.id);
                  onSelectInsight({ title: entry.label, summary: entry.detail, source: widget.title });
                }}
              >
                <span>{entry.date}</span>
                <strong>{entry.label}</strong>
                <em>{entry.value}</em>
              </button>
            );
          })}
        </div>
      </div>
      {selected ? (
        <div className={`viz-calendar-detail viz-detail-panel ${statusToClass(selected.status)}`} style={{ backgroundColor: getStatusColor(selected.status) }}>
          <div className="viz-calendar-detail-top">
            <span>{selected.label}</span>
            <HeatChip label={selected.value} status={selected.status} />
          </div>
          <div className="viz-calendar-detail-copy">{selected.detail}</div>
        </div>
      ) : null}
    </div>
  );
}

function DataTableShell({
  density,
  columnCount,
  actions,
  children,
}: {
  density: "comfortable" | "compact";
  columnCount: number;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  const minWidth = Math.max(600, columnCount * 110);
  const shellStyle = {
    ["--viz-table-min-width"]: `${minWidth}px`,
  } as React.CSSProperties & Record<"--viz-table-min-width", string>;

  return (
    <div className={`viz-table-shell ${density === "compact" ? "compact" : ""}`} style={shellStyle}>
      <div className="viz-table-toolbar">
        <div className="viz-table-toolbar-actions">{actions}</div>
        {columnCount > 4 ? <span className="viz-table-scroll-hint">左右滑动查看完整数据</span> : null}
      </div>
      <div className={`viz-table-wrap ${density === "compact" ? "compact" : ""}`}>{children}</div>
    </div>
  );
}

function BenchmarkTableWidget({
  widget,
  density,
  onSelectInsight,
  selectedInsight,
}: {
  widget: Extract<VisualizationWidget, { kind: "benchmarkTable" }>;
  density: "comfortable" | "compact";
  onSelectInsight: (insight: VisualizationInsight) => void;
  selectedInsight: VisualizationInsight | null;
}) {
  const [sortMode, setSortMode] = useState<"default" | "status">("default");
  const rows = useMemo(() => {
    if (sortMode === "default") {
      return widget.rows;
    }
    return [...widget.rows].sort((left, right) => {
      const weight = { risk: 0, watch: 1, neutral: 2, good: 3 } as const;
      return weight[left.status] - weight[right.status];
    });
  }, [sortMode, widget.rows]);

  return (
    <DataTableShell
      density={density}
      columnCount={5}
      actions={
        <div className="viz-widget-inline-actions">
          <button type="button" className="viz-inline-btn" onClick={() => setSortMode((previous) => previous === "default" ? "status" : "default")}>
            {sortMode === "default" ? "按风险排序" : "恢复默认"}
          </button>
        </div>
      }
    >
      <table className="viz-table">
        <thead>
          <tr>
            <th>项目</th>
            <th>当前值</th>
            <th>对标值</th>
            <th>差距</th>
            <th>结论</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const isDimmed = selectedInsight && selectedInsight.title !== row.item;
            return (
              <tr
                key={row.id}
                className={`${statusToClass(row.status)} ${isDimmed ? "dimmed" : ""}`}
                onClick={() => { onSelectInsight({ title: row.item, summary: row.note, source: widget.title }); }}
              >
                <td>{row.item}</td>
                <td className="viz-cell-numeric">{row.current}</td>
                <td className="viz-cell-numeric">{row.benchmark}</td>
                <td className="viz-cell-numeric">{row.gap}</td>
                <td>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <HeatChip label={row.status === "good" ? "良好" : row.status === "watch" ? "观察" : row.status === "risk" ? "高风险" : "中等"} status={row.status} />
                    <span>{row.note}</span>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </DataTableShell>
  );
}

function isNumericCell(text: string) {
  if (!text) return false;
  const trimmed = text.trim();
  return /^-?\d[\d,]*\.?\d*%?$/.test(trimmed);
}

function ZebraTableWidget({
  widget,
  density,
  selectedInsight,
}: {
  widget: Extract<VisualizationWidget, { kind: "zebraTable" }>;
  density: "comfortable" | "compact";
  selectedInsight: VisualizationInsight | null;
}) {
  return (
    <DataTableShell density={density} columnCount={widget.columns.length}>
      <table className="viz-table viz-zebra-table">
        <thead>
          <tr>
            {widget.columns.map((column) => <th key={`${widget.id}-col-${column}`}>{column}</th>)}
          </tr>
        </thead>
        <tbody>
          {widget.rows.map((row, index) => {
            const isDimmed = selectedInsight && selectedInsight.title !== row.cells[0];
            return (
              <tr key={row.id} className={`${index % 2 === 0 ? "odd" : "even"} ${statusToClass(row.status ?? "neutral")} ${isDimmed ? "dimmed" : ""}`}>
                {row.cells.map((cell, cellIndex) => <td key={`${row.id}-${cellIndex}`} className={isNumericCell(cell) ? "viz-cell-numeric" : ""}>{cell}</td>)}
              </tr>
            );
          })}
        </tbody>
      </table>
    </DataTableShell>
  );
}

function HeatmapTableWidget({
  widget,
  density,
  onSelectInsight,
  selectedInsight,
}: {
  widget: Extract<VisualizationWidget, { kind: "heatmapTable" }>;
  density: "comfortable" | "compact";
  onSelectInsight: (insight: VisualizationInsight) => void;
  selectedInsight: VisualizationInsight | null;
}) {
  const [activeCell, setActiveCell] = useState<{ rowId: string; columnIndex: number } | null>(null);

  return (
    <DataTableShell density={density} columnCount={widget.columns.length + 1}>
      <table className="viz-table viz-heatmap-table">
        <thead>
          <tr>
            <th>维度</th>
            {widget.columns.map((column) => <th key={`${widget.id}-col-${column}`}>{column}</th>)}
          </tr>
        </thead>
        <tbody>
          {widget.rows.map((row) => (
            <tr key={row.id}>
              <td>{row.label}</td>
              {row.values.map((value, index) => {
                const tone = barTone(value);
                const active = activeCell?.rowId === row.id && activeCell.columnIndex === index;
                const cellTitle = `${row.label} · ${widget.columns[index]}`;
                const isDimmed = selectedInsight && selectedInsight.title !== cellTitle;
                return (
                  <td key={`${row.id}-${index}`}>
                    <button
                      type="button"
                      className={`viz-heat-cell ${tone} ${active ? "active" : ""} ${isDimmed ? "dimmed" : ""}`}
                      style={{ opacity: Math.min(1, 0.4 + value / 140) }}
                      onMouseEnter={() => setActiveCell({ rowId: row.id, columnIndex: index })}
                      onFocus={() => setActiveCell({ rowId: row.id, columnIndex: index })}
                      onClick={() => {
                        setActiveCell({ rowId: row.id, columnIndex: index });
                        onSelectInsight({
                          title: cellTitle,
                          summary: `${row.displayValues[index]}：${row.notes[index] ?? widget.columns[index]}`,
                          source: widget.title,
                        });
                      }}
                    >
                      <strong>{row.displayValues[index]}</strong>
                      <span>{row.notes[index] ?? widget.columns[index]}</span>
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </DataTableShell>
  );
}

function SparklineTableWidget({
  widget,
  density,
  onSelectInsight,
  selectedInsight,
}: {
  widget: Extract<VisualizationWidget, { kind: "sparklineTable" }>;
  density: "comfortable" | "compact";
  onSelectInsight: (insight: VisualizationInsight) => void;
  selectedInsight: VisualizationInsight | null;
}) {
  return (
    <DataTableShell density={density} columnCount={5}>
      <table className="viz-table viz-spark-table">
        <thead>
          <tr>
            <th>指标</th>
            <th>当前值</th>
            <th>迷你图</th>
            <th>基准</th>
            <th>解读</th>
          </tr>
        </thead>
        <tbody>
          {widget.rows.map((row) => {
            const isDimmed = selectedInsight && selectedInsight.title !== row.label;
            return (
              <tr
                key={row.id}
                className={`${statusToClass(row.status)} ${isDimmed ? "dimmed" : ""}`}
                onClick={() => onSelectInsight({ title: row.label, summary: row.note, source: widget.title })}
              >
                <td>{row.label}</td>
                <td className="viz-cell-numeric">{row.value}</td>
                <td>
                  <div className={`viz-spark-wrap ${statusToClass(row.status)}`}>
                    <MiniSparkline values={row.trend} />
                    <span>{row.trendLabel}</span>
                  </div>
                </td>
                <td>{row.benchmark ?? "—"}</td>
                <td>{row.note}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </DataTableShell>
  );
}

function AlertTableWidget({
  widget,
  density,
  onSelectInsight,
  selectedInsight,
}: {
  widget: Extract<VisualizationWidget, { kind: "alertTable" }>;
  density: "comfortable" | "compact";
  onSelectInsight: (insight: VisualizationInsight) => void;
  selectedInsight: VisualizationInsight | null;
}) {
  return (
    <DataTableShell density={density} columnCount={5}>
      <table className="viz-table viz-alert-table">
        <thead>
          <tr>
            <th>规则</th>
            <th>当前</th>
            <th>阈值</th>
            <th>状态</th>
            <th>动作建议</th>
          </tr>
        </thead>
        <tbody>
          {widget.rows.map((row) => {
            const isDimmed = selectedInsight && selectedInsight.title !== row.rule;
            return (
              <tr
                key={row.id}
                className={`${statusToClass(row.severity)} ${isDimmed ? "dimmed" : ""}`}
                onClick={() => onSelectInsight({ title: row.rule, summary: row.action, source: widget.title })}
              >
                <td>{row.rule}</td>
                <td className="viz-cell-numeric">{row.current}</td>
                <td className="viz-cell-numeric">{row.threshold}</td>
                <td><HeatChip label={row.severity === "good" ? "正常" : row.severity === "watch" ? "观察" : "预警"} status={row.severity} /></td>
                <td>{row.action}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </DataTableShell>
  );
}

function CardTableWidget({
  widget,
  selectedInsight,
}: {
  widget: Extract<VisualizationWidget, { kind: "cardTable" }>;
  selectedInsight: VisualizationInsight | null;
}) {
  return (
    <div className="viz-card-groups">
      {widget.groups.map((group) => (
        <section key={group.id} className="viz-card-group">
          <div className="viz-card-group-head">
            <h5>{group.title}</h5>
            <p>{group.description}</p>
          </div>
          <div className="viz-card-group-grid">
            {group.items.map((item) => {
              const isDimmed = selectedInsight && selectedInsight.title !== item.label;
              return (
                <div key={item.id} className={`viz-card-group-item ${statusToClass(item.status)} ${isDimmed ? "dimmed" : ""}`}>
                  <span>{item.label}</span>
                  <strong>{item.value}</strong>
                  {item.meta ? <em>{item.meta}</em> : null}
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

function PivotMatrixWidget({
  widget,
  density,
  onSelectInsight,
  selectedInsight,
}: {
  widget: Extract<VisualizationWidget, { kind: "pivotMatrix" }>;
  density: "comfortable" | "compact";
  onSelectInsight: (insight: VisualizationInsight) => void;
  selectedInsight: VisualizationInsight | null;
}) {
  return (
    <DataTableShell density={density} columnCount={widget.columns.length + 1}>
      <table className="viz-table viz-pivot-table">
        <thead>
          <tr>
            <th>维度</th>
            {widget.columns.map((column) => <th key={`${widget.id}-col-${column}`}>{column}</th>)}
          </tr>
        </thead>
        <tbody>
          {widget.rows.map((row) => {
            const isDimmed = selectedInsight && selectedInsight.title !== row.dimension;
            return (
              <tr
                key={row.id}
                className={`${statusToClass(row.status)} ${isDimmed ? "dimmed" : ""}`}
                onClick={() => onSelectInsight({ title: row.dimension, summary: row.values.join(" / "), source: widget.title })}
              >
                <td>{row.dimension}</td>
                {row.values.map((value, index) => <td key={`${row.id}-${index}`}>{value}</td>)}
              </tr>
            );
          })}
        </tbody>
      </table>
    </DataTableShell>
  );
}

function MetricCardsWidget({
  widget,
  onSelectInsight,
  selectedInsight,
}: {
  widget: Extract<VisualizationWidget, { kind: "metricCards" }>;
  onSelectInsight: (insight: VisualizationInsight) => void;
  selectedInsight: VisualizationInsight | null;
}) {
  return (
    <div className="viz-metric-grid">
      {widget.cards.map((card) => {
        const isDimmed = selectedInsight && selectedInsight.title !== card.label;
        return (
          <article
            key={card.id}
            className={`viz-metric-card ${statusToClass(card.status)} ${isDimmed ? "dimmed" : ""}`}
            onClick={() => onSelectInsight({ title: card.label, summary: card.description ?? "", source: widget.title })}
          >
            <div className="viz-metric-top">
              <span>{card.label}</span>
              <HeatChip label={card.status === "good" ? "良好" : card.status === "watch" ? "观察" : card.status === "risk" ? "预警" : "中等"} status={card.status} />
            </div>
            <strong style={{ color: getStatusColor(card.status), textShadow: card.status && card.status !== "neutral" ? `0 0 20px ${getStatusColor(card.status)}, 0 0 40px ${getStatusColor(card.status)}40` : undefined }}>{card.value}</strong>
            {card.delta ? <div className="viz-metric-delta">{card.delta}</div> : null}
            {card.benchmark ? <div className="viz-metric-benchmark">{card.benchmark}</div> : null}
            <p>{card.description}</p>
          </article>
        );
      })}
    </div>
  );
}

function BarChartWidget({
  widget,
  onSelectInsight,
  selectedInsight,
}: {
  widget: Extract<VisualizationWidget, { kind: "barChart" }>;
  onSelectInsight: (insight: VisualizationInsight) => void;
  selectedInsight: VisualizationInsight | null;
}) {
  // GMPS Model - 10 indicators with weights
  const GMPS_INDICATORS: Record<string, { weight: number; dimension: string; color: string }> = {
    "gpm_yoy": { weight: 0.14, dimension: "A", color: "#00D4FF" },      // 毛利率同比变化
    "rev_cost_gap": { weight: 0.11, dimension: "A", color: "#00D4FF" }, // 营收增速减成本增速
    "li_price_yoy": { weight: 0.10, dimension: "B", color: "#FF6B9D" }, // 碳酸锂价格同比变化
    "unit_cost_yoy": { weight: 0.12, dimension: "B", color: "#FF6B9D" },// 单位营业成本变化率
    "inv_yoy": { weight: 0.09, dimension: "C", color: "#00E676" },      // 库存同比增速
    "sale_prod_ratio": { weight: 0.10, dimension: "C", color: "#00E676" }, // 产销率
    "mfg_cost_ratio": { weight: 0.12, dimension: "C", color: "#00E676" }, // 制造费用占营业成本比
    "ind_vol": { weight: 0.07, dimension: "D", color: "#FFD600" },      // 锂电行业指数波动率
    "cfo_ratio": { weight: 0.08, dimension: "E", color: "#B388FF" },    // 经营现金流/营业收入
    "lev": { weight: 0.07, dimension: "E", color: "#B388FF" },          // 资产负债率
  };
  
  // GMPS Level Colors
  const GMPS_LEVELS = {
    low: "#10B981",      // < 40: 低压
    medium: "#F59E0B",   // 40-70: 中压
    high: "#EF4444",     // >= 70: 高压
  };
  
  // Get GMPS indicator info
  const getGMPSInfo = (label: string): { weight: number; dimension: string; color: string } => {
    const labelLower = label.toLowerCase().replace(/[\s\-_]/g, "");
    for (const [key, info] of Object.entries(GMPS_INDICATORS)) {
      if (labelLower.includes(key.replace(/_/g, "")) || 
          labelLower.includes(key.split("_")[0] || "") ||
          label.includes(key)) {
        return info;
      }
    }
    return { weight: 0.1, dimension: "A", color: "#00D4FF" };
  };
  
  const max = Math.max(...widget.data.map((item) => item.value), 1);
  const [activeId, setActiveId] = useState<string>(widget.data[0]?.id ?? "");
  const active = widget.data.find((item) => item.id === activeId) ?? widget.data[0];
  const [focusedId, setFocusedId] = useState<string>("");
  const { animProgress, isAnimating } = useChartAnimation(widget.data.length);
  const { addRipple, rippleElements } = useClickRipple();

  const barStyleId = `bar-styles-${widget.id}`;

  return (
    <div className="viz-bar-chart">
      <style>{`
        .${barStyleId}-item {
          transition: opacity 200ms ease;
          transform-origin: bottom center;
        }
        .${barStyleId}-fill {
          transition: height 800ms cubic-bezier(0.34, 1.56, 0.64, 1);
        }
        .${barStyleId}-dim-a { --dim-color: #00D4FF; }
        .${barStyleId}-dim-b { --dim-color: #FF6B9D; }
        .${barStyleId}-dim-c { --dim-color: #00E676; }
        .${barStyleId}-dim-d { --dim-color: #FFD600; }
        .${barStyleId}-dim-e { --dim-color: #B388FF; }
      `}</style>
      <div className="viz-chart-shell" style={{ position: "relative" }}>
        {focusedId && (
          <button type="button" onClick={() => setFocusedId("")}
            style={{ position: "absolute", top: 4, right: 4, zIndex: 20, fontSize: CHART_FONT_SIZE_LEGEND, background: "rgba(0,212,255,0.15)", color: "#00D4FF", border: "1px solid rgba(0,212,255,0.3)", borderRadius: 6, padding: "4px 12px", cursor: "pointer", transition: "all 200ms ease" }}>
            清除聚焦
          </button>
        )}
        {rippleElements}
        <div className="viz-chart-panel">
          <div className="viz-bar-stage">
            {widget.data.map((item, index) => {
              const isDimmed = (selectedInsight && selectedInsight.title !== item.label) || (focusedId && focusedId !== item.id);
              const isActive = activeId === item.id;
              const isFocused = focusedId === item.id;
              const gmpsInfo = getGMPSInfo(item.label);
              const neonColor = { glow: gmpsInfo.color, solid: gmpsInfo.color };
              const gradient = getNeonGradient(item.status);
              const itemProgress = Math.min(Math.max((animProgress * (800 + widget.data.length * 50) - index * 50) / 800, 0), 1);
              const animHeight = isAnimating ? Math.max((item.value / max) * 100 * itemProgress, 16) : Math.max((item.value / max) * 100, 16);
              const statusColor = getStatusColor(item.status);
              return (
                <button
                  key={item.id}
                  type="button"
                  data-bar-index={index}
                  data-bar-status={item.status ?? "neutral"}
                  data-gmps-dimension={gmpsInfo.dimension}
                  className={`viz-bar-item ${statusToClass(item.status)} ${isActive ? "active" : ""} ${isDimmed ? "dimmed" : ""} ${barStyleId}-item ${barStyleId}-dim-${gmpsInfo.dimension.toLowerCase()}`}
                  style={{ opacity: isDimmed ? 0.3 : 1 }}
                  onMouseEnter={() => setActiveId(item.id)}
                  onFocus={() => setActiveId(item.id)}
                  onClick={(e) => {
                    setActiveId(item.id);
                    setFocusedId(focusedId === item.id ? "" : item.id);
                    onSelectInsight({ title: item.label, summary: item.detail, source: widget.title });
                    addRipple(e, statusColor);
                  }}
                >
                  <span
                    className={`viz-bar-fill ${barStyleId}-fill`}
                    style={{
                      height: `${animHeight}%`,
                      background: gradient,
                      boxShadow: isActive || isFocused
                        ? `0 0 24px ${neonColor.glow}, 0 4px 16px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.3), 0 0 40px ${neonColor.glow}60`
                        : `0 0 20px ${neonColor.glow}, 0 4px 12px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.2)`,
                      transformOrigin: "bottom",
                    }}
                  ></span>
                  <strong>{item.label}</strong>
                </button>
              );
            })}
          </div>
        </div>

      </div>
    </div>
  );
}

function LineChartWidget({
  widget,
  onSelectInsight,
  selectedInsight,
}: {
  widget: Extract<VisualizationWidget, { kind: "lineChart" }>;
  onSelectInsight: (insight: VisualizationInsight) => void;
  selectedInsight: VisualizationInsight | null;
}) {
  // DQI Model Color System
  const DQI_COLORS = {
    improve: "#10B981",   // > 1: 经营质量改善
    stable: "#6366F1",    // = 1: 基本稳定
    decline: "#EF4444",   // < 1: 经营质量恶化
  };
  
  // Get DQI status based on value
  const getDQIStatus = (value: number): "improve" | "stable" | "decline" => {
    if (value > 1.02) return "improve";
    if (value < 0.98) return "decline";
    return "stable";
  };
  
  // Get DQI color based on value
  const getDQIColor = (value: number): string => {
    const status = getDQIStatus(value);
    return DQI_COLORS[status];
  };
  
  const maxVal = Math.max(...widget.data.map((item) => item.value), widget.threshold ?? -Infinity);
  const minVal = Math.min(...widget.data.map((item) => item.value), widget.threshold ?? Infinity, 0);
  const range = Math.max(maxVal - minVal, 1);

  const [activeId, setActiveId] = useState<string>(widget.data[0]?.id ?? "");
  const active = widget.data.find((item) => item.id === activeId) ?? widget.data[0];
  const [brushRange, setBrushRange] = useState<[number, number] | null>(null);
  const [isBrushing, setIsBrushing] = useState(false);
  const [brushStart, setBrushStart] = useState<number | null>(null);
  const [focusedId, setFocusedId] = useState<string>("");
  const { animProgress, isAnimating } = useChartAnimation(widget.data.length);
  const { addRipple, rippleElements } = useClickRipple();

  const points = widget.data.map((item, index) => {
    const x = (index / Math.max(widget.data.length - 1, 1)) * 100;
    const y = 100 - ((item.value - minVal) / range) * 100;
    const dqiStatus = getDQIStatus(item.value);
    const dqiColor = getDQIColor(item.value);
    return { x, y, item, dqiStatus, dqiColor };
  });

  // DQI threshold at 1.0
  const dqiThresholdY = 100 - ((1 - minVal) / range) * 100;
  const thresholdY = widget.threshold !== undefined ? 100 - ((widget.threshold - minVal) / range) * 100 : undefined;

  const isDark = useIsDark();
  const chartTheme = {
    gridStroke: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)",
    axisStroke: isDark ? "rgba(148,163,184,0.28)" : "rgba(148,163,184,0.4)",
    axisText: isDark ? "rgba(203,213,225,0.82)" : "rgba(30,41,59,0.82)",
    tooltipBg: isDark ? "rgba(15,23,42,0.92)" : "rgba(255,255,255,0.95)",
    tooltipBorder: isDark ? "rgba(255,255,255,0.10)" : "rgba(0,0,0,0.10)",
    tooltipText: isDark ? "rgba(203,213,225,0.86)" : "rgba(30,41,59,0.86)",
  };
  const lineColor = "#00D4FF";
  const gridColor = chartTheme.gridStroke;
  const textColor = chartTheme.axisText;

  const filteredPoints = brushRange
    ? points.filter((p) => p.x >= brushRange[0] && p.x <= brushRange[1])
    : points;

  const areaPoints = filteredPoints.length > 0 ? filteredPoints : points;

  const lineStyleId = `line-styles-${widget.id}`;
  const clipPct = isAnimating ? `${Math.min(animProgress * 130, 100)}%` : "100%";

  return (
    <div className="viz-bar-chart viz-line-chart">
      <style>{`
        .${lineStyleId}-dot-btn {
          transition: opacity 200ms ease;
        }
        .dqi-zone-improve { fill: rgba(16, 185, 129, 0.08); }
        .dqi-zone-decline { fill: rgba(239, 68, 68, 0.08); }
      `}</style>
      <div className="viz-chart-shell" style={{ position: "relative" }}>
        {focusedId && (
          <button type="button" onClick={() => setFocusedId("")}
            style={{ position: "absolute", top: 4, right: 4, zIndex: 20, fontSize: CHART_FONT_SIZE_LEGEND, background: "rgba(0,212,255,0.15)", color: lineColor, border: "1px solid rgba(0,212,255,0.3)", borderRadius: 6, padding: "4px 12px", cursor: "pointer", transition: "all 200ms ease" }}>
            清除聚焦
          </button>
        )}
        {rippleElements}
        <div className="viz-chart-panel">
          <div className="viz-bar-stage" style={{ position: "relative", minHeight: 240 }}>
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ position: "absolute", width: "100%", height: "100%", overflow: "visible", clipPath: `inset(0 ${100 - parseFloat(clipPct)}% 0 0)`, transition: "clip-path 800ms ease-out" }}>
              {/* DQI Zone Background - Improve zone (DQI > 1) */}
              {dqiThresholdY !== undefined && dqiThresholdY < 100 && (
                <rect x="0" y="0" width="100" height={dqiThresholdY} className="dqi-zone-improve" />
              )}
              {/* DQI Zone Background - Decline zone (DQI < 1) */}
              {dqiThresholdY !== undefined && dqiThresholdY > 0 && (
                <rect x="0" y={dqiThresholdY} width="100" height={100 - dqiThresholdY} className="dqi-zone-decline" />
              )}
              {[0.25, 0.5, 0.75].map((tick) => {
                const yPos = 100 - tick * 100;
                return <line key={tick} x1="0" y1={yPos} x2="100" y2={yPos} stroke={gridColor} strokeWidth="0.3" />;
              })}
              {/* DQI threshold line at 1.0 */}
              {dqiThresholdY !== undefined && (
                <line x1="0" y1={dqiThresholdY} x2="100" y2={dqiThresholdY} stroke="#6366F1" strokeDasharray="3,2" strokeWidth="0.5" opacity="0.8" />
              )}
              {thresholdY !== undefined && (
                <line x1="0" y1={thresholdY} x2="100" y2={thresholdY} stroke="#FF6B9D" strokeDasharray="4,2" strokeWidth="0.6" opacity="0.7" />
              )}
              <defs>
                <linearGradient id={`line-area-grad-${widget.id}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={lineColor} stopOpacity={0.35} />
                  <stop offset="50%" stopColor={lineColor} stopOpacity={0.12} />
                  <stop offset="100%" stopColor={lineColor} stopOpacity={0.01} />
                </linearGradient>
              </defs>
              <polygon
                points={`0,100 ${areaPoints.map((p) => `${p.x},${p.y}`).join(" ")} 100,100`}
                fill={`url(#line-area-grad-${widget.id})`}
                style={{ transition: "all 0.8s" }}
              />
              <polyline
                points={points.map((point) => `${point.x},${point.y}`).join(" ")}
                fill="none"
                stroke={lineColor}
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{ transition: "all 0.8s" }}
              />
              {brushRange && (
                <rect
                  x={brushRange[0]}
                  y={0}
                  width={brushRange[1] - brushRange[0]}
                  height={100}
                  fill="rgba(0,212,255,0.06)"
                  stroke="rgba(0,212,255,0.3)"
                  strokeWidth="0.4"
                  strokeDasharray="2,1"
                  rx="0.5"
                />
              )}
              {points.map(({ x, y, item, dqiColor }) => {
                const isActive = activeId === item.id;
                const isDimmed = (selectedInsight && selectedInsight.title !== item.label) || (focusedId && focusedId !== item.id);
                return (
                  <circle
                    key={item.id}
                    cx={x}
                    cy={y}
                    r={isActive ? 2 : 1.2}
                    fill={isActive ? (isDark ? "#fff" : "#1e293b") : dqiColor}
                    stroke={dqiColor}
                    strokeWidth={isActive ? 0.8 : 0.4}
                    opacity={isDimmed ? 0.3 : 1}
                    style={{
                      transition: "all 200ms ease",
                      cursor: "pointer",
                    }}
                  />
                );
              })}
            </svg>

            {/* DQI threshold label */}
            {dqiThresholdY !== undefined && (
              <div style={{ position: "absolute", top: `${dqiThresholdY}%`, left: 4, transform: "translateY(-50%)", fontSize: CHART_FONT_SIZE_AXIS_TICK, color: "#6366F1", fontWeight: 600, background: isDark ? "rgba(15,23,42,0.8)" : "rgba(255,255,255,0.8)", padding: "2px 8px", borderRadius: 4, border: "1px solid rgba(99,102,241,0.3)" }}>
                DQI=1
              </div>
            )}

            {thresholdY !== undefined && widget.thresholdLabel && (
              <div style={{ position: "absolute", top: `${thresholdY}%`, right: 8, transform: "translateY(-50%)", fontSize: CHART_FONT_SIZE_AXIS_TICK, color: "#FF6B9D", opacity: 0.85, background: isDark ? "rgba(15,23,42,0.7)" : "rgba(255,255,255,0.7)", padding: "2px 8px", borderRadius: 4, border: "1px dashed rgba(255,107,157,0.4)" }}>
                {widget.thresholdLabel} {widget.threshold}
              </div>
            )}

            <div
              style={{ display: "flex", justifyContent: "space-between", width: "100%", height: "100%", position: "absolute", top: 0, left: 0 }}
              onMouseDown={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                const xPct = ((e.clientX - rect.left) / rect.width) * 100;
                setIsBrushing(true);
                setBrushStart(xPct);
                setBrushRange(null);
              }}
              onMouseMove={(e) => {
                if (!isBrushing || brushStart === null) return;
                const rect = e.currentTarget.getBoundingClientRect();
                const xPct = ((e.clientX - rect.left) / rect.width) * 100;
                setBrushRange([Math.min(brushStart, xPct), Math.max(brushStart, xPct)]);
              }}
              onMouseUp={() => {
                setIsBrushing(false);
                setBrushStart(null);
              }}
              onMouseLeave={() => {
                if (isBrushing) {
                  setIsBrushing(false);
                  setBrushStart(null);
                }
              }}
            >
              {points.map(({ y, item, dqiStatus, dqiColor }) => {
                const isDimmed = (selectedInsight && selectedInsight.title !== item.label) || (focusedId && focusedId !== item.id);
                const isActive = activeId === item.id;
                const dotColor = isActive ? (isDark ? "#fff" : "#1e293b") : dqiColor;
                const statusColor = getStatusColor(item.status);
                const dqiLabel = dqiStatus === "improve" ? "改善" : dqiStatus === "decline" ? "恶化" : "稳定";
                return (
                  <button
                    key={item.id}
                    type="button"
                    className={`viz-bar-item ${statusToClass(item.status)} ${isActive ? "active" : ""} ${isDimmed ? "dimmed" : ""} ${lineStyleId}-dot-btn`}
                    style={{ width: "40px", height: "100%", position: "relative", display: "flex", justifyContent: "center", background: "transparent", opacity: isDimmed ? 0.3 : 1 }}
                    onMouseEnter={() => setActiveId(item.id)}
                    onFocus={() => setActiveId(item.id)}
                    onClick={(e) => {
                      setActiveId(item.id);
                      setFocusedId(focusedId === item.id ? "" : item.id);
                      onSelectInsight({ title: item.label, summary: item.detail, source: widget.title });
                      addRipple(e, statusColor);
                    }}
                  >
                    <div style={{
                      position: "absolute", top: `${y}%`, width: isActive ? "14px" : "10px", height: isActive ? "14px" : "10px",
                      borderRadius: "50%", background: dotColor, transform: "translateY(-50%)",
                      border: `2px solid ${dqiColor}`,
                      boxShadow: isActive
                        ? `0 0 12px ${dqiColor}80, 0 0 24px ${dqiColor}40`
                        : `0 0 6px ${dqiColor}60`,
                      transition: "all 200ms ease",
                      cursor: "pointer",
                      transformOrigin: "center",
                    }} />
                    <strong style={{ position: "absolute", bottom: "-20px", color: textColor, fontSize: "11px" }}>{item.label}</strong>
                  </button>
                );
              })}
            </div>
            {brushRange && (
              <button
                type="button"
                style={{ position: "absolute", top: 4, right: 4, fontSize: "11px", background: "rgba(0,212,255,0.15)", color: lineColor, border: "1px solid rgba(0,212,255,0.3)", borderRadius: 4, padding: "3px 10px", cursor: "pointer" }}
                onClick={() => setBrushRange(null)}
              >
                清除选区
              </button>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}

function WaterfallChartWidget({
  widget,
  onSelectInsight,
  selectedInsight,
}: {
  widget: Extract<VisualizationWidget, { kind: "waterfallChart" }>;
  onSelectInsight: (insight: VisualizationInsight) => void;
  selectedInsight: VisualizationInsight | null;
}) {
  // DQI Decomposition Model - ROE/Growth/OCF contributions
  const DQI_COMPONENTS: Record<string, { weight: number; label: string; color: string }> = {
    "ROE": { weight: 0.4, label: "盈利能力", color: "#00D4FF" },
    "Growth": { weight: 0.3, label: "成长能力", color: "#00E676" },
    "OCF": { weight: 0.3, label: "现金流质量", color: "#B388FF" },
  };
  
  // Get DQI component info
  const getDQIComponentInfo = (label: string): { weight: number; label: string; color: string } => {
    const labelUpper = label.toUpperCase();
    for (const [key, info] of Object.entries(DQI_COMPONENTS)) {
      if (labelUpper.includes(key) || label.includes(key) || labelUpper.includes(info.label)) {
        return { ...info, label: `${key} (${info.label})` };
      }
    }
    return { weight: 1, label: label, color: "#FFD600" }; // Default for total
  };
  
  let runningTotal = 0;
  const metrics = widget.data.map((item) => {
    const isTotal = item.isTotal;
    const start = isTotal ? 0 : runningTotal;
    if (!isTotal) runningTotal += item.value;
    const end = isTotal ? item.value : runningTotal;
    const dqiInfo = getDQIComponentInfo(item.label);
    return { ...item, start, end, dqiInfo };
  });

  const maxVal = Math.max(...metrics.map((m) => Math.max(m.start, m.end, 0)), 1);
  const minVal = Math.min(...metrics.map((m) => Math.min(m.start, m.end, 0)), 0);
  const range = maxVal - minVal;

  const [activeId, setActiveId] = useState<string>(widget.data[0]?.id ?? "");
  const [focusedId, setFocusedId] = useState<string>("");
  const { animProgress, isAnimating } = useChartAnimation(metrics.length);
  const { addRipple, rippleElements } = useClickRipple();

  const isDark = useIsDark();
  const chartTheme = {
    gridStroke: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)",
    axisText: isDark ? "rgba(203,213,225,0.82)" : "rgba(30,41,59,0.82)",
  };
  const textColor = chartTheme.axisText;

  const svgW = metrics.length * 80 + 60;
  const svgH = 320;
  const padL = 50;
  const padB = 40;
  const padT = 30;
  const chartH = svgH - padT - padB;
  const barW = 40;

  const toSvgY = (value: number) => padT + chartH - ((value - minVal) / range) * chartH;

  const connectorPoints = metrics.map((m, i) => {
    const topVal = m.value >= 0 ? m.end : m.start;
    const x = padL + i * 80 + barW / 2;
    const y = toSvgY(topVal);
    return `${x},${y}`;
  });

  const waterfallStyleId = `wf-styles-${widget.id}`;

  return (
    <div className="viz-bar-chart">
      <style>{`
        .${waterfallStyleId}-bar {
          cursor: pointer;
        }
        .${waterfallStyleId}-bar rect {
          transition: fill-opacity 200ms ease, stroke-width 200ms ease;
        }
        .${waterfallStyleId}-bar:hover rect {
          fill-opacity: 1 !important;
        }
      `}</style>
      <div className="viz-chart-shell" style={{ position: "relative" }}>
        {focusedId && (
          <button type="button" onClick={() => setFocusedId("")}
            style={{ position: "absolute", top: 4, right: 4, zIndex: 20, fontSize: "12px", background: "rgba(0,212,255,0.15)", color: "#00D4FF", border: "1px solid rgba(0,212,255,0.3)", borderRadius: 6, padding: "4px 12px", cursor: "pointer", transition: "all 200ms ease" }}>
            清除聚焦
          </button>
        )}
        {rippleElements}
        <div className="viz-chart-panel" style={{ overflowX: "auto" }}>
          <svg viewBox={`0 0 ${svgW} ${svgH}`} preserveAspectRatio="xMidYMid meet" style={{ width: "100%", height: "auto", overflow: "visible" }}>
            <defs>
              {/* DQI Component Gradients */}
              <linearGradient id={`wf-roe-grad-${widget.id}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#00D4FF" stopOpacity={0.9} />
                <stop offset="100%" stopColor="#00D4FF" stopOpacity={0.5} />
              </linearGradient>
              <linearGradient id={`wf-growth-grad-${widget.id}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#00E676" stopOpacity={0.9} />
                <stop offset="100%" stopColor="#00E676" stopOpacity={0.5} />
              </linearGradient>
              <linearGradient id={`wf-ocf-grad-${widget.id}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#B388FF" stopOpacity={0.9} />
                <stop offset="100%" stopColor="#B388FF" stopOpacity={0.5} />
              </linearGradient>
              <linearGradient id={`wf-total-grad-${widget.id}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#FFD600" stopOpacity={0.9} />
                <stop offset="100%" stopColor="#FFD600" stopOpacity={0.5} />
              </linearGradient>
              {/* Legacy gradients for backward compatibility */}
              <linearGradient id={`wf-pos-grad-${widget.id}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#10B981" stopOpacity={0.9} />
                <stop offset="100%" stopColor="#10B981" stopOpacity={0.5} />
              </linearGradient>
              <linearGradient id={`wf-neg-grad-${widget.id}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#EF4444" stopOpacity={0.9} />
                <stop offset="100%" stopColor="#EF4444" stopOpacity={0.5} />
              </linearGradient>
            </defs>
            {[0, 0.25, 0.5, 0.75, 1].map((tick) => {
              const value = minVal + tick * range;
              const yPos = toSvgY(value);
              return (
                <g key={tick}>
                  <line x1={padL} y1={yPos} x2={svgW} y2={yPos} stroke={chartTheme.gridStroke} strokeWidth="0.5" />
                  <text x={padL - 6} y={yPos} fontSize="11" fill={textColor} textAnchor="end" dominantBaseline="middle" fontWeight={500}>
                    {value.toFixed(1)}
                  </text>
                </g>
              );
            })}
            {connectorPoints.length > 1 && (
              <polyline
                points={connectorPoints.join(" ")}
                fill="none"
                stroke={isDark ? "rgba(255,255,255,0.15)" : "rgba(0,0,0,0.12)"}
                strokeWidth="1.5"
                strokeDasharray="4,3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            )}
            {metrics.map((item, index) => {
              const isPositive = item.value >= 0;
              const isTotal = item.isTotal;
              const bottomVal = Math.min(item.start, item.end);
              const topVal = Math.max(item.start, item.end);
              const barHeight = Math.max(((topVal - bottomVal) / range) * chartH, 2);
              const x = padL + index * 80 + (80 - barW) / 2;
              const y = toSvgY(topVal);
              const isDimmed = (selectedInsight && selectedInsight.title !== item.label) || (focusedId && focusedId !== item.id);
              const isActive = activeId === item.id;
              
              // Use DQI component colors
              const dqiColor = item.dqiInfo.color;
              let fillGrad: string;
              let strokeColor: string;
              
              if (isTotal) {
                fillGrad = `url(#wf-total-grad-${widget.id})`;
                strokeColor = "#FFD600";
              } else {
                // Determine gradient based on DQI component
                const labelUpper = item.label.toUpperCase();
                if (labelUpper.includes("ROE") || labelUpper.includes("盈利")) {
                  fillGrad = `url(#wf-roe-grad-${widget.id})`;
                } else if (labelUpper.includes("GROWTH") || labelUpper.includes("成长")) {
                  fillGrad = `url(#wf-growth-grad-${widget.id})`;
                } else if (labelUpper.includes("OCF") || labelUpper.includes("现金流")) {
                  fillGrad = `url(#wf-ocf-grad-${widget.id})`;
                } else {
                  fillGrad = isPositive ? `url(#wf-pos-grad-${widget.id})` : `url(#wf-neg-grad-${widget.id})`;
                }
                strokeColor = dqiColor;
              }
              
              const itemProgress = Math.min(Math.max((animProgress * (800 + metrics.length * 50) - index * 50) / 800, 0), 1);
              const animBarHeight = isAnimating ? barHeight * itemProgress : barHeight;
              const animY = isAnimating ? toSvgY(topVal) + (barHeight - animBarHeight) : y;

              return (
                <g key={item.id}
                  className={`${waterfallStyleId}-bar`}
                  style={{ opacity: isDimmed ? 0.3 : 1 }}
                  onMouseEnter={() => setActiveId(item.id)}
                  onClick={(e) => {
                    setActiveId(item.id);
                    setFocusedId(focusedId === item.id ? "" : item.id);
                    onSelectInsight({ title: item.label, summary: item.detail ?? item.displayValue, source: widget.title });
                    addRipple(e, strokeColor);
                  }}
                >
                  <rect
                    x={x} y={animY} width={barW} height={animBarHeight}
                    fill={fillGrad} stroke={strokeColor} strokeWidth={isActive ? 2.5 : 1.5}
                    rx="3" ry="3"
                    style={{
                      fillOpacity: isActive ? 1 : 0.85,
                    }}
                  />
                  <text
                    x={x + barW / 2} y={animY - 6}
                    fontSize="12" fill={strokeColor} textAnchor="middle" dominantBaseline="auto"
                    fontWeight={isActive ? 800 : 600}
                  >
                    {item.displayValue}
                  </text>
                  <text
                    x={x + barW / 2} y={svgH - padB + 16}
                    fontSize="11" fill={textColor} textAnchor="middle" dominantBaseline="hanging"
                    fontWeight={isActive ? 700 : 500}
                  >
                    {item.label}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>

      </div>
    </div>
  );
}

function BoxPlotChartWidget({
  widget,
  onSelectInsight,
  selectedInsight,
}: {
  widget: Extract<VisualizationWidget, { kind: "boxPlotChart" }>;
  onSelectInsight: (insight: VisualizationInsight) => void;
  selectedInsight: VisualizationInsight | null;
}) {
  const [activeId, setActiveId] = useState<string>(widget.groups[0]?.id ?? "");
  const [hoveredId, setHoveredId] = useState<string>("");
  const [focusedId, setFocusedId] = useState<string>("");
  const { animProgress, isAnimating } = useChartAnimation(widget.groups.length);
  const { addRipple, rippleElements } = useClickRipple();

  const allValues = widget.groups.flatMap((g) => [g.min, g.max, ...(g.outliers ?? [])]);
  const globalMin = Math.min(...allValues);
  const globalMax = Math.max(...allValues);
  const padding = (globalMax - globalMin) * 0.15 || 1;
  const yMin = globalMin - padding;
  const yMax = globalMax + padding;
  const yRange = yMax - yMin;

  const toY = (value: number) => 100 - ((value - yMin) / yRange) * 80 - 5;

  const isDark = useIsDark();
  const chartTheme = {
    gridStroke: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)",
    axisStroke: isDark ? "rgba(148,163,184,0.28)" : "rgba(148,163,184,0.4)",
    axisText: isDark ? "rgba(203,213,225,0.82)" : "rgba(30,41,59,0.82)",
    tooltipBg: isDark ? "rgba(15,23,42,0.92)" : "rgba(255,255,255,0.95)",
    tooltipBorder: isDark ? "rgba(255,255,255,0.10)" : "rgba(0,0,0,0.10)",
    tooltipText: isDark ? "rgba(203,213,225,0.86)" : "rgba(30,41,59,0.86)",
  };
  const textColor = chartTheme.axisText;
  const gridColor = chartTheme.gridStroke;

  const groupCount = widget.groups.length;
  const slotWidth = 80 / groupCount;
  const offsetX = 15;

  const bpStyleId = `bp-styles-${widget.id}`;

  return (
    <div className="viz-bar-chart viz-box-plot-chart">
      <style>{`
        @keyframes bpOutlierPulse {
          0% { r: 1.5; opacity: 0.8; }
          50% { r: 2.2; opacity: 1; }
          100% { r: 1.5; opacity: 0.8; }
        }
        .${bpStyleId}-outlier {
          animation: bpOutlierPulse 2s ease-in-out infinite;
        }
        .${bpStyleId}-group {
          cursor: pointer;
          transition: opacity 200ms ease;
        }
      `}</style>
      <div className="viz-chart-shell stacked" style={{ position: "relative" }}>
        {focusedId && (
          <button type="button" onClick={() => setFocusedId("")}
            style={{ position: "absolute", top: 4, right: 4, zIndex: 20, fontSize: CHART_FONT_SIZE_SMALL, background: "rgba(0,212,255,0.15)", color: "#00D4FF", border: "1px solid rgba(0,212,255,0.3)", borderRadius: 6, padding: "3px 10px", cursor: "pointer", transition: "all 200ms cubic-bezier(0.34, 1.56, 0.64, 1)" }}>
            清除聚焦
          </button>
        )}
        {rippleElements}
        <div className="viz-chart-panel">
          <svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet" style={{ width: "100%", height: 320, overflow: "visible" }}>
            <defs>
              {widget.groups.map((group, index) => {
                const neonColor = NEON_COLORS[index % NEON_COLORS.length] ?? NEON_DEFAULT;
                const statusColor = getStatusColor(group.status);
                const gradientId = `bp-iqr-grad-${group.id ?? `group-${index}`}`;
                return (
                  <linearGradient key={gradientId} id={gradientId} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={statusColor} stopOpacity={0.55} />
                    <stop offset="50%" stopColor={neonColor.glow.replace("0.25", "0.35")} stopOpacity={0.35} />
                    <stop offset="100%" stopColor={statusColor} stopOpacity={0.15} />
                  </linearGradient>
                );
              })}
            </defs>
            {[0, 0.25, 0.5, 0.75, 1].map((tick) => {
              const yPos = toY(yMin + tick * yRange);
              const value = yMin + tick * yRange;
              return (
                <g key={tick}>
                  <line x1={offsetX - 2} y1={yPos} x2={95} y2={yPos} stroke={gridColor} strokeWidth="0.3" />
                  <text x={offsetX - 3} y={yPos} fontSize="3.2" fill={textColor} textAnchor="end" dominantBaseline="middle" fontWeight={500}>
                    {value.toFixed(2)}
                  </text>
                </g>
              );
            })}

            {widget.groups.map((group, index) => {
              const cx = offsetX + slotWidth * index + slotWidth / 2;
              const boxWidth = slotWidth * 0.55;
              const halfBox = boxWidth / 2;
              const gradientId = `bp-iqr-grad-${group.id ?? `group-${index}`}`;

              const yMedian = toY(group.median);
              const yQ1 = toY(group.q1);
              const yQ3 = toY(group.q3);
              const yMinW = toY(group.min);
              const yMaxW = toY(group.max);

              const isDimmed = (selectedInsight && selectedInsight.title !== group.label) || (focusedId && focusedId !== group.id);
              const isActive = activeId === group.id;
              const isHovered = hoveredId === group.id;
              const neonColor = NEON_COLORS[index % NEON_COLORS.length] ?? NEON_DEFAULT;
              const statusColor = getStatusColor(group.status);
              const opacity = isDimmed ? 0.3 : 1;
              const itemProgress = Math.min(Math.max((animProgress * (800 + widget.groups.length * 50) - index * 50) / 800, 0), 1);
              const scaleAnim = isAnimating ? itemProgress : 1;

              return (
                <g key={group.id ?? `group-${index}`} className={`${bpStyleId}-group`} style={{ opacity, transform: `scale(${scaleAnim})`, transformOrigin: `${cx}px ${yMedian}px` }}
                  onMouseEnter={() => setHoveredId(group.id)}
                  onMouseLeave={() => setHoveredId("")}
                  onClick={(e) => { setActiveId(group.id); setFocusedId(focusedId === group.id ? "" : group.id); onSelectInsight({ title: group.label, summary: group.detail, source: widget.title }); addRipple(e, statusColor); }}
                >
                  <line x1={cx} y1={yMinW} x2={cx} y2={yQ1} stroke={statusColor} strokeWidth="0.8" opacity={0.6} strokeDasharray="1.5,1" />
                  <line x1={cx} y1={yQ3} x2={cx} y2={yMaxW} stroke={statusColor} strokeWidth="0.8" opacity={0.6} strokeDasharray="1.5,1" />
                  <line x1={cx - halfBox * 0.5} y1={yMinW} x2={cx + halfBox * 0.5} y2={yMinW} stroke={statusColor} strokeWidth="0.8" opacity={0.8} />
                  <line x1={cx - halfBox * 0.5} y1={yMaxW} x2={cx + halfBox * 0.5} y2={yMaxW} stroke={statusColor} strokeWidth="0.8" opacity={0.8} />

                  <rect
                    x={cx - halfBox} y={yQ3} width={boxWidth} height={Math.max(yQ1 - yQ3, 0.5)}
                    fill={`url(#${gradientId})`} stroke={statusColor} strokeWidth={isActive ? 0.8 : 0.5} rx="1.5"
                    style={{ transition: "fill-opacity 200ms ease, stroke-width 200ms ease" }}
                  />

                  <line x1={cx - halfBox} y1={yMedian} x2={cx + halfBox} y2={yMedian}
                    stroke={isDark ? "#fff" : "#1e293b"} strokeWidth="1.8" opacity={0.95}
                    style={{ transition: "stroke-width 200ms ease" }}
                  />

                  {(group.outliers ?? []).map((outlier, oi) => {
                    const oy = toY(outlier);
                    return (
                      <circle key={oi} cx={cx} cy={oy} r="1.5" fill={statusColor} fillOpacity={0.6} stroke={statusColor} strokeWidth="0.6" opacity={0.8}
                        className={`${bpStyleId}-outlier`}
                        style={{ transition: "fill-opacity 200ms ease" }} />
                    );
                  })}

                  <text x={cx} y={toY(yMin) + 6} fontSize="3.2" fill={textColor} textAnchor="middle" dominantBaseline="hanging" fontWeight={isActive ? 700 : 500}>
                    {group.label}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>

      </div>
    </div>
  );
}

function ScatterChartWidget({
  widget,
  onSelectInsight,
  selectedInsight,
}: {
  widget: Extract<VisualizationWidget, { kind: "scatterChart" }>;
  onSelectInsight: (insight: VisualizationInsight) => void;
  selectedInsight: VisualizationInsight | null;
}) {
  const [activeId, setActiveId] = useState<string>(widget.data[0]?.id ?? "");
  const [focusedId, setFocusedId] = useState<string>("");
  const { animProgress, isAnimating } = useChartAnimation(widget.data.length);
  const { addRipple, rippleElements } = useClickRipple();

  const isDark = useIsDark();
  const chartTheme = {
    gridStroke: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)",
    axisStroke: isDark ? "rgba(148,163,184,0.28)" : "rgba(148,163,184,0.4)",
    axisText: isDark ? "rgba(203,213,225,0.82)" : "rgba(30,41,59,0.82)",
    tooltipBg: isDark ? "rgba(15,23,42,0.92)" : "rgba(255,255,255,0.95)",
    tooltipBorder: isDark ? "rgba(255,255,255,0.10)" : "rgba(0,0,0,0.10)",
    tooltipText: isDark ? "rgba(203,213,225,0.86)" : "rgba(30,41,59,0.86)",
  };
  const axisColor = chartTheme.axisStroke;
  const textColor = chartTheme.axisText;
  const activeStrokeColor = isDark ? "#fff" : "#1e293b";

  const clusterColors = ["#00D4FF", "#FF6B9D", "#00E676", "#FFD600", "#B388FF", "#FF9100", "#E040FB"];

  const scatterData = widget.data.map((d, index) => ({
    id: d.id,
    label: d.label,
    x: d.x,
    y: d.y,
    displayX: d.displayX,
    displayY: d.displayY,
    status: d.status,
    detail: d.detail,
    clusterColor: clusterColors[index % clusterColors.length] ?? "#00D4FF",
  }));

  const n = scatterData.length;
  const sumX = scatterData.reduce((s, d) => s + d.x, 0);
  const sumY = scatterData.reduce((s, d) => s + d.y, 0);
  const sumXY = scatterData.reduce((s, d) => s + d.x * d.y, 0);
  const sumX2 = scatterData.reduce((s, d) => s + d.x * d.x, 0);
  const slope = n > 1 ? (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX) : 0;
  const intercept = n > 0 ? (sumY - slope * sumX) / n : 0;

  const xMin = Math.min(...scatterData.map((d) => d.x));
  const xMax = Math.max(...scatterData.map((d) => d.x));
  const trendStart = { x: xMin, y: slope * xMin + intercept };
  const trendEnd = { x: xMax, y: slope * xMax + intercept };

  const scatterStyleId = `sc-styles-${widget.id}`;

  return (
    <div className="viz-bar-chart viz-scatter-chart">
      <style>{`
        .${scatterStyleId}-cell {
          transition: fill-opacity 200ms ease, stroke-width 200ms ease;
          cursor: pointer;
        }
      `}</style>
      <div className="viz-chart-shell stacked" style={{ position: "relative" }}>
        {focusedId && (
          <button type="button" onClick={() => setFocusedId("")}
            style={{ position: "absolute", top: 4, right: 4, zIndex: 20, fontSize: "0.72rem", background: "rgba(0,212,255,0.15)", color: "#00D4FF", border: "1px solid rgba(0,212,255,0.3)", borderRadius: 6, padding: "3px 10px", cursor: "pointer", transition: "all 200ms cubic-bezier(0.34, 1.56, 0.64, 1)" }}>
            清除聚焦
          </button>
        )}
        {rippleElements}
        <div className="viz-chart-panel">
          <ResponsiveContainer width="100%" height={320}>
            <ScatterChart margin={CHART_SPACING_MARGIN}>
              <defs>
                {scatterData.map((entry, index) => {
                  const neonColor = NEON_COLORS[index % NEON_COLORS.length] ?? NEON_DEFAULT;
                  return (
                    <radialGradient key={`sc-grad-${entry.id}`} id={`sc-grad-${entry.id}`} cx="35%" cy="35%" r="65%">
                      <stop offset="0%" stopColor={entry.clusterColor} stopOpacity={0.95} />
                      <stop offset="100%" stopColor={neonColor.glow.replace("0.25", "0.5")} stopOpacity={0.3} />
                    </radialGradient>
                  );
                })}
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={axisColor} />
              <XAxis
                dataKey="x" type="number" name={widget.xLabel}
                tick={{ fill: textColor, fontSize: CHART_FONT_SIZE_AXIS_TICK }} axisLine={{ stroke: axisColor }} tickLine={{ stroke: axisColor }}
                label={{ value: widget.xLabel, position: "bottom", offset: 0, style: { fill: textColor, fontSize: CHART_FONT_SIZE_AXIS_LABEL } }}
              />
              <YAxis
                dataKey="y" type="number" name={widget.yLabel}
                tick={{ fill: textColor, fontSize: CHART_FONT_SIZE_AXIS_TICK }} axisLine={{ stroke: axisColor }} tickLine={{ stroke: axisColor }}
                label={{ value: widget.yLabel, angle: -90, position: "insideLeft", style: { fill: textColor, fontSize: CHART_FONT_SIZE_AXIS_LABEL } }}
              />
              <ZAxis range={[90, 280]} />
              <Tooltip
                content={({ payload }) => {
                  if (!payload || payload.length === 0) return null;
                  const datum = payload[0]!.payload;
                  return (
                    <div style={{
                      background: chartTheme.tooltipBg,
                      border: `1px solid ${chartTheme.tooltipBorder}`,
                      borderRadius: 12, padding: "10px 14px", fontSize: CHART_FONT_SIZE_TOOLTIP,
                      boxShadow: isDark ? "0 8px 32px rgba(0,0,0,0.5)" : "0 8px 24px rgba(0,0,0,0.1)",
                      backdropFilter: "blur(12px)",
                    }}>
                      <div style={{ fontWeight: 700, marginBottom: 6, color: datum.clusterColor }}>{datum.label}</div>
                      <div style={{ color: chartTheme.tooltipText }}>{widget.xLabel}: {datum.displayX}</div>
                      <div style={{ color: chartTheme.tooltipText }}>{widget.yLabel}: {datum.displayY}</div>
                    </div>
                  );
                }}
              />
              <ReferenceLine
                segment={[{ x: trendStart.x, y: trendStart.y }, { x: trendEnd.x, y: trendEnd.y }]}
                stroke={isDark ? "rgba(255,255,255,0.25)" : "rgba(0,0,0,0.2)"}
                strokeWidth={2}
                strokeDasharray="6 4"
              />
              <Scatter
                data={scatterData}
                onMouseEnter={(datum) => {
                  const d = scatterData.find((s) => s.x === datum.x && s.y === datum.y);
                  if (d) setActiveId(d.id);
                }}
                onClick={(datum) => {
                  const d = scatterData.find((s) => s.x === datum.x && s.y === datum.y);
                  if (d) {
                    setActiveId(d.id);
                    setFocusedId(focusedId === d.id ? "" : d.id);
                    onSelectInsight({ title: d.label, summary: d.detail, source: widget.title });
                  }
                }}
              >
                {scatterData.map((entry, index) => {
                  const isDimmed = (selectedInsight && selectedInsight.title !== entry.label) || (focusedId && focusedId !== entry.id);
                  const isActive = activeId === entry.id;
                  const neonColor = NEON_COLORS[index % NEON_COLORS.length] ?? NEON_DEFAULT;
                  const itemProgress = Math.min(Math.max((animProgress * (800 + scatterData.length * 50) - index * 50) / 800, 0), 1);
                  const animOpacity = isAnimating ? itemProgress : 1;
                  return (
                    <Cell
                      key={entry.id}
                      fill={`url(#sc-grad-${entry.id})`}
                      fillOpacity={isDimmed ? 0.1 : isActive ? 0.9 : 0.6 * animOpacity}
                      stroke={isActive ? activeStrokeColor : "transparent"}
                      strokeWidth={isActive ? 2 : 0}
                      className={`${scatterStyleId}-cell`}
                      style={{
                        filter: isActive
                          ? `drop-shadow(0 0 10px ${neonColor.glow}) drop-shadow(0 0 20px ${neonColor.glow})`
                          : `drop-shadow(0 0 4px ${neonColor.glow})`,
                        cursor: "pointer",
                        opacity: isDimmed ? 0.3 : 1,
                      }}
                    />
                  );
                })}
              </Scatter>
            </ScatterChart>
          </ResponsiveContainer>
        </div>

      </div>
    </div>
  );
}

function RadarChartWidget({
  widget,
  onSelectInsight,
  selectedInsight,
}: {
  widget: Extract<VisualizationWidget, { kind: "radarChart" }>;
  onSelectInsight: (insight: VisualizationInsight) => void;
  selectedInsight: VisualizationInsight | null;
}) {
  const isDark = useIsDark();
  
  // GMPS/DQI Model Color System - aligned with CSS variables
  const GMPS_COLORS = {
    dimensionA: "#00D4FF",    // A: 毛利率结果
    dimensionB: "#FF6B9D",    // B: 材料成本冲击
    dimensionC: "#00E676",    // C: 产销负荷分摊
    dimensionD: "#FFD600",    // D: 外部风险传导
    dimensionE: "#B388FF",    // E: 现金流安全垫
    low: "#10B981",          // < 40: 低压
    medium: "#F59E0B",       // 40-70: 中压
    high: "#EF4444",         // >= 70: 高压
  };
  
  const chartTheme = {
    gridStroke: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)",
    axisStroke: isDark ? "rgba(148,163,184,0.28)" : "rgba(148,163,184,0.4)",
    axisText: isDark ? "rgba(203,213,225,0.82)" : "rgba(30,41,59,0.82)",
    tooltipBg: isDark ? "rgba(15,23,42,0.92)" : "rgba(255,255,255,0.95)",
    tooltipBorder: isDark ? "rgba(255,255,255,0.10)" : "rgba(0,0,0,0.10)",
    tooltipText: isDark ? "rgba(203,213,225,0.86)" : "rgba(30,41,59,0.86)",
  };

  const [hoveredDim, setHoveredDim] = useState<string>("");
  const [focusedId, setFocusedId] = useState<string>("");
  const { animProgress, isAnimating } = useChartAnimation(widget.dimensions.length);
  const { addRipple, rippleElements } = useClickRipple();

  // Get dimension color based on GMPS model
  const getDimensionColor = (dimName: string): string => {
    const dimLower = dimName.toLowerCase();
    if (dimLower.includes("毛利率") || dimLower.includes("gpm") || dimLower.includes("a:")) return GMPS_COLORS.dimensionA;
    if (dimLower.includes("材料") || dimLower.includes("成本") || dimLower.includes("b:")) return GMPS_COLORS.dimensionB;
    if (dimLower.includes("产销") || dimLower.includes("库存") || dimLower.includes("c:")) return GMPS_COLORS.dimensionC;
    if (dimLower.includes("外部") || dimLower.includes("风险") || dimLower.includes("d:")) return GMPS_COLORS.dimensionD;
    if (dimLower.includes("现金流") || dimLower.includes("e:")) return GMPS_COLORS.dimensionE;
    return "#00D4FF"; // Default cyan
  };

  const chartData = widget.dimensions.map((dim) => ({
    dimension: dim.dimension,
    displayDimension: dim.dimension,
    current: dim.current,
    baseline: dim.baseline,
    color: getDimensionColor(dim.dimension),
  }));

  const hasBaseline = widget.dimensions.some((dim) => dim.baseline > 0);

  function CustomRadarTooltip({ active, payload }: { active?: boolean; payload?: Array<{ name: string; value: number; dataKey: string; payload: { dimension: string; displayDimension: string; current: number; baseline: number; color: string } }> }) {
    if (!active || !payload || payload.length === 0) return null;
    const dimKey = payload[0]?.payload?.dimension ?? "";
    const dimName = payload[0]?.payload?.displayDimension ?? "";
    const dimColor = payload[0]?.payload?.color ?? "#00D4FF";
    const dim = widget.dimensions.find((d) => d.dimension === dimName);
    if (!dim) return null;
    const gap = dim.current - dim.baseline;
    return (
      <div
        style={{
          background: chartTheme.tooltipBg,
          backdropFilter: "blur(12px)",
          WebkitBackdropFilter: "blur(12px)",
          border: `1px solid ${chartTheme.tooltipBorder}`,
          borderRadius: 12,
          padding: "12px 16px",
          boxShadow: isDark ? "0 8px 32px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.05)" : "0 8px 24px rgba(0,0,0,0.1)",
          fontSize: CHART_FONT_SIZE_TOOLTIP,
          minWidth: 160,
        }}
      >
        <div style={{ fontWeight: 700, marginBottom: 8, color: chartTheme.axisText, fontSize: CHART_FONT_SIZE_TOOLTIP_TITLE }}>{dimName}</div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
          <span style={{ width: 10, height: 10, borderRadius: "50%", background: dimColor, boxShadow: `0 0 8px ${dimColor}`, display: "inline-block" }}></span>
          <span style={{ color: chartTheme.tooltipText }}>{widget.currentLabel}：</span>
          <strong style={{ color: dimColor, fontSize: CHART_FONT_SIZE_TOOLTIP_VALUE }}>{dim.displayCurrent}</strong>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
          <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#B388FF", display: "inline-block" }}></span>
          <span style={{ color: chartTheme.tooltipText }}>{widget.baselineLabel}：</span>
          <strong style={{ color: "#B388FF", fontSize: CHART_FONT_SIZE_TOOLTIP_VALUE }}>{dim.displayBaseline}</strong>
        </div>
        <div style={{ borderTop: `1px solid ${chartTheme.tooltipBorder}`, paddingTop: 8, marginTop: 6, color: gap >= 0 ? "#10B981" : "#EF4444", fontWeight: 600 }}>
          差距：{gap >= 0 ? "+" : ""}{gap.toFixed(2)}
        </div>
      </div>
    );
  }

  const radarAnimId = `radar-pulse-${widget.id}`;
  const radarStyleId = `radar-styles-${widget.id}`;

  return (
    <div className="viz-bar-chart viz-radar-chart">
      <style>{`
        @keyframes ${radarAnimId} {
          0% { r: 5; }
          50% { r: 6.5; }
          100% { r: 5; }
        }
        .${radarStyleId}-dot {
          transition: fill-opacity 200ms ease, stroke-width 200ms ease;
        }
        .${radarStyleId}-dot:hover {
          fill-opacity: 0.9;
          stroke-width: 3;
        }
        .${radarStyleId}-baseline-dot {
          transition: fill-opacity 200ms ease, stroke-width 200ms ease;
        }
        .${radarStyleId}-baseline-dot:hover {
          fill-opacity: 0.9;
          stroke-width: 2.5;
        }
        .${radarStyleId}-polygon {
          transition: fill-opacity 300ms ease, stroke-width 300ms ease;
        }
        .${radarStyleId}-polygon:hover {
          fill-opacity: 0.6;
          stroke-width: 3;
        }
      `}</style>
      <div className="viz-chart-shell stacked" style={{ position: "relative" }}>
        {focusedId && (
          <button type="button" onClick={() => setFocusedId("")}
            style={{ position: "absolute", top: 4, right: 4, zIndex: 20, fontSize: "12px", background: "rgba(0,212,255,0.15)", color: "#00D4FF", border: "1px solid rgba(0,212,255,0.3)", borderRadius: 6, padding: "4px 12px", cursor: "pointer", transition: "all 200ms ease" }}>
            清除聚焦
          </button>
        )}
        {rippleElements}
        <div className="viz-chart-panel">
          <ResponsiveContainer width="100%" height={360}>
            <RadarChart data={chartData} cx="50%" cy="50%" outerRadius={75}>
              <defs>
                <linearGradient id={`radar-grad-current-${widget.id}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#00D4FF" stopOpacity={0.5} />
                  <stop offset="50%" stopColor="#00D4FF" stopOpacity={0.25} />
                  <stop offset="100%" stopColor="#00D4FF" stopOpacity={0.1} />
                </linearGradient>
                <linearGradient id={`radar-grad-baseline-${widget.id}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#B388FF" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="#B388FF" stopOpacity={0.05} />
                </linearGradient>
                {/* Glow filter for radar - stable, no animation */}
                <filter id={`radar-glow-${widget.id}`} x="-50%" y="-50%" width="200%" height="200%">
                  <feGaussianBlur stdDeviation="2" result="blur" />
                  <feComposite in="SourceGraphic" in2="blur" operator="over" />
                </filter>
              </defs>
              <PolarGrid stroke={chartTheme.gridStroke} gridType="polygon" strokeDasharray="3 3" />
              <PolarAngleAxis dataKey="dimension" tick={{ fontSize: CHART_FONT_SIZE_LEGEND, fill: chartTheme.axisText, fontWeight: 600 }} />
              <PolarRadiusAxis tick={{ fontSize: CHART_FONT_SIZE_AXIS_TICK, fill: isDark ? "rgba(148,163,184,0.5)" : "rgba(100,116,139,0.5)" }} axisLine={false} />
              <Radar
                name={widget.currentLabel}
                dataKey="current"
                stroke="#00D4FF"
                fill={`url(#radar-grad-current-${widget.id})`}
                fillOpacity={1}
                strokeWidth={2.5}
                className={`${radarStyleId}-polygon`}
                dot={{ r: 5, fill: "#00D4FF", stroke: isDark ? "rgba(255,255,255,0.9)" : "#fff", strokeWidth: 2, className: `${radarStyleId}-dot` }}
                activeDot={{ r: 7, fill: "#00D4FF", stroke: isDark ? "#fff" : "#1e293b", strokeWidth: 2.5, className: `${radarStyleId}-dot` }}
                animationDuration={1000}
                animationEasing="ease-out"
                onMouseEnter={(data: any) => { const dimName = data?.payload?.displayDimension ?? data?.payload?.dimension ?? ""; setHoveredDim(dimName); }}
                onMouseLeave={() => setHoveredDim("")}
                onClick={(data: any) => {
                  const dimName = data?.payload?.displayDimension ?? data?.payload?.dimension ?? "";
                  const dim = widget.dimensions.find((d) => d.dimension === dimName);
                  if (dim) {
                    setFocusedId(focusedId === dimName ? "" : dimName);
                    onSelectInsight({ title: dimName, summary: `当前：${dim.displayCurrent}，基准：${dim.displayBaseline}`, source: widget.title });
                  }
                }}
              />
              {hasBaseline && (
                <Radar
                  name={widget.baselineLabel}
                  dataKey="baseline"
                  stroke="#B388FF"
                  fill={`url(#radar-grad-baseline-${widget.id})`}
                  fillOpacity={1}
                  strokeWidth={2}
                  strokeDasharray="5 5"
                  className={`${radarStyleId}-polygon`}
                  dot={{ r: 4, fill: "#B388FF", stroke: isDark ? "rgba(255,255,255,0.9)" : "#fff", strokeWidth: 1.5, className: `${radarStyleId}-baseline-dot` }}
                  animationDuration={1000}
                  animationEasing="ease-out"
                />
              )}
              <Tooltip content={<CustomRadarTooltip />} />
              <Legend wrapperStyle={{ fontSize: CHART_FONT_SIZE_LEGEND, paddingTop: 16 }} />
            </RadarChart>
          </ResponsiveContainer>
        </div>

      </div>
    </div>
  );
}

function BubbleChartWidget({
  widget,
  onSelectInsight,
  selectedInsight,
}: {
  widget: Extract<VisualizationWidget, { kind: "bubbleChart" }>;
  onSelectInsight: (insight: VisualizationInsight) => void;
  selectedInsight: VisualizationInsight | null;
}) {
  const [activeId, setActiveId] = useState<string>(widget.data[0]?.id ?? "");
  const [focusedId, setFocusedId] = useState<string>("");
  const { animProgress, isAnimating } = useChartAnimation(widget.data.length);
  const { addRipple, rippleElements } = useClickRipple();

  const isDark = useIsDark();
  const chartTheme = {
    gridStroke: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)",
    axisStroke: isDark ? "rgba(148,163,184,0.28)" : "rgba(148,163,184,0.4)",
    axisText: isDark ? "rgba(203,213,225,0.82)" : "rgba(30,41,59,0.82)",
    tooltipBg: isDark ? "rgba(15,23,42,0.92)" : "rgba(255,255,255,0.95)",
    tooltipBorder: isDark ? "rgba(255,255,255,0.10)" : "rgba(0,0,0,0.10)",
    tooltipText: isDark ? "rgba(203,213,225,0.86)" : "rgba(30,41,59,0.86)",
  };
  const axisColor = chartTheme.axisStroke;
  const textColor = chartTheme.axisText;
  const activeStrokeColor = isDark ? "#fff" : "#1e293b";

  const zValues = widget.data.map((d) => d.z);
  const minZ = Math.min(...zValues, 0);
  const maxZ = Math.max(...zValues, 1);
  const sqrtMin = Math.sqrt(Math.max(minZ, 0));
  const sqrtMax = Math.sqrt(Math.max(maxZ, 1));
  const sqrtRange = sqrtMax - sqrtMin || 1;

  const bubbleData = widget.data.map((d) => {
    const sqrtZ = Math.sqrt(Math.max(d.z, 0));
    const normalizedZ = (sqrtZ - sqrtMin) / sqrtRange;
    const bubbleSize = 120 + normalizedZ * 1080;
    return { ...d, bubbleSize };
  });

  const bubbleStyleId = `bb-styles-${widget.id}`;

  return (
    <div className="viz-bar-chart viz-bubble-chart">
      <style>{`
        .${bubbleStyleId}-cell {
          transition: fill-opacity 200ms ease, stroke-width 200ms ease;
          cursor: pointer;
        }
        .${bubbleStyleId}-cell:hover {
          fill-opacity: 0.15;
          stroke-width: 3px;
        }
      `}</style>
      <div className="viz-chart-shell stacked" style={{ position: "relative" }}>
        {focusedId && (
          <button type="button" onClick={() => setFocusedId("")}
            style={{ position: "absolute", top: 4, right: 4, zIndex: 20, fontSize: "0.72rem", background: "rgba(0,212,255,0.15)", color: "#00D4FF", border: "1px solid rgba(0,212,255,0.3)", borderRadius: 6, padding: "3px 10px", cursor: "pointer", transition: "all 200ms cubic-bezier(0.34, 1.56, 0.64, 1)" }}>
            清除聚焦
          </button>
        )}
        {rippleElements}
        <div className="viz-chart-panel">
          <ResponsiveContainer width="100%" height={320}>
            <ScatterChart margin={{ top: 15, right: 25, bottom: 25, left: 15 }}>
              <defs>
                {bubbleData.map((entry, index) => {
                  const color = getStatusColor(entry.status);
                  const neonColor = NEON_COLORS[index % NEON_COLORS.length] ?? NEON_DEFAULT;
                  return (
                    <radialGradient key={`bb-grad-${entry.id}`} id={`bb-grad-${entry.id}`} cx="35%" cy="35%" r="65%">
                      <stop offset="0%" stopColor={color} stopOpacity={0.9} />
                      <stop offset="100%" stopColor={neonColor.glow.replace("0.25", "0.4")} stopOpacity={0.3} />
                    </radialGradient>
                  );
                })}
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={axisColor} />
              <XAxis dataKey="x" type="number" name={widget.xLabel} tick={{ fill: textColor, fontSize: 11, fontWeight: 500 }} axisLine={{ stroke: axisColor }} tickLine={{ stroke: axisColor }}
                label={{ value: widget.xLabel, position: "bottom", offset: 0, style: { fill: textColor, fontSize: 12, fontWeight: 600 } }}
              />
              <YAxis dataKey="y" type="number" name={widget.yLabel} tick={{ fill: textColor, fontSize: 11, fontWeight: 500 }} axisLine={{ stroke: axisColor }} tickLine={{ stroke: axisColor }}
                label={{ value: widget.yLabel, angle: -90, position: "insideLeft", style: { fill: textColor, fontSize: 12, fontWeight: 600 } }}
              />
              <ZAxis dataKey="bubbleSize" range={[120, 1200]} name={widget.zLabel} />
              <Tooltip
                content={({ payload }) => {
                  if (!payload || payload.length === 0) return null;
                  const datum = payload[0]!.payload;
                  return (
                    <div style={{
                      background: chartTheme.tooltipBg,
                      border: `1px solid ${chartTheme.tooltipBorder}`,
                      borderRadius: 12, padding: "10px 14px", fontSize: "0.82rem",
                      boxShadow: isDark ? "0 8px 32px rgba(0,0,0,0.5)" : "0 8px 24px rgba(0,0,0,0.1)",
                      backdropFilter: "blur(12px)",
                    }}>
                      <div style={{ fontWeight: 700, marginBottom: 6, color: getStatusColor(datum.status) }}>{datum.label}</div>
                      <div style={{ color: chartTheme.tooltipText }}>{widget.xLabel}: {datum.displayX}</div>
                      <div style={{ color: chartTheme.tooltipText }}>{widget.yLabel}: {datum.displayY}</div>
                      <div style={{ color: chartTheme.tooltipText }}>{widget.zLabel}: {datum.displayZ}</div>
                    </div>
                  );
                }}
              />
              <Scatter
                data={bubbleData}
                onMouseEnter={(datum) => { const d = bubbleData.find((s) => s.x === datum.x && s.y === datum.y); if (d) setActiveId(d.id); }}
                onClick={(datum) => {
                  const d = bubbleData.find((s) => s.x === datum.x && s.y === datum.y);
                  if (d) {
                    setActiveId(d.id);
                    setFocusedId(focusedId === d.id ? "" : d.id);
                    onSelectInsight({ title: d.label, summary: d.detail, source: widget.title });
                  }
                }}
              >
                {bubbleData.map((entry, index) => {
                  const isDimmed = (selectedInsight && selectedInsight.title !== entry.label) || (focusedId && focusedId !== entry.id);
                  const isActive = activeId === entry.id;
                  const neonColor = NEON_COLORS[index % NEON_COLORS.length] ?? NEON_DEFAULT;
                  const itemProgress = Math.min(Math.max((animProgress * (800 + bubbleData.length * 50) - index * 50) / 800, 0), 1);
                  const animScale = isAnimating ? itemProgress : 1;
                  return (
                    <Cell key={entry.id}
                      fill={`url(#bb-grad-${entry.id})`}
                      fillOpacity={isDimmed ? 0.1 : isActive ? 0.9 : 0.6 * animScale}
                      stroke={isActive ? activeStrokeColor : "transparent"} strokeWidth={isActive ? 2.5 : 0}
                      className={`${bubbleStyleId}-cell`}
                      style={{
                        cursor: "pointer",
                        opacity: isDimmed ? 0.3 : 1,
                      }}
                    />
                  );
                })}
              </Scatter>
            </ScatterChart>
          </ResponsiveContainer>
        </div>

      </div>
    </div>
  );
}

function HeatmapChartWidget({
  widget,
  onSelectInsight,
  selectedInsight,
}: {
  widget: Extract<VisualizationWidget, { kind: "heatmapChart" }>;
  onSelectInsight: (insight: VisualizationInsight) => void;
  selectedInsight: VisualizationInsight | null;
}) {
  // GMPS Model Color System for heatmap
  const GMPS_LEVEL_COLORS = {
    low: { bg: "#10B981", text: "#fff" },      // < 40: 低压
    medium: { bg: "#F59E0B", text: "#fff" },   // 40-70: 中压
    high: { bg: "#EF4444", text: "#fff" },     // >= 70: 高压
  };
  
  // Get GMPS level color based on value
  const getGMPSLevelColor = (value: number): { bg: string; text: string } => {
    if (value < 40) return GMPS_LEVEL_COLORS.low;
    if (value < 70) return GMPS_LEVEL_COLORS.medium;
    return GMPS_LEVEL_COLORS.high;
  };
  
  const [activeCellKey, setActiveCellKey] = useState<string>("");
  const [focusedCellKey, setFocusedCellKey] = useState<string>("");
  const activeCell = widget.cells.find((c) => `${c.row}-${c.column}` === activeCellKey) ?? widget.cells[0];
  const { animProgress, isAnimating } = useChartAnimation(widget.cells.length);
  const { addRipple, rippleElements } = useClickRipple();

  const isDark = useIsDark();
  const chartTheme = {
    gridStroke: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)",
    axisStroke: isDark ? "rgba(148,163,184,0.28)" : "rgba(148,163,184,0.4)",
    axisText: isDark ? "rgba(203,213,225,0.82)" : "rgba(30,41,59,0.82)",
    tooltipBg: isDark ? "rgba(15,23,42,0.92)" : "rgba(255,255,255,0.95)",
    tooltipBorder: isDark ? "rgba(255,255,255,0.10)" : "rgba(0,0,0,0.10)",
    tooltipText: isDark ? "rgba(203,213,225,0.86)" : "rgba(30,41,59,0.86)",
  };
  const labelColor = chartTheme.axisText;

  const allValues = widget.cells.map((c) => c.value);
  const minVal = Math.min(...allValues, 0);
  const maxVal = Math.max(...allValues, 100);
  const valRange = maxVal - minVal || 1;

  // Use GMPS level colors instead of gradient
  function getHeatColor(value: number) {
    const level = getGMPSLevelColor(value);
    return level.bg;
  }

  const colCount = widget.columns.length;
  const rowCount = widget.rows.length;
  const labelWidth = 120;
  const labelHeight = 40;
  const cellW = 100;
  const cellH = 70;
  const svgW = labelWidth + colCount * cellW;
  const svgH = labelHeight + rowCount * cellH + 50;

  const heatmapStyleId = `hm-styles-${widget.id}`;

  return (
    <div className="viz-bar-chart viz-heatmap-chart">
      <style>{`
        .${heatmapStyleId}-cell {
          transition: stroke-width 200ms ease, fill-opacity 200ms ease, opacity 300ms ease;
          cursor: pointer;
        }
        /* Stable hover effect - NO filter:brightness to prevent SVG flickering */
        .${heatmapStyleId}-cell:hover rect {
          stroke-width: 3;
          fill-opacity: 1;
        }
      `}</style>
      <div className="viz-chart-shell stacked" style={{ position: "relative" }}>
        {focusedCellKey && (
          <button type="button" onClick={() => setFocusedCellKey("")}
            style={{ position: "absolute", top: 4, right: 4, zIndex: 20, fontSize: "12px", background: "rgba(0,212,255,0.15)", color: "#00D4FF", border: "1px solid rgba(0,212,255,0.3)", borderRadius: 6, padding: "4px 12px", cursor: "pointer", transition: "all 200ms ease" }}>
            清除聚焦
          </button>
        )}
        {rippleElements}
        <div className="viz-chart-panel" style={{ overflowX: "auto" }}>
          <svg viewBox={`0 0 ${svgW} ${svgH}`} preserveAspectRatio="xMidYMid meet"
            style={{ width: "100%", minHeight: 280, overflow: "visible" }}
          >
            <defs>
              {/* GMPS Level Legend Gradient */}
              <linearGradient id={`hm-legend-grad-${widget.id}`} x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#10B981" />
                <stop offset="40%" stopColor="#F59E0B" />
                <stop offset="100%" stopColor="#EF4444" />
              </linearGradient>
            </defs>
            {widget.columns.map((col, ci) => (
              <text key={`${widget.id}-col-${col}`} x={labelWidth + ci * cellW + cellW / 2} y={labelHeight / 2}
                fontSize="13" fill={labelColor} textAnchor="middle" dominantBaseline="middle" fontWeight={600}>
                {col}
              </text>
            ))}
            {widget.rows.map((row, ri) => (
              <React.Fragment key={`${widget.id}-row-${row}`}>
                <text x={labelWidth - 8} y={labelHeight + ri * cellH + cellH / 2}
                  fontSize="12" fill={labelColor} textAnchor="end" dominantBaseline="middle" fontWeight={500}>
                  {row}
                </text>
                {widget.columns.map((col, ci) => {
                  const cell = widget.cells.find((c) => c.row === row && c.column === col);
                  if (!cell) return null;
                  const cellKey = `${widget.id}-${row}-${col}`;
                  const isActive = activeCellKey === cellKey;
                  const isFocused = focusedCellKey === cellKey;
                  const isDimmed = selectedInsight && selectedInsight.title !== `${row}·${col}`;
                  const isOtherFocused = focusedCellKey !== "" && focusedCellKey !== cellKey;
                  const color = getHeatColor(cell.value);
                  const level = getGMPSLevelColor(cell.value);
                  const cellOpacity = isOtherFocused ? 0.3 : isDimmed ? 0.2 : 1;
                  const levelLabel = cell.value < 40 ? "低压" : cell.value < 70 ? "中压" : "高压";
                  return (
                    <g key={cellKey} className={`${heatmapStyleId}-cell`}
                      style={{ opacity: cellOpacity }}
                      onMouseEnter={() => setActiveCellKey(cellKey)}
                      onMouseLeave={() => setActiveCellKey("")}
                      onClick={(e) => {
                        setActiveCellKey(cellKey);
                        setFocusedCellKey(focusedCellKey === cellKey ? "" : cellKey);
                        onSelectInsight({ title: `${row}·${col}`, summary: cell.note, source: widget.title });
                        addRipple(e as any, color);
                      }}
                    >
                      <rect x={labelWidth + ci * cellW + 2} y={labelHeight + ri * cellH + 2}
                        width={cellW - 4} height={cellH - 4}
                        fill={color} rx="4" ry="4"
                        stroke={isActive || isFocused ? (isDark ? "#fff" : "#1e293b") : "rgba(255,255,255,0.1)"} 
                        strokeWidth={isActive || isFocused ? 2.5 : 1}
                        style={{
                          fillOpacity: isActive || isFocused ? 1 : 0.85,
                          transition: "all 200ms ease",
                        }}
                      />
                      <text x={labelWidth + ci * cellW + cellW / 2} y={labelHeight + ri * cellH + cellH / 2 - 6}
                        fontSize="14" fill={level.text}
                        textAnchor="middle" dominantBaseline="middle" fontWeight={isActive || isFocused ? 800 : 700}>
                        {cell.displayValue}
                      </text>
                      <text x={labelWidth + ci * cellW + cellW / 2} y={labelHeight + ri * cellH + cellH / 2 + 10}
                        fontSize="10" fill={isDark ? "rgba(255,255,255,0.7)" : "rgba(30,41,59,0.7)"}
                        textAnchor="middle" dominantBaseline="middle" fontWeight={500}>
                        {levelLabel}
                      </text>
                    </g>
                  );
                })}
              </React.Fragment>
            ))}
            {/* GMPS Level Legend */}
            <rect x={labelWidth} y={labelHeight + rowCount * cellH + 10} width={colCount * cellW} height={12}
              fill={`url(#hm-legend-grad-${widget.id})`} rx="6" ry="6"
            />
            <text x={labelWidth} y={labelHeight + rowCount * cellH + 34} fontSize="11" fill={labelColor} textAnchor="start" fontWeight={500}>
              低压 (&lt;40)
            </text>
            <text x={labelWidth + colCount * cellW} y={labelHeight + rowCount * cellH + 34} fontSize="11" fill={labelColor} textAnchor="end" fontWeight={500}>
              高压 (&gt;=70)
            </text>
            <text x={labelWidth + colCount * cellW / 2} y={labelHeight + rowCount * cellH + 34} fontSize="11" fill={labelColor} textAnchor="middle" fontWeight={500}>
              中压 (40-70)
            </text>
          </svg>
        </div>

      </div>
    </div>
  );
}

function SankeyChartWidget({
  widget,
  onSelectInsight,
  selectedInsight,
}: {
  widget: Extract<VisualizationWidget, { kind: "sankeyChart" }>;
  onSelectInsight: (insight: VisualizationInsight) => void;
  selectedInsight: VisualizationInsight | null;
}) {
  const [hoveredLink, setHoveredLink] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [focusedId, setFocusedId] = useState<string>("");
  const { animProgress, isAnimating } = useChartAnimation(widget.links.length);
  const { addRipple, rippleElements } = useClickRipple();

  const isDark = useIsDark();
  const textColor = isDark ? "rgba(203,213,225,0.82)" : "rgba(30,41,59,0.82)";

  const maxColumn = Math.max(...widget.nodes.map((n) => n.column), 0);
  const totalValue = widget.links.reduce((sum, l) => sum + l.value, 0);

  const svgW = 900;
  const svgH = 420;
  const padX = 140;
  const padY = 30;
  const nodeW = 18;
  const colSpacing = (svgW - padX * 2) / Math.max(maxColumn, 1);

  const nodeMap = new Map(widget.nodes.map((n) => [n.id, n]));

  const sourceSums = new Map<string, number>();
  const targetSums = new Map<string, number>();
  for (const link of widget.links) {
    sourceSums.set(link.source, (sourceSums.get(link.source) ?? 0) + link.value);
    targetSums.set(link.target, (targetSums.get(link.target) ?? 0) + link.value);
  }

  const nodeValueMap = new Map<string, number>();
  for (const node of widget.nodes) {
    nodeValueMap.set(node.id, Math.max(sourceSums.get(node.id) ?? 0, targetSums.get(node.id) ?? 0));
  }

  const columnGroups = new Map<number, string[]>();
  for (const node of widget.nodes) {
    const group = columnGroups.get(node.column) ?? [];
    group.push(node.id);
    columnGroups.set(node.column, group);
  }

  const nodePositions = new Map<string, { x: number; y: number; height: number }>();
  for (const [col, nodeIds] of columnGroups) {
    const colTotal = nodeIds.reduce((sum, id) => sum + (nodeValueMap.get(id) ?? 0), 0);
    const scale = (svgH - padY * 2) / Math.max(colTotal, 1);
    let currentY = padY;
    for (const id of nodeIds) {
      const h = (nodeValueMap.get(id) ?? 0) * scale;
      nodePositions.set(id, {
        x: padX + col * colSpacing,
        y: currentY,
        height: Math.max(h, 4),
      });
      currentY += h;
    }
  }

  function getConnectedLinks(nodeId: string): string[] {
    const visited = new Set<string>();
    const queue = [nodeId];
    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const link of widget.links) {
        const linkKey = `${link.source}->${link.target}`;
        if (visited.has(linkKey)) continue;
        if (link.source === current || link.target === current) {
          visited.add(linkKey);
          if (link.source === current && !queue.includes(link.target)) queue.push(link.target);
          if (link.target === current && !queue.includes(link.source)) queue.push(link.source);
        }
      }
    }
    return [...visited];
  }

  const selectedNodeLinks = selectedNode ? new Set(getConnectedLinks(selectedNode)) : null;

  const linkElements: Array<{
    key: string;
    source: string;
    target: string;
    value: number;
    path: string;
    sourceColor: string;
    targetColor: string;
  }> = [];

  const sourceOffsets = new Map<string, number>();
  const targetOffsets = new Map<string, number>();

  for (const link of widget.links) {
    const linkKey = `${link.source}->${link.target}`;
    const srcPos = nodePositions.get(link.source);
    const tgtPos = nodePositions.get(link.target);
    if (!srcPos || !tgtPos) continue;

    const srcNode = nodeMap.get(link.source);
    const tgtNode = nodeMap.get(link.target);
    if (!srcNode || !tgtNode) continue;

    const srcValSum = sourceSums.get(link.source) ?? 1;
    const tgtValSum = targetSums.get(link.target) ?? 1;
    const srcScale = srcPos.height / Math.max(srcValSum, 1);
    const tgtScale = tgtPos.height / Math.max(tgtValSum, 1);

    const srcOffset = sourceOffsets.get(link.source) ?? 0;
    const tgtOffset = targetOffsets.get(link.target) ?? 0;

    const linkH = link.value * srcScale;
    const tgtLinkH = link.value * tgtScale;

    const x0 = srcPos.x + nodeW;
    const y0 = srcPos.y + srcOffset;
    const x1 = tgtPos.x;
    const y1 = tgtPos.y + tgtOffset;

    const midX = (x0 + x1) / 2;

    const path = `M${x0},${y0}C${midX},${y0} ${midX},${y1} ${x1},${y1}L${x1},${y1 + tgtLinkH}C${midX},${y1 + tgtLinkH} ${midX},${y0 + linkH} ${x0},${y0 + linkH}Z`;

    linkElements.push({
      key: linkKey,
      source: link.source,
      target: link.target,
      value: link.value,
      path,
      sourceColor: srcNode.color,
      targetColor: tgtNode.color,
    });

    sourceOffsets.set(link.source, srcOffset + linkH);
    targetOffsets.set(link.target, tgtOffset + tgtLinkH);
  }

  return (
    <div className="viz-bar-chart viz-sankey-chart">
      <div className="viz-chart-shell stacked" style={{ position: "relative" }}>
        {focusedId && (
          <button type="button" onClick={() => setFocusedId("")}
            style={{ position: "absolute", top: 4, right: 4, zIndex: 20, fontSize: "0.72rem", background: "rgba(0,212,255,0.15)", color: "#00D4FF", border: "1px solid rgba(0,212,255,0.3)", borderRadius: 6, padding: "3px 10px", cursor: "pointer", transition: "all 200ms cubic-bezier(0.34, 1.56, 0.64, 1)" }}>
            清除聚焦
          </button>
        )}
        {rippleElements}
        <div className="viz-chart-panel" style={{ overflowX: "auto" }}>
          <svg
            viewBox={`0 0 ${svgW} ${svgH}`}
            preserveAspectRatio="xMidYMid meet"
            style={{ width: "100%", minHeight: 320, overflow: "visible" }}
          >
            <defs>
              {linkElements.map((le) => (
                <linearGradient key={`grad-${le.key}`} id={`sankey-grad-${le.key.replace(/->/g, "-")}`} x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor={le.sourceColor} stopOpacity={0.45} />
                  <stop offset="100%" stopColor={le.targetColor} stopOpacity={0.45} />
                </linearGradient>
              ))}
            </defs>
            {linkElements.map((le) => {
              const isHoveredPath = hoveredLink === le.key;
              const isConnectedToSelectedNode = selectedNodeLinks?.has(le.key) ?? false;
              const isDimmed = (hoveredLink !== null && !isHoveredPath) || (selectedNode !== null && !isConnectedToSelectedNode);
              const isHighlighted = isHoveredPath || isConnectedToSelectedNode;
              return (
                <path
                  key={le.key}
                  d={le.path}
                  fill={isHighlighted ? `url(#sankey-grad-${le.key.replace(/->/g, "-")})` : `url(#sankey-grad-${le.key.replace(/->/g, "-")})`}
                  opacity={isDimmed ? 0.08 : isHighlighted ? 0.7 : 0.3}
                  stroke={isHighlighted ? le.sourceColor : "none"}
                  strokeWidth={isHighlighted ? 1 : 0}
                  style={{ cursor: "pointer", transition: "opacity 200ms cubic-bezier(0.34, 1.56, 0.64, 1), stroke 200ms cubic-bezier(0.34, 1.56, 0.64, 1)" }}
                  onMouseEnter={() => setHoveredLink(le.key)}
                  onMouseLeave={() => setHoveredLink(null)}
                  onClick={(e) => {
                    const srcLabel = nodeMap.get(le.source)?.label ?? le.source;
                    const tgtLabel = nodeMap.get(le.target)?.label ?? le.target;
                    const linkKey = `${le.source}->${le.target}`;
                    setFocusedId(focusedId === linkKey ? "" : linkKey);
                    onSelectInsight({
                      title: `${srcLabel} → ${tgtLabel}`,
                      summary: `流量值: ${le.value} (占比 ${(le.value / totalValue * 100).toFixed(1)}%)`,
                      source: widget.title,
                    });
                    addRipple(e as any, le.sourceColor);
                  }}
                />
              );
            })}
            {widget.nodes.map((node) => {
              const pos = nodePositions.get(node.id);
              if (!pos) return null;
              const isDimmed = selectedInsight && selectedInsight.title !== node.label;
              const isSelected = selectedNode === node.id;
              return (
                <g
                  key={node.id}
                  style={{ cursor: "pointer", transition: "opacity 200ms cubic-bezier(0.34, 1.56, 0.64, 1)" }}
                  opacity={isDimmed ? 0.3 : 1}
                  onClick={(e) => {
                    setSelectedNode(selectedNode === node.id ? null : node.id);
                    setFocusedId(focusedId === node.id ? "" : node.id);
                    onSelectInsight({ title: node.label, summary: `节点流量: ${nodeValueMap.get(node.id) ?? 0}`, source: widget.title });
                    addRipple(e as any, node.color);
                  }}
                >
                  <rect
                    x={pos.x}
                    y={pos.y}
                    width={nodeW}
                    height={pos.height}
                    fill={node.color}
                    rx={3}
                    opacity={isSelected ? 1 : 0.85}
                    stroke={isSelected ? (isDark ? "#fff" : "#1e293b") : "transparent"}
                    strokeWidth={isSelected ? 2 : 0}
                    style={{
                      transition: "fill-opacity 200ms ease, stroke-width 200ms ease",
                    }}
                  />
                  <text
                    x={pos.x + nodeW / 2}
                    y={pos.y - 6}
                    fontSize="11"
                    fill={textColor}
                    textAnchor="middle"
                    fontWeight={isSelected ? 700 : 500}
                  >
                    {node.label}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>
      </div>
    </div>
  );
}

function WidgetBody({
  widget,
  density,
  onSelectInsight,
  selectedInsight,
}: {
  widget: VisualizationWidget;
  density: "comfortable" | "compact";
  onSelectInsight: (insight: VisualizationInsight) => void;
  selectedInsight: VisualizationInsight | null;
}) {
  switch (widget.kind) {
    case "sankeyChart":
      return <ErrorBoundary><SankeyChartWidget widget={widget} onSelectInsight={onSelectInsight} selectedInsight={selectedInsight} /></ErrorBoundary>;
    case "metricCards":
      return <ErrorBoundary><MetricCardsWidget widget={widget} onSelectInsight={onSelectInsight} selectedInsight={selectedInsight} /></ErrorBoundary>;
    case "barChart":
      return <ErrorBoundary><BarChartWidget widget={widget} onSelectInsight={onSelectInsight} selectedInsight={selectedInsight} /></ErrorBoundary>;
    case "lineChart":
      return <ErrorBoundary><LineChartWidget widget={widget} onSelectInsight={onSelectInsight} selectedInsight={selectedInsight} /></ErrorBoundary>;
    case "waterfallChart":
      return <ErrorBoundary><WaterfallChartWidget widget={widget} onSelectInsight={onSelectInsight} selectedInsight={selectedInsight} /></ErrorBoundary>;
    case "radarChart":
      return <ErrorBoundary><RadarChartWidget widget={widget} onSelectInsight={onSelectInsight} selectedInsight={selectedInsight} /></ErrorBoundary>;
    case "boxPlotChart":
      return <ErrorBoundary><BoxPlotChartWidget widget={widget} onSelectInsight={onSelectInsight} selectedInsight={selectedInsight} /></ErrorBoundary>;
    case "scatterChart":
      return <ErrorBoundary><ScatterChartWidget widget={widget} onSelectInsight={onSelectInsight} selectedInsight={selectedInsight} /></ErrorBoundary>;
    case "bubbleChart":
      return <ErrorBoundary><BubbleChartWidget widget={widget} onSelectInsight={onSelectInsight} selectedInsight={selectedInsight} /></ErrorBoundary>;
    case "heatmapChart":
      return <ErrorBoundary><HeatmapChartWidget widget={widget} onSelectInsight={onSelectInsight} selectedInsight={selectedInsight} /></ErrorBoundary>;
    case "benchmarkTable":
      return <ErrorBoundary><BenchmarkTableWidget widget={widget} density={density} onSelectInsight={onSelectInsight} selectedInsight={selectedInsight} /></ErrorBoundary>;
    case "zebraTable":
      return <ErrorBoundary><ZebraTableWidget widget={widget} density={density} selectedInsight={selectedInsight} /></ErrorBoundary>;
    case "heatmapTable":
      return <ErrorBoundary><HeatmapTableWidget widget={widget} density={density} onSelectInsight={onSelectInsight} selectedInsight={selectedInsight} /></ErrorBoundary>;
    case "sparklineTable":
      return <ErrorBoundary><SparklineTableWidget widget={widget} density={density} onSelectInsight={onSelectInsight} selectedInsight={selectedInsight} /></ErrorBoundary>;
    case "alertTable":
      return <ErrorBoundary><AlertTableWidget widget={widget} density={density} onSelectInsight={onSelectInsight} selectedInsight={selectedInsight} /></ErrorBoundary>;
    case "cardTable":
      return <ErrorBoundary><CardTableWidget widget={widget} selectedInsight={selectedInsight} /></ErrorBoundary>;
    case "treeTable":
      return <ErrorBoundary><TreeTableWidget widget={widget} onSelectInsight={onSelectInsight} selectedInsight={selectedInsight} /></ErrorBoundary>;
    case "pivotMatrix":
      return <ErrorBoundary><PivotMatrixWidget widget={widget} density={density} onSelectInsight={onSelectInsight} selectedInsight={selectedInsight} /></ErrorBoundary>;
    case "calendarTable":
      return <ErrorBoundary><CalendarWidget widget={widget} onSelectInsight={onSelectInsight} selectedInsight={selectedInsight} /></ErrorBoundary>;
    default:
      return null;
  }
}

function VisualizationWidgetCard({
  widget,
  payload,
  refreshLabel,
  lastUpdated,
  density,
  onRefresh,
  onSelectInsight,
  selectedInsight,
  refreshedAt,
  className,
}: {
  widget: VisualizationWidget;
  payload: VisualizationPayload;
  refreshLabel: string;
  lastUpdated: string;
  density: "comfortable" | "compact";
  onRefresh: (widgetId: string) => void;
  onSelectInsight: (insight: VisualizationInsight) => void;
  selectedInsight: VisualizationInsight | null;
  refreshedAt?: string;
  className?: string;
}) {
  const widgetLayoutClass = getWidgetLayoutClass(widget.kind);
  const [expanded, setExpanded] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const widgetSources = useMemo(() => getWidgetSources(payload, widget), [payload, widget]);

  return (
    <>
    <article className={`viz-widget viz-${widget.kind} ${widgetLayoutClass} ${expanded ? "expanded" : ""} ${className ?? ""}`.trim()}>
      <div className="viz-widget-head">
        <div>
          <h4>{widget.title}</h4>
        </div>
        <div className="viz-widget-actions">
          <button type="button" className={`viz-inline-btn ${refreshedAt ? "active" : ""}`} onClick={() => onRefresh(widget.id)}>
            刷新
          </button>
          <button type="button" className="viz-inline-btn" onClick={() => setFullscreen(true)}>
            全屏
          </button>
          <button type="button" className="viz-inline-btn" onClick={() => setExpanded((value) => !value)}>
            {expanded ? "收起" : "展开"}
          </button>
        </div>
      </div>
      <div className="viz-widget-refresh">
        <span>{refreshLabel}</span>
        <span>更新时间 {formatRefreshTime(lastUpdated)}</span>
        {refreshedAt ? <span>局部刷新：{formatRefreshTime(refreshedAt)}</span> : null}
      </div>
      <WidgetSourceSummary widget={widget} sources={widgetSources} />
      <WidgetBody widget={widget} density={density} onSelectInsight={onSelectInsight} selectedInsight={selectedInsight} />
      {expanded && widgetSources.length > 0 ? (
        <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
          {widgetSources.map((source) => <SourceMetaCard key={source.id} source={source} compact />)}
        </div>
      ) : null}
    </article>
    <DetailPanel isOpen={fullscreen} onClose={() => setFullscreen(false)} title={widget.title} widget={widget} payload={payload} />
    </>
  );
}

function VisualizationSectionView({
  section,
  payload,
  refreshLabel,
  lastUpdated,
  density,
  onRefresh,
  onSelectInsight,
  selectedInsight,
  refreshLedger,
  page,
}: {
  section: VisualizationSection;
  payload: VisualizationPayload;
  refreshLabel: string;
  lastUpdated: string;
  density: "comfortable" | "compact";
  onRefresh: (widgetId: string) => void;
  onSelectInsight: (insight: VisualizationInsight) => void;
  selectedInsight: VisualizationInsight | null;
  refreshLedger: Record<string, string>;
  page: VisualizationPage;
}) {
  return (
    <section className="viz-section">
    <div className="viz-section-head">
      <div>
        <h3>{section.title}</h3>
      </div>
    </div>
    <div className="viz-widget-grid">
      {section.widgets.map((widget, index) => {
        const widgetLayoutClass = getWidgetLayoutClass(widget.kind);
        return (
          <VisualizationWidgetCard
            key={widget.id}
            widget={widget}
            payload={payload}
            refreshLabel={refreshLabel}
            lastUpdated={lastUpdated}
            density={density}
            onRefresh={onRefresh}
            onSelectInsight={onSelectInsight}
            selectedInsight={selectedInsight}
            refreshedAt={refreshLedger[widget.id]}
            className={`${widgetLayoutClass} ${page === "home" ? getHomeWidgetAreaClass(index) : ""}`.trim()}
          />
        );
      })}
    </div>
  </section>
  );
}

export function renderWidgetByKind(
  widget: VisualizationWidget,
  onSelectInsight?: (insight: VisualizationInsight) => void,
  selectedInsight?: VisualizationInsight | null,
): React.ReactNode {
  const handleInsight = onSelectInsight ?? (() => {});
  const currentInsight = selectedInsight ?? null;
  switch (widget.kind) {
    case 'radarChart':
      return <RadarChartWidget widget={widget as Extract<VisualizationWidget, { kind: 'radarChart' }>} onSelectInsight={handleInsight} selectedInsight={currentInsight} />;
    case 'lineChart':
      return <LineChartWidget widget={widget as Extract<VisualizationWidget, { kind: 'lineChart' }>} onSelectInsight={handleInsight} selectedInsight={currentInsight} />;
    case 'barChart':
      return <BarChartWidget widget={widget as Extract<VisualizationWidget, { kind: 'barChart' }>} onSelectInsight={handleInsight} selectedInsight={currentInsight} />;
    case 'waterfallChart':
      return <WaterfallChartWidget widget={widget as Extract<VisualizationWidget, { kind: 'waterfallChart' }>} onSelectInsight={handleInsight} selectedInsight={currentInsight} />;
    case 'boxPlotChart':
      return <BoxPlotChartWidget widget={widget as Extract<VisualizationWidget, { kind: 'boxPlotChart' }>} onSelectInsight={handleInsight} selectedInsight={currentInsight} />;
    case 'scatterChart':
      return <ScatterChartWidget widget={widget as Extract<VisualizationWidget, { kind: 'scatterChart' }>} onSelectInsight={handleInsight} selectedInsight={currentInsight} />;
    case 'bubbleChart':
      return <BubbleChartWidget widget={widget as Extract<VisualizationWidget, { kind: 'bubbleChart' }>} onSelectInsight={handleInsight} selectedInsight={currentInsight} />;
    case 'heatmapChart':
      return <HeatmapChartWidget widget={widget as Extract<VisualizationWidget, { kind: 'heatmapChart' }>} onSelectInsight={handleInsight} selectedInsight={currentInsight} />;
    case 'sankeyChart':
      return <SankeyChartWidget widget={widget as Extract<VisualizationWidget, { kind: 'sankeyChart' }>} onSelectInsight={handleInsight} selectedInsight={currentInsight} />;
    default:
      return <div style={{ padding: 16, color: 'var(--t3)' }}>暂不支持 {widget.kind}</div>;
  }
}

export function VisualizationBoard({
  payload,
  page,
  className,
}: {
  payload: VisualizationPayload | null;
  page: VisualizationPage;
  className?: string;
  dataFormatter?: DataFormatter;
}) {
  const [lastUpdated, setLastUpdated] = useState(payload?.updatedAt ?? new Date().toISOString());
  const [filterState, setFilterState] = useState<Record<string, string>>(
    () => Object.fromEntries(payload?.filters.map((filter) => [filter.id, filter.defaultValue]) ?? []),
  );
  const [density, setDensity] = useState<"comfortable" | "compact">("comfortable");
  // Added a specific class for the board root
  const boardClassName = `viz-board viz-board-${page} ${density === "compact" ? "density-compact" : ""} ${className ?? ""}`.trim();
  const [selectedInsight, setSelectedInsight] = useState<VisualizationInsight | null>(null);
  const [refreshLedger, setRefreshLedger] = useState<Record<string, string>>({});

  useEffect(() => {
    setLastUpdated(payload?.updatedAt ?? new Date().toISOString());
    setFilterState(Object.fromEntries(payload?.filters.map((filter) => [filter.id, filter.defaultValue]) ?? []));
    setSelectedInsight(null);
  }, [payload]);

  useEffect(() => {
    if (!payload?.autoRefreshMs) {
      return;
    }
    const timer = window.setInterval(() => {
      setLastUpdated(new Date().toISOString());
    }, payload.autoRefreshMs);
    return () => window.clearInterval(timer);
  }, [payload?.autoRefreshMs]);

  const filteredPayload = useMemo(
    () => (payload ? buildFilteredPayload(payload, filterState) : null),
    [filterState, payload],
  );

  const sections = useMemo(
    () => filteredPayload?.sections.filter((section) => section.page === page) ?? [],
    [filteredPayload, page],
  );

  if (!payload || !filteredPayload || sections.length === 0) {
    return null;
  }

  const activeWindowLabel = getFilterOptionLabel(payload, "window", filterState.window ?? "quarterly");
  const activeBenchmarkLabel = getFilterOptionLabel(payload, "benchmark", filterState.benchmark ?? "industry");

  return (
    <div className={boardClassName}>
      <ChartGlobalStyles />
      <div className="viz-board-top">
        <div>
          <div className="viz-board-kicker">{payload.role === "enterprise" ? "企业端图表系统" : "普通用户端图表系统"}</div>
          <h2>{page === "home" ? "首页总览" : "分析工作台"}</h2>
        </div>
        <div className="viz-board-meta">
          <span>{filteredPayload.refreshLabel}</span>
          <span>自动刷新 {Math.round(payload.autoRefreshMs / 1000)}s</span>
          <span>最新时间：${formatRefreshTime(lastUpdated)}</span>
          <button type="button" className="viz-inline-btn" onClick={() => setDensity((current) => current === "comfortable" ? "compact" : "comfortable")}>
            {density === "comfortable" ? "紧凑模式" : "舒展模式"}
          </button>
        </div>
      </div>
      <div className="viz-filter-row">
        {payload.filters.map((filter) => (
          <div key={filter.id} className="viz-filter-group">
            <span>{filter.label}</span>
            <div className="viz-filter-options">
              {filter.options.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={`viz-filter-btn ${filterState[filter.id] === option.value ? "active" : ""}`}
                  onClick={() => setFilterState((previous) => ({ ...previous, [filter.id]: option.value }))}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        ))}
        <button
          type="button"
          className="viz-filter-reset"
          onClick={() => setFilterState(Object.fromEntries(payload.filters.map((filter) => [filter.id, filter.defaultValue])))}
        >
          重置筛选
        </button>
      </div>
      <div className="viz-active-state">
        <span>当前时间窗：{activeWindowLabel}</span>
        <span>当前对标口径：{activeBenchmarkLabel}</span>
      </div>
      {selectedInsight ? (
        <div className="viz-insight-banner">
          <div className="viz-insight-copy">
            <div className="viz-insight-kicker">当前分析对象</div>
            <strong>{selectedInsight.title}</strong>
            <p>{selectedInsight.summary}</p>
            <span>来源：{selectedInsight.source}</span>
          </div>
          <div className="viz-insight-actions">
            <div className="viz-insight-question">{createSuggestedQuestion(selectedInsight)}</div>
            <button type="button" className="viz-inline-btn" onClick={() => setSelectedInsight(null)}>
              清除聚焦
            </button>
          </div>
        </div>
      ) : null}
      {sections.map((section) => (
        <VisualizationSectionView
          key={section.id}
          section={section}
          payload={filteredPayload}
          refreshLabel={filteredPayload.refreshLabel}
          lastUpdated={lastUpdated}
          density={density}
          onRefresh={(widgetId) => {
            const now = new Date().toISOString();
            setLastUpdated(now);
            setRefreshLedger((previous) => ({ ...previous, [widgetId]: now }));
          }}
          onSelectInsight={setSelectedInsight}
          selectedInsight={selectedInsight}
          refreshLedger={refreshLedger}
          page={page}
        />
      ))}
    </div>
  );
}

export function summarizeCalendarEntries(entries: VisualizationCalendarEntry[]) {
  return entries.length;
}
