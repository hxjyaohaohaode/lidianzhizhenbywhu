"""Bounded, content-free diagnostics for isolated acceptance processes.

Never log headers, cookies, request/response bodies, URL queries or arbitrary
console text. These observations explain failures; they do not change verdicts,
timeouts, retry requests or provide evidence of long-term stability.
"""
from datetime import datetime, timezone
import hashlib
import json
import re
import threading
import time
from urllib.parse import urlsplit


# Fixed endpoint/asset vocabulary from the checked-in API contract. IDs and
# arbitrary path segments are never retained, even on the local test origin.
LOCAL_SEGMENTS = frozenset("""
    account acknowledge actions activate adaptive.css agents alerts analysis api api.js app.js
    archive assessment assets assistant assistant.js audit auth brand brand.js brief
    business-source.js cancel capabilities catalog commit compare comparisons components.js
    confirm connections control conversations copilot-research-inputs.js copilot-ui.js dataset
    datasets delete-batch dismiss dist docs.js evaluate events evidence evolution examples execute
    experience.js experiments export favicon.ico feedback fetch file health history identities
    import imports insights interactions.js layout.js lineage live.js loading-video.mp4 login
    logo.png logout math-results.js me memories messages metadata ops orchestration pages.js
    password plans preferences preview profiles proposals propose quality register remove reports
    research restore retrieval review reviews revisions revoke role rollback runs runtime
    saved-comparisons.js saved-experiments.js scenarios search security services sessions state.js
    status strategies strategy-evaluations styles.css sync template templates threads trace
    tracking views-analysis.js views-data.js views-orchestrator.js views-services.js
    views-studio.js watches workbench.css workflow.js workspace
""".split()) | {''}


def safe_location(url):
    """Keep only the local test origin's path, without query/fragment values."""
    parsed = urlsplit(str(url))
    if parsed.scheme in ('http', 'https') and parsed.netloc == '127.0.0.1:8000':
        return "/".join(segment if segment in LOCAL_SEGMENTS else ":value" for segment in parsed.path.split("/"))
    return '[non-local location omitted]'


WORKSPACES = frozenset('brief copilot agents lab evolution data evidence compare reports tracking actions memory services ops settings'.split())


def route_metadata(route):
    name = str(route).split(':', 1)[0]
    return {'workspace': name if name in WORKSPACES else '[unknown]', 'dynamic': ':' in str(route)}


def message_metadata(message):
    text = str(message)
    return {
        'message_sha256': hashlib.sha256(text.encode('utf-8')).hexdigest(),
        'message_length': len(text),
        'network_codes': re.findall(r'\b(?:net::)?ERR_[A-Z_]+\b', text)[:8],
        'text_omitted': True,
    }


class EventJournal:
    """Line-buffered evidence survives a later browser/parent failure."""
    def __init__(self, path, clock=time.monotonic, wall_clock=None, limit=6000):
        self.clock = clock
        self.wall_clock = wall_clock or (lambda: datetime.now(timezone.utc).isoformat())
        self.start = clock()
        self.limit = limit
        self.count = 0
        self.dropped = 0
        self.lock = threading.Lock()
        self.output = path.open('w', encoding='utf-8', buffering=1)
        self.emit('journal_started', content_policy='No bodies, headers, cookies, query values or console text')

    def emit(self, event, **fields):
        with self.lock:
            if self.output.closed:
                return
            if self.count >= self.limit:
                self.dropped += 1
                return
            self.count += 1
            self.output.write(json.dumps({
                'sequence': self.count, 'utc': self.wall_clock(),
                'elapsed_seconds': round(self.clock() - self.start, 6),
                'event': event, **fields,
            }, ensure_ascii=False) + '\n')

    def close(self):
        with self.lock:
            if self.output.closed:
                return
            self.output.write(json.dumps({'event': 'journal_closed', 'utc': self.wall_clock(),
                'elapsed_seconds': round(self.clock() - self.start, 6),
                'events_written': self.count, 'events_dropped': self.dropped}) + '\n')
            self.output.close()


def attach_browser_diagnostics(page, journal):
    """Observe native Playwright events without changing browser networking."""
    active = {}
    sequence = 0

    def request_started(request):
        nonlocal sequence
        sequence += 1
        active[request] = sequence
        journal.emit('request', request_id=sequence, method=request.method,
            path=safe_location(request.url), resource_type=request.resource_type)

    def request_ended(request, failed=False):
        fields = {'request_id': active.pop(request, None), 'method': request.method,
            'path': safe_location(request.url), 'resource_type': request.resource_type,
            'timing': request.timing}
        if failed:
            fields.update(message_metadata(request.failure or ''))
        journal.emit('requestfailed' if failed else 'requestfinished', **fields)

    def console(message):
        location = message.location
        journal.emit('console', level=message.type,
            path=safe_location(location.get('url', '')),
            line=location.get('lineNumber'), column=location.get('columnNumber'),
            **message_metadata(message.text))

    page.on('request', request_started)
    page.on('requestfinished', request_ended)
    page.on('requestfailed', lambda request: request_ended(request, True))
    page.on('response', lambda response: journal.emit('response',
        request_id=active.get(response.request), path=safe_location(response.url), status=response.status))
    page.on('console', console)
    page.on('pageerror', lambda error: journal.emit('pageerror', **message_metadata(error)))
    page.on('crash', lambda *_: journal.emit('page_crashed'))
    page.on('close', lambda *_: journal.emit('page_closed'))
