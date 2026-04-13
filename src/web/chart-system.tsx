import React, { useEffect, useMemo, useState } from "react";
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

type VisualizationInsight = {
  title: string;
  summary: string;
  source: string;
};

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
  if (status === "good") return "#00D4FF";
  if (status === "watch") return "#FFD600";
  if (status === "risk") return "#FF6B9D";
  return "var(--t1)";
}

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
      subtitle: `${section.subtitle} · 当前口径：${windowLabel} / ${benchmarkLabel}`,
      emphasis: section.emphasis
        ? `${section.emphasis}。当前已切换${windowLabel} / ${benchmarkLabel}。`
        : `当前已切换为${windowLabel} / ${benchmarkLabel}。`,
      widgets: section.widgets.map((widget) => {
        switch (widget.kind) {
          case "metricCards":
            return {
              ...widget,
              subtitle: `${widget.subtitle} · ${windowLabel}`,
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
              subtitle: `${widget.subtitle} · ${windowLabel}`,
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
              subtitle: `${widget.subtitle} · ${windowLabel}`,
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
              subtitle: `${widget.subtitle} · ${benchmarkLabel}`,
              rows: widget.rows.map((row) => ({
                ...row,
                benchmark: `${benchmarkLabel} · ${row.benchmark}`,
                note: `${row.note} 当前比较维度已切换到${benchmarkLabel}。`,
              })),
            };
          case "zebraTable":
            return {
              ...widget,
              subtitle: `${widget.subtitle} · ${windowLabel}`,
            };
          case "heatmapTable":
            return {
              ...widget,
              subtitle: `${widget.subtitle} · ${windowLabel}`,
              rows: widget.rows.map((row) => ({
                ...row,
                values: row.values.map((value) => Math.min(120, Number((value * factor).toFixed(0)))),
              })),
            };
          case "sparklineTable":
            return {
              ...widget,
              subtitle: `${widget.subtitle} · ${windowLabel}`,
              rows: widget.rows.map((row) => ({
                ...row,
                trend: row.trend.map((value, index) => Number((value * (windowMode === "forward" ? 1 + index * 0.01 : factor)).toFixed(2))),
                benchmark: row.benchmark ? `${benchmarkLabel} · ${row.benchmark}` : benchmarkLabel,
              })),
            };
          case "alertTable":
            return {
              ...widget,
              subtitle: `${widget.subtitle} · ${benchmarkLabel}`,
              rows: widget.rows.map((row) => ({
                ...row,
                threshold: `${benchmarkLabel} · ${row.threshold}`,
              })),
            };
          case "cardTable":
            return {
              ...widget,
              subtitle: `${widget.subtitle} · ${benchmarkLabel}`,
            };
          case "treeTable":
            return {
              ...widget,
              subtitle: `${widget.subtitle} · ${windowLabel}`,
              rows: widget.rows.map((row) => ({
                ...row,
                note: `${row.note} 当前查看口径：${windowLabel}。`,
              })),
            };
          case "pivotMatrix":
            return {
              ...widget,
              subtitle: `${widget.subtitle} · ${windowLabel}`,
            };
          case "calendarTable":
            return {
              ...widget,
              subtitle: `${widget.subtitle} · ${windowLabel}`,
              entries: widget.entries.map((entry) => ({
                ...entry,
                detail: `${entry.detail} 已按${windowLabel}节奏重新组织。`,
              })),
            };
          case "boxPlotChart":
            return {
              ...widget,
              subtitle: `${widget.subtitle} · ${windowLabel}`,
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
              subtitle: `${widget.subtitle} · ${windowLabel}`,
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
              subtitle: `${widget.subtitle} · ${windowLabel}`,
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
              subtitle: `${widget.subtitle} · ${windowLabel} · ${benchmarkLabel}`,
              cells: widget.cells.map((cell) => ({
                ...cell,
                value: Math.min(120, Number((cell.value * factor).toFixed(0))),
                note: `${cell.note} 当前按${windowLabel} / ${benchmarkLabel}重绘。`,
              })),
            };
          case "radarChart":
            return {
              ...widget,
              subtitle: `${widget.subtitle} · ${benchmarkLabel}`,
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
          default:
            return widget;
        }
      }),
    })),
  };
}

function HeatChip({ label, status }: { label: string; status: VisualizationStatus }) {
  return <span className={`viz-chip ${statusToClass(status)}`}>{label}</span>;
}

