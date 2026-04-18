import React, { useState, useMemo, useCallback, createContext, useContext, useRef, useEffect } from 'react';
import type { VisualizationWidget } from '../../shared/business.js';
import { ChartInsight, generateRadarInsight, generateBoxPlotInsight, generateTrendInsight, generateHeatmapInsight, generateSankeyInsight } from '../utils/chart-insights.js';

type VisualizationInsight = {
  title: string;
  summary: string;
  source: string;
};

interface ChartInteractionContextType {
  activeElement: string | null;
  setActiveElement: (id: string | null, data?: any) => void;
  hoveredElement: string | null;
  setHoveredElement: (id: string | null) => void;
  highlightElements: string[];
  setHighlightElements: (ids: string[]) => void;
}

export const ChartInteractionContext = createContext<ChartInteractionContextType>({
  activeElement: null,
  setActiveElement: () => {},
  hoveredElement: null,
  setHoveredElement: () => {},
  highlightElements: [],
  setHighlightElements: () => {},
});

export function useChartInteraction() {
  return useContext(ChartInteractionContext);
}

interface ChartWithInsightPanelProps {
  widget: VisualizationWidget;
  children: React.ReactNode;
  selectedInsight: VisualizationInsight | null;
  onInsightChange: (insight: VisualizationInsight | null) => void;
}

export function ChartWithInsightPanel({ widget, children, selectedInsight, onInsightChange }: ChartWithInsightPanelProps) {
  const [activeDataPoint, setActiveDataPoint] = useState<string | null>(null);
  const [hoveredElement, setHoveredElement] = useState<string | null>(null);
  const [highlightElements, setHighlightElements] = useState<string[]>([]);
  const [isAnimating, setIsAnimating] = useState(false);
  const prevInsightRef = useRef<ChartInsight | null>(null);

  const insight = useMemo(() => {
    return generateInsightForWidget(widget, selectedInsight, activeDataPoint);
  }, [widget, selectedInsight, activeDataPoint]);

  useEffect(() => {
    if (prevInsightRef.current?.title !== insight.title) {
      setIsAnimating(true);
      const timer = setTimeout(() => setIsAnimating(false), 300);
      return () => clearTimeout(timer);
    }
    prevInsightRef.current = insight;
  }, [insight]);

  const handleSetActiveElement = useCallback((id: string | null, data?: any) => {
    setActiveDataPoint(id);
    if (id && data) {
      onInsightChange({
        title: data.label || data.title || id,
        summary: data.summary || data.detail || '',
        source: widget.title,
      });
    } else if (id === null) {
      onInsightChange(null);
    }
  }, [widget.title, onInsightChange]);

  const handleMetricClick = useCallback((label: string, data?: any) => {
    setActiveDataPoint(label);
    setHighlightElements([label]);
    setTimeout(() => setHighlightElements([]), 2000);
    if (data) {
      onInsightChange({
        title: label,
        summary: data.value?.toString() || '',
        source: widget.title,
      });
    }
  }, [widget.title, onInsightChange]);

  const contextValue = useMemo(() => ({
    activeElement: activeDataPoint,
    setActiveElement: handleSetActiveElement,
    hoveredElement,
    setHoveredElement,
    highlightElements,
    setHighlightElements,
  }), [activeDataPoint, handleSetActiveElement, hoveredElement, highlightElements]);

  return (
    <ChartInteractionContext.Provider value={contextValue}>
      <div className="chart-with-insight-panel">
        <div className="chart-insight-left">
          <div 
            className="chart-container-interactive"
            onMouseLeave={() => setHoveredElement(null)}
          >
            {children}
          </div>
        </div>
        <div className="chart-insight-right">
          <InsightDisplay 
            insight={insight} 
            activeElement={hoveredElement || activeDataPoint}
            onMetricClick={handleMetricClick}
            isAnimating={isAnimating}
            highlightElements={highlightElements}
          />
        </div>
      </div>
    </ChartInteractionContext.Provider>
  );
}

