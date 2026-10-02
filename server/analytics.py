"""Auditable analytics. No learned weights, synthetic observations or causal claims."""
from __future__ import annotations
from .clock import utc_today
import math
from datetime import date
from statistics import mean
from .models import metric, div, calculate
from .store import digest

FLOW_FIELDS = {'revenue','cost','net_profit','cash_flow','sales_volume','production_volume','manufacturing_cost','rd_expense'}
METRIC_LABELS = {'revenue':'营业收入','cost':'营业成本','net_profit':'净利润','cash_flow':'经营现金流',
    'gross_margin':'毛利率','net_margin':'净利率','cash_ratio':'经营现金收入比','leverage':'资产负债率',
    'asset_turnover':'资产周转率','inventory_turnover':'库存周转率','rd_ratio':'研发强度',
    'roe':'季度净资产收益率','revenue_growth':'收入增速','margin_change':'毛利率变化'}


def quarter_index(label):
    return int(label[:4]) * 4 + int(label[-1]) - 1


def quarter_label(index):
    return f'{index // 4}-Q{index % 4 + 1}'


def closed_quarter(label, today=None):
    today = today or utc_today()
    return quarter_index(label) < today.year * 4 + (today.month - 1) // 3


def period_end(label):
    y,q = int(label[:4]),int(label[-1])
    return date(y, q*3, {1:31,2:30,3:30,4:31}[q])


def from_cumulative(data):
    """Difference only flows within the same year. Stock fields are never differenced."""
    out = {**data, 'periods':[]}
    history = {p['period']:p for p in data['periods']}
    for p in sorted(data['periods'], key=lambda p:p['period']):
        q = int(p['period'][-1]); previous = history.get(quarter_label(quarter_index(p['period']) - 1))
        if q > 1 and previous is None:
            raise ValueError(f"{p['period']}缺少同年上一季度累计值，禁止臆造单季度数据")
        row = dict(p)
        if q > 1:
            for field in FLOW_FIELDS:
                a,b = p.get(field),previous.get(field)
                # Missing baseline cannot be treated as zero.
                row[field] = a-b if a is not None and b is not None else None
            row['equity_begin'] = previous.get('equity_end')
        out['periods'].append(row)
    out['notes'] = ('累计数据转换为单季度；仅流量字段作同年差分，存量字段保留期末值。\n' + out.get('notes',''))[:2000]
    return out


def dataset_diff(before, after):
    result = []
    for key in ('name','company','source_kind','source_url','notes'):
        if before.get(key) != after.get(key):
            result.append({'path':key,'before':before.get(key),'after':after.get(key)})
    a = {p['period']:p for p in before['periods']}; b = {p['period']:p for p in after['periods']}
    for period in sorted(a.keys() | b.keys()):
        for field in sorted((a.get(period) or {}).keys() | (b.get(period) or {}).keys()):
            av,bv = a.get(period,{}).get(field), b.get(period,{}).get(field)
            if av != bv:
                result.append({'path':f'periods/{period}/{field}','before':av,'after':bv})
    return result


