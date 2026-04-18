import React, { useState } from "react";
import type { InvestorOnboardingDraft } from "../utils/helpers.js";
import { Icon } from "./Icon.js";

export function CollectInvestorScreen({
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
        <h2 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{
            width: '32px', height: '32px', borderRadius: '10px',
            background: 'linear-gradient(135deg, #7C5CFC, #F59E0B)',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Icon name="investor" size={18} color="#FFFFFF" />
          </span>
          投资信息收集
        </h2>
        <p>了解您的投资情况以便提供个性化分析</p>
      </div>
      <div className="sts">
        <div className={`sd ${step >= 1 ? (step === 1 ? 'on' : 'ok') : ''}`}></div>
        <div className="sln"></div>
        <div className={`sd ${step >= 2 ? (step === 2 ? 'on' : 'ok') : ''}`}></div>
      </div>

      {step === 1 && (
        <div className="qc">
          <h4>投资概况</h4>
          <p className="ht">请填写您的基本投资信息</p>
          <div className="fr"><div className="fg"><label>投资者名称</label><input value={draft.investorName} onChange={(event) => setDraft((previous) => ({ ...previous, investorName: event.target.value }))} placeholder="" /></div></div>
          <div className="fr"><div className="fg"><label>已投资锂电企业</label><input value={draft.investedEnterprises} onChange={(event) => setDraft((previous) => ({ ...previous, investedEnterprises: event.target.value }))} placeholder="宁德时代、比亚迪、亿纬锂能" /></div></div>
          <div className="fr"><div className="fg"><label>资金成本 (年化 %)</label><input value={draft.capitalCostRate} onChange={(event) => setDraft((previous) => ({ ...previous, capitalCostRate: event.target.value }))} placeholder="5.5" /></div><div className="fg"><label>投资总金额(万元)</label><input value={draft.investmentTotal} onChange={(event) => setDraft((previous) => ({ ...previous, investmentTotal: event.target.value }))} placeholder="200" /></div></div>
          <div className="fr">
            <div className="fg"><label>投资周期偏好</label><select value={draft.investmentHorizon} onChange={(event) => setDraft((previous) => ({ ...previous, investmentHorizon: event.target.value as InvestorOnboardingDraft["investmentHorizon"] }))}><option value="">请选择</option><option value="short">短期 (1-3个月)</option><option value="medium">中期 (3-12个月)</option><option value="long">长期 (1年以上)</option></select></div>
            <div className="fg"><label>风险承受能力</label><select value={draft.riskAppetite} onChange={(event) => setDraft((previous) => ({ ...previous, riskAppetite: event.target.value as InvestorOnboardingDraft["riskAppetite"] }))}><option value="">请选择</option><option value="low">保守</option><option value="medium">稳健</option><option value="high">积极</option></select></div>
          </div>
          <div className="fr">
            <div className="fg"><label>最关注的细分领域</label><select value={draft.industryInterest} onChange={(event) => setDraft((previous) => ({ ...previous, industryInterest: event.target.value }))}><option value="">请选择</option><option>动力电池</option><option>储能电池</option><option>消费电池</option><option>上游材料</option><option>锂电设备</option><option>全产业链</option></select></div>
            <div className="fg"><label>关注的投资主题</label><select value={draft.focusTopic} onChange={(event) => setDraft((previous) => ({ ...previous, focusTopic: event.target.value }))}><option value="">请选择</option><option>毛利率变化趋势</option><option>产能扩张与利用率</option><option>技术路线迭代</option><option>海外市场拓展</option><option>行业整合并购</option></select></div>
          </div>
          <div className="fr"><div className="fg"><label>其他补充说明</label><textarea value={draft.notes} onChange={(event) => setDraft((previous) => ({ ...previous, notes: event.target.value }))} placeholder="请补充其他关注点或特殊需求..." /></div></div>
          <div className="br">
            <button className="bt bp" onClick={() => setStep(2)}>下一步</button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="qc">
          <h4>确认信息</h4>
          <p className="ht">请确认您的投资信息</p>
          <div style={{ padding: '16px', background: 'rgba(124,92,252,0.04)', borderRadius: '12px', marginBottom: '12px', fontSize: '13px', color: 'var(--t2)', lineHeight: 2, border: '1px solid rgba(124,92,252,0.08)' }}>
            <div><strong style={{ color: 'var(--t1)' }}>投资者：</strong>{draft.investorName || "未命名用户"}</div>
            <div><strong style={{ color: 'var(--t1)' }}>持仓/关注企业：</strong>{draft.investedEnterprises || "待补充"}</div>
            <div style={{ fontSize: '12px', color: 'var(--t3)', marginTop: '4px' }}>系统将根据您的偏好提供个性化分析</div>
          </div>
          <div className="br">
            <button className="bt bgh" onClick={() => setStep(1)}>上一步</button>
            <button className="bt bp" onClick={onFinish}>开始使用</button>
          </div>
        </div>
      )}
    </div>
  );
}
