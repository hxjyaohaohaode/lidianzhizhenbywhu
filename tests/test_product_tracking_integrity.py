"""I7 plain-text geometry contracts; no browser or product acceptance claim."""
import pytest

from scripts.product_tracking_integrity import _plain_reason_geometry_needle


class Reason:
    def __init__(self, text, *, child_count=1, first_is_text=True):
        self.content = {'text': text, 'child_count': child_count,
                        'first_is_text': first_is_text}

    def evaluate(self, expression):
        # Read-only DOM metadata is supplied here; native CI verifies real DOM.
        assert 'element.childNodes.length' in expression
        assert 'element.firstChild?.nodeType === Node.TEXT_NODE' in expression
        assert 'element.firstChild?.textContent' in expression
        return self.content


@pytest.mark.parametrize('raw,rendered', [
    # Exact textContent/innerText mismatch captured in run 37258110570.
    ('已按用户阈值核对 · 2024-Q4  · 当前值 0.2',
     '已按用户阈值核对 · 2024-Q4 · 当前值 0.2'),
    ('当前财务输入校验失败，未计算或生成提醒 ',
     '当前财务输入校验失败，未计算或生成提醒'),
    ('\t已核对\n当前值\r\n0.2\f ', '已核对 当前值 0.2'),
    ('已核对 当前值 0.2', '已核对 当前值 0.2'),
])
def test_whole_raw_text_is_preserved_for_geometry_offsets(raw, rendered):
    assert _plain_reason_geometry_needle(Reason(raw), rendered) == raw


@pytest.mark.parametrize('reason', [
    Reason('', child_count=0, first_is_text=False),
    Reason('已核对', child_count=2),  # Includes any extra hidden descendant.
    Reason('已核对', child_count=1, first_is_text=False),  # Element or comment.
    Reason('已核对', child_count=2, first_is_text=False),
])
def test_changed_or_multi_node_structure_fails_closed(reason):
    with pytest.raises(AssertionError, match='exactly one plain text node'):
        _plain_reason_geometry_needle(reason, '已核对')


@pytest.mark.parametrize('raw,rendered', [
    ('已按用户阈值核对 · 2024-Q4  · 当前值 0.3',
     '已按用户阈值核对 · 2024-Q4 · 当前值 0.2'),
    ('已按用户阈值核对 · 2024-Q3  · 当前值 0.2',
     '已按用户阈值核对 · 2024-Q4 · 当前值 0.2'),
    ('未按用户阈值核对 · 2024-Q4  · 当前值 0.2',
     '已按用户阈值核对 · 2024-Q4 · 当前值 0.2'),
    ('当前值\u00a00.2', '当前值 0.2'),  # Do not normalize non-breaking units.
    ('已核对\n当前值 0.2', '已核对\n当前值 0.2'),  # Preformatted mismatch.
])
def test_substantive_or_non_html_whitespace_changes_are_rejected(raw, rendered):
    with pytest.raises(AssertionError, match='already-checked rendered reason'):
        _plain_reason_geometry_needle(Reason(raw), rendered)


@pytest.mark.parametrize('raw,rendered', [(None, '已核对'), ('', ''), ('   ', '')])
def test_missing_or_blank_reason_cannot_pass(raw, rendered):
    with pytest.raises(AssertionError, match='must not be empty'):
        _plain_reason_geometry_needle(Reason(raw), rendered)
