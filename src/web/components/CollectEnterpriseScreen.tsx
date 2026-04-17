import React, { useState } from "react";
import { validateEnterpriseOnboarding, type ValidationResult } from "../../shared/validate-inputs.js";
import type { EnterpriseOnboardingDraft } from "../chart-data.js";

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

  return (
    <div className="cb-wrap">
      <div className="ch">
        <h2>📋 企业数据收集</h2>
        <p>请填写以下信息以便我们为您提供精准分析</p>
      </div>
      <div className="sts">
        <div className={`sd ${step >= 1 ? (step === 1 ? 'on' : 'ok') : ''}`}></div>
        <div className="sln"></div>
        <div className={`sd ${step >= 2 ? (step === 2 ? 'on' : 'ok') : ''}`}></div>
        <div className="sln"></div>
        <div className={`sd ${step >= 3 ? (step === 3 ? 'on' : 'ok') : ''}`}></div>
      </div>

      {showValidationPanel && validationResult && (
        <ValidationFeedbackPanel
          result={validationResult}
          onDismiss={() => setShowValidationPanel(false)}
        />
      )}

      {step === 1 && (
        <div className="qc">
          <h4>历史数据可用</h4><p className="ht">您是否有最近一个季度的历史运营数据</p>
          <div className="fr">
            <div className="fg">
              <label>企业名称</label>
              <input
                value={draft.enterpriseName}
                onChange={(event) => setDraft((previous) => ({ ...previous, enterpriseName: event.target.value }))}
                placeholder="例如：宁德时代"
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
            <div className={`tb ${hasHist === 'yes' ? 'on' : ''}`} onClick={() => setDraft((previous) => ({ ...previous, hasFullHistory: true }))}>有完整数据</div>
            <div className={`tb ${hasHist === 'no' ? 'on' : ''}`} onClick={() => setDraft((previous) => ({ ...previous, hasFullHistory: false }))}>仅有当前数据</div>
          </div>
          <div className="br">
            <button className="bt bp" onClick={() => setStep(2)}>下一步</button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="qc">
          <h4>当前季度核心数据</h4><p className="ht">请填写当前季度的运营数据</p>
          <div className="fr"><div className="fg"><label>本季度毛利率 (%)</label><input value={draft.currentGrossMargin} onChange={(event) => setDraft((previous) => ({ ...previous, currentGrossMargin: event.target.value }))} placeholder="Q4动力电池营收 18.5" /></div><div className="fg"><label>当前季度总收入(万元)</label><input value={draft.currentRevenue} onChange={(event) => setDraft((previous) => ({ ...previous, currentRevenue: event.target.value }))} placeholder=" 52000" /></div></div>
          <div className="fr"><div className="fg"><label>当前季度总成本(万元)</label><input value={draft.currentCost} onChange={(event) => setDraft((previous) => ({ ...previous, currentCost: event.target.value }))} placeholder=" 42400" /></div><div className="fg"><label>当前季度销量(万件)</label><input value={draft.currentSalesVolume} onChange={(event) => setDraft((previous) => ({ ...previous, currentSalesVolume: event.target.value }))} placeholder=" 850" /></div></div>
          <div className="fr"><div className="fg"><label>当前季度产量 (万件)</label><input value={draft.currentProductionVolume} onChange={(event) => setDraft((previous) => ({ ...previous, currentProductionVolume: event.target.value }))} placeholder="例: 900" /></div><div className="fg"><label>当前季度库存费用 (万元)</label><input value={draft.currentInventoryExpense} onChange={(event) => setDraft((previous) => ({ ...previous, currentInventoryExpense: event.target.value }))} placeholder="Q3消费电池营收 3200" /></div></div>
          <div className="fr"><div className="fg"><label>产品总制造费用(万元)</label><input value={draft.currentManufacturingExpense} onChange={(event) => setDraft((previous) => ({ ...previous, currentManufacturingExpense: event.target.value }))} placeholder=" 28000" /></div><div className="fg"><label>总营业成本(万元)</label><input value={draft.currentOperatingCost} onChange={(event) => setDraft((previous) => ({ ...previous, currentOperatingCost: event.target.value }))} placeholder=" 42400" /></div></div>
          <div className="fr"><div className="fg"><label>当前季度现金流(万元)</label><input value={draft.currentOperatingCashFlow} onChange={(event) => setDraft((previous) => ({ ...previous, currentOperatingCashFlow: event.target.value }))} placeholder=" 8500" /></div><div className="fg"><label>去年同期标签</label><input value={draft.baselineQuarterLabel} onChange={(event) => setDraft((previous) => ({ ...previous, baselineQuarterLabel: event.target.value }))} placeholder=" Q4'23" /></div></div>
          <div className="fr"><div className="fg"><label>总负债(万元)</label><input value={draft.currentTotalLiabilities} onChange={(event) => setDraft((previous) => ({ ...previous, currentTotalLiabilities: event.target.value }))} placeholder=" 35000" /></div><div className="fg"><label>总资产(万元)</label><input value={draft.currentTotalAssets} onChange={(event) => setDraft((previous) => ({ ...previous, currentTotalAssets: event.target.value }))} placeholder=" 120000" /></div></div>
          <div className="br">
            <button className="bt bgh" onClick={() => setStep(1)}>上一步</button>
            <button className="bt bp" onClick={() => setStep(3)}>下一步</button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="qc">
          <h4>{hasHist === 'yes' ? '历史季度对比数据' : '去年同季度对比数据'}</h4>
          <p className="ht">{hasHist === 'yes' ? '请填写近4个季度的历史数据' : '请填写去年同期数据以便进行对比分析'}</p>
          <div className="fr"><div className="fg"><label>去年同季度毛利率 (%)</label><input value={draft.baselineGrossMargin} onChange={(event) => setDraft((previous) => ({ ...previous, baselineGrossMargin: event.target.value }))} placeholder="例: 23.2" /></div><div className="fg"><label>去年同季度总收入(万元)</label><input value={draft.baselineRevenue} onChange={(event) => setDraft((previous) => ({ ...previous, baselineRevenue: event.target.value }))} placeholder=" 48000" /></div></div>
          <div className="fr"><div className="fg"><label>去年同季度总成本(万元)</label><input value={draft.baselineCost} onChange={(event) => setDraft((previous) => ({ ...previous, baselineCost: event.target.value }))} placeholder=" 36900" /></div><div className="fg"><label>去年同季度销量(万件)</label><input value={draft.baselineSalesVolume} onChange={(event) => setDraft((previous) => ({ ...previous, baselineSalesVolume: event.target.value }))} placeholder=" 720" /></div></div>
          <div className="fr"><div className="fg"><label>去年同季度库存费(万元)</label><input value={draft.baselineInventoryExpense} onChange={(event) => setDraft((previous) => ({ ...previous, baselineInventoryExpense: event.target.value }))} placeholder=" 2620" /></div><div className="fg"></div></div>
          
          {hasHist === 'yes' && (
            <div>
              <div style={{ padding: '10px', background: 'rgba(59,130,246,.04)', borderRadius: '8px', marginBottom: '12px', fontSize: '12px', color: 'var(--t3)' }}>
                📊 检测到您有完整历史数据，以下为中间两个季度补充
              </div>
              <div className="fr"><div className="fg"><label>上一季度毛利(%)</label><input value={draft.previousQuarterGrossMargin} onChange={(event) => setDraft((previous) => ({ ...previous, previousQuarterGrossMargin: event.target.value }))} placeholder=" 20.1" /></div><div className="fg"><label>上一季度总收(万元)</label><input value={draft.previousQuarterRevenue} onChange={(event) => setDraft((previous) => ({ ...previous, previousQuarterRevenue: event.target.value }))} placeholder=" 50000" /></div></div>
              <div className="fr"><div className="fg"><label>两季度前毛利(%)</label><input value={draft.twoQuartersAgoGrossMargin} onChange={(event) => setDraft((previous) => ({ ...previous, twoQuartersAgoGrossMargin: event.target.value }))} placeholder=" 21.8" /></div><div className="fg"><label>两季度前总收(万元)</label><input value={draft.twoQuartersAgoRevenue} onChange={(event) => setDraft((previous) => ({ ...previous, twoQuartersAgoRevenue: event.target.value }))} placeholder=" 49000" /></div></div>
            </div>
          )}

          <div className="br">
            <button className="bt bgh" onClick={() => setStep(2)}>上一</button>
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
      background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center',
      justifyContent: 'center', zIndex: 10000,
    }} onClick={onDismiss}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--bg)', borderRadius: '16px', padding: '24px',
          maxWidth: '600px', width: '90%', maxHeight: '80vh', overflowY: 'auto',
          boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
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
            <div style={{ background: 'rgba(239,68,68,0.06)', borderRadius: '8px', padding: '12px' }}>
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
            <div style={{ background: 'rgba(245,158,11,0.06)', borderRadius: '8px', padding: '12px' }}>
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