def quality_report(data, today=None):
    today = today or utc_today()
    findings = []; ps = sorted(data['periods'],key=lambda p:p['period'])
    def add(code,severity,period,fields,message):
        findings.append({'code':code,'severity':severity,'period':period,'fields':fields,'message':message})
    for index,p in enumerate(ps):
        period=p['period']
        if not closed_quarter(period,today):
            add('OPEN_QUARTER','warning',period,['period'],'季度尚未结束，不可混入完整季度回测')
        if index and quarter_index(period) - quarter_index(ps[index-1]['period']) != 1:
            add('TIME_GAP','warning',period,['period'],'与上一条记录不连续；趋势连线与预测必须保留缺口')
        if p['revenue'] == 0:
            add('ZERO_REVENUE','warning',period,['revenue'],'收入为零，相关比率不可计算')
        if p['cost'] > p['revenue']:
            add('NEGATIVE_GROSS_PROFIT','warning',period,['revenue','cost'],'营业成本超过收入；保留负毛利，不截断原值')
        if p.get('cash_flow') is not None and p['cash_flow'] < 0:
            add('NEGATIVE_CASH_FLOW','warning',period,['cash_flow'],'经营现金流为负，需要结合业务与付款周期核对')
        if all(p.get(k) is not None for k in ('assets','liabilities','equity_end')):
            residual=p['assets']-p['liabilities']-p['equity_end']
            if abs(residual) > max(1.0,p['assets']*.005):
                add('BALANCE_MISMATCH','warning',period,['assets','liabilities','equity_end'],
                    '资产−负债与期末净资产差异超过0.5%/1元容差，可能存在合并口径或录入问题')
        if p.get('rd_expense') is not None and p['rd_expense'] > p['revenue']:
            add('RD_OVER_REVENUE','warning',period,['rd_expense','revenue'],'研发支出大于收入，需核实期间和单位')
        if index:
            prev=ps[index-1]
            for k in ('revenue','cost','assets','inventory'):
                if p.get(k) is not None and prev.get(k) and p[k] / prev[k] > 10:
                    add('ORDER_OF_MAGNITUDE','warning',period,[k],'较上一记录增长超过十倍，请核查金额单位或业务合并范围')
    optional=['net_profit','cash_flow','assets','liabilities','inventory','sales_volume','production_volume','rd_expense']
    missing=[k for k in optional if ps[-1].get(k) is None]
    if missing:
        add('MISSING_FIELDS','info',ps[-1]['period'],missing,'缺失字段保持空值；不会以零或行业均值填补')
    if not data.get('source_url'):
        add('MISSING_SOURCE','info',ps[-1]['period'],['source_url'],'未填写原始来源地址，可在证据库关联文件并人工审阅')
    if data.get('source_kind')=='sample':
        add('SYNTHETIC_DATA','warning',ps[-1]['period'],['source_kind'],'历史导入内容标为合成样例，不代表真实企业')
    return {'findings':findings, 'warning_count':sum(x['severity']=='warning' for x in findings),
        'field_coverage':{'present':len(optional)-len(missing),'total':len(optional),'missing':missing},
        'closed_quarters':sum(closed_quarter(p['period'],today) for p in ps),
        'source_state':'user_declared_not_verified','input_hash':digest(data),'as_of':today.isoformat()}


def extended_scenario(data, price, cost, volume, fixed_share):
    p = sorted(data['periods'],key=lambda p:p['period'])[-1]
    def calc(pr,co,vo):
        revenue=p['revenue']*(1+pr)*(1+vo)
        fixed=p['cost']*fixed_share
        variable=p['cost']*(1-fixed_share)*(1+co)*(1+vo)
        expense=fixed+variable
        return {'revenue':revenue,'cost':expense,'fixed_cost':fixed,'variable_cost':variable,
            'gross_profit':revenue-expense,'gross_margin':div(revenue-expense,revenue)}
    result=calc(price,cost,volume);base=calc(0,0,0)
    sensitivity=[]
    for id,label in [('price','售价'),('cost','单位变动成本'),('volume','销量')]:
        args={'pr':price,'co':cost,'vo':volume};key={'price':'pr','cost':'co','volume':'vo'}[id]
        low=dict(args);high=dict(args);low[key]-=.05;high[key]+=.05
        sensitivity.append({'id':id,'label':label,'minus_five_pp':calc(**low)['gross_profit'],
            'plus_five_pp':calc(**high)['gross_profit'],'center':result['gross_profit']})
    grid=[]
    for dp in [-.1,-.05,0,.05,.1]:
        for dc in [-.1,-.05,0,.05,.1]:
            grid.append({'price_change':price+dp,'cost_change':cost+dc,
                **calc(price+dp,cost+dc,volume)})
    contribution=p['revenue']*(1+price)-p['cost']*(1-fixed_share)*(1+cost)
    break_even=div(p['cost']*fixed_share,contribution)
    return {'kind':'scenario','period':p['period'],'baseline':base,'result':result,
        'delta_gross_profit':result['gross_profit']-base['gross_profit'],
        'break_even_volume_multiplier':break_even,'sensitivity':sensitivity,'grid':grid,
        'formula':'收入=基准收入×(1+售价变化)×(1+销量变化)；成本=基准成本×固定占比+基准成本×(1−固定占比)×(1+单位变动成本变化)×(1+销量变化)',
        'assumptions':{'price_change':price,'unit_variable_cost_change':cost,'volume_change':volume,'fixed_cost_share':fixed_share},
        'limitations':['情景是输入假设的机械计算，不是经验预测或因果估计','固定成本本轮不随成本冲击改变；不含税费、融资和产能上限',
            '盈亏平衡销量为基准销量倍数；单位贡献非正时无可用结果']}


