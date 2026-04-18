import React, { useState } from "react";
import { validateEnterpriseOnboarding, type ValidationResult } from "../../shared/validate-inputs.js";
import type { EnterpriseOnboardingDraft } from "../../shared/types.js";

const dimTag = (label: string, color: string) => (
  <span style={{
    fontSize: '10px',
    fontWeight: 600,
    color,
    background: color.replace(')', ',0.08)').replace('rgb', 'rgba'),
    padding: '2px 8px',
    borderRadius: '10px',
    marginLeft: '6px',
    whiteSpace: 'nowrap',
  }}>
    {label}
  </span>
);

export function CollectEnterpriseScreen({
  draft,
  setDraft,
  onFinish,
}: {
  draft: EnterpriseOnboardingDraft;
  setDraft: React.Dispatch<React.SetStateAction<EnterpriseOnboardingDraft>>;
  onFinish: () => void;
}) {
  const [step, setStep] = useState(1);
  const [validationResult, setValidationResult] = useState<ValidationResult | null>(null);
  const [showValidationPanel, setShowValidationPanel] = useState(false);
  const hasHist = draft.hasFullHistory ? 'yes' : 'no';

  const handleValidate = () => {
    const result = validateEnterpriseOnboarding(draft);
    setValidationResult(result);
    setShowValidationPanel(true);
    if (result.isValid) {
      setTimeout(() => {
        setShowValidationPanel(false);
        onFinish();
      }, 800);
    }
  };

  const u = (field: keyof EnterpriseOnboardingDraft, value: string | boolean) => {
    setDraft((prev: EnterpriseOnboardingDraft) => ({ ...prev, [field]: value }));
  };

  const sectionHeader = (title: string, dimLabel: string, dimColor: string) => (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      marginBottom: '12px',
      padding: '8px 12px',
      borderRadius: '10px',
      background: 'rgba(79,107,246,0.04)',
      borderLeft: '3px solid',
      borderLeftColor: dimColor,
    }}>
      <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--t1)' }}>{title}</span>
      {dimTag(dimLabel, dimColor)}
    </div>
  );

  const inputField = (label: string, field: keyof EnterpriseOnboardingDraft, placeholder: string) => (
    <div className="fg">
      <label>{label}</label>
      <input value={draft[field] as string} onChange={(e) => u(field, e.target.value)} placeholder={placeholder} />
    </div>
  );

  return (
    <div className="cb-wrap">
      <div className="ch">
        <h2 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{
            width: '32px', height: '32px', borderRadius: '10px',
            background: 'linear-gradient(135deg, #4F6BF6, #06B6D4)',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '16px', color: '#fff',
          }}>📋</span>
          企业数据收集
        </h2>
        <p>请填写以下信息以便我们为您提供精准分析</p>
      </div>
      <div className="sts">
        <div className={`sd ${step >= 1 ? (step === 1 ? 'on' : 'ok') : ''}`}></div>
        <div className="sln"></div>
        <div className={`sd ${step >= 2 ? (step === 2 ? 'on' : 'ok') : ''}`}></div>
        <div className="sln"></div>
        <div className={`sd ${step >= 3 ? (step === 3 ? 'on' : 'ok') : ''}`}></div>
        <div className="sln"></div>
        <div className={`sd ${step >= 4 ? (step === 4 ? 'on' : 'ok') : ''}`}></div>
      </div>

      {showValidationPanel && validationResult && (
        <ValidationFeedbackPanel
          result={validationResult}
          onDismiss={() => setShowValidationPanel(false)}
        />
      )}

      {step === 1 && (
        <div className="qc">
          <h4>基本信息</h4>
          <p className="ht">请填写企业基本标识信息</p>
          <div className="fr">
            <div className="fg"><label>企业名称</label><input value={draft.enterpriseName} onChange={(e) => u("enterpriseName", e.target.value)} placeholder="例如：宁德时代" /></div>
            <div className="fg"><label>当前季度标签</label><input value={draft.currentQuarterLabel} onChange={(e) => u("currentQuarterLabel", e.target.value)} placeholder="Q4'24" /></div>
          </div>
          <div className="tg">
            <div className={`tb ${hasHist === 'yes' ? 'on' : ''}`} onClick={() => u("hasFullHistory", true)}>有完整历史数据</div>
            <div className={`tb ${hasHist === 'no' ? 'on' : ''}`} onClick={() => u("hasFullHistory", false)}>仅有当前数据</div>
          </div>
          <div className="br">
            <button className="bt bp" onClick={() => setStep(2)}>下一步</button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="qc">
          {sectionHeader('毛利率结果层', 'GMPS-A', '#4F6BF6')}
          <div className="fr">
            {inputField('本季度毛利率 (%)', 'currentGrossMargin', '18.5')}
            {inputField('当前季度总收入(万元)', 'currentRevenue', '52000')}
          </div>
          <div className="fr">
            {inputField('当前季度总成本(万元)', 'currentCost', '42400')}
            <div className="fg"></div>
          </div>

          {sectionHeader('材料成本冲击层', 'GMPS-B', '#06B6D4')}
          <div style={{ padding: '8px 12px', fontSize: '12px', color: 'var(--t3)', background: 'rgba(6,182,212,0.04)', borderRadius: '8px', marginBottom: '12px' }}>
            碳酸锂价格与行业波动率将由系统自动获取
          </div>

          {sectionHeader('产销负荷与制造费用分摊层', 'GMPS-C', '#10B981')}
          <div className="fr">
            {inputField('当前季度销量(万件)', 'currentSalesVolume', '850')}
            {inputField('当前季度产量(万件)', 'currentProductionVolume', '900')}
          </div>
          <div className="fr">
            {inputField('当前季度库存费用(万元)', 'currentInventoryExpense', '3200')}
            {inputField('产品总制造费用(万元)', 'currentManufacturingExpense', '28000')}
          </div>
          <div className="fr">
            {inputField('总营业成本(万元)', 'currentOperatingCost', '42400')}
            <div className="fg"></div>
          </div>

          {sectionHeader('现金流与安全垫层', 'GMPS-E', '#F59E0B')}
          <div className="fr">
            {inputField('经营现金流(万元)', 'currentOperatingCashFlow', '8500')}
            {inputField('总负债(万元)', 'currentTotalLiabilities', '35000')}
          </div>
          <div className="fr">
            {inputField('总资产(万元)', 'currentTotalAssets', '120000')}
            {inputField('去年同期标签', 'baselineQuarterLabel', "Q4'23")}
          </div>

          <div className="br">
            <button className="bt bgh" onClick={() => setStep(1)}>上一步</button>
            <button className="bt bp" onClick={() => setStep(3)}>下一步</button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="qc">
          {sectionHeader('盈利能力', 'DQI-盈利', '#4F6BF6')}
          <div className="fr">
            {inputField('净利润(万元)', 'currentNetProfit', '8200')}
            {inputField('期初净资产(万元)', 'currentBeginNetAssets', '65000')}
          </div>
          <div className="fr">
            {inputField('期末净资产(万元)', 'currentEndNetAssets', '68000')}
            <div className="fg"></div>
          </div>

          {sectionHeader('成长能力', 'DQI-成长', '#10B981')}
          <div className="fr">
            {inputField('营业收入(万元)', 'currentRevenueForDQI', '52000')}
            <div className="fg"></div>
          </div>

          {sectionHeader('现金流质量', 'DQI-现金流', '#F59E0B')}
          <div className="fr">
            {inputField('经营活动现金流量净额(万元)', 'currentOCFNet', '8500')}
            <div className="fg"></div>
          </div>

          <div style={{ padding: '8px 12px', fontSize: '11px', color: 'var(--t3)', background: 'rgba(79,107,246,0.04)', borderRadius: '8px', marginTop: '8px', lineHeight: 1.6 }}>
            ROE = 净利润 / 平均净资产 × 100%　·　平均净资产 = (期初 + 期末) / 2
          </div>

          <div className="br">
            <button className="bt bgh" onClick={() => setStep(2)}>上一步</button>
            <button className="bt bp" onClick={() => setStep(4)}>下一步</button>
          </div>
        </div>
      )}

      {step === 4 && (
        <div className="qc">
          <h4>{hasHist === 'yes' ? '历史季度对比数据' : '去年同季度对比数据'}</h4>
          <p className="ht">{hasHist === 'yes' ? '请填写近4个季度的历史数据' : '请填写去年同期数据以便进行对比分析'}</p>

          {sectionHeader('毛利率结果层对比', 'GMPS-A', '#4F6BF6')}
          <div className="fr">
            {inputField('去年同季度毛利率 (%)', 'baselineGrossMargin', '23.2')}
            {inputField('去年同季度总收入(万元)', 'baselineRevenue', '48000')}
          </div>
          <div className="fr">
            {inputField('去年同季度总成本(万元)', 'baselineCost', '36900')}
            {inputField('去年同季度销量(万件)', 'baselineSalesVolume', '720')}
          </div>
          <div className="fr">
            {inputField('去年同季度库存费(万元)', 'baselineInventoryExpense', '2620')}
            <div className="fg"></div>
          </div>

          {sectionHeader('DQI 对比数据', 'DQI', '#7C5CFC')}
          <div className="fr">
            {inputField('去年同期净利润(万元)', 'baselineNetProfit', '7600')}
            {inputField('去年同期期初净资产(万元)', 'baselineBeginNetAssets', '60000')}
          </div>
          <div className="fr">
            {inputField('去年同期期末净资产(万元)', 'baselineEndNetAssets', '63000')}
            {inputField('去年同期营业收入(万元)', 'baselineRevenueForDQI', '48000')}
          </div>
          <div className="fr">
            {inputField('去年同期经营现金流净额(万元)', 'baselineOCFNet', '7800')}
            <div className="fg"></div>
          </div>

          {hasHist === 'yes' && (
            <div>
              <div style={{ padding: '10px', background: 'rgba(79,107,246,0.04)', borderRadius: '8px', marginBottom: '12px', fontSize: '12px', color: 'var(--t3)' }}>
                检测到您有完整历史数据，以下为中间两个季度补充
              </div>
              <div className="fr">
                {inputField('上一季度毛利率(%)', 'previousQuarterGrossMargin', '20.1')}
                {inputField('上一季度总收入(万元)', 'previousQuarterRevenue', '50000')}
              </div>
              <div className="fr">
                {inputField('两季度前毛利率(%)', 'twoQuartersAgoGrossMargin', '21.8')}
                {inputField('两季度前总收入(万元)', 'twoQuartersAgoRevenue', '49000')}
              </div>
            </div>
          )}

          <div className="br">
            <button className="bt bgh" onClick={() => setStep(3)}>上一步</button>
            <button className="bt bp" onClick={handleValidate}>开始分析</button>
          </div>
          <div className="pn">🔒 我们承诺对贵企业的信息进行保密，数据只用于数据分析</div>
        </div>
      )}
    </div>
  );
}

