/* eslint-disable react-refresh/only-export-components */
/**
 * DQI & GMPS 结果展示面板组件
 *
 * 本模块提供用于展示数学模型诊断结果的可视化组件：
 * - DQIResultPanel: 经营质量动态评价指数面板
 * - GMPSResultPanel: 毛利承压评估预测模型面板
 * - ModelParameterConfig: 模型参数配置界面（可选）
 *
 * 设计原则：
 * 1. 采用玻璃态(Glassmorphism)设计，与现有UI一致
 * 2. 使用React.memo优化性能
 * 3. 完整的TypeScript类型定义
 * 4. 支持暗色/亮色主题
 * 5. 响应式布局
 *
 * @module dqi-gmps-panels
 */

import React, { memo, useMemo, useState, useCallback } from 'react';
import {
  extractDQIResult,
  extractGMPSResult,
} from './chart-data.js';
import type { MathAnalysisOutput } from '../shared/agents.js';

// ==================== 类型定义 ====================

/** DQI数据接口 */
export interface DQIData {
  dqi: number;
  status: "改善" | "稳定" | "恶化";
  driver: "盈利能力" | "成长能力" | "现金流质量" | "资产周转效率" | "研发投入强度" | "库存周转效率" | "无明显驱动";
  decomposition: {
    profitabilityContribution: number;
    growthContribution: number;
    cashflowContribution: number;
    assetTurnoverContribution: number;
    rdIntensityContribution: number;
    inventoryTurnoverContribution: number;
  };
  metrics: {
    currentROE: number;
    baselineROE: number;
    roeRatio: number;
    currentGrowth: number;
    baselineGrowth: number;
    growthRatio: number;
    currentOCFRatio: number;
    baselineOCFRatio: number;
    ocfRatioChange: number;
    currentAssetTurnover: number;
    baselineAssetTurnover: number;
    currentRdRatio: number;
    baselineRdRatio: number;
    currentInventoryDays: number;
    baselineInventoryDays: number;
  };
  trend: string;
  confidence: number;
}

/** GMPS数据接口 */
export interface GMPSData {
  gmps: number;
  level: "低压" | "中压" | "高压";
  probabilityNextQuarter: number;
  riskLevel: "低风险" | "中风险" | "高风险";
  dimensionScores: {
    A_毛利率结果: number;
    B_材料成本冲击: number;
    C_产销负荷: number;
    D_外部风险: number;
    E_现金流安全: number;
  };
  featureScores: Record<string, number>;
  keyFindings: string[];
  industrySegment?: "powerBattery" | "energyStorage" | "consumerBattery";
  industryWeights?: Record<string, number>;
  dataProvenance?: {
    estimatedFields: string[];
    estimationMethod: string;
  };
}

/** DQI面板属性 */
export interface DQIResultPanelProps {
  /** DQI数据对象 */
  dqiData: DQIData | null;
  /** 是否正在加载 */
  isLoading?: boolean;
  /** 自定义类名 */
  className?: string;
  /** 是否显示详细信息（默认true） */
  showDetails?: boolean;
}

/** GMPS面板属性 */
export interface GMPSResultPanelProps {
  /** GMPS数据对象 */
  gmpsData: GMPSData | null;
  /** 是否正在加载 */
  isLoading?: boolean;
  /** 自定义类名 */
  className?: string;
  /** 是否显示详细信息（默认true） */
  showDetails?: boolean;
}

/** 模型参数配置属性 */
export interface ModelParameterConfigProps {
  /** DQI权重配置 */
  dqiWeights?: { w1: number; w2: number; w3: number; w4: number; w5: number; w6: number };
  /** GMPS权重配置 */
  gmpsWeights?: Record<string, number>;
  /** DQI权重变更回调 */
  onDQIWeightChange?: (key: string, value: number) => void;
  /** GMPS权重变更回调 */
  onGMPSWeightChange?: (key: string, value: number) => void;
  /** 自定义类名 */
  className?: string;
}

/** 联合面板容器属性 */
export interface DQIGMPSPanelsContainerProps {
  mathAnalysisOutput: MathAnalysisOutput | null;
  isLoading?: boolean;
  className?: string;
  displayMode?: 'grid' | 'stacked' | 'tabs';
  isDark?: boolean;
  chartThemeKey?: number;
}

// ==================== 样式常量 ====================

const STATUS_COLORS = {
  改善: '#10B981',
  稳定: '#3B82F6',
  恶化: '#EF4444',
} as const;

const LEVEL_COLORS = {
  低压: '#10B981',
  中压: '#F59E0B',
  高压: '#EF4444',
} as const;

const RISK_COLORS = {
  低风险: '#10B981',
  中风险: '#F59E0B',
  高风险: '#EF4444',
} as const;

