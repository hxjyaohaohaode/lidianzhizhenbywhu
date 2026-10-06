"""Explicit, bounded financial report normalization; never infer units or missing values."""
import math
import re

HEADER_ALIASES = {
    '报告期':'period', '会计期间':'period', '营业收入合计':'revenue',
    '经营活动产生的现金流量净额':'cash_flow', '资产总计':'assets',
    '负债合计':'liabilities', '存货':'inventory',
}
# A comma is accepted only as an unambiguous three-digit grouping separator.
NUMBER = re.compile(r'-?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?\Z')


def accounting_number(value, field):
    if isinstance(value, bool):
        raise ValueError('不允许布尔数字')
    if isinstance(value, (int, float)):
        if not math.isfinite(value):raise ValueError('不允许非有限数值')
        return float(value), ''
    text = str(value).strip()
    if text.startswith(('=', '@', '+')):
        raise ValueError('不执行公式或带 +/@ 前缀的表达式')
    percent = text.endswith('%')
    if percent:
        if field != 'industry_volatility':raise ValueError('金额/数量列不接受百分号，请核对列与单位')
        text = text[:-1]
    negative = text.startswith('(') and text.endswith(')')
    if negative:text = text[1:-1]
    if not NUMBER.fullmatch(text) or (negative and text.startswith('-')):
        raise ValueError('仅支持纯数字、规范千分位（1,234.56）或括号负数；缺失值请留空，不使用横线或单位后缀')
    result = float(text.replace(',', '')) * (-1 if negative else 1) / (100 if percent else 1)
    if not math.isfinite(result):raise ValueError('不允许非有限数值')
    rules = []
    if ',' in text:rules.append('移除千分位')
    if negative:rules.append('括号转负数')
    if percent:rules.append('百分比转比值')
    return result, '、'.join(rules)
