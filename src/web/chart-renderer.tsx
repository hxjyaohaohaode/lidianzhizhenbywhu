/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useState } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  PieChart, Pie, Cell,
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  BarChart, Bar,
  AreaChart, Area,
  type PieLabelRenderProps,
} from "recharts";

// 统一图表主题色（与 styles.css 中的 --viz-accent-* 对齐）
const NEON_COLORS = [
  "var(--viz-accent-1)",
  "var(--viz-accent-2)",
  "var(--viz-accent-3)",
  "var(--viz-accent-4)",
  "var(--viz-accent-5)",
];

// 图表轴标签字体大小（与 styles.css 中的 --fs-chart-axis 对齐）
const CHART_AXIS_FONT_SIZE = 11;

export type ChartSpec = {
  type: "line" | "pie" | "radar" | "bar" | "area";
  title?: string;
  data: Record<string, unknown>[];
  xKey?: string;
  yKeys?: string[];
  nameKey?: string;
  valueKey?: string;
  categories?: string[];
};

function parseChartBlocks(text: string): { textParts: string[]; charts: ChartSpec[] } {
  const chartRegex = /```chart\n([\s\S]*?)```/g;
  const textParts: string[] = [];
  const charts: ChartSpec[] = [];
  let lastIndex = 0;
  let match;
  while ((match = chartRegex.exec(text)) !== null) {
    textParts.push(text.slice(lastIndex, match.index));
    try {
      const spec = JSON.parse(match[1]!);
      if (spec.type && spec.data) {
        charts.push(spec as ChartSpec);
      }
    } catch (e) { void e; }
    lastIndex = match.index + match[0].length;
  }
  textParts.push(text.slice(lastIndex));
  return { textParts, charts };
}

const tooltipBaseStyle: React.CSSProperties = {
  background: "var(--viz-tooltip-bg)",
  border: "1px solid var(--viz-tooltip-border)",
  borderRadius: 12,
  fontSize: 12,
  color: "var(--viz-tooltip-text)",
  backdropFilter: "blur(16px)",
  WebkitBackdropFilter: "blur(16px)",
};

