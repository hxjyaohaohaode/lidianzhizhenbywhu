"""Question-level presentation of frozen calculator values and approved sources.

No calculator, provider or historical-query reparser runs here. New plans freeze
which metrics were requested; older plans without that record remain explicit.
"""
from __future__ import annotations
import copy
import math
from .analytics import METRIC_LABELS
from .metric_facts import AMOUNT_METRICS, RATIO_METRICS
from .store import digest

FIELD_LABELS={**METRIC_LABELS,'assets':'总资产','liabilities':'总负债','inventory':'库存金额',
    'equity_begin':'期初净资产','equity_end':'期末净资产','rd_expense':'研发费用'}
UNIT_LABELS={'yuan':'元','wan':'万元','yi':'亿元'}
BASIS_LABELS={'standalone_quarter':'单季度','year_to_date':'年初累计转单季度'}


def capture_input_source(store, owner, dataset, period):
    """Freeze only an owned, exact-revision receipt applicable to the target.

    A retained old quarter did not come from the latest imported file. Keep that
    boundary explicit rather than attributing all history to a recent upload.
    """
    base={'schema_version':1,'status':'not_recorded','dataset_id':dataset['id'],
        'dataset_version':dataset['version'],'dataset_hash':dataset['content_hash'],
        'period':period,'input_amount_unit':dataset['payload'].get('input_amount_unit'),
        'input_basis':None,'normalized_amount_unit':'yuan','normalized_basis':'standalone_quarter',
        'verification':'user_provided_not_independently_verified',
        'notice':'本修订未保存可绑定到目标季度的原文件回执；不推测文件名或指纹。'}
    try:
        row=store.one('SELECT payload,content_hash FROM dataset_import_receipts WHERE user_id=? AND dataset_id=? AND version=?',
            (owner,dataset['id'],dataset['version']))
        if not row:return base
        p=row['payload']
        valid=isinstance(p,dict) and digest(p)==row['content_hash']
    except (ValueError,TypeError):
        return {**base,'status':'invalid','notice':'导入回执损坏，不能作为原文件来源；未生成替代文件信息。'}
    if (not valid or type(p.get('schema_version')) is not int or p['schema_version']!=1
        or type(p.get('dataset_version')) is not int
        or p.get('dataset_id')!=dataset['id'] or p.get('dataset_version')!=dataset['version']
        or p.get('dataset_hash')!=dataset['content_hash']):
        return {**base,'status':'invalid','notice':'本修订导入回执未通过指纹或版本绑定核对；不能作为原文件来源。'}
    context=p.get('import_context')
    if p.get('source_kind')=='structured_preview':
        return {**base,'source_kind':'structured_input','input_basis':p.get('basis') if p.get('basis') in BASIS_LABELS else None,
            'receipt_hash':row['content_hash'],'confirmed_at':p.get('confirmed_at'),
            'notice':'本修订通过结构化表单保存输入，未记录原文件；不把早期文件充当此修订全部字段的来源。'}
    if p.get('source_kind')!='file' or not isinstance(context,dict):
        return {**base,'status':'invalid','notice':'导入回执类型或文件元数据不完整；不能确定原文件来源。'}
    if any(not isinstance(context.get(k),list) or any(not isinstance(v,str) for v in context[k]) for k in ('added','replaced','retained')):
        return {**base,'status':'invalid','notice':'导入回执季度范围不完整，不能确定目标季度的文件来源。'}
    if period not in [*context['added'],*context['replaced']]:
        return {**base,'status':'quarter_not_bound','input_amount_unit':None,'notice':'目标季度来自保留的历史输入；本修订新导入文件不能被认作该季度的原始来源。'}
    required={'filename':str,'source_file_sha256':str,'source_file_bytes':int,
        'input_amount_unit':str,'input_basis':str}
    if (any(type(context.get(k)) is not t for k,t in required.items())
        or context['input_amount_unit'] not in UNIT_LABELS or context['input_basis'] not in BASIS_LABELS
        or len(context['source_file_sha256'])!=64 or any(c not in '0123456789abcdef' for c in context['source_file_sha256'])
        or context['source_file_bytes']<1):
        return {**base,'status':'invalid','notice':'原文件回执字段不完整；未生成替代文件信息。'}
    return {**base,'status':'recorded','input_amount_unit':context['input_amount_unit'],
        'input_basis':context['input_basis'],'confirmed_at':p.get('confirmed_at'),
        'receipt_hash':row['content_hash'],'source_kind':'uploaded_file',
        'file':{'name':context['filename'],'sha256':context['source_file_sha256'],'bytes':context['source_file_bytes']},
        'notice':'用户提供，未经独立核验；文件归属不表示所有字段均已提供。仅保存文件指纹与处理回执，未保存原文件，不提供原件单元格定位。'}