const DQI_PRESETS = {
  conservative: { label: '保守', dqi: { w1: 0.30, w2: 0.20, w3: 0.20, w4: 0.15, w5: 0.08, w6: 0.07 } },
  neutral: { label: '中性', dqi: { w1: 0.25, w2: 0.20, w3: 0.20, w4: 0.15, w5: 0.10, w6: 0.10 } },
  aggressive: { label: '激进', dqi: { w1: 0.20, w2: 0.25, w3: 0.15, w4: 0.15, w5: 0.15, w6: 0.10 } },
} as const;

// ==================== 辅助组件 ====================

/** 加载状态指示器 */
const LoadingSpinner: React.FC<{ message?: string }> = memo(({ message = '计算中...' }) => (
  <div className="dqi-gmps-loading" role="status" aria-label="加载中">
    <div className="dqi-gmps-loading-spinner"></div>
    <span className="dqi-gmps-loading-text">{message}</span>
  </div>
));

LoadingSpinner.displayName = 'LoadingSpinner';

/** 空状态提示 */
const EmptyState: React.FC<{ message: string; icon?: string }> = memo(({ message, icon = '📊' }) => (
  <div className="dqi-gmps-empty" role="status">
    <span className="dqi-gmps-empty-icon">{icon}</span>
    <p className="dqi-gmps-empty-message">{message}</p>
  </div>
));

EmptyState.displayName = 'EmptyState';

/** 状态徽章组件 */
const StatusBadge: React.FC<{
  status: string;
  color: string;
}> = memo(({ status, color }) => (
  <span
    className="dqi-gmps-badge"
    style={{
      backgroundColor: `${color}20`,
      color: color,
      borderColor: `${color}40`,
    }}
    role="status"
    aria-label={`状态: ${status}`}
  >
    {getStatusIcon(status)} {status}
  </span>
));

StatusBadge.displayName = 'StatusBadge';

function getStatusIcon(status: string): string {
  switch (status) {
    case '改善':
    case '低压':
    case '低风险':
      return '✓';
    case '稳定':
    case '中压':
    case '中风险':
      return '○';
    case '恶化':
    case '高压':
    case '高风险':
      return '✗';
    default:
      return '•';
  }
}

/** 进度条组件 */
const ProgressBar: React.FC<{
  value: number;
  max?: number;
  label?: string;
  color?: string;
  showValue?: boolean;
}> = memo(({ value, max = 100, label, color = '#3B82F6', showValue = true }) => {
  const percentage = Math.min((value / max) * 100, 100);

  return (
    <div className="dqi-gmps-progress-bar-container">
      {label && <span className="dqi-gmps-progress-label">{label}</span>}
      <div
        className="dqi-gmps-progress-bar"
        role="progressbar"
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-label={label ?? `进度: ${percentage.toFixed(2)}%`}
      >
        <div
          className="dqi-gmps-progress-fill"
          style={{ width: `${percentage}%`, backgroundColor: color }}
        />
        {showValue && (
          <span className="dqi-gmps-progress-value">{value.toFixed(2)}</span>
        )}
      </div>
    </div>
  );
});

ProgressBar.displayName = 'ProgressBar';

/** 置信度指示器 */
const ConfidenceIndicator: React.FC<{ confidence: number }> = memo(({ confidence }) => {
  const percentage = confidence * 100;
  const color = confidence >= 0.85 ? '#10B981' : confidence >= 0.7 ? '#F59E0B' : '#EF4444';
  const label = confidence >= 0.85 ? '高置信' : confidence >= 0.7 ? '中置信' : '低置信';

  const isDark = typeof document !== 'undefined' && (document.documentElement.classList.contains('theme-dark') || !document.documentElement.classList.contains('theme-light'));
  const ringBgColor = isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)';

  return (
    <div className="dqi-gmps-confidence" title={`置信度: ${percentage.toFixed(2)}%`}>
      <svg viewBox="0 0 36 36" className="dqi-gmps-confidence-ring">
        <path
          className="dqi-gmps-confidence-ring-bg"
          d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
          fill="none"
          stroke={ringBgColor}
          strokeWidth="2"
        />
        <path
          className="dqi-gmps-confidence-ring-fill"
          d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
          fill="none"
          stroke={color}
          strokeWidth="2"
          strokeDasharray={`${percentage}, 100`}
          strokeLinecap="round"
        />
      </svg>
      <span className="dqi-gmps-confidence-value" style={{ color }}>{label}</span>
    </div>
  );
});

ConfidenceIndicator.displayName = 'ConfidenceIndicator';

/** 关键发现列表项 */
const FindingItem: React.FC<{ text: string }> = memo(({ text }) => {
  const getIcon = (text: string): string => {
    if (text.includes('风险') || text.includes('警告') || text.includes('注意')) return '⚠️';
    if (text.includes('良好') || text.includes('改善') || text.includes('优势')) return '✓';
    return 'ℹ️';
  };

  return (
    <li className="dqi-gmps-finding-item">
      <span className="dqi-gmps-finding-icon" aria-hidden="true">{getIcon(text)}</span>
      <span className="dqi-gmps-finding-text">{text}</span>
    </li>
  );
});