function SourceMetaCard({
  source,
  compact = false,
}: {
  source: VisualizationSourceMeta;
  compact?: boolean;
}) {
  const isDark = typeof document !== "undefined" && (document.documentElement.classList.contains("theme-dark") || !document.documentElement.classList.contains("theme-light"));
  return (
    <div
      style={{
        border: `1px solid ${isDark ? "rgba(148, 163, 184, 0.28)" : "rgba(148, 163, 184, 0.18)"}`,
        borderRadius: 14,
        padding: compact ? "10px 12px" : "12px 14px",
        background: isDark ? "rgba(15, 23, 42, 0.02)" : "rgba(255, 255, 255, 0.5)",
        display: "grid",
        gap: 8,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <strong style={{ fontSize: compact ? "0.9rem" : "0.95rem" }}>{source.label}</strong>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <HeatChip label={getCategoryLabel(source.category)} status="neutral" />
          <HeatChip label={getConfidenceLabel(source.confidence)} status={getConfidenceStatus(source.confidence)} />
        </div>
      </div>
      <div style={{ fontSize: "0.84rem", opacity: 0.88 }}>{source.description}</div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", fontSize: "0.78rem", opacity: 0.72 }}>
        <span>时效 {source.freshnessLabel}</span>
        {source.ownerLabel ? <span>主体 {source.ownerLabel}</span> : null}
        {source.actualSource ? <span>来源 {source.actualSource}</span> : null}
      </div>
      {source.trace.length > 0 ? (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {source.trace.slice(0, compact ? 2 : 3).map((item) => (
            <span
              key={item}
              style={{
                fontSize: "0.76rem",
                padding: "4px 8px",
                borderRadius: 999,
                background: "rgba(99, 102, 241, 0.08)",
                color: "inherit",
              }}
            >
              {item}
            </span>
          ))}
        </div>
      ) : null}
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
  if (sources.length === 0 && !widget.footnote && !widget.emphasisTag) {
    return null;
  }

  return (
    <div style={{ display: "grid", gap: 8, marginBottom: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {widget.emphasisTag ? <HeatChip label={widget.emphasisTag} status="neutral" /> : null}
          {sources.map((source) => (
            <HeatChip
              key={source.id}
              label={`${source.label} · ${getConfidenceLabel(source.confidence)}`}
              status={getConfidenceStatus(source.confidence)}
            />
          ))}
        </div>
      </div>
      {widget.footnote ? (
        <div style={{ fontSize: "0.82rem", opacity: 0.76 }}>
          {widget.footnote}
        </div>
      ) : null}
    </div>
  );
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
        <div className={`viz-calendar-detail viz-detail-panel ${statusToClass(selected.status)}`}>
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
                onClick={() => onSelectInsight({ title: row.item, summary: row.note, source: widget.title })}
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
            {widget.columns.map((column) => <th key={column}>{column}</th>)}
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
            {widget.columns.map((column) => <th key={column}>{column}</th>)}
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
            {widget.columns.map((column) => <th key={column}>{column}</th>)}
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
            onClick={() => onSelectInsight({ title: card.label, summary: card.description, source: widget.title })}
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
  const max = Math.max(...widget.data.map((item) => item.value), 1);
  const [activeId, setActiveId] = useState<string>(widget.data[0]?.id ?? "");
  const active = widget.data.find((item) => item.id === activeId) ?? widget.data[0];

  return (
    <div className="viz-bar-chart">
      <div className="viz-chart-shell">
        <div className="viz-chart-panel">
          <div className="viz-bar-stage">
            {widget.data.map((item, index) => {
              const isDimmed = selectedInsight && selectedInsight.title !== item.label;
              const isActive = activeId === item.id;
              const neonColor = NEON_COLORS[index % NEON_COLORS.length] ?? NEON_DEFAULT;
              const gradient = getNeonGradient(item.status);
              return (
                <button
                  key={item.id}
                  type="button"
                  data-bar-index={index}
                  data-bar-status={item.status ?? "neutral"}
                  className={`viz-bar-item ${statusToClass(item.status)} ${isActive ? "active" : ""} ${isDimmed ? "dimmed" : ""}`}
                  onMouseEnter={() => setActiveId(item.id)}
                  onFocus={() => setActiveId(item.id)}
                  onClick={() => {
                    setActiveId(item.id);
                    onSelectInsight({ title: item.label, summary: item.detail, source: widget.title });
                  }}
                >
                  <span
                    className="viz-bar-fill"
                    style={{
                      height: `${Math.max((item.value / max) * 100, 16)}%`,
                      background: gradient,
                      boxShadow: isActive
                        ? `0 0 24px ${neonColor.glow}, 0 4px 16px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.3), 0 0 40px ${neonColor.glow}60`
                        : `0 0 20px ${neonColor.glow}, 0 4px 12px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.2)`,
                    }}
                  ></span>
                  <strong>{item.label}</strong>
                </button>
              );
            })}
          </div>
        </div>
        {active ? (
          <div className={`viz-bar-detail viz-detail-panel ${statusToClass(active.status)}`}>
            <div className="viz-bar-detail-top">
              <span>{active.label}</span>
              <strong>{active.displayValue}</strong>
            </div>
            <div className="viz-bar-detail-meta">{active.benchmark}</div>
            <p>{active.detail}</p>
          </div>
        ) : null}
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
  const maxVal = Math.max(...widget.data.map((item) => item.value), widget.threshold ?? -Infinity);
  const minVal = Math.min(...widget.data.map((item) => item.value), widget.threshold ?? Infinity, 0);
  const range = Math.max(maxVal - minVal, 1);

  const [activeId, setActiveId] = useState<string>(widget.data[0]?.id ?? "");
  const active = widget.data.find((item) => item.id === activeId) ?? widget.data[0];

  const points = widget.data.map((item, index) => {
    const x = (index / Math.max(widget.data.length - 1, 1)) * 100;
    const y = 100 - ((item.value - minVal) / range) * 100;
    return { x, y, item };
  });

  const thresholdY = widget.threshold !== undefined ? 100 - ((widget.threshold - minVal) / range) * 100 : undefined;

  const isDark = typeof document !== "undefined" && (document.documentElement.classList.contains("theme-dark") || !document.documentElement.classList.contains("theme-light"));
  const lineColor = "#00D4FF";
  const areaGradient = isDark ? "rgba(0,212,255,0.15)" : "rgba(0,212,255,0.08)";
  const gridColor = isDark ? "rgba(99,102,241,0.08)" : "rgba(99,102,241,0.06)";
  const textColor = isDark ? "rgba(203,213,225,0.7)" : "rgba(51,65,85,0.7)";

  return (
    <div className="viz-bar-chart viz-line-chart">
      <div className="viz-chart-shell">
        <div className="viz-chart-panel">
          <div className="viz-bar-stage" style={{ position: "relative", minHeight: 240 }}>
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ position: "absolute", width: "100%", height: "100%", overflow: "visible" }}>
              {[0.25, 0.5, 0.75].map((tick) => {
                const yPos = 100 - tick * 100;
                return <line key={tick} x1="0" y1={yPos} x2="100" y2={yPos} stroke={gridColor} strokeWidth="0.3" />;
              })}
              {thresholdY !== undefined && (
                <line x1="0" y1={thresholdY} x2="100" y2={thresholdY} stroke="#FF6B9D" strokeDasharray="2,1" strokeWidth="0.6" opacity="0.6" />
              )}
              <defs>
                <linearGradient id="line-area-grad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={lineColor} stopOpacity={0.3} />
                  <stop offset="100%" stopColor={lineColor} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <polygon
                points={`0,100 ${points.map((p) => `${p.x},${p.y}`).join(" ")} 100,100`}
                fill="url(#line-area-grad)"
                style={{ transition: "all 0.8s" }}
              />
              <polyline
                points={points.map((point) => `${point.x},${point.y}`).join(" ")}
                fill="none"
                stroke={lineColor}
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{ filter: "drop-shadow(0 0 6px rgba(0,212,255,0.4))", transition: "all 0.8s" }}
              />
            </svg>

            {thresholdY !== undefined && widget.thresholdLabel && (
              <div style={{ position: "absolute", top: `${thresholdY}%`, left: 0, transform: "translateY(-100%)", fontSize: "0.72rem", color: "#FF6B9D", opacity: 0.8 }}>
                {widget.thresholdLabel} {widget.threshold}
              </div>
            )}

            <div style={{ display: "flex", justifyContent: "space-between", width: "100%", height: "100%", position: "absolute", top: 0, left: 0 }}>
              {points.map(({ y, item }) => {
                const isDimmed = selectedInsight && selectedInsight.title !== item.label;
                const isActive = activeId === item.id;
                const dotColor = isActive ? (isDark ? "#fff" : "#1e293b") : lineColor;
                return (
                  <button
                    key={item.id}
                    type="button"
                    className={`viz-bar-item ${statusToClass(item.status)} ${isActive ? "active" : ""} ${isDimmed ? "dimmed" : ""}`}
                    style={{ width: "40px", height: "100%", position: "relative", display: "flex", justifyContent: "center", background: "transparent" }}
                    onMouseEnter={() => setActiveId(item.id)}
                    onFocus={() => setActiveId(item.id)}
                    onClick={() => {
                      setActiveId(item.id);
                      onSelectInsight({ title: item.label, summary: item.detail, source: widget.title });
                    }}
                  >
                    <div style={{
                      position: "absolute", top: `${y}%`, width: isActive ? "14px" : "10px", height: isActive ? "14px" : "10px",
                      borderRadius: "50%", background: dotColor, transform: "translateY(-50%)",
                      border: `2px solid ${lineColor}`, boxShadow: isActive ? `0 0 12px rgba(0,212,255,0.5), 0 0 24px rgba(0,212,255,0.2)` : "none",
                      transition: "all 0.3s",
                    }} />
                    <strong style={{ position: "absolute", bottom: "-20px", color: textColor, fontSize: "0.7rem" }}>{item.label}</strong>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
        {active ? (
          <div className={`viz-bar-detail viz-detail-panel ${statusToClass(active.status)}`} style={{ marginTop: 0 }}>
            <div className="viz-bar-detail-top">
              <span>{active.label}</span>
              <strong>{active.displayValue}</strong>
            </div>
            <div className="viz-bar-detail-meta">{active.benchmark}</div>
            <p>{active.detail}</p>
          </div>
        ) : null}
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
  let runningTotal = 0;
  const metrics = widget.data.map((item) => {
    const isTotal = item.isTotal;
    const start = isTotal ? 0 : runningTotal;
    if (!isTotal) runningTotal += item.value;
    const end = isTotal ? item.value : runningTotal;
    return { ...item, start, end };
  });

  const maxVal = Math.max(...metrics.map((m) => Math.max(m.start, m.end, 0)), 1);
  const minVal = Math.min(...metrics.map((m) => Math.min(m.start, m.end, 0)), 0);
  const range = maxVal - minVal;

  const [activeId, setActiveId] = useState<string>(widget.data[0]?.id ?? "");
  const active = widget.data.find((item) => item.id === activeId) ?? widget.data[0];

  return (
    <div className="viz-bar-chart">
      <div className="viz-chart-shell">
        <div className="viz-chart-panel">
          <div className="viz-bar-stage">
            {metrics.map((item, index) => {
              const bottom = (((item.start < item.end ? item.start : item.end) - minVal) / range) * 100;
              const height = (Math.abs(item.end - item.start) / range) * 100;
              const isDimmed = selectedInsight && selectedInsight.title !== item.label;
              const isActive = activeId === item.id;
              const isTotal = item.isTotal;
              const neonColor = NEON_COLORS[index % NEON_COLORS.length] ?? NEON_DEFAULT;
              const gradient = isTotal
                ? "linear-gradient(180deg, #FFD600 0%, rgba(255,214,0,0.5) 100%)"
                : getNeonGradient(item.status);

              return (
                <button
                  key={item.id}
                  type="button"
                  data-bar-index={index}
                  data-bar-status={item.status ?? "neutral"}
                  data-bar-total={isTotal ? "true" : undefined}
                  className={`viz-bar-item ${statusToClass(item.status ?? "neutral")} ${isActive ? "active" : ""} ${isDimmed ? "dimmed" : ""}`}
                  onMouseEnter={() => setActiveId(item.id)}
                  onFocus={() => setActiveId(item.id)}
                  onClick={() => {
                    setActiveId(item.id);
                    onSelectInsight({ title: item.label, summary: item.detail ?? item.displayValue, source: widget.title });
                  }}
                >
                  <span
                    className="viz-bar-fill"
                    style={{
                      bottom: `${bottom}%`,
                      height: `${Math.max(height, 1)}%`,
                      position: "absolute",
                      width: "100%",
                      left: 0,
                      background: gradient,
                      boxShadow: isActive
                        ? `0 0 24px ${neonColor.glow}, 0 4px 16px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.3), 0 0 40px ${neonColor.glow}60`
                        : `0 0 20px ${neonColor.glow}, 0 4px 12px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.2)`,
                    }}
                  ></span>
                  <strong>{item.label}</strong>
                </button>
              );
            })}
          </div>
        </div>
        {active ? (
          <div className={`viz-bar-detail viz-detail-panel ${statusToClass(active.status ?? "neutral")}`}>
            <div className="viz-bar-detail-top">
              <span>{active.label}</span>
              <strong>{active.displayValue}</strong>
            </div>
            <p>{active.detail}</p>
          </div>
        ) : null}
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
  const active = widget.groups.find((g) => g.id === activeId) ?? widget.groups[0];

  const allValues = widget.groups.flatMap((g) => [g.min, g.max, ...(g.outliers ?? [])]);
  const globalMin = Math.min(...allValues);
  const globalMax = Math.max(...allValues);
  const padding = (globalMax - globalMin) * 0.15 || 1;
  const yMin = globalMin - padding;
  const yMax = globalMax + padding;
  const yRange = yMax - yMin;

  const toY = (value: number) => 100 - ((value - yMin) / yRange) * 80 - 5;

  const isDark = typeof document !== "undefined" && (document.documentElement.classList.contains("theme-dark") || !document.documentElement.classList.contains("theme-light"));
  const axisColor = isDark ? "rgba(148,163,184,0.25)" : "rgba(100,116,139,0.18)";
  const textColor = isDark ? "rgba(203,213,225,0.75)" : "rgba(51,65,85,0.75)";
  const gridColor = isDark ? "rgba(99,102,241,0.08)" : "rgba(99,102,241,0.06)";

  const groupCount = widget.groups.length;
  const slotWidth = 80 / groupCount;
  const offsetX = 15;

  return (
    <div className="viz-bar-chart viz-box-plot-chart">
      <div className="viz-chart-shell stacked">
        <div className="viz-chart-panel">
          <svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet" style={{ width: "100%", height: 320, overflow: "visible" }}>
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

              const yMedian = toY(group.median);
              const yQ1 = toY(group.q1);
              const yQ3 = toY(group.q3);
              const yMinW = toY(group.min);
              const yMaxW = toY(group.max);

              const isDimmed = selectedInsight && selectedInsight.title !== group.label;
              const isActive = activeId === group.id;
              const neonColor = NEON_COLORS[index % NEON_COLORS.length] ?? NEON_DEFAULT;
              const gradient = getNeonGradient(group.status);
              const statusColor = getStatusColor(group.status);
              const opacity = isDimmed ? 0.2 : 1;

              return (
                <g key={group.id} style={{ opacity, cursor: "pointer", transition: "opacity 0.8s" }}
                  onMouseEnter={() => setActiveId(group.id)}
                  onClick={() => { setActiveId(group.id); onSelectInsight({ title: group.label, summary: group.detail, source: widget.title }); }}
                >
                  <line x1={cx} y1={yMinW} x2={cx} y2={yQ1} stroke={statusColor} strokeWidth="0.8" opacity={0.6} strokeDasharray="1.5,1" />
                  <line x1={cx} y1={yQ3} x2={cx} y2={yMaxW} stroke={statusColor} strokeWidth="0.8" opacity={0.6} strokeDasharray="1.5,1" />
                  <line x1={cx - halfBox * 0.5} y1={yMinW} x2={cx + halfBox * 0.5} y2={yMinW} stroke={statusColor} strokeWidth="0.8" opacity={0.8} />
                  <line x1={cx - halfBox * 0.5} y1={yMaxW} x2={cx + halfBox * 0.5} y2={yMaxW} stroke={statusColor} strokeWidth="0.8" opacity={0.8} />

                  <defs>
                    <linearGradient id={`bp-grad-${group.id}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={statusColor} stopOpacity={isActive ? 0.6 : 0.35} />
                      <stop offset="100%" stopColor={statusColor} stopOpacity={isActive ? 0.25 : 0.1} />
                    </linearGradient>
                  </defs>
                  <rect
                    x={cx - halfBox} y={yQ3} width={boxWidth} height={Math.max(yQ1 - yQ3, 0.5)}
                    fill={`url(#bp-grad-${group.id})`} stroke={statusColor} strokeWidth={isActive ? 0.8 : 0.5} rx="1"
                    style={{ filter: isActive ? `drop-shadow(0 0 8px ${neonColor.glow}) drop-shadow(0 0 16px ${neonColor.glow})` : `drop-shadow(0 0 3px ${neonColor.glow})`, transition: "all 0.8s" }}
                  />

                  <line x1={cx - halfBox} y1={yMedian} x2={cx + halfBox} y2={yMedian} stroke={isDark ? "#fff" : "#1e293b"} strokeWidth="1.2" opacity={0.9} />

                  {(group.outliers ?? []).map((outlier, oi) => {
                    const oy = toY(outlier);
                    return (
                      <circle key={oi} cx={cx} cy={oy} r="1.5" fill="transparent" stroke={statusColor} strokeWidth="0.6" opacity={0.8}
                        style={{ filter: `drop-shadow(0 0 3px ${neonColor.glow})` }} />
                    );
                  })}

                  <text x={cx} y={toY(yMin) + 6} fontSize="3.2" fill={textColor} textAnchor="middle" dominantBaseline="hanging" fontWeight={isActive ? 700 : 500}>
                    {group.label}
                  </text>

                  {isActive && (
                    <g>
                      <text x={cx + halfBox + 2} y={yMedian} fontSize="2.8" fill={statusColor} dominantBaseline="middle" fontWeight={700}>
                        中位数：${group.displayValues.median}
                      </text>
                      <text x={cx + halfBox + 2} y={yQ3 - 1} fontSize="2.4" fill={textColor} dominantBaseline="auto" opacity={0.7}>
                        Q3 {group.displayValues.q3}
                      </text>
                      <text x={cx + halfBox + 2} y={yQ1 + 1.5} fontSize="2.4" fill={textColor} dominantBaseline="hanging" opacity={0.7}>
                        Q1 {group.displayValues.q1}
                      </text>
                    </g>
                  )}
                </g>
              );
            })}
          </svg>
        </div>
        {active ? (
          <div className={`viz-bar-detail viz-detail-panel ${statusToClass(active.status)}`}>
            <div className="viz-bar-detail-top">
              <span>{active.label}</span>
              <strong>{active.displayValues.median}</strong>
            </div>
            <div className="viz-bar-detail-meta">
              最小：${active.displayValues.min} · Q1 {active.displayValues.q1} · 中位数：${active.displayValues.median} · Q3 {active.displayValues.q3} · 最大：${active.displayValues.max}
              {(active.outliers ?? []).length > 0 && ` · 离群值：${active.outliers!.join(", ")}`}
            </div>
            <p>{active.detail}</p>
          </div>
        ) : null}
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
  const active = widget.data.find((d) => d.id === activeId) ?? widget.data[0];

  const isDark = typeof document !== "undefined" && (document.documentElement.classList.contains("theme-dark") || !document.documentElement.classList.contains("theme-light"));
  const axisColor = isDark ? "rgba(148,163,184,0.3)" : "rgba(100,116,139,0.2)";
  const textColor = isDark ? "rgba(203,213,225,0.8)" : "rgba(51,65,85,0.8)";
  const activeStrokeColor = isDark ? "#fff" : "#1e293b";

  const scatterData = widget.data.map((d) => ({
    id: d.id,
    label: d.label,
    x: d.x,
    y: d.y,
    displayX: d.displayX,
    displayY: d.displayY,
    status: d.status,
    detail: d.detail,
  }));

  return (
    <div className="viz-bar-chart viz-scatter-chart">
      <div className="viz-chart-shell stacked">
        <div className="viz-chart-panel">
          <ResponsiveContainer width="100%" height={320}>
            <ScatterChart margin={{ top: 15, right: 25, bottom: 25, left: 15 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={axisColor} />
              <XAxis
                dataKey="x" type="number" name={widget.xLabel}
                tick={{ fill: textColor, fontSize: 11 }} axisLine={{ stroke: axisColor }} tickLine={{ stroke: axisColor }}
                label={{ value: widget.xLabel, position: "bottom", offset: 0, style: { fill: textColor, fontSize: 11 } }}
              />
              <YAxis
                dataKey="y" type="number" name={widget.yLabel}
                tick={{ fill: textColor, fontSize: 11 }} axisLine={{ stroke: axisColor }} tickLine={{ stroke: axisColor }}
                label={{ value: widget.yLabel, angle: -90, position: "insideLeft", style: { fill: textColor, fontSize: 11 } }}
              />
              <ZAxis range={[90, 280]} />
              <Tooltip
                content={({ payload }) => {
                  if (!payload || payload.length === 0) return null;
                  const datum = payload[0]!.payload;
                  return (
                    <div style={{
                      background: isDark ? "rgba(15,23,42,0.92)" : "rgba(255,255,255,0.96)",
                      border: `1px solid ${isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.08)"}`,
                      borderRadius: 12, padding: "10px 14px", fontSize: "0.82rem",
                      boxShadow: isDark ? "0 8px 32px rgba(0,0,0,0.5)" : "0 8px 24px rgba(0,0,0,0.1)",
                      backdropFilter: "blur(12px)",
                    }}>
                      <div style={{ fontWeight: 700, marginBottom: 6, color: getStatusColor(datum.status) }}>{datum.label}</div>
                      <div style={{ opacity: 0.85 }}>{widget.xLabel}: {datum.displayX}</div>
                      <div style={{ opacity: 0.85 }}>{widget.yLabel}: {datum.displayY}</div>
                    </div>
                  );
                }}
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
                    onSelectInsight({ title: d.label, summary: d.detail, source: widget.title });
                  }
                }}
              >
                {scatterData.map((entry, index) => {
                  const isDimmed = selectedInsight && selectedInsight.title !== entry.label;
                  const isActive = activeId === entry.id;
                  const color = getStatusColor(entry.status);
                  const neonColor = NEON_COLORS[index % NEON_COLORS.length] ?? NEON_DEFAULT;
                  return (
                    <Cell
                      key={entry.id}
                      fill={color}
                      fillOpacity={isDimmed ? 0.12 : isActive ? 0.85 : 0.55}
                      stroke={isActive ? activeStrokeColor : color}
                      strokeWidth={isActive ? 2 : 1}
                      style={{
                        filter: isActive
                          ? `drop-shadow(0 0 10px ${neonColor.glow}) drop-shadow(0 0 20px ${neonColor.glow})`
                          : `drop-shadow(0 0 4px ${neonColor.glow})`,
                        transition: "all 0.8s",
                        cursor: "pointer",
                      }}
                    />
                  );
                })}
              </Scatter>
            </ScatterChart>
          </ResponsiveContainer>
        </div>
        {active ? (
          <div className={`viz-bar-detail viz-detail-panel ${statusToClass(active.status)}`}>
            <div className="viz-bar-detail-top">
              <span>{active.label}</span>
              <strong>{active.displayY}</strong>
            </div>
            <div className="viz-bar-detail-meta">
              {widget.xLabel}: {active.displayX} · {widget.yLabel}: {active.displayY}
            </div>
            <p>{active.detail}</p>
          </div>
        ) : null}
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
  const [isDark, setIsDark] = useState(() => {
    if (typeof document !== "undefined") {
      return document.documentElement.classList.contains("theme-dark") || !document.documentElement.classList.contains("theme-light");
    }
    return true;
  });

  useEffect(() => {
    if (typeof document === "undefined") return;
    const observer = new MutationObserver(() => {
      setIsDark(document.documentElement.classList.contains("theme-dark") || !document.documentElement.classList.contains("theme-light"));
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  const chartData = widget.dimensions.map((dim) => ({
    dimension: dim.dimension,
    current: dim.current,
    baseline: dim.baseline,
  }));

  const [activeDim, setActiveDim] = useState<string>(widget.dimensions[0]?.dimension ?? "");
  const activeDimension = widget.dimensions.find((dim) => dim.dimension === activeDim) ?? widget.dimensions[0];

  function CustomRadarTooltip({ active, payload }: { active?: boolean; payload?: Array<{ name: string; value: number; dataKey: string; payload: { dimension: string; current: number; baseline: number } }> }) {
    if (!active || !payload || payload.length === 0) return null;
    const dimName = payload[0]?.payload?.dimension ?? "";
    const dim = widget.dimensions.find((d) => d.dimension === dimName);
    if (!dim) return null;
    const gap = dim.current - dim.baseline;
    return (
      <div
        style={{
          background: isDark ? "rgba(15,23,42,0.88)" : "rgba(248,250,252,0.92)",
          backdropFilter: "blur(12px)",
          WebkitBackdropFilter: "blur(12px)",
          border: `1px solid ${isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.08)"}`,
          borderRadius: 12,
          padding: "10px 14px",
          boxShadow: isDark ? "0 8px 32px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.05)" : "0 8px 24px rgba(0,0,0,0.1)",
          fontSize: "0.84rem",
          minWidth: 140,
        }}
      >
        <div style={{ fontWeight: 600, marginBottom: 6, color: isDark ? "var(--t1)" : "var(--t2)" }}>{dimName}</div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#00D4FF", display: "inline-block" }}></span>
          <span style={{ color: isDark ? "var(--t3)" : "var(--t4)" }}>{widget.currentLabel}：</span>
          <strong style={{ color: "#00D4FF" }}>{dim.displayCurrent}</strong>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#B388FF", display: "inline-block" }}></span>
          <span style={{ color: isDark ? "var(--t3)" : "var(--t4)" }}>{widget.baselineLabel}：</span>
          <strong style={{ color: "#B388FF" }}>{dim.displayBaseline}</strong>
        </div>
        <div style={{ borderTop: `1px solid ${isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)"}`, paddingTop: 6, marginTop: 4, color: gap >= 0 ? "#00E676" : "#FF6B9D" }}>
          差距：{gap >= 0 ? "+" : ""}{gap.toFixed(2)}
        </div>
      </div>
    );
  }

  return (
    <div className="viz-bar-chart viz-radar-chart">
      <div className="viz-chart-shell stacked">
        <div className="viz-chart-panel">
          <ResponsiveContainer width="100%" height={360}>
            <RadarChart data={chartData} cx="50%" cy="50%" outerRadius={72}>
              <PolarGrid stroke={isDark ? "rgba(99,102,241,0.12)" : "rgba(99,102,241,0.1)"} gridType="polygon" strokeDasharray="3 3" />
              <PolarAngleAxis dataKey="dimension" tick={{ fontSize: 12, fill: isDark ? "rgba(203,213,225,0.8)" : "rgba(51,65,85,0.8)", fontWeight: 600 }} />
              <PolarRadiusAxis tick={{ fontSize: 10, fill: isDark ? "rgba(148,163,184,0.5)" : "rgba(100,116,139,0.5)" }} axisLine={false} />
              <Radar
                name={widget.currentLabel}
                dataKey="current"
                stroke="#00D4FF"
                fill="#00D4FF"
                fillOpacity={0.2}
                strokeWidth={2.5}
                dot={{ r: 5, fill: "#00D4FF", stroke: isDark ? "rgba(255,255,255,0.9)" : "#fff", strokeWidth: 2 }}
                animationDuration={1000}
                animationEasing="ease-out"
                style={{ filter: "drop-shadow(0 0 10px rgba(0,212,255,0.35))" }}
              />
              <Radar
                name={widget.baselineLabel}
                dataKey="baseline"
                stroke="#B388FF"
                fill="#B388FF"
                fillOpacity={0.08}
                strokeWidth={2}
                strokeDasharray="5 5"
                dot={{ r: 4, fill: "#B388FF", stroke: isDark ? "rgba(255,255,255,0.9)" : "#fff", strokeWidth: 1.5 }}
                animationDuration={1000}
                animationEasing="ease-out"
                style={{ filter: "drop-shadow(0 0 8px rgba(179,136,255,0.25))" }}
              />
              <Tooltip content={<CustomRadarTooltip />} />
              <Legend wrapperStyle={{ fontSize: 12, paddingTop: 16 }} />
            </RadarChart>
          </ResponsiveContainer>
        </div>
        {activeDimension ? (
          <div className="viz-bar-detail viz-detail-panel neutral">
            <div className="viz-bar-detail-top">
              <span>{activeDimension.dimension}</span>
              <strong>{activeDimension.displayCurrent}</strong>
            </div>
            <div className="viz-bar-detail-meta">
              {widget.baselineLabel}：{activeDimension.displayBaseline}　|　差距：{(activeDimension.current - activeDimension.baseline) >= 0 ? "+" : ""}{(activeDimension.current - activeDimension.baseline).toFixed(2)}
            </div>
          </div>
        ) : null}
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
  const active = widget.data.find((d) => d.id === activeId) ?? widget.data[0];

  const isDark = typeof document !== "undefined" && (document.documentElement.classList.contains("theme-dark") || !document.documentElement.classList.contains("theme-light"));
  const axisColor = isDark ? "rgba(148,163,184,0.3)" : "rgba(100,116,139,0.2)";
  const textColor = isDark ? "rgba(203,213,225,0.8)" : "rgba(51,65,85,0.8)";
  const activeStrokeColor = isDark ? "#fff" : "#1e293b";

  const bubbleData = widget.data.map((d) => ({ ...d, z: d.z }));

  return (
    <div className="viz-bar-chart viz-bubble-chart">
      <div className="viz-chart-shell stacked">
        <div className="viz-chart-panel">
          <ResponsiveContainer width="100%" height={320}>
            <ScatterChart margin={{ top: 15, right: 25, bottom: 25, left: 15 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={axisColor} />
              <XAxis dataKey="x" type="number" name={widget.xLabel} tick={{ fill: textColor, fontSize: 11 }} axisLine={{ stroke: axisColor }} tickLine={{ stroke: axisColor }} label={{ value: widget.xLabel, position: "bottom", offset: 0, style: { fill: textColor, fontSize: 11 } }} />
              <YAxis dataKey="y" type="number" name={widget.yLabel} tick={{ fill: textColor, fontSize: 11 }} axisLine={{ stroke: axisColor }} tickLine={{ stroke: axisColor }} label={{ value: widget.yLabel, angle: -90, position: "insideLeft", style: { fill: textColor, fontSize: 11 } }} />
              <ZAxis dataKey="z" range={[120, 1200]} name={widget.zLabel} />
              <Tooltip
                content={({ payload }) => {
                  if (!payload || payload.length === 0) return null;
                  const datum = payload[0]!.payload;
                  return (
                    <div style={{
                      background: isDark ? "rgba(15,23,42,0.92)" : "rgba(255,255,255,0.96)",
                      border: `1px solid ${isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.08)"}`,
                      borderRadius: 12, padding: "10px 14px", fontSize: "0.82rem",
                      boxShadow: isDark ? "0 8px 32px rgba(0,0,0,0.5)" : "0 8px 24px rgba(0,0,0,0.1)",
                      backdropFilter: "blur(12px)",
                    }}>
                      <div style={{ fontWeight: 700, marginBottom: 6, color: getStatusColor(datum.status) }}>{datum.label}</div>
                      <div style={{ opacity: 0.85 }}>{widget.xLabel}: {datum.displayX}</div>
                      <div style={{ opacity: 0.85 }}>{widget.yLabel}: {datum.displayY}</div>
                      <div style={{ opacity: 0.85 }}>{widget.zLabel}: {datum.displayZ}</div>
                    </div>
                  );
                }}
              />
              <Scatter
                data={bubbleData}
                onMouseEnter={(datum) => { const d = bubbleData.find((s) => s.x === datum.x && s.y === datum.y); if (d) setActiveId(d.id); }}
                onClick={(datum) => {
                  const d = bubbleData.find((s) => s.x === datum.x && s.y === datum.y);
                  if (d) { setActiveId(d.id); onSelectInsight({ title: d.label, summary: d.detail, source: widget.title }); }
                }}
              >
                {bubbleData.map((entry, index) => {
                  const isDimmed = selectedInsight && selectedInsight.title !== entry.label;
                  const isActive = activeId === entry.id;
                  const color = getStatusColor(entry.status);
                  const neonColor = NEON_COLORS[index % NEON_COLORS.length] ?? NEON_DEFAULT;
                  return (
                    <Cell key={entry.id} fill={color} fillOpacity={isDimmed ? 0.1 : isActive ? 0.7 : 0.4}
                      stroke={isActive ? activeStrokeColor : color} strokeWidth={isActive ? 2.5 : 1}
                      style={{
                        filter: isActive ? `drop-shadow(0 0 12px ${neonColor.glow}) drop-shadow(0 0 24px ${neonColor.glow})` : `drop-shadow(0 0 6px ${neonColor.glow})`,
                        transition: "all 0.8s", cursor: "pointer",
                      }}
                    />
                  );
                })}
              </Scatter>
            </ScatterChart>
          </ResponsiveContainer>
        </div>
        {active ? (
          <div className={`viz-bar-detail viz-detail-panel ${statusToClass(active.status)}`}>
            <div className="viz-bar-detail-top"><span>{active.label}</span><strong>{active.displayY}</strong></div>
            <div className="viz-bar-detail-meta">{widget.xLabel}: {active.displayX} · {widget.yLabel}: {active.displayY} · {widget.zLabel}: {active.displayZ}</div>
            <p>{active.detail}</p>
          </div>
        ) : null}
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
  const [activeCellKey, setActiveCellKey] = useState<string>("");
  const activeCell = widget.cells.find((c) => `${c.row}-${c.column}` === activeCellKey) ?? widget.cells[0];

  const isDark = typeof document !== "undefined" && (document.documentElement.classList.contains("theme-dark") || !document.documentElement.classList.contains("theme-light"));
  const labelColor = isDark ? "rgba(148,163,184,0.8)" : "rgba(71,85,105,0.8)";

  const allValues = widget.cells.map((c) => c.value);
  const minVal = Math.min(...allValues, 0);
  const maxVal = Math.max(...allValues, 100);
  const valRange = maxVal - minVal || 1;

  function getHeatColor(value: number) {
    const norm = (value - minVal) / valRange;
    if (norm < 0.25) {
      const t = norm / 0.25;
      return `rgb(${Math.round(20 + t * 20)},${Math.round(60 + t * 100)},${Math.round(180 + t * 20)})`;
    } else if (norm < 0.5) {
      const t = (norm - 0.25) / 0.25;
      return `rgb(${Math.round(40 + t * 80)},${Math.round(160 + t * 60)},${Math.round(200 - t * 80)})`;
    } else if (norm < 0.75) {
      const t = (norm - 0.5) / 0.25;
      return `rgb(${Math.round(120 + t * 120)},${Math.round(220 - t * 40)},${Math.round(120 - t * 80)})`;
    } else {
      const t = (norm - 0.75) / 0.25;
      return `rgb(${Math.round(240 + t * 15)},${Math.round(180 - t * 100)},${Math.round(40 - t * 20)})`;
    }
  }

  const colCount = widget.columns.length;
  const rowCount = widget.rows.length;
  const labelWidth = 120;
  const labelHeight = 40;
  const cellW = 100;
  const cellH = 60;
  const svgW = labelWidth + colCount * cellW;
  const svgH = labelHeight + rowCount * cellH;

  return (
    <div className="viz-bar-chart viz-heatmap-chart">
      <div className="viz-chart-shell stacked">
        <div className="viz-chart-panel" style={{ overflowX: "auto" }}>
          <svg viewBox={`0 0 ${svgW} ${svgH}`} preserveAspectRatio="xMidYMid meet"
            style={{ width: "100%", minHeight: 280, overflow: "visible" }}
          >
            {widget.columns.map((col, ci) => (
              <text key={col} x={labelWidth + ci * cellW + cellW / 2} y={labelHeight / 2}
                fontSize="13" fill={labelColor} textAnchor="middle" dominantBaseline="middle" fontWeight={600}>
                {col}
              </text>
            ))}
            {widget.rows.map((row, ri) => (
              <React.Fragment key={row}>
                <text x={labelWidth - 8} y={labelHeight + ri * cellH + cellH / 2}
                  fontSize="12" fill={labelColor} textAnchor="end" dominantBaseline="middle" fontWeight={500}>
                  {row}
                </text>
                {widget.columns.map((col, ci) => {
                  const cell = widget.cells.find((c) => c.row === row && c.column === col);
                  if (!cell) return null;
                  const cellKey = `${row}-${col}`;
                  const isActive = activeCellKey === cellKey;
                  const isDimmed = selectedInsight && selectedInsight.title !== `${row}·${col}`;
                  const color = getHeatColor(cell.value);
                  return (
                    <g key={cellKey} style={{ cursor: "pointer", transition: "opacity 0.8s" }}
                      onMouseEnter={() => setActiveCellKey(cellKey)}
                      onClick={() => { setActiveCellKey(cellKey); onSelectInsight({ title: `${row}·${col}`, summary: cell.note, source: widget.title }); }}
                    >
                      <rect x={labelWidth + ci * cellW + 2} y={labelHeight + ri * cellH + 2}
                        width={cellW - 4} height={cellH - 4}
                        fill={color} rx="6" opacity={isDimmed ? 0.2 : 1}
                        stroke={isActive ? (isDark ? "#fff" : "#1e293b") : "transparent"} strokeWidth={isActive ? 2 : 0}
                        style={{ filter: isActive ? `drop-shadow(0 0 8px ${color}) drop-shadow(0 0 16px ${color})` : "none", transition: "all 0.8s" }}
                      />
                      <text x={labelWidth + ci * cellW + cellW / 2} y={labelHeight + ri * cellH + cellH / 2 - 6}
                        fontSize="14" fill={isDark ? "rgba(255,255,255,0.95)" : "rgba(15,23,42,0.9)"}
                        textAnchor="middle" dominantBaseline="middle" fontWeight={isActive ? 800 : 700}>
                        {cell.displayValue}
                      </text>
                      <text x={labelWidth + ci * cellW + cellW / 2} y={labelHeight + ri * cellH + cellH / 2 + 10}
                        fontSize="9" fill={isDark ? "rgba(255,255,255,0.5)" : "rgba(15,23,42,0.45)"}
                        textAnchor="middle" dominantBaseline="middle" fontWeight={400}>
                        {cell.note.length > 8 ? cell.note.slice(0, 8) + "…" : cell.note}
                      </text>
                    </g>
                  );
                })}
              </React.Fragment>
            ))}
          </svg>
        </div>
        {activeCell ? (
          <div className="viz-bar-detail viz-detail-panel neutral">
            <div className="viz-bar-detail-top"><span>{activeCell.row} · {activeCell.column}</span><strong>{activeCell.displayValue}</strong></div>
            <div className="viz-bar-detail-meta">{activeCell.note}</div>
          </div>
        ) : null}
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
    case "metricCards":
      return <MetricCardsWidget widget={widget} onSelectInsight={onSelectInsight} selectedInsight={selectedInsight} />;
    case "barChart":
      return <BarChartWidget widget={widget} onSelectInsight={onSelectInsight} selectedInsight={selectedInsight} />;
    case "lineChart":
      return <LineChartWidget widget={widget} onSelectInsight={onSelectInsight} selectedInsight={selectedInsight} />;
    case "waterfallChart":
      return <WaterfallChartWidget widget={widget} onSelectInsight={onSelectInsight} selectedInsight={selectedInsight} />;
    case "radarChart":
      return <RadarChartWidget widget={widget} onSelectInsight={onSelectInsight} selectedInsight={selectedInsight} />;
    case "boxPlotChart":
      return <BoxPlotChartWidget widget={widget} onSelectInsight={onSelectInsight} selectedInsight={selectedInsight} />;
    case "scatterChart":
      return <ScatterChartWidget widget={widget} onSelectInsight={onSelectInsight} selectedInsight={selectedInsight} />;
    case "bubbleChart":
      return <BubbleChartWidget widget={widget} onSelectInsight={onSelectInsight} selectedInsight={selectedInsight} />;
    case "heatmapChart":
      return <HeatmapChartWidget widget={widget} onSelectInsight={onSelectInsight} selectedInsight={selectedInsight} />;
    case "benchmarkTable":
      return <BenchmarkTableWidget widget={widget} density={density} onSelectInsight={onSelectInsight} selectedInsight={selectedInsight} />;
    case "zebraTable":
      return <ZebraTableWidget widget={widget} density={density} selectedInsight={selectedInsight} />;
    case "heatmapTable":
      return <HeatmapTableWidget widget={widget} density={density} onSelectInsight={onSelectInsight} selectedInsight={selectedInsight} />;
    case "sparklineTable":
      return <SparklineTableWidget widget={widget} density={density} onSelectInsight={onSelectInsight} selectedInsight={selectedInsight} />;
    case "alertTable":
      return <AlertTableWidget widget={widget} density={density} onSelectInsight={onSelectInsight} selectedInsight={selectedInsight} />;
    case "cardTable":
      return <CardTableWidget widget={widget} selectedInsight={selectedInsight} />;
    case "treeTable":
      return <TreeTableWidget widget={widget} onSelectInsight={onSelectInsight} selectedInsight={selectedInsight} />;
    case "pivotMatrix":
      return <PivotMatrixWidget widget={widget} density={density} onSelectInsight={onSelectInsight} selectedInsight={selectedInsight} />;
    case "calendarTable":
      return <CalendarWidget widget={widget} onSelectInsight={onSelectInsight} selectedInsight={selectedInsight} />;
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
  const widgetSources = useMemo(() => getWidgetSources(payload, widget), [payload, widget]);

  return (
    <article className={`viz-widget viz-${widget.kind} ${widgetLayoutClass} ${expanded ? "expanded" : ""} ${className ?? ""}`.trim()}>
      <div className="viz-widget-head">
        <div>
          <h4>{widget.title}</h4>
          <p>{widget.subtitle}</p>
          {widget.description ? <div className="viz-widget-description">{widget.description}</div> : null}
        </div>
        <div className="viz-widget-actions">
          <button type="button" className={`viz-inline-btn ${refreshedAt ? "active" : ""}`} onClick={() => onRefresh(widget.id)}>
            刷新
          </button>
          <button type="button" className="viz-inline-btn" onClick={() => setExpanded((value) => !value)}>
            {expanded ? "收起" : "展开"}
          </button>
        </div>
      </div>
      <div className="viz-widget-refresh">
        <span>{refreshLabel}</span>
        <span>更新时间 {formatRefreshTime(lastUpdated)}</span>
        {refreshedAt ? <span>局部刷新：${formatRefreshTime(refreshedAt)}</span> : null}
      </div>
      <WidgetSourceSummary widget={widget} sources={widgetSources} />
      <WidgetBody widget={widget} density={density} onSelectInsight={onSelectInsight} selectedInsight={selectedInsight} />
      {expanded && widgetSources.length > 0 ? (
        <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
          {widgetSources.map((source) => <SourceMetaCard key={source.id} source={source} compact />)}
        </div>
      ) : null}
    </article>
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
  const tableWidgetCount = section.widgets.filter((widget) => isTableLikeWidget(widget.kind)).length;
  const chartWidgetCount = section.widgets.filter((widget) => ["barChart", "lineChart", "waterfallChart", "radarChart", "boxPlotChart", "scatterChart"].includes(widget.kind)).length;

  return (
    <section className="viz-section">
    <div className="viz-section-head">
      <div>
        <h3>{section.title}</h3>
        <p>{section.subtitle}</p>
      </div>
      {section.emphasis ? <div className="viz-section-emphasis">{section.emphasis}</div> : null}
    </div>
    <div className="viz-section-stats">
      <div className="viz-section-stat">
        <span>视图组件</span>
        <strong>{section.widgets.length}</strong>
      </div>
      <div className="viz-section-stat">
        <span>表格视图</span>
        <strong>{tableWidgetCount}</strong>
      </div>
      <div className="viz-section-stat">
        <span>图形视图</span>
        <strong>{chartWidgetCount}</strong>
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

export function VisualizationBoard({
  payload,
  page,
  className,
  dataFormatter,
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
      <div className="viz-board-top">
        <div>
          <div className="viz-board-kicker">{payload.role === "enterprise" ? "企业端图表系统" : "普通用户端图表系统"}</div>
          <h2>{page === "home" ? "首页图表总览" : "分析图表工作台"}</h2>
          <p>{payload.sourceSummary}</p>
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
      {filteredPayload.sourceMeta.length > 0 ? (
        <div style={{ display: "grid", gap: 12, marginBottom: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
            <div>
              <div className="viz-board-kicker">真实数据来源元信息</div>
              <div style={{ fontSize: "0.9rem", opacity: 0.78 }}>
                当前图表共关联${filteredPayload.sourceMeta.length} 个来源节点，支持企业端与普通用户端统一追溯。
              </div>
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {filteredPayload.sourceMeta.slice(0, 4).map((source) => (
                <HeatChip
                  key={source.id}
                  label={`${getCategoryLabel(source.category)} · ${getConfidenceLabel(source.confidence)}`}
                  status={getConfidenceStatus(source.confidence)}
                />
              ))}
            </div>
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: density === "compact" ? "repeat(auto-fit, minmax(220px, 1fr))" : "repeat(auto-fit, minmax(260px, 1fr))",
              gap: 12,
            }}
          >
            {filteredPayload.sourceMeta.map((source) => <SourceMetaCard key={source.id} source={source} />)}
          </div>
        </div>
      ) : null}
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