def display_number(value, unit, amount_unit='yuan'):
    if value is None:return '未提供' if unit=='CNY' else '不可计算'
    digits=2
    if unit=='CNY':
        scale={'yuan':1,'wan':1e4,'yi':1e8}.get(amount_unit,1);value=value/scale;digits=2+int(math.log10(scale))
    elif unit in ('ratio','ratio_points'):value=value*100
    rendered=f'{value:,.{digits}f}'.rstrip('0').rstrip('.')
    return rendered+(' '+UNIT_LABELS.get(amount_unit,'元') if unit=='CNY' else '%' if unit=='ratio' else ' 个百分点' if unit=='ratio_points' else ' 倍')


def build_readout(snapshot, analysis, links):
    """Copy recorded numbers; never calculate a replacement historical metric."""
    scope=snapshot.get('research_scope') or {};period=analysis['current_period']
    topics=scope.get('topics');known=isinstance(topics,list)
    current=next((p for p in analysis['series'] if p['period']==period),{})
    lineage={p['id']:p for p in links};facts=[];missing={}
    for key in dict.fromkeys(topics or []):
        if key not in METRIC_LABELS:continue
        link=lineage.get(key,{})
        raw=key in AMOUNT_METRICS
        value=current.get(key) if raw else analysis['metrics'].get(key)
        if not isinstance(value,(int,float)) or isinstance(value,bool) or not math.isfinite(value):value=None
        inputs=([{'path':f'periods/{period}/{key}','field':key,'value':value,'unit':'CNY'}] if raw else copy.deepcopy(link.get('inputs',[])))
        formula='已保存的单季度输入（标准化为元）' if raw else link.get('formula','已保存计算结果，原公式未记录')
        if key=='revenue_growth':
            formula='本期收入 ÷ 指定同比或环比基期收入 − 1；基期收入必须大于0'
            inputs=[{'path':f"periods/{p['period']}/revenue",'field':'revenue','value':p.get('revenue'),'unit':'CNY'}
                for p in analysis['series'] if p['period'] in (period,analysis['baseline_period'])]
        unit='CNY' if raw else 'ratio_points' if key=='margin_change' else 'ratio' if key in RATIO_METRICS else 'times'
        unavailable=[p for p in inputs if p.get('value') is None]
        reason=('该季度未提供'+METRIC_LABELS[key]+'金额，不能给出金额；缺失不按0处理。' if raw else
            '原始输入不足，不能计算；缺失不按0处理。' if unavailable else
            '冻结输入不满足本指标的计算条件，请核对分母或指定基期；未以0代替结果。') if value is None else ''
        facts.append({'id':key,'label':METRIC_LABELS[key],'period':period,'value':value,'unit':unit,
            'status':'missing' if value is None else 'available','reason':reason,'formula':formula,'inputs':inputs})
        for p in unavailable:
            field=p.get('field') or p['path'].rsplit('/',1)[-1]
            target=p['path'].split('/')[1]
            missing[(target,field)]={'period':target,'fields':[field],'conditional':False,
                'action':f'补充{target}的{FIELD_LABELS.get(field,field)}，确认金额单位和单季度口径，保存新修订后重新研判。'}
    steps=list(missing.values())
    if analysis['baseline_period'] is None:
        year,quarter=int(period[:4]),int(period[-1]);previous=analysis['comparison']=='previous'
        baseline=f'{year if quarter>1 else year-1}-Q{quarter-1 if quarter>1 else 4}' if previous else f'{year-1}-Q{quarter}'
        steps.append({'period':baseline,'fields':[],'conditional':True,
            'action':f'如需完成本次选择的'+('环比' if previous else '同比')+f'变化，请补充{baseline}同口径数据；这不影响本期已有输入可计算的指标水平。'})
    if not snapshot.get('citations'):
        steps.append({'period':period,'fields':['supporting_evidence'],'conditional':True,
            'action':'如需核验录入值或形成行业判断，请关联并审阅本次问题的原始资料；没有资料时保留证据缺口。'})
    amount_unit=snapshot.get('preferences',{}).get('amount_unit','yuan')
    if amount_unit not in UNIT_LABELS:amount_unit='yuan'
    source=copy.deepcopy(snapshot.get('input_source') or {'status':'not_recorded',
        'notice':'当时未记录原文件指纹与导入回执，不能从当前数据补写为旧报告依据。',
        'input_amount_unit':snapshot['dataset'].get('input_amount_unit'),'input_basis':None,
        'normalized_amount_unit':'yuan','normalized_basis':'standalone_quarter'})
    return {'schema_version':1,'scope_recorded':known,'period':period,'amount_unit':amount_unit,
        'facts':facts,'input_source':source,'next_steps':steps,
        'notice':'以下仅整理本报告冻结的问题范围、原始输入和计算结果；不代表输入已经独立核验。' if known else
            '旧计划未记录问题级指标范围；不重新解析历史问题或生成替代答案，原报告内容保留。'}


def answer_findings(readout):
    result=[]
    for f in readout['facts']:
        statement=f"{f['period']} {f['label']}："+display_number(f['value'],f['unit'],readout['amount_unit'])+'。'
        if f['reason']:statement+=f['reason']
        result.append(statement)
    return result
