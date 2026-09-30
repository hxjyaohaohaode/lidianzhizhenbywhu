"""Explicit deterministic question scope shared by both local research assistants.

This is a bounded router, not language understanding or an external data source.
Unrecognized topics and ambiguous periods must not silently become latest-quarter
margin/cash answers. The original saved dataset is never mutated.
"""
from __future__ import annotations
import re

TOPICS = (
    ('gross_margin', ('毛利', 'gross margin')),
    ('cash_flow', ('现金流', '现金', '回款', 'cash flow')),
    ('cash_ratio', ('现金收入比', '现金流收入比', 'cash ratio')),
    ('leverage', ('负债率', '杠杆', '偿债', '负债', 'leverage')),
    ('revenue_growth', ('增长', '增速', '同比', 'growth')),
    ('revenue', ('收入', '营收', '销售额', 'revenue')),
    ('cost', ('成本', 'cost')),
    ('net_margin', ('净利率', '盈利能力', 'net margin')),
    ('net_profit', ('净利润', '利润额', 'net profit')),
    ('inventory_turnover', ('库存', '存货', '周转', 'inventory turnover')),
    ('rd_ratio', ('研发', 'r&d')),
    ('roe', ('净资产收益', 'roe')),
    ('asset_turnover', ('资产周转', 'asset turnover')),
)


def matches(text, term):
    return bool(re.search(r'(?<![a-z0-9])' + re.escape(term) + r'(?![a-z0-9])', text)) if term.isascii() else term in text


def topics_for(text):
    q=text.lower()
    topics=[key for key, words in TOPICS if any(matches(q,word) for word in words)]
    if 'cash_ratio' in topics:
        topics=[key for key in topics if key not in ('cash_flow','revenue')]
    elif 'cash_flow' in topics:
        topics.insert(topics.index('cash_flow')+1,'cash_ratio')
    if 'asset_turnover' in topics:
        topics=[key for key in topics if key!='inventory_turnover']
    if not topics and matches(q,'margin'):topics=['gross_margin']
    if not topics and matches(q,'cash'):topics=['cash_flow']
    return topics


def resolve_question(text, data, defaults):
    q=text.lower();topics=topics_for(text)
    overview=any(w in q for w in ('经营','诊断','概览','全景','整体','数据质量','数据缺口','核查指标','overview','summary'))
    if not topics and overview:topics=list(defaults)
    previous=any(w in q for w in ('环比','上一季度','上季','previous quarter'))
    yearly=any(w in q for w in ('同比','上年同季','去年同季','year over year'))
    comparison='previous' if previous else 'year_over_year'
    quarters=[]; spans=[]
    patterns=(r'(?<!\d)((?:19|20)\d{2})\s*年\s*第?\s*([1-4一二三四])\s*季度',
              r'(?<!\d)((?:19|20)\d{2})\s*[-/]?\s*q([1-4])(?!\d|\.\d)')
    for pattern in patterns:
        for match in re.finditer(pattern,q):
            year,quarter=match.groups()
            value=f"{year}-Q{dict(zip('一二三四','1234')).get(quarter,quarter)}"
            if value not in quarters:quarters.append(value)
            spans.append(match.span())
    remainder=list(q)
    for start,end in spans:remainder[start:end]=' '*(end-start)
    unresolved=''.join(remainder)
    partial_period=bool(re.search(r'(?<![a-z])q\d+|第?\s*[0-9一二三四五六七八九十]+\s*季度|[0-9一二三四五六七八九十]+\s*月|(?:去年|今年|前年|上年|本年|明年)(?!同季)|上半年|下半年|半年度|年度|全年|本月|上月|下月|annual|yearly|last year|this year',unresolved))
    extra_years=re.findall(r'(?<!\d)(?:19|20)\d{2}(?!\d)',''.join(remainder))
    available=sorted(p['period'] for p in data['periods'])
    period=quarters[0] if len(quarters)==1 else available[-1]
    status='supported';notice=''
    if (previous and yearly) or '同环比' in q:
        status='needs_clarification';notice='一次计划使用一个比较基期；请明确同比或环比，避免静默选择。'
    elif len(quarters)>1:
        status='needs_clarification';notice='本地助手一次核查一个目标季度及其同/环比基期；请指定一个目标季度，或在企业对照工作区选择比较范围。'
    elif extra_years or partial_period:
        status='needs_clarification';notice='当前数据按单季度保存；年度、月份、无效季度或额外年份不会擅自当作最近一季或自动汇总，请明确单个目标季度。'
    elif quarters and period not in available:
        status='period_unavailable';notice=f'已保存输入没有{period}，不能用最近一季代替；请先补充该季度原始数据。'
    elif not topics and any(w in q for w in ('证据','资料','记忆','偏好','任务','执行','断点','行动','待办','跟进','截止','情景','敏感','假设','涨价','跌价')):
        status='workspace_query';notice='已按当前企业与工作身份查询相关资料或工作记录；本问题没有指定财务指标，因此不附加无关指标结论。'
    elif not topics:
        status='unsupported_topic';notice='当前问题未匹配可计算的财务指标。本地助手可核查收入、成本、利润、现金流、比率及其同/环比；请明确指标。资料匹配仅作为待审阅候选。'
    if status!='supported':topics=[]
    return {'status':status,'notice':notice,'topics':topics,'comparison':comparison,'period':period,
            'available_periods':available,'period_explicit':bool(quarters),'default_overview':overview,
            'comparison_explicit':previous or yearly,'period_basis':'single_quarter','can_calculate':status=='supported'}


def scoped_dataset(data, scope):
    return {**data,'periods':[p for p in data['periods'] if p['period']<=scope['period']]} if scope['can_calculate'] else data


def analysis_dataset(snapshot):
    """Apply an approved financial-period selection while retaining the full audit snapshot."""
    data=snapshot['dataset'];scope=snapshot.get('research_scope')
    if not scope or scope.get('status')!='selected':return data
    return {**data,'periods':[p for p in data['periods'] if p['period']<=scope['period']]}


def plan_scope(query, data):
    resolved=resolve_question(query,data,[])
    blocked=resolved['status'] in ('needs_clarification','period_unavailable')
    return {'status':'blocked' if blocked else 'selected','period':resolved['period'],
            'explicit':resolved['period_explicit'],'requested_comparison':resolved['comparison'] if resolved['comparison_explicit'] else None,'available_periods':resolved['available_periods'],
            'notice':resolved['notice'] if blocked else '限定财务输入截至目标季度；证据资料仍按本次检索范围，不声称历史当时已可获得。'}