def _predict(values, method, horizon):
    if method=='last':return [values[-1]]*horizon
    if method=='mean4':return [mean(values[-4:])]*horizon
    if method=='seasonal4':return [values[-4+(i%4)] for i in range(horizon)]
    ys=values[-6:];n=len(ys);xm=(n-1)/2;ym=mean(ys)
    slope=sum((i-xm)*(v-ym) for i,v in enumerate(ys))/sum((i-xm)**2 for i in range(n))
    return [ym+slope*(n+i-xm) for i in range(horizon)]


def _quantile(values,q):
    xs=sorted(values);pos=(len(xs)-1)*q;lo=math.floor(pos);hi=math.ceil(pos)
    return xs[lo]*(hi-pos)+xs[hi]*(pos-lo) if hi!=lo else xs[lo]


def forecast_baselines(data, field, horizon, today=None):
    ps=sorted(data['periods'],key=lambda p:p['period'])
    excluded=[p['period'] for p in ps if not closed_quarter(p['period'],today)]
    ps=[p for p in ps if closed_quarter(p['period'],today)]
    if len(ps)<6:
        raise ValueError('至少需要6个连续且已结束的完整季度；当前/未来季度不参与回测')
    if any(quarter_index(b['period'])-quarter_index(a['period'])!=1 for a,b in zip(ps,ps[1:])):
        raise ValueError('历史季度存在缺口，拒绝将不连续记录当作连续时间序列')
    ys=[metric(p)['gross_margin'] if field=='gross_margin' else p.get(field) for p in ps]
    if any(y is None or not math.isfinite(y) for y in ys):
        raise ValueError('所选预测指标存在缺失或不可计算值；不自动插值')
    nonnegative=field in {'revenue','cost'}
    def predict(values,method,h):
        result=_predict(values,method,h)
        return [max(0.0,x) for x in result] if nonnegative else result
    names={'last':'上一季度','mean4':'近四季均值','seasonal4':'同季季节基线','trend6':'近六季线性趋势'}
    results=[]
    for method,label in names.items():
        folds=[]
        for end in range(4,len(ys)):
            estimate=predict(ys[:end],method,1)[0]
            folds.append({'train_end':ps[end-1]['period'],'target':ps[end]['period'],
                'train_count':end,'actual':ys[end],'prediction':estimate,'error':ys[end]-estimate})
        mae=mean(abs(f['error']) for f in folds);rmse=math.sqrt(mean(f['error']**2 for f in folds))
        den=sum(abs(f['actual']) for f in folds)
        wape=sum(abs(f['error']) for f in folds)/den if den>0 else None
        results.append({'method':method,'label':label,'mae':mae,'rmse':rmse,'wape':wape,'folds':folds})
    # Stable tie-breaking prefers the simpler method, not a claim of model superiority.
    selected=min(results,key=lambda r:r['mae']);residuals=[f['error'] for f in selected['folds']]
    # Independent-in-time model-selection check: last two quarters cannot influence
    # method choice. This is a locked-method rolling holdout, not external validation.
    locked={'status':'insufficient_history','required_quarters':10,'note':'至少10个已结束季度才保留末两季作独立选模检验；不把短样本误差称为独立验证'}
    if len(ys)>=10:
        cutoff=len(ys)-2
        development=[]
        for result in results:
            folds=[f for f in result['folds'] if f['train_count']<cutoff]
            development.append({'method':result['method'],'mae':mean(abs(f['error']) for f in folds),'targets':[f['target'] for f in folds]})
        chosen=min(development,key=lambda x:x['mae'])['method']
        tests=[]
        for end in range(cutoff,len(ys)):
            estimate=predict(ys[:end],chosen,1)[0]
            tests.append({'train_end':ps[end-1]['period'],'target':ps[end]['period'],'actual':ys[end],
                          'prediction':estimate,'error':ys[end]-estimate,'baseline_prediction':ys[end-1]})
        locked={'status':'completed','method':chosen,'selection_end':ps[cutoff-1]['period'],'development':development,
            'holdout_start':ps[cutoff]['period'],'holdout_end':ps[-1]['period'],'folds':tests,
            'mae':mean(abs(f['error']) for f in tests),'last_value_mae':mean(abs(f['actual']-f['baseline_prediction']) for f in tests),
            'selection_uses_holdout':False,'note':'方法在末两季前锁定；逐季可使用此前已到达观测，不用保留组重新选模。仅两折，不证明稳定性或跨企业泛化。'}
    predictions=predict(ys,selected['method'],horizon);series=[]
    for i,y in enumerate(predictions):
        # Residuals only calibrate a one-step empirical band. Multi-step has no calibrated band.
        band = len(residuals)>=6 and i==0
        lower=y+_quantile(residuals,.1) if band else None
        upper=y+_quantile(residuals,.9) if band else None
        if nonnegative and lower is not None:lower=max(0,lower);upper=max(0,upper)
        series.append({'period':quarter_label(quarter_index(ps[-1]['period'])+i+1),'value':y,
            'lower':lower,'upper':upper,'band_kind':'validation_residual_10_90' if band else 'insufficient_calibration'})
    return {'kind':'forecast','metric':field,'selected':selected['method'],'selected_label':selected['label'],
        'history':[{'period':p['period'],'value':v} for p,v in zip(ps,ys)],'forecast':series,'backtests':results,
        'excluded_periods':excluded,'train_end':ps[-1]['period'],'forecast_horizon':horizon,
        'selection':'在相同滚动起点单步验证上选最低MAE；相等时选择较简单基线',
        'locked_holdout':locked,
        'limitations':['仅可解释统计基线，不含外部市场、政策或订单变量',
            '选模与报告误差共用滚动验证集，误差可能乐观；并非独立样本外效果承诺',
            '误差带为历史单步残差10%—90%分位，不是80%置信区间；多步不外推校准',
            '收入/成本预测负值截为零；基线间相同输入不代表已学到产业因果规律']}


