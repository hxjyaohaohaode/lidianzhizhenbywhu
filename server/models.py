"""Versioned deterministic business rules; scores are not empirically trained probabilities."""
from __future__ import annotations
from decimal import Decimal
from datetime import date
from .schemas import Dataset
from .store import digest

MODEL_VERSION='rules-3.0.0'
AMOUNT_FIELDS={'revenue','cost','net_profit','cash_flow','assets','liabilities','equity_begin','equity_end','inventory','manufacturing_cost','rd_expense'}

def normalize(data: Dataset) -> dict:
    result=data.model_dump(mode='json');factor={'yuan':1,'wan':10000,'yi':100000000}[data.amount_unit]
    for p in result['periods']:
        for key in AMOUNT_FIELDS:
            if p.get(key) is not None:
                p[key]=float(Decimal(str(p[key]))*factor)
                if abs(p[key])>1e15:raise ValueError('标准化金额超出支持范围，请核实单位')
    result.update(input_amount_unit=data.amount_unit,amount_unit='yuan',verification='synthetic_example' if data.source_kind=='sample' else 'unverified_user_input')
    return result

def div(n,d):
    if n is None or d is None or d<=0:return None
    return float(Decimal(str(n))/Decimal(str(d)))

def growth(current,baseline):
    r=div(current,baseline)
    return r-1 if r is not None else None

def clip(value,low=0,high=100):return max(low,min(high,value))
def increasing(value,low,high):return clip(100*(value-low)/(high-low)) if value is not None else None
def decreasing(value,low,high):
    s=increasing(value,low,high)
    return 100-s if s is not None else None

def metric(p):
    equity=None
    if p.get('equity_begin') is not None and p.get('equity_end') is not None:equity=(p['equity_begin']+p['equity_end'])/2
    return {'period':p['period'],'gross_margin':div(p['revenue']-p['cost'],p['revenue']),
        'net_margin':div(p.get('net_profit'),p['revenue']),'roe':div(p.get('net_profit'),equity),
        'cash_ratio':div(p.get('cash_flow'),p['revenue']),'leverage':div(p.get('liabilities'),p.get('assets')),
        'asset_turnover':div(p['revenue'],p.get('assets')),'rd_ratio':div(p.get('rd_expense'),p['revenue']),
        'inventory_turnover':div(p['cost'],p.get('inventory')),'sales_production_ratio':div(p.get('sales_volume'),p.get('production_volume'))}

def select_baseline(periods,comparison):
    if len(periods)<2:return None
    label=periods[-1]['period'];year=int(label[:4]);q=int(label[-1])
    if comparison=='previous':target=f'{year if q>1 else year-1}-Q{q-1 if q>1 else 4}'
    else:target=f'{year-1}{label[4:]}'
    return next((p for p in periods if p['period']==target),None)

