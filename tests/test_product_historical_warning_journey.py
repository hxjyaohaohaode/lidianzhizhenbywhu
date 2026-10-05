"""Reader/admission adverse contracts; simulated geometry is not native evidence."""
from copy import deepcopy
from types import SimpleNamespace

import pytest

from scripts import product_historical_warning_journey as journey
from scripts.product_readout_oracles import _TEXT_GEOMETRY


def reading():
    return {'warning_title': journey.WARNING_TITLE, 'original_question': '原问题：' + journey.QUESTION,
        'notice': journey.NOTICE, 'history_notice': journey.HISTORY_NOTICE, 'export_notice': journey.EXPORT_NOTICE,
        'value_title': journey.VALUE_TITLE, 'query': journey.QUESTION, 'input_notice': journey.INPUT_NOTICE,
        'headers': ['目标季度', '当时记录的指标', '已保存结果', '原输入与公式'],
        'facts': [['2024-Q2', '营业成本', '10 万元', '营业成本：10 万元\n\n已保存的单季度输入（标准化为元）']],
        'source_rows': deepcopy(journey.SOURCE_ROWS), 'source_notice': journey.SOURCE_NOTICE,
        'warning_precedes_value': True, 'integrity': '记录一致性通过',
        'new_plan_label': '明确口径后新建研判', 'new_plan_route': 'agents'}


def test_complete_reader_contract_preserves_amount_and_does_not_certify_its_percent_answer():
    journey.expect_report_reading(reading())


@pytest.mark.parametrize('damage', [
    'warning_title', 'original_question', 'notice', 'history_notice', 'export_notice', 'value_title', 'query',
    'input_notice', 'headers', 'wrong_amount', 'yuan_in_wan_column', 'substitute_percentage', 'input_formula_tail',
    'duplicate_fact', 'missing_fact', 'invented_file', 'invented_hash', 'invented_basis', 'source_notice',
    'warning_after_amount', 'integrity', 'new_plan_label', 'new_plan_route'])
def test_reader_rejects_partial_or_misleading_historical_answers(damage):
    value = reading()
    if damage in {'warning_title', 'original_question', 'notice', 'history_notice', 'export_notice', 'value_title',
                  'query', 'input_notice', 'source_notice', 'new_plan_label'}:
        value[damage] = value[damage][:-4]
    elif damage == 'headers': value['headers'][1] = '所问指标'
    elif damage == 'wrong_amount': value['facts'][0][2] = '8 万元'
    elif damage == 'yuan_in_wan_column': value['facts'][0][2] = '100000 万元'
    elif damage == 'substitute_percentage': value['facts'][0][2] = '25%'
    elif damage == 'input_formula_tail': value['facts'][0][3] = value['facts'][0][3][:-5]
    elif damage == 'duplicate_fact': value['facts'] *= 2
    elif damage == 'missing_fact': value['facts'] = []
    elif damage == 'invented_file': value['source_rows'][1][1] = 'import.csv'
    elif damage == 'invented_hash': value['source_rows'][2][1] = '0' * 64
    elif damage == 'invented_basis': value['source_rows'][4][1] = '单季度'
    elif damage == 'warning_after_amount': value['warning_precedes_value'] = False
    elif damage == 'integrity': value['integrity'] = '原始资料与答案已认证'
    elif damage == 'new_plan_route': value['new_plan_route'] = 'agents:run-new'
    with pytest.raises(AssertionError): journey.expect_report_reading(value)


def current():
    thread = {'id': 'current-thread', 'payload': {'dataset_id': journey.DATASET_ID, 'identity_id': ''}}
    message = {'thread_id': thread['id'], 'payload': {'question': journey.QUESTION, 'response': {
        'answer': journey.NOTICE, 'facts': [], 'cards': [], 'external_calls': 0,
        'context': {'dataset_id': journey.DATASET_ID, 'identity': None, 'question_scope': {
            'status': 'unsupported_topic', 'can_calculate': False, 'topics': [], 'notice': journey.NOTICE}}}}}
    return message, thread


def test_current_refusal_contract_is_explicit_and_independent_of_old_report():
    message, thread = current()
    journey.expect_current_refusal(message, thread)


@pytest.mark.parametrize('damage', ['question', 'thread', 'dataset', 'identity', 'answer_tail', 'facts',
    'cards', 'scope_status', 'scope_calculate', 'topics', 'external', 'old_warning', 'source_dataset', 'source_identity'])
