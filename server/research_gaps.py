"""Turn actual calculator failures into reviewable needs, without imputing inputs."""
from .analytics import lineage


def needs_gap_analysis(quality, quant):
    return bool(quality['field_coverage']['missing'] or quant.get('baseline_period') is None or
                any(part['score'] is None for key in ('gmps','dqi') for part in quant[key]['dimensions']))


def research_gaps(data, quality, quant):
    items=[{'field':field,'action':'补充同口径的原始报表字段并保存新修订','auto_imputed':False}
           for field in quality['field_coverage']['missing']]
    known={item['field'] for item in items}
    for link in lineage(data,quant):
        if link['value'] is not None:continue
        for source in link['inputs']:
            if source['value'] is None and source['field'] not in known:
                known.add(source['field'])
                items.append({'field':source['field'],'path':source['path'],
                              'action':'补充'+link['label']+'所需的原始字段；不得将缺失当作零','auto_imputed':False})
    unavailable=[]
    for kind in ('gmps','dqi'):
        for part in quant[kind]['dimensions']:
            if part['score'] is not None:continue
            unavailable.append({'model':kind,'id':part['id'],'label':part['label'],'formula':part['formula']})
            items.append({'field':kind+':'+part['id'],'action':'核对'+part['label']+'的当前期与指定基期输入：'+part['formula'],
                          'auto_imputed':False})
    baseline=None
    if quant.get('baseline_period') is None:
        baseline={'current_period':quant['current_period'],'comparison':quant['comparison'],
                  'action':'补充指定同/环比季度；不自动改用其他季度，也不将缺失基期当作零'}
        items.append({'field':'comparison_baseline','action':baseline['action'],'auto_imputed':False})
    return {'items':items,'unavailable_rule_components':unavailable,'baseline_requirement':baseline,
            'findings':quality['findings'],'status':'needs_input' if items else 'completed',
            'limitation':'可计算不等于来源真实；缺口由已保存字段、指定基期和实际规则结果导出，不自动补值'}