def calculate(data,comparison='year_over_year', *, today=None):
    periods=sorted(data['periods'],key=lambda p:p['period']);current=periods[-1];baseline=select_baseline(periods,comparison)
    m=metric(current);b=metric(baseline) if baseline else {};warnings=[];today=today or date.today()
    if current['period']==f'{today.year}-Q{(today.month-1)//3+1}':warnings.append('输入包含尚未结束的当前季度；请核对是否为实际截至日数据，不能当作完整季度业绩。')
    if not baseline:warnings.append('缺少指定的同/环比季度；基期指标保持缺失，不改用任意季度。')
    warnings.append('全部财务输入是演示样例，不代表真实企业。' if data.get('source_kind')=='sample' else '输入未经本系统独立核验；来源链接不等于真实性认证。')
    if current['revenue']==0:warnings.append('收入为0；涉及收入分母的指标不可计算。')
    if current.get('liabilities') is not None and current.get('assets') and current['liabilities']>current['assets']:warnings.append('负债超过资产，存在负净资产情形；保留原值而非强行截为100%。')
    if current.get('industry_volatility') is not None:warnings.append('行业波动率由用户提供，不是实时拉取或历史校准结果。')
    c=baseline or {};margin_change=None if m['gross_margin'] is None or b.get('gross_margin') is None else m['gross_margin']-b['gross_margin']
    revenue_growth=growth(current['revenue'],c.get('revenue'));cost_growth=growth(current['cost'],c.get('cost'))
    cost_gap=None if revenue_growth is None or cost_growth is None else cost_growth-revenue_growth
    unit_cost=div(current['cost'],current.get('sales_volume'));base_unit_cost=div(c.get('cost'),c.get('sales_volume'))
    raw=[
        ('margin','毛利率结果','毛利率下降幅度',None if margin_change is None else -margin_change,.14,0,.15,'increasing','-(本期毛利率-基期毛利率)'),
        ('gap','毛利率结果','成本收入增速差',cost_gap,.11,0,.12,'increasing','成本增速-收入增速'),
        ('lithium','材料成本','锂价变化',growth(current.get('lithium_price'),c.get('lithium_price')),.10,0,.30,'increasing','本期锂价/基期锂价-1'),
        ('unit_cost','材料成本','单位销售成本变化',growth(unit_cost,base_unit_cost),.12,0,.15,'increasing','(成本/销量)/(基期成本/基期销量)-1'),
        ('inventory','产销负荷','库存变化',growth(current.get('inventory'),c.get('inventory')),.09,0,.25,'increasing','本期库存/基期库存-1'),
        ('sales_production','产销负荷','产销率',m['sales_production_ratio'],.10,.75,1,'decreasing','销量/产量'),
        ('manufacturing','产销负荷','制造费用占比',div(current.get('manufacturing_cost'),current['cost']),.12,.5,.85,'increasing','制造费用/营业成本'),
        ('volatility','外部风险','行业波动率',current.get('industry_volatility'),.07,.15,.5,'increasing','用户提供的行业波动率'),
        ('cash','现金安全','经营现金收入比',m['cash_ratio'],.08,-.05,.15,'decreasing','经营现金流/营业收入'),
        ('leverage','现金安全','资产负债率',m['leverage'],.07,.35,.75,'increasing','总负债/总资产')]
    dimensions=[]
    for id,group,label,value,weight,lo,hi,direction,formula in raw:
        score=(increasing if direction=='increasing' else decreasing)(value,lo,hi)
        dimensions.append({'id':id,'group':group,'label':label,'value':value,'score':score,'weight':weight,'thresholds':[lo,hi],'direction':direction,'formula':formula,'status':'missing' if value is None else 'available'})
    coverage=sum(d['weight'] for d in dimensions if d['score'] is not None)
    score=sum(d['weight']*d['score'] for d in dimensions if d['score'] is not None)/coverage if coverage>=.6 else None
    gmps={'score':round(score,2) if score is not None else None,'coverage':round(coverage,4),'dimensions':dimensions,'level':'不可计算' if score is None else ('高压' if score>=66 else '中压' if score>=33 else '低压'),'method':'可用维度权重归一；覆盖率不足60%拒绝总分','probability':None,'probability_status':'not_calibrated'}
    profitability='roe' if m['roe'] is not None and b.get('roe') is not None else 'net_margin';dq=[]
    for id,label,weight,key,scale in [('profit','盈利质量',.25,profitability,.10),('growth','收入成长',.20,'revenue_growth',.30),('cash','现金质量',.20,'cash_ratio',.15),('assets','资产效率',.15,'asset_turnover',.5),('rd','研发强度',.10,'rd_ratio',.05),('inventory','库存效率',.10,'inventory_turnover',1.)]:
        a,bb=m.get(key),b.get(key)
        delta=revenue_growth if key=='revenue_growth' else (a-bb if a is not None and bb is not None else None)
        component=clip(50+50*delta/scale) if delta is not None else None
        dq.append({'id':id,'label':label,'weight':weight,'change':delta,'score':component,'metric':key,'scale':scale,'formula':f'clamp(50+50×变化/{scale},0,100)'})
    dq_cov=sum(x['weight'] for x in dq if x['score'] is not None)
    dq_score=sum(x['weight']*x['score'] for x in dq if x['score'] is not None)/dq_cov if dq_cov>=.6 else None
    dqi={'score':round(dq_score,2) if dq_score is not None else None,'coverage':round(dq_cov,4),'dimensions':dq,'status':'不可计算' if dq_score is None else ('改善' if dq_score>55 else '恶化' if dq_score<45 else '稳定'),'method':'变化型经营质量规则指数，50为中性；非原版比值DQI，版本不可直接混比'}
    warnings.append('GMPS与DQI权重/阈值为启发式研究规则，未经样本外校准；不是概率、信用评级或投资建议。')
    if coverage<1 or dq_cov<1:warnings.append('存在缺失指标；综合分按可用权重归一，覆盖率单独披露，不代表统计置信度。')
    return {'model_version':MODEL_VERSION,'input_hash':digest(data),'comparison':comparison,'current_period':current['period'],'baseline_period':baseline['period'] if baseline else None,'metrics':{**m,'revenue_growth':revenue_growth,'margin_change':margin_change},'gmps':gmps,'dqi':dqi,'series':[{**p,**metric(p)} for p in periods],'warnings':warnings}

def scenario(data,price,cost,volume):
    p=data['periods'][-1];revenue=p['revenue']*(1+price)*(1+volume);expense=p['cost']*(1+cost)*(1+volume)
    return {'revenue':revenue,'cost':expense,'gross_profit':revenue-expense,'gross_margin':div(revenue-expense,revenue),'baseline_gross_margin':div(p['revenue']-p['cost'],p['revenue']),'assumptions':{'selling_price_change':price,'unit_cost_change':cost,'volume_change':volume,'all_costs_variable':True},'warning':'机械情景假设：全部成本随销量变化，不含固定成本/税费/资金成本，不是预测。'}