def lineage(data, analysis):
    p=analysis['current_period'];base=analysis['baseline_period']
    recipes={
        'gross_margin':(['revenue','cost'],'(收入−成本)/收入'),
        'net_margin':(['net_profit','revenue'],'净利润/收入'),
        'cash_ratio':(['cash_flow','revenue'],'经营现金流/收入'),
        'leverage':(['liabilities','assets'],'负债/资产'),
        'rd_ratio':(['rd_expense','revenue'],'研发支出/收入'),
        'asset_turnover':(['revenue','assets'],'季度收入/期末资产（非平均资产口径）'),
        'inventory_turnover':(['cost','inventory'],'季度成本/期末存货（非平均存货口径）'),
        'roe':(['net_profit','equity_begin','equity_end'],'季度净利润/平均净资产（未年化）')}
    current=next(x for x in data['periods'] if x['period']==p)
    return [{'id':key,'label':METRIC_LABELS.get(key,key),'value':analysis['metrics'].get(key),
        'formula':formula,'period':p,'baseline_period':base,
        'inputs':[{'path':f'periods/{p}/{f}','field':f,'value':current.get(f),'unit':'CNY'} for f in fs],
        'source_url':data.get('source_url',''),'status':'missing' if analysis['metrics'].get(key) is None else 'computed'}
        for key,(fs,formula) in recipes.items()]