function ValidationFeedbackPanel({ result, onDismiss }: { result: ValidationResult; onDismiss: () => void }) {
  const isPass = result.isValid && result.warnings.length === 0;

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      background: 'var(--modal-overlay-strong)', display: 'flex', alignItems: 'center',
      justifyContent: 'center', zIndex: 10000,
    }} onClick={onDismiss}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--bg2)', borderRadius: '20px', padding: '28px',
          maxWidth: '600px', width: '90%', maxHeight: '80vh', overflowY: 'auto',
          boxShadow: '0 20px 60px rgba(79,107,246,0.12)',
          border: '1px solid var(--glass-border-soft)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h3 style={{ margin: 0, fontSize: '18px' }}>
            {isPass ? '✅ 数据校验通过' : result.isValid ? '⚠️ 数据校验完成' : '❌ 数据校验未通过'}
          </h3>
          <button onClick={onDismiss} style={{ background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer', color: 'var(--t2)', padding: '4px 8px' }}>✕</button>
        </div>
        <p style={{ margin: '0 0 16px 0', fontSize: '13px', color: 'var(--t2)', lineHeight: 1.6 }}>{result.summary}</p>
        {result.missingFields.length > 0 && (
          <div style={{ marginBottom: '16px' }}>
            <div style={{ fontSize: '13px', fontWeight: 600, color: '#EF4444', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span>🔴</span> 必填字段缺失（{result.missingFields.length}项）
            </div>
            <div style={{ background: 'rgba(239,68,68,0.06)', borderRadius: '10px', padding: '12px' }}>
              {result.missingFields.map((issue, i) => (
                <div key={i} style={{ fontSize: '12px', color: '#DC2626', padding: '4px 0', borderBottom: i < result.missingFields.length - 1 ? '1px solid rgba(239,68,68,0.1)' : 'none' }}>
                  <strong>{issue.label}</strong>：未填写
                  <span style={{ color: '#94A3B8', marginLeft: '8px' }}>（影响模型：{issue.models.join('、')}）</span>
                </div>
              ))}
            </div>
          </div>
        )}
        {result.warnings.length > 0 && (
          <div style={{ marginBottom: '16px' }}>
            <div style={{ fontSize: '13px', fontWeight: 600, color: '#F59E0B', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span>🟡</span> 数值范围警告（{result.warnings.length}项）
            </div>
            <div style={{ background: 'rgba(245,158,11,0.06)', borderRadius: '10px', padding: '12px' }}>
              {result.warnings.map((issue, i) => (
                <div key={i} style={{ fontSize: '12px', color: '#D97706', padding: '4px 0', borderBottom: i < result.warnings.length - 1 ? '1px solid rgba(245,158,11,0.1)' : 'none' }}>
                  <strong>{issue.label}</strong>：{issue.message}
                  <span style={{ color: '#94A3B8', marginLeft: '8px' }}>（影响模型：{issue.models.join('、')}）</span>
                </div>
              ))}
            </div>
          </div>
        )}
        {isPass && (
          <div style={{ textAlign: 'center', padding: '12px', color: 'var(--t3)', fontSize: '13px' }}>正在提交数据，请稍候...</div>
        )}
      </div>
    </div>
  );
}
