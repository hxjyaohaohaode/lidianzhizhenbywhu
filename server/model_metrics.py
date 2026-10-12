"""Approved question-level metric projection and per-call reference receipts.

Copies existing calculator/raw-input values; never introduces a formula, live
lookup, or new permission. Old archived contexts are not enriched on dispatch.
"""
from __future__ import annotations
import math
import re
from .analytics import METRIC_LABELS
from .metric_facts import AMOUNT_METRICS, RATIO_METRICS
from .store import digest


def finite_number(value):
    return isinstance(value,(int,float)) and not isinstance(value,bool) and math.isfinite(value)


def project_metrics(snapshot, analysis):
    topics=(snapshot.get('research_scope') or {}).get('topics',[])
    if not isinstance(topics,list):
        raise ValueError('Approved metric topics are unavailable')
    period=analysis['current_period']
    current=next(p for p in analysis['series'] if p['period']==period)
    facts=[];metrics={}
    for key in dict.fromkeys(topics):
        if key not in METRIC_LABELS:continue
        value=current.get(key) if key in AMOUNT_METRICS else analysis['metrics'].get(key)
        value=value if finite_number(value) else None
        unit='CNY' if key in AMOUNT_METRICS else 'ratio_points' if key=='margin_change' else 'ratio' if key in RATIO_METRICS else 'times'
        metrics[key]=value
        facts.append({'id':key,'label':METRIC_LABELS[key],'value':value,'unit':unit,'period':period,
                      'status':'available' if value is not None else 'missing'})
    return metrics,{'schema_version':1,'dataset_version':snapshot['dataset_version'],
                    'dataset_hash':snapshot['dataset_hash'],'facts':facts}


def metric_receipt(context):
    """Bind only numeric values actually in this exact outbound context."""
    metrics=context.get('metrics',{})
    if not isinstance(metrics,dict):return {}
    scope=context.get('metric_scope')
    # Existing contexts without a question projection remain their original
    # approved disclosure. Never add current data or newly projected values.
    if 'metric_scope' not in context:
        return {key:{'value':value} for key,value in metrics.items() if finite_number(value)}
    if not isinstance(scope,dict) or type(scope.get('schema_version')) is not int or scope['schema_version']!=1 or not isinstance(scope.get('facts'),list):return {}
    if (type(scope.get('dataset_version')) is not int or not 1<=scope['dataset_version']<=9007199254740991
        or not isinstance(scope.get('dataset_hash'),str) or not re.fullmatch(r'[a-f0-9]{64}',scope['dataset_hash'])):return {}
    facts=scope['facts']
    if any(not isinstance(f,dict) or not isinstance(f.get('id'),str) for f in facts):return {}
    if len({f['id'] for f in facts})!=len(facts):return {}
    result={}
    for fact in facts:
        key=fact['id'];value=metrics.get(key)
        if (finite_number(value) and finite_number(fact.get('value')) and digest(fact['value'])==digest(value) and fact.get('status')=='available'
            and key in METRIC_LABELS and fact.get('unit') in {'CNY','ratio','ratio_points','times'}
            and isinstance(fact.get('period'),str)):
            result[key]={'value':value,'unit':fact['unit'],'period':fact['period'],
                         'dataset_version':scope.get('dataset_version'),'dataset_hash':scope.get('dataset_hash')}
    return result


def disclosed_metric_ids(expected, actual):
    if not isinstance(actual,dict):return set()
    return {key for key,binding in expected.items() if key in actual and digest(actual[key])==digest(binding)}