function generateInsightForWidget(
  widget: VisualizationWidget, 
  selectedInsight: VisualizationInsight | null,
  activeDataPoint: string | null
): ChartInsight {
  const baseInsight: ChartInsight = {
    title: widget.title,
    summary: '请点击或悬停图表元素查看详细分析',
    analysis: '',
    model: '',
    recommendation: '',
    riskLevel: 'medium',
  };

  try {
    switch (widget.kind) {
      case 'radarChart':
        return generateRadarInsight({
          dimensions: (widget as any).dimensions.map((d: any) => ({
            name: d.dimension,
            current: d.current,
            baseline: d.baseline,
          })),
          title: widget.title,
        });

      case 'boxPlotChart':
        return generateBoxPlotInsight({
          groups: (widget as any).groups.map((g: any) => ({
            label: g.label,
            median: g.median,
            q1: g.q1,
            q3: g.q3,
            status: g.status,
          })),
          title: widget.title,
        });

      case 'lineChart':
        return generateTrendInsight({
          points: (widget as any).data.map((d: any) => ({
            label: d.label,
            value: d.value,
            displayValue: d.displayValue || String(d.value),
          })),
          title: widget.title,
          trend: calculateTrend((widget as any).data.map((d: any) => d.value)),
        });

      case 'barChart':
        return generateTrendInsight({
          points: (widget as any).data.map((d: any) => ({
            label: d.label,
            value: d.value,
            displayValue: d.displayValue || String(d.value),
          })),
          title: widget.title,
          trend: 'stable',
        });

      case 'heatmapChart':
        return generateHeatmapInsight({
          rows: (widget as any).rows,
          cols: (widget as any).columns,
          cells: (widget as any).cells.map((c: any) => ({
            row: c.row,
            col: c.column,
            value: c.value,
            status: c.status || 'neutral',
          })),
          title: widget.title,
        });

      case 'sankeyChart':
        return generateSankeyInsight({
          nodes: widget.nodes,
          links: widget.links,
          title: widget.title,
        });

      case 'bubbleChart':
      case 'scatterChart':
        return {
          ...baseInsight,
          summary: `${widget.data.length}个数据点，展示${widget.xLabel}与${widget.yLabel}的关系`,
          analysis: `散点图展示${widget.xLabel}与${widget.yLabel}之间的相关性分析。每个点代表一个数据样本，位置反映其特征值，颜色表示状态。`,
          model: '相关性分析模型',
          recommendation: '建议关注偏离趋势线的异常点，分析其形成原因。',
        };

      case 'waterfallChart':
        return {
          ...baseInsight,
          summary: `瀑布图展示各因素对总指标的贡献`,
          analysis: `瀑布图清晰展示了各因素的正负贡献，帮助识别关键驱动因素和拖累因素。`,
          model: '因素分解模型',
          recommendation: '建议重点关注贡献度最大的正向和负向因素。',
        };

      default:
        return baseInsight;
    }
  } catch (error) {
    console.error('Error generating insight:', error);
    return baseInsight;
  }
}

function calculateTrend(values: number[]): 'up' | 'down' | 'stable' {
  if (values.length < 2) return 'stable';
  const first = values[0] ?? 0;
  const last = values[values.length - 1] ?? 0;
  const change = (last - first) / Math.abs(first || 1);
  if (change > 0.05) return 'up';
  if (change < -0.05) return 'down';
  return 'stable';
}

interface InsightDisplayProps {
  insight: ChartInsight;
  activeElement: string | null;
  onMetricClick: (label: string, data?: any) => void;
  isAnimating: boolean;
  highlightElements: string[];
}

function InsightDisplay({ insight, activeElement, onMetricClick, isAnimating, highlightElements }: InsightDisplayProps) {
  const riskColors = {
    low: '#10B981',
    medium: '#F59E0B',
    high: '#EF4444',
  };

  const riskLabels = {
    low: '低风险',
    medium: '中等风险',
    high: '高风险',
  };

  const trendIcons = {
    up: '↑',
    down: '↓',
    stable: '→',
  };

  return (
    <div className={`insight-display ${isAnimating ? 'insight-animating' : ''}`}>
      <div className="insight-header">
        <h3 className="insight-title">{insight.title}</h3>
        <div 
          className="insight-risk-badge"
          style={{ backgroundColor: riskColors[insight.riskLevel as keyof typeof riskColors] || riskColors.medium }}
        >
          {riskLabels[insight.riskLevel as keyof typeof riskLabels] || riskLabels.medium}
        </div>
      </div>

      <div className="insight-summary">
        <div className="insight-summary-icon">💡</div>
        <div className="insight-summary-text">{insight.summary}</div>
      </div>

      {insight.model && (
        <div className="insight-model">
          <span className="insight-model-label">分析模型：</span>
          <span className="insight-model-name">{insight.model}</span>
        </div>
      )}

      {insight.analysis && (
        <div className="insight-analysis">
          <div className="insight-section-title">📊 详细分析</div>
          <div className="insight-analysis-content">
            {insight.analysis.split('\n').map((line: string, i: number) => (
              <p key={i}>{line}</p>
            ))}
          </div>
        </div>
      )}

      {insight.metrics && insight.metrics.length > 0 && (
        <div className="insight-metrics">
          <div className="insight-section-title">📈 关键指标</div>
          <div className="insight-metrics-grid">
            {insight.metrics.map((metric: { label: string; value: string | number; status?: string; trend?: string }, index: number) => {
              const isHighlighted = highlightElements.includes(metric.label);
              return (
                <div 
                  key={index} 
                  className={`insight-metric-card ${metric.status || ''} ${isHighlighted ? 'highlighted' : ''}`}
                  onClick={() => onMetricClick(metric.label, metric)}
                >
                  <div className="metric-header">
                    <span className="metric-label">{metric.label}</span>
                    {metric.trend && (
                      <span className={`metric-trend trend-${metric.trend}`}>
                        {trendIcons[metric.trend as keyof typeof trendIcons] || '→'}
                      </span>
                    )}
                  </div>
                  <div className="metric-value">{metric.value}</div>
                  {isHighlighted && <div className="metric-pulse-ring" />}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {insight.recommendation && (
        <div className="insight-recommendation">
          <div className="insight-section-title">💡 建议</div>
          <div className="insight-recommendation-content">
            {insight.recommendation}
          </div>
        </div>
      )}

      {activeElement && (
        <div className="insight-active-element">
          <span className="active-indicator" />
          <span className="active-label">当前选中：</span>
          <span className="active-value">{activeElement}</span>
        </div>
      )}
    </div>
  );
}

export default ChartWithInsightPanel;