FindingItem.displayName = 'FindingItem';

/** 维度得分展示组件 */
const DimensionScoreBar: React.FC<{
  label: string;
  score: number;
  color?: string;
}> = memo(({ label, score, color = '#3B82F6' }) => {
  const normalizedScore = Math.min(Math.max(score, 0), 100);

  return (
    <div className="dqi-gmps-dimension-item">
      <div className="dqi-gmps-dimension-label">
        <span>{label.replace(/^[A-E]_/, '')}</span>
        <span className="dqi-gmps-dimension-score" style={{ color }}>{normalizedScore.toFixed(2)}</span>
      </div>
      <div className="dqi-gmps-dimension-bar-bg">
        <div
          className="dqi-gmps-dimension-bar-fill"
          style={{
            width: `${normalizedScore}%`,
            backgroundColor: color,
          }}
        />
      </div>
    </div>
  );
});

DimensionScoreBar.displayName = 'DimensionScoreBar';

// ==================== 主组件 ====================

/**
 * DQI 经营质量动态评价指数面板
 *
 * 展示DQI模型的完整输出结果，包括：
 * - 大号DQI数值显示
 * - 状态徽章（改善/稳定/恶化）
 * - 驱动因素标签
 * - 三维分解贡献度可视化
 * - 趋势描述文本
 * - 置信度指示器
 *
 * @example
 * ```tsx
 * <DQIResultPanel
 *   dqiData={extractDQIResult(mathAnalysis)}
 *   isLoading={isAnalyzing}
 * />
 * ```
 */
export const DQIResultPanel: React.FC<DQIResultPanelProps> = memo(({
  dqiData,
  isLoading = false,
  className = '',
  showDetails = true,
}) => {
  // 加载状态
  if (isLoading) {
    return (
      <div className={`dqi-gmps-panel dqi-panel ${className}`} aria-busy="true">
        <div className="dqi-gmps-panel-header">
          <h3 className="dqi-gmps-panel-title">经营质量动态评价指数</h3>
        </div>
        <LoadingSpinner message="正在计算DQI..." />
      </div>
    );
  }

  // 空状态
  if (!dqiData) {
    return (
      <div className={`dqi-gmps-panel dqi-panel ${className}`}>
        <div className="dqi-gmps-panel-header">
          <h3 className="dqi-gmps-panel-title">经营质量动态评价指数</h3>
        </div>
        <EmptyState message="暂无DQI数据，请先执行诊断分析" />
      </div>
    );
  }

  const statusColor = STATUS_COLORS[dqiData.status];

  return (
    <div className={`dqi-gmps-panel dqi-panel ${className}`} role="region" aria-label="DQI结果面板">
      {/* 面板头部 */}
      <div className="dqi-gmps-panel-header">
        <h3 className="dqi-gmps-panel-title">经营质量动态评价指数 (DQI)</h3>
        <StatusBadge status={dqiData.status} color={statusColor} />
      </div>

      {/* 主要数值区域 */}
      <div className="dqi-gmps-main-value-section">
        <div className="dqi-gmps-value-display">
          <span
            className="dqi-gmps-value-number"
            style={{ color: statusColor }}
            aria-label={`DQI值: ${dqiData.dqi.toFixed(2)}`}
          >
            {dqiData.dqi.toFixed(2)}
          </span>
          <span className="dqi-gmps-value-unit">DQI</span>
        </div>

        <div className="dqi-gmps-meta-info">
          <ConfidenceIndicator confidence={dqiData.confidence} />
          <div className="dqi-gmps-driver-tag">
            <span className="dqi-gmps-driver-label">主要驱动因素：</span>
            <span className="dqi-gmps-driver-value">{dqiData.driver}</span>
          </div>
        </div>
      </div>

      {/* 详细信息区域 */}
      {showDetails && (
        <>
          {/* 六维分解贡献度 */}
          <div className="dqi-gmps-decomposition-section">
            <h4 className="dqi-gmps-section-title">六维分解贡献度</h4>
            <div className="dqi-gmps-decomposition-bars">
              <ProgressBar
                label="盈利能力"
                value={Math.abs(dqiData.decomposition.profitabilityContribution) * 100}
                max={100}
                color="#3B82F6"
              />
              <ProgressBar
                label="成长能力"
                value={Math.abs(dqiData.decomposition.growthContribution) * 100}
                max={100}
                color="#8B5CF6"
              />
              <ProgressBar
                label="现金流质量"
                value={Math.abs(dqiData.decomposition.cashflowContribution) * 100}
                max={100}
                color="#06B6D4"
              />
              <ProgressBar
                label="资产周转效率"
                value={Math.abs(dqiData.decomposition.assetTurnoverContribution) * 100}
                max={100}
                color="#F59E0B"
              />
              <ProgressBar
                label="研发投入强度"
                value={Math.abs(dqiData.decomposition.rdIntensityContribution) * 100}
                max={100}
                color="#10B981"
              />
              <ProgressBar
                label="库存周转效率"
                value={Math.abs(dqiData.decomposition.inventoryTurnoverContribution) * 100}
                max={100}
                color="#EF4444"
              />
            </div>
          </div>

          {/* 趋势描述 */}
          {dqiData.trend && (
            <div className="dqi-gmps-trend-section">
              <h4 className="dqi-gmps-section-title">趋势分析</h4>
              <p className="dqi-gmps-trend-text">{dqiData.trend}</p>
            </div>
          )}

          {/* 核心指标详情 */}
          <div className="dqi-gmps-metrics-grid">
            <div className="dqi-gmps-metric-card">
              <span className="dqi-gmps-metric-label">ROE比率</span>
              <span className="dqi-gmps-metric-value">{dqiData.metrics.roeRatio.toFixed(2)}</span>
            </div>
            <div className="dqi-gmps-metric-card">
              <span className="dqi-gmps-metric-label">成长率比率</span>
              <span className="dqi-gmps-metric-value">{dqiData.metrics.growthRatio.toFixed(2)}</span>
            </div>
            <div className="dqi-gmps-metric-card">
              <span className="dqi-gmps-metric-label">OCF比率变化</span>
              <span className="dqi-gmps-metric-value">{dqiData.metrics.ocfRatioChange.toFixed(2)}</span>
            </div>
            <div className="dqi-gmps-metric-card">
              <span className="dqi-gmps-metric-label">资产周转率(当期)</span>
              <span className="dqi-gmps-metric-value">{dqiData.metrics.currentAssetTurnover.toFixed(4)}</span>
            </div>
            <div className="dqi-gmps-metric-card">
              <span className="dqi-gmps-metric-label">研发投入比(估算)</span>
              <span className="dqi-gmps-metric-value">{(dqiData.metrics.currentRdRatio * 100).toFixed(2)}%</span>
            </div>
            <div className="dqi-gmps-metric-card">
              <span className="dqi-gmps-metric-label">库存周转天数</span>
              <span className="dqi-gmps-metric-value">{dqiData.metrics.currentInventoryDays.toFixed(2)}天</span>
            </div>
          </div>
        </>
      )}
    </div>
  );
});