def test_current_refusal_rejects_relabelled_history_or_substitute_facts(damage):
    message, thread = current(); response = message['payload']['response']
    if damage == 'question': message['payload']['question'] = '2024-Q2成本金额'
    elif damage == 'thread': message['thread_id'] = 'old-thread'
    elif damage == 'dataset': thread['payload']['dataset_id'] = 'other'
    elif damage == 'identity': thread['payload']['identity_id'] = 'other'
    elif damage == 'answer_tail': response['answer'] = response['answer'][:-5]
    elif damage == 'facts': response['facts'] = [{'value': 100000, 'unit': 'CNY'}]
    elif damage == 'cards': response['cards'] = [{'kind': 'forecast'}]
    elif damage == 'scope_status': response['context']['question_scope']['status'] = 'supported'
    elif damage == 'scope_calculate': response['context']['question_scope']['can_calculate'] = True
    elif damage == 'topics': response['context']['question_scope']['topics'] = ['cost']
    elif damage == 'external': response['external_calls'] = 1
    elif damage == 'old_warning': message['question_compatibility'] = {'status': 'unsupported_operation'}
    elif damage == 'source_dataset': response['context']['dataset_id'] = 'other'
    elif damage == 'source_identity': response['context']['identity'] = {'id': 'other'}
    with pytest.raises(AssertionError): journey.expect_current_refusal(message, thread)


def reader_double(mode='scroll'):
    text = journey.NOTICE; moves, screenshots, ranges, waits = [], [], [], []
    y = 80
    class Locator:
        def wait_for(self, **kwargs):
            waits.append(kwargs)
            if mode == 'never_ready': raise TimeoutError('Actual visible text never arrived')
        def count(self): return 1
        def is_visible(self): return bool(waits) and mode != 'hidden'
        def locator(self, selector): return SimpleNamespace(count=lambda: 0)
        def inner_text(self): return text
        def text_content(self): return text
        def scroll_into_view_if_needed(self): pass
        def evaluate(self, script, needle):
            assert script == _TEXT_GEOMETRY and needle == text, 'Reader must measure the entire warning, never a keyword.'
            ranges.append(needle)
            clip_bottom = 60 if mode == 'ancestor_clip' else 100
            visible = y >= 40 and y + 30 <= clip_bottom
            return {'found': mode != 'missing_range', 'visible': visible,
                'left': 10, 'right': 190, 'top': y, 'bottom': y + 30,
                'root': {'left': 0, 'right': 200, 'top': 40, 'bottom': clip_bottom},
                'clip': {'left': 0, 'right': 200, 'top': 40, 'bottom': clip_bottom}}
    def wheel(dx, dy):
        nonlocal y
        moves.append((dx, dy))
        if mode != 'no_motion': y = 40
    p = SimpleNamespace(observations={}, step=lambda label, work: work(),
        screenshot=lambda suffix: screenshots.append(suffix) or suffix,
        page=SimpleNamespace(mouse=SimpleNamespace(move=lambda x, y: None, wheel=wheel), evaluate=lambda _: None))
    return p, Locator(), moves, screenshots, ranges, waits


def test_full_warning_waits_then_uses_real_scroll_geometry_and_keeps_reached_frame():
    p, target, moves, screenshots, ranges, waits = reader_double()
    journey._read_complete_groups(p, [(target, [journey.NOTICE])], 'full current warning')
    assert waits == [{'state': 'visible', 'timeout': 10000}]
    assert moves and screenshots and all(text == journey.NOTICE for text in ranges)
    reading = p.observations['complete_text_groups'][0]
    assert reading['text'] == journey.NOTICE and reading['geometry']['visible']
    assert reading['screenshot'] and reading['manual_pixel_review'] == 'pending'
    assert p.observations['reading_group_scrolls'][0]['attempts'][0]['range_movement']['y'] != 0


@pytest.mark.parametrize('mode', ['never_ready', 'hidden', 'missing_range', 'no_motion', 'ancestor_clip'])
def test_reader_never_passes_dom_text_without_readiness_or_full_unclipped_range(mode):
    p, target, _, _, _, _ = reader_double(mode)
    with pytest.raises((AssertionError, TimeoutError)):
        journey._read_complete_groups(p, [(target, [journey.NOTICE])], 'not actually readable')
    assert p.observations.get('complete_text_groups', []) == []


def test_exact_native_mutation_budget_allows_one_current_message_but_no_new_history_or_plan():
    allowed = [('POST', '/api/auth/register'), ('POST', '/api/services/threads'),
               ('POST', '/api/services/threads/new-thread/messages')]
    journey.expect_mutations(allowed, 'new-thread')
    for extra in [('POST', '/api/workspace/plans'), ('POST', '/api/runs'),
                  ('POST', '/api/services/threads/new-thread/proposals'), allowed[-1]]:
        with pytest.raises(AssertionError): journey.expect_mutations(allowed + [extra], 'new-thread')
    with pytest.raises(AssertionError): journey.expect_mutations(allowed, 'other-thread')