export const ChartRenderer: React.FC<{ spec: ChartSpec }> = ({ spec }) => {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  const isDark = typeof document !== 'undefined'
    ? (document.documentElement.classList.contains('theme-dark') || !document.documentElement.classList.contains('theme-light'))
    : true;

  // Glass-morphism 容器样式
  const containerStyle: React.CSSProperties = {
    width: "100%",
    height: 340,
    margin: "16px 0",
    padding: "24px",
    background: "var(--viz-surface-bg)",
    borderRadius: 20,
    border: "1px solid var(--viz-surface-border)",
    boxShadow: "var(--viz-surface-shadow)",
    backdropFilter: "blur(20px)",
    WebkitBackdropFilter: "blur(20px)",
    transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
  };

  // 标题样式
  const titleStyle: React.CSSProperties = {
    fontSize: 15,
    fontWeight: 700,
    color: isDark ? "#E2E8F0" : "#1E293B",
    marginBottom: 4,
    letterSpacing: "0.02em",
  };

  // 自定义 Tooltip 组件 - 暗色玻璃态 + 光晕效果
  const CustomTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;

    const glowColor = payload[0]?.color || NEON_COLORS[0];

    return (
      <div style={{
        padding: "12px 16px",
        ...tooltipBaseStyle,
        boxShadow: `0 10px 30px rgba(0,0,0,${isDark ? 0.34 : 0.14}), 0 0 18px color-mix(in srgb, ${glowColor} 22%, transparent)`,
        transform: "translateY(-4px)",
        transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
        minWidth: 140,
      }}>
        <div style={{
          fontWeight: 700,
          marginBottom: 8,
          fontSize: 13,
          color: "var(--viz-tooltip-title)",
          paddingBottom: 6,
          borderBottom: "1px solid color-mix(in srgb,var(--viz-tooltip-border) 70%, transparent)",
        }}>
          {label}
        </div>
        {payload.map((entry: any, i: number) => (
          <div key={i} style={{
            display: "flex",
            justifyContent: "space-between",
            gap: 16,
            marginTop: 6,
            alignItems: "center",
          }}>
            <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{
                width: 10,
                height: 10,
                borderRadius: 3,
                background: entry.color || NEON_COLORS[i % NEON_COLORS.length],
                boxShadow: `0 0 10px color-mix(in srgb, ${entry.color || NEON_COLORS[i % NEON_COLORS.length]} 45%, transparent)`,
              }} />
              <span style={{ opacity: 0.9, fontSize: 12 }}>{entry.name}</span>
            </span>
            <span style={{ fontWeight: 700, fontSize: 13 }}>{entry.value}</span>
          </div>
        ))}
      </div>
    );
  };

  // 轴线通用样式
  const axisStyle = {
    fontSize: CHART_AXIS_FONT_SIZE,
    fill: "var(--viz-axis-text)",
    fontFamily: "inherit",
  };

  return (
    <div
      style={containerStyle}
      onMouseEnter={() => setHoveredIndex(null)}
    >
      {/* 标题栏：左侧渐变竖条 + 标题文字 */}
      {spec.title && (
        <div style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          marginBottom: 16,
        }}>
          <div style={{
            width: 3,
            height: 18,
            borderRadius: 2,
            background: "linear-gradient(180deg, #00D4FF, #0066FF)",
            boxShadow: isDark ? "0 0 10px #00D4FF44" : "none",
          }} />
          <div style={titleStyle}>{spec.title}</div>
        </div>
      )}

      <ResponsiveContainer width="100%" height={spec.title ? 286 : 310}>
        {/* ==================== 折线图 ==================== */}
        {spec.type === "line" ? (
          <LineChart data={spec.data} margin={{ top: 14, right: 24, bottom: 10, left: 0 }}>
            <defs>
              {(spec.yKeys || ["value"]).map((key, i) => (
                <linearGradient key={`lineGrad-${i}`} id={`lineGrad-${i}-${spec.title}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={NEON_COLORS[i % NEON_COLORS.length]} stopOpacity={0.35} />
                  <stop offset="100%" stopColor={NEON_COLORS[i % NEON_COLORS.length]} stopOpacity={0.01} />
                </linearGradient>
              ))}
              {/* 发光滤镜 */}
              <filter id={`glow-${spec.title}`}>
                <feGaussianBlur stdDeviation="3" result="coloredBlur"/>
                <feMerge>
                  <feMergeNode in="coloredBlur"/>
                  <feMergeNode in="SourceGraphic"/>
                </feMerge>
              </filter>
            </defs>

            <CartesianGrid
              strokeDasharray="3 4"
              stroke="var(--viz-grid-stroke)"
            />

            <XAxis
              dataKey={spec.xKey || "name"}
              tick={axisStyle}
              axisLine={false}
              tickLine={false}
            />
            <YAxis tick={axisStyle} axisLine={false} tickLine={false} />

            <Tooltip content={<CustomTooltip />} cursor={{ strokeDasharray: "4 4", stroke: isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.1)" }} />

            <Legend
              wrapperStyle={{ fontSize: CHART_AXIS_FONT_SIZE, paddingTop: 14 }}
              iconType="circle"
              iconSize={8}
            />

            {(spec.yKeys || ["value"]).map((key, i) => (
              <Line
                key={key}
                type="monotone"
                dataKey={key}
                stroke={NEON_COLORS[i % NEON_COLORS.length]}
                strokeWidth={3}
                dot={(props: any) => {
                  const isActive = hoveredIndex === props.index || hoveredIndex === null;
                  const color = NEON_COLORS[i % NEON_COLORS.length];
                  // Recharts v3: custom dot must return a ReactNode, not an object of props
                  return (
                    <circle
                      cx={props.cx}
                      cy={props.cy}
                      r={isActive ? 5 : 2.5}
                      fill={color}
                      stroke={isDark ? "rgba(255,255,255,0.9)" : "#fff"}
                      strokeWidth={isActive ? 2 : 0}
                      opacity={isActive ? 1 : 0.5}
                      style={{ filter: "none" }}
                    />
                  );
                }}
                activeDot={{
                  r: 7,
                  fill: NEON_COLORS[i % NEON_COLORS.length],
                  strokeWidth: 2.5,
                  stroke: isDark ? "rgba(255,255,255,0.9)" : "#fff",
                  filter: "none",
                }}
                animationDuration={1200}
                animationEasing="ease-in-out"
              />
            ))}
          </LineChart>

        /* ==================== 面积图 ==================== */
        ) : spec.type === "area" ? (
          <AreaChart data={spec.data}>
            <defs>
              {(spec.yKeys || ["value"]).map((key, i) => (
                <linearGradient key={`areaGrad-${i}-${spec.title}`} id={`areaGrad-${i}-${spec.title}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={NEON_COLORS[i % NEON_COLORS.length]} stopOpacity={0.4} />
                  <stop offset="100%" stopColor={NEON_COLORS[i % NEON_COLORS.length]} stopOpacity={0.02} />
                </linearGradient>
              ))}
            </defs>

            <CartesianGrid
              strokeDasharray="3 4"
              stroke="var(--viz-grid-stroke)"
            />

            <XAxis
              dataKey={spec.xKey || "name"}
              tick={axisStyle}
              axisLine={false}
              tickLine={false}
            />
            <YAxis tick={axisStyle} axisLine={false} tickLine={false} />

            <Tooltip content={<CustomTooltip />} />

            <Legend
              wrapperStyle={{ fontSize: CHART_AXIS_FONT_SIZE, paddingTop: 14 }}
              iconType="circle"
              iconSize={8}
            />

            {(spec.yKeys || ["value"]).map((key, i) => (
              <Area
                key={key}
                type="monotone"
                dataKey={key}
                stroke={NEON_COLORS[i % NEON_COLORS.length]}
                strokeWidth={3}
                fill={`url(#areaGrad-${i}-${spec.title})`}
                animationDuration={1200}
                animationEasing="ease-in-out"
              />
            ))}
          </AreaChart>

        /* ==================== 饼图（环形） ==================== */
        ) : spec.type === "pie" ? (
          <PieChart>
            <Pie
              data={spec.data}
              dataKey={spec.valueKey || "value"}
              nameKey={spec.nameKey || "name"}
              cx="50%"
              cy="50%"
              innerRadius={60}
              outerRadius={95}
              paddingAngle={3}
              label={(props: PieLabelRenderProps) => {
                const percent = ((props.percent as number) ?? 0) * 100;
                const x = props.x ?? 0;
                const y = props.y ?? 0;
                return (
                  <text
                    x={x}
                    y={y}
                    textAnchor={props.textAnchor ?? "middle"}
                    dominantBaseline="central"
                    style={{
                      fontSize: CHART_AXIS_FONT_SIZE,
                      fill: isDark ? "#94A3B8" : "#94A3B8",
                      fontWeight: 600,
                      pointerEvents: "none",
                    }}
                  >
                    {`${percent.toFixed(2)}%`}
                  </text>
                );
              }}
              labelLine={{
                stroke: isDark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.12)",
                strokeWidth: 1,
              }}
              onMouseEnter={(_, index) => setHoveredIndex(index)}
              onMouseLeave={() => setHoveredIndex(null)}
            >
              {spec.data.map((_, i) => (
                <Cell
                  key={i}
                  fill={NEON_COLORS[i % NEON_COLORS.length]}
                  stroke={isDark ? "rgba(255,255,255,0.08)" : "none"}
                  strokeWidth={hoveredIndex === i ? 2 : 0}
                  style={{
                    filter:
                      hoveredIndex === i
                        ? "brightness(1.1)"
                        : "none",
                    transform: hoveredIndex === i ? "scale(1.04)" : "scale(1)",
                    transformOrigin: "center",
                    transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
                    cursor: "pointer",
                  }}
                />
              ))}
            </Pie>

            <Tooltip content={<CustomTooltip />} />

            <Legend
              wrapperStyle={{ fontSize: CHART_AXIS_FONT_SIZE, paddingTop: 18 }}
              iconType="circle"
              iconSize={8}
            />
          </PieChart>

        /* ==================== 雷达图 ==================== */
        ) : spec.type === "radar" ? (
          <RadarChart
            data={spec.data}
            cx="50%"
            cy="50%"
            outerRadius={78}
            startAngle={90}
            endAngle={-270}
          >
            <PolarGrid
              stroke={isDark ? "rgba(148, 163, 184, 0.15)" : "rgba(100, 116, 139, 0.2)"}
              gridType="polygon"
              strokeDasharray="3 3"
            />
            <PolarAngleAxis
              dataKey={spec.xKey || "subject"}
              tick={{ 
                ...axisStyle, 
                fontSize: 12,
                fontWeight: 600,
                fill: isDark ? '#f1f5f9' : '#1e293b'
              }}
              axisLine={false}
              tickLine={false}
            />
            <PolarRadiusAxis
              tick={{ 
                ...axisStyle, 
                fontSize: 10,
                fill: isDark ? 'rgba(148, 163, 184, 0.6)' : 'rgba(100, 116, 139, 0.7)'
              }}
              axisLine={false}
              tickLine={false}
            />

            {(spec.yKeys || ["value"]).map((key, i) => {
              const color = NEON_COLORS[i % NEON_COLORS.length];
              const isPrimary = i === 0;
              return (
                <Radar
                  key={key}
                  name={key}
                  dataKey={key}
                  stroke={color}
                  fill={color}
                  fillOpacity={isPrimary ? (isDark ? 0.25 : 0.2) : (isDark ? 0.15 : 0.1)}
                  strokeWidth={isPrimary ? 3.5 : 3}
                  strokeDasharray={isPrimary ? undefined : "5 5"}
                  dot={{
                    r: isPrimary ? 6 : 5,
                    fill: color,
                    stroke: isDark ? "rgba(255,255,255,0.95)" : "#fff",
                    strokeWidth: isPrimary ? 3 : 2,
                    filter: "none",
                  }}
                  animationDuration={1000}
                  animationEasing="ease-out"
                />
              );
            })}

            <Tooltip content={<CustomTooltip />} />

            <Legend 
              wrapperStyle={{ 
                fontSize: 12, 
                paddingTop: 16,
                fontWeight: 500
              }} 
            />
          </RadarChart>

        /* ==================== 柱状图 ==================== */
        ) : spec.type === "bar" ? (
          <BarChart data={spec.data} barCategoryGap="20%">
            <defs>
              {(spec.yKeys || ["value"]).map((key, i) => (
                <linearGradient key={`barGrad-${i}-${spec.title}`} id={`barGrad-${i}-${spec.title}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={NEON_COLORS[i % NEON_COLORS.length]} stopOpacity={1} />
                  <stop offset="100%" stopColor={NEON_COLORS[i % NEON_COLORS.length]} stopOpacity={0.65} />
                </linearGradient>
              ))}
            </defs>

            <CartesianGrid
              strokeDasharray="3 4"
              stroke="var(--viz-grid-stroke)"
              vertical={false}
            />

            <XAxis
              dataKey={spec.xKey || "name"}
              tick={axisStyle}
              axisLine={false}
              tickLine={false}
            />
            <YAxis tick={axisStyle} axisLine={false} tickLine={false} />

            <Tooltip
              content={<CustomTooltip />}
              cursor={{
                fill: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.05)",
                fillOpacity: isDark ? 0.35 : 0.25,
              }}
            />

            <Legend
              wrapperStyle={{ fontSize: CHART_AXIS_FONT_SIZE, paddingTop: 14 }}
              iconType="circle"
              iconSize={8}
            />

            {(spec.yKeys || ["value"]).map((key, i) => (
              <Bar
                key={key}
                dataKey={key}
                fill={`url(#barGrad-${i}-${spec.title})`}
                radius={[8, 8, 0, 0]}
                maxBarSize={52}
                onMouseEnter={(_, idx) => setHoveredIndex(idx)}
                onMouseLeave={() => setHoveredIndex(null)}
                style={{
                  filter: hoveredIndex !== null
                    ? "brightness(1.1)"
                    : "none",
                  transform: hoveredIndex !== null ? "scale(1.02)" : "scale(1)",
                  transformOrigin: "bottom center",
                  transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
                  cursor: "pointer",
                }}
              />
            ))}
          </BarChart>

        ) : (
          <div style={{
            color: "#94A3B8",
            textAlign: "center",
            paddingTop: 130,
            fontSize: 13,
            opacity: 0.6,
          }}>
            不支持的图表类型
          </div>
        )}
      </ResponsiveContainer>
    </div>
  );
};

export const MessageWithCharts: React.FC<{ content: string }> = ({ content }) => {
  const { textParts, charts } = parseChartBlocks(content);
  if (charts.length === 0) {
    return <>{content}</>;
  }
  return (
    <>
      {textParts.map((part, i) => (
        <React.Fragment key={i}>
          {part}
          {i < charts.length && charts[i] && <ChartRenderer spec={charts[i]!} />}
        </React.Fragment>
      ))}
    </>
  );
};