DQIResultPanel.displayName = 'DQIResultPanel';

/**
 * GMPS 毛利承压评估预测模型面板
 *
 * 展示GMPS模型的完整输出结果，包括：
 * - GMPS数值和等级显示
 * - 五维度评分可视化
 * - 风险概率指示器
 * - 关键发现列表
 *
 * @example
 * ```tsx
 * <GMPSResultPanel
 *   gmpsData={extractGMPSResult(mathAnalysis)}
 *   isLoading={isAnalyzing}
 * />
 * ```
 */
export const GMPSResultPanel: React.FC<GMPSResultPanelProps> = memo(({
  gmpsData,
  isLoading = false,
  className = '',
  showDetails = true,
}) => {
  // 加载状态
  if (isLoading) {
    return (
      <div className={`dqi-gmps-panel gmps-panel ${className}`} aria-busy="true">
        <div className="dqi-gmps-panel-header">
          <h3 className="dqi-gmps-panel-title">毛利承压评估预测模型</h3>
        </div>
        <LoadingSpinner message="正在计算GMPS..." />
      </div>
    );
  }

  // 空状态
  if (!gmpsData) {
    return (
      <div className={`dqi-gmps-panel gmps-panel ${className}`}>
        <div className="dqi-gmps-panel-header">
          <h3 className="dqi-gmps-panel-title">毛利承压评估预测模型</h3>
        </div>
        <EmptyState message="暂无GMPS数据，请先执行诊断分析" />
      </div>
    );
  }

  const levelColor = LEVEL_COLORS[gmpsData.level];
  const riskColor = RISK_COLORS[gmpsData.riskLevel];

  return (
    <div className={`dqi-gmps-panel gmps-panel ${className}`} role="region" aria-label="GMPS结果面板">
      {/* 面板头部 */}
      <div className="dqi-gmps-panel-header">
        <h3 className="dqi-gmps-panel-title">毛利承压评估预测模型 (GMPS)</h3>
        <div className="dqi-gmps-panel-badges">
          <StatusBadge status={gmpsData.level} color={levelColor} />
          <StatusBadge status={gmpsData.riskLevel} color={riskColor} />
          {gmpsData.industrySegment && (
            <span
              className="dqi-gmps-badge"
              style={{
                backgroundColor: 'rgba(99,102,241,0.15)',
                color: '#6366F1',
                borderColor: 'rgba(99,102,241,0.3)',
              }}
            >
              {gmpsData.industrySegment === 'powerBattery' ? '动力电池' : gmpsData.industrySegment === 'energyStorage' ? '储能电池' : '消费电池'}
            </span>
          )}
        </div>
      </div>

      {/* 主要数值区域 */}
      <div className="dqi-gmps-main-value-section gmps-value-layout">
        <div className="dqi-gmps-value-display">
          <span
            className="dqi-gmps-value-number"
            style={{ color: levelColor }}
            aria-label={`GMPS值: ${gmpsData.gmps.toFixed(2)}`}
          >
            {gmpsData.gmps.toFixed(2)}
          </span>
          <span className="dqi-gmps-value-unit">GMPS</span>
        </div>

        {/* 风险概率指示器 */}
        <div className="dqi-gmps-probability-indicator">
          <div
            className="dqi-gmps-probability-circle"
            style={{ borderColor: riskColor }}
            role="progressbar"
            aria-valuenow={gmpsData.probabilityNextQuarter}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`下季度恶化概率: ${gmpsData.probabilityNextQuarter.toFixed(2)}%`}
          >
            <span className="dqi-gmps-probability-value" style={{ color: riskColor }}>
              {gmpsData.probabilityNextQuarter.toFixed(2)}%
            </span>
          </div>
          <span className="dqi-gmps-probability-label">下季度恶化概率</span>
        </div>
      </div>

      {/* 详细信息区域 */}
      {showDetails && (
        <>
          {/* 五维度评分 */}
          <div className="dqi-gmps-dimensions-section">
            <h4 className="dqi-gmps-section-title">五维度评分</h4>
            <div className="dqi-gmps-dimensions-list">
              {Object.entries(gmpsData.dimensionScores).map(([key, score]) => (
                <DimensionScoreBar
                  key={key}
                  label={key}
                  score={score}
                  color={
                    score >= 70 ? '#10B981' :
                    score >= 40 ? '#F59E0B' :
                    '#EF4444'
                  }
                />
              ))}
            </div>
          </div>

          {/* 行业细分权重 */}
          {gmpsData.industryWeights && Object.keys(gmpsData.industryWeights).length > 0 && (
            <div className="dqi-gmps-weights-section" style={{ marginTop: 12, padding: '8px 12px', borderRadius: 6, fontSize: 12, lineHeight: 1.8, background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.2)' }}>
              <div style={{ fontWeight: 600, marginBottom: 4, color: '#6366F1' }}>
                行业细分权重配置
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 12px' }}>
                {Object.entries(gmpsData.industryWeights).map(([key, weight]) => (
                  <span key={key} style={{ color: '#374151' }}>
                    {key.replace(/^[A-E]_/, '')}: {(weight * 100).toFixed(0)}%
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* 关键发现列表 */}
          {gmpsData.keyFindings && gmpsData.keyFindings.length > 0 && (
            <div className="dqi-gmps-findings-section">
              <h4 className="dqi-gmps-section-title">关键发现</h4>
              <ul className="dqi-gmps-findings-list" role="list" aria-label="关键发现列表">
                {gmpsData.keyFindings.map((finding, index) => (
                  <FindingItem key={`finding-${index}`} text={finding} />
                ))}
              </ul>
            </div>
          )}

          {/* 特征得分摘要 */}
          {gmpsData.featureScores && Object.keys(gmpsData.featureScores).length > 0 && (
            <div className="dqi-gmps-features-summary">
              <h4 className="dqi-gmps-section-title">特征变量概览</h4>
              <p className="dqi-gmps-features-count">
                共 <strong>{Object.keys(gmpsData.featureScores).length}</strong> 个特征变量参与评估，
                最高分: <strong>{Math.max(...Object.values(gmpsData.featureScores)).toFixed(2)}</strong>，
                最低分: <strong>{Math.min(...Object.values(gmpsData.featureScores)).toFixed(2)}</strong>
              </p>
            </div>
          )}

          {gmpsData.dataProvenance && (
            <div className="dqi-gmps-data-provenance" style={{ marginTop: 12, padding: '8px 12px', borderRadius: 6, fontSize: 12, lineHeight: 1.6, background: gmpsData.dataProvenance.estimatedFields.some(f => f === 'currentLithiumPrice' || f === 'industryVolatility') ? '#FEF3C7' : '#F0FDF4', border: gmpsData.dataProvenance.estimatedFields.some(f => f === 'currentLithiumPrice' || f === 'industryVolatility') ? '1px solid #F59E0B' : '1px solid #86EFAC' }}>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>
                {gmpsData.dataProvenance.estimatedFields.some(f => f === 'currentLithiumPrice' || f === 'industryVolatility') ? '⚠️ 部分数据使用默认值' : '✅ 数据来源'}
              </div>
              <div style={{ color: '#374151' }}>{gmpsData.dataProvenance.estimationMethod}</div>
              {gmpsData.dataProvenance.estimatedFields.some(f => f === 'currentLithiumPrice' || f === 'industryVolatility') && (
                <div style={{ color: '#92400E', marginTop: 4 }}>建议配置数据源或触发数据采集以获取真实行业数据</div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
});

GMPSResultPanel.displayName = 'GMPSResultPanel';

/**
 * 模型参数配置组件（可选增强功能）
 *
 * 提供交互式界面调整DQI和GMPS模型的权重参数。
 * 包含预设方案和自定义调整功能。
 *
 * @example
 * ```tsx
 * <ModelParameterConfig
 *   dqiWeights={{ w1: 0.4, w2: 0.35, w3: 0.25 }}
 *   onDQIWeightChange={(key, value) => updateWeights(key, value)}
 * />
 * ```
 */
export const ModelParameterConfig: React.FC<ModelParameterConfigProps> = memo(({
  dqiWeights = { w1: 0.25, w2: 0.20, w3: 0.20, w4: 0.15, w5: 0.10, w6: 0.10 },
  gmpsWeights,
  onDQIWeightChange,
  onGMPSWeightChange,
  className = '',
}) => {
  const [activeTab, setActiveTab] = useState<'dqi' | 'gmps'>('dqi');
  const [isExpanded, setIsExpanded] = useState(false);

  const handlePresetSelect = useCallback((presetKey: 'conservative' | 'neutral' | 'aggressive') => {
    if (onDQIWeightChange) {
      const preset = DQI_PRESETS[presetKey].dqi;
      Object.entries(preset).forEach(([key, value]) => {
        onDQIWeightChange(key, value);
      });
    }
  }, [onDQIWeightChange]);

  return (
    <div className={`dqi-gmps-config ${className}`}>
      <button
        className="dqi-gmps-config-toggle"
        onClick={() => setIsExpanded(!isExpanded)}
        aria-expanded={isExpanded}
        aria-controls="dqi-gmps-config-content"
      >
        <span>⚙️ 模型参数配置</span>
        <span className={`dqi-gmps-config-arrow ${isExpanded ? 'expanded' : ''}`}>▼</span>
      </button>

      {isExpanded && (
        <div id="dqi-gmps-config-content" className="dqi-gmps-config-content">
          {/* Tab切换 */}
          <div className="dqi-gmps-config-tabs" role="tablist">
            <button
              role="tab"
              aria-selected={activeTab === 'dqi'}
              onClick={() => setActiveTab('dqi')}
              className={activeTab === 'dqi' ? 'active' : ''}
            >
              DQI权重
            </button>
            <button
              role="tab"
              aria-selected={activeTab === 'gmps'}
              onClick={() => setActiveTab('gmps')}
              className={activeTab === 'gmps' ? 'active' : ''}
            >
              GMPS权重
            </button>
          </div>

          {/* DQI权重配置 */}
          {activeTab === 'dqi' && (
            <div className="dqi-gmps-config-section" role="tabpanel">
              <div className="dqi-gmps-presets">
                {Object.entries(DQI_PRESETS).map(([key, preset]) => (
                  <button
                    key={key}
                    className="dqi-gmps-preset-btn"
                    onClick={() => handlePresetSelect(key as 'conservative' | 'neutral' | 'aggressive')}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>

              <div className="dqi-gmps-sliders">
                <label className="dqi-gmps-slider-label">
                  盈利能力权重 (w1)
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={dqiWeights.w1}
                    onChange={(e) => onDQIWeightChange?.('w1', parseFloat(e.target.value))}
                    aria-label="盈利能力权重"
                  />
                  <span>{dqiWeights.w1.toFixed(2)}</span>
                </label>

                <label className="dqi-gmps-slider-label">
                  成长能力权重 (w2)
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={dqiWeights.w2}
                    onChange={(e) => onDQIWeightChange?.('w2', parseFloat(e.target.value))}
                    aria-label="成长能力权重"
                  />
                  <span>{dqiWeights.w2.toFixed(2)}</span>
                </label>

                <label className="dqi-gmps-slider-label">
                  现金流质量权重 (w3)
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={dqiWeights.w3}
                    onChange={(e) => onDQIWeightChange?.('w3', parseFloat(e.target.value))}
                    aria-label="现金流质量权重"
                  />
                  <span>{dqiWeights.w3.toFixed(2)}</span>
                </label>

                <label className="dqi-gmps-slider-label">
                  资产周转效率权重 (w4)
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={dqiWeights.w4}
                    onChange={(e) => onDQIWeightChange?.('w4', parseFloat(e.target.value))}
                    aria-label="资产周转效率权重"
                  />
                  <span>{dqiWeights.w4.toFixed(2)}</span>
                </label>

                <label className="dqi-gmps-slider-label">
                  研发投入强度权重 (w5)
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={dqiWeights.w5}
                    onChange={(e) => onDQIWeightChange?.('w5', parseFloat(e.target.value))}
                    aria-label="研发投入强度权重"
                  />
                  <span>{dqiWeights.w5.toFixed(2)}</span>
                </label>

                <label className="dqi-gmps-slider-label">
                  库存周转效率权重 (w6)
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={dqiWeights.w6}
                    onChange={(e) => onDQIWeightChange?.('w6', parseFloat(e.target.value))}
                    aria-label="库存周转效率权重"
                  />
                  <span>{dqiWeights.w6.toFixed(2)}</span>
                </label>
              </div>

              <div className="dqi-gmps-weight-sum">
                权重总和: {(dqiWeights.w1 + dqiWeights.w2 + dqiWeights.w3 + dqiWeights.w4 + dqiWeights.w5 + dqiWeights.w6).toFixed(2)}
                {Math.abs((dqiWeights.w1 + dqiWeights.w2 + dqiWeights.w3 + dqiWeights.w4 + dqiWeights.w5 + dqiWeights.w6) - 1.0) > 0.01 && (
                  <span className="dqi-gmps-weight-warning"> (应等于1.0)</span>
                )}
              </div>
            </div>
          )}

          {/* GMPS权重配置 */}
          {activeTab === 'gmps' && gmpsWeights && (
            <div className="dqi-gmps-config-section" role="tabpanel">
              <p className="dqi-gmps-config-note">
                GMPS包含10个特征变量的权重配置（高级功能）
              </p>
              <div className="dqi-gmps-sliders scrollable">
                {Object.entries(gmpsWeights).slice(0, 5).map(([key, value]) => (
                  <label key={key} className="dqi-gmps-slider-label">
                    {key.replace(/^[A-Z]_/, '')}
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.05"
                      value={value}
                      onChange={(e) => onGMPSWeightChange?.(key, parseFloat(e.target.value))}
                      aria-label={`${key}权重`}
                    />
                    <span>{value.toFixed(2)}</span>
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
});

ModelParameterConfig.displayName = 'ModelParameterConfig';

/**
 * DQI & GMPS 联合面板容器
 *
 * 便捷的容器组件，从MathAnalysisOutput自动提取并展示DQI和GMPS结果。
 * 支持多种显示模式：grid（网格）、stacked（堆叠）、tabs（标签页）
 *
 * @example
 * ```tsx
 * <DQIGMPSPanelsContainer
 *   mathAnalysisOutput={diagnosticResponse?.agents?.find(a => a.agentId === 'mathAnalysis')?.output}
 *   isLoading={isAnalyzing}
 *   displayMode="grid"
 * />
 * ```
 */
export const DQIGMPSPanelsContainer: React.FC<DQIGMPSPanelsContainerProps> = memo(({
  mathAnalysisOutput,
  isLoading = false,
  className = '',
  displayMode = 'grid',
  isDark,
  chartThemeKey,
}) => {
  void isDark;
  void chartThemeKey;
  const dqiData = useMemo<DQIData | null>(() =>
    extractDQIResult(mathAnalysisOutput), [mathAnalysisOutput]
  );

  const gmpsData = useMemo<GMPSData | null>(() =>
    extractGMPSResult(mathAnalysisOutput), [mathAnalysisOutput]
  );

  const [activePanelTab, setActivePanelTab] = useState<'dqi' | 'gmps'>('dqi');

  // 如果没有数据且不在加载中，不渲染
  if (!isLoading && !dqiData && !gmpsData) {
    return null;
  }

  // Grid模式（默认）
  if (displayMode === 'grid') {
    return (
      <div className={`dqi-gmps-grid-container ${className}`} role="region" aria-label="DQI/GMPS诊断结果">
        <DQIResultPanel dqiData={dqiData} isLoading={isLoading} />
        <GMPSResultPanel gmpsData={gmpsData} isLoading={isLoading} />
      </div>
    );
  }

  // Stacked模式（垂直堆叠）
  if (displayMode === 'stacked') {
    return (
      <div className={`dqi-gmps-stacked-container ${className}`} role="region" aria-label="DQI/GMPS诊断结果">
        <DQIResultPanel dqiData={dqiData} isLoading={isLoading} className="full-width" />
        <GMPSResultPanel gmpsData={gmpsData} isLoading={isLoading} className="full-width" />
      </div>
    );
  }

  // Tabs模式（标签页切换）
  return (
    <div className={`dqi-gmps-tabs-container ${className}`} role="region" aria-label="DQI/GMPS诊断结果">
      <div className="dqi-gmps-tab-headers" role="tablist">
        <button
          role="tab"
          aria-selected={activePanelTab === 'dqi'}
          onClick={() => setActivePanelTab('dqi')}
          className={`dqi-gmps-tab-btn ${activePanelTab === 'dqi' ? 'active' : ''}`}
        >
          经营质量指数 (DQI)
        </button>
        <button
          role="tab"
          aria-selected={activePanelTab === 'gmps'}
          onClick={() => setActivePanelTab('gmps')}
          className={`dqi-gmps-tab-btn ${activePanelTab === 'gmps' ? 'active' : ''}`}
        >
          毛利承压模型 (GMPS)
        </button>
      </div>

      <div className="dqi-gmps-tab-content" role="tabpanel">
        {activePanelTab === 'dqi' ? (
          <DQIResultPanel dqiData={dqiData} isLoading={isLoading} />
        ) : (
          <GMPSResultPanel gmpsData={gmpsData} isLoading={isLoading} />
        )}
      </div>
    </div>
  );
});

DQIGMPSPanelsContainer.displayName = 'DQIGMPSPanelsContainer';

// ==================== 高阶组件包装器 ====================

/**
 * withDQIGMPSData - 高阶组件包装器
 *
 * 自动从MathAnalysisOutput提取DQI和GMPS数据，并传递给内部组件。
 * 用于快速将现有组件扩展为支持DQI/GMPS数据展示的组件。
 *
 * @param WrappedComponent - 要包装的组件
 * @returns 包装后的新组件
 *
 * @example
 * ```typescript
 * // 创建增强版的分析页面
 * const EnhancedAnalysisPage = withDQIGMPSData(AnalysisPageBase);
 *
 * // 使用时传入mathAnalysisOutput prop
 * <EnhancedAnalysisPage
 *   mathAnalysisOutput={diagnosticResponse?.agents?.find(a => a.agentId === 'mathAnalysis')?.output}
 *   {...otherProps}
 * />
 * ```
 */
export function withDQIGMPSData<P extends object>(
  WrappedComponent: React.ComponentType<P & { dqiData: DQIData | null; gmpsData: GMPSData | null }>
): React.ComponentType<P & { mathAnalysisOutput?: MathAnalysisOutput | null }> {
  const WithDQIGMPSDataComponent: React.ComponentType<P & { mathAnalysisOutput?: MathAnalysisOutput | null }> = (props) => {
    const { mathAnalysisOutput, ...rest } = props;

    const dqiData = useMemo<DQIData | null>(() =>
      extractDQIResult(mathAnalysisOutput), [mathAnalysisOutput]
    );

    const gmpsData = useMemo<GMPSData | null>(() =>
      extractGMPSResult(mathAnalysisOutput), [mathAnalysisOutput]
    );

    return (
      <WrappedComponent
        {...(rest as P)}
        dqiData={dqiData}
        gmpsData={gmpsData}
      />
    );
  };

  WithDQIGMPSDataComponent.displayName = `withDQIGMPSData(${WrappedComponent.displayName || WrappedComponent.name || 'Component'})`;

  return WithDQIGMPSDataComponent;
}

// ==================== 数据提取工具函数（供外部使用）====================

/**
 * 从诊断响应中提取MathAnalysisOutput
 *
 * @param diagnosticResponse - 企业端或投资端的诊断响应对象
 * @returns MathAnalysisOutput或null
 */
export function extractMathAnalysisFromResponse(
  diagnosticResponse: { diagnostic?: { agents?: Array<{ agentId: string; output?: unknown }> } } | null
): MathAnalysisOutput | null {
  if (!diagnosticResponse?.diagnostic?.agents) return null;

  const mathAgent = diagnosticResponse.diagnostic.agents.find(
    (agent) => agent.agentId === 'mathAnalysis'
  );

  // 检查output是否为MathAnalysisOutput类型
  const output = mathAgent?.output;
  if (output && typeof output === 'object' && 'combinedRiskLevel' in output && 'combinedInsights' in output) {
    return output as MathAnalysisOutput;
  }

  return null;
}

/**
 * 快速提取DQI数据的便捷函数
 *
 * @param diagnosticResponse - 诊断响应
 * @returns DQI数据或null
 */
export function quickExtractDQI(
  diagnosticResponse: { diagnostic?: { agents?: Array<{ agentId: string; output?: MathAnalysisOutput }> } } | null
): DQIData | null {
  const mathAnalysis = extractMathAnalysisFromResponse(diagnosticResponse);
  return extractDQIResult(mathAnalysis);
}

/**
 * 快速提取GMPS数据的便捷函数
 *
 * @param diagnosticResponse - 诊断响应
 * @returns GMPS数据或null
 */
export function quickExtractGMPS(
  diagnosticResponse: { diagnostic?: { agents?: Array<{ agentId: string; output?: unknown }> } } | null
): GMPSData | null {
  const mathAnalysis = extractMathAnalysisFromResponse(diagnosticResponse);
  return extractGMPSResult(mathAnalysis);
}


