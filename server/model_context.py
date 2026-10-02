"""Minimize structured evidence metadata at the external-model boundary."""
from __future__ import annotations


def provider_context(context):
    """Return a projection without changing an approved or archived context.

    Source addresses are local provenance, not required evidence text. This
    removes only those structured metadata fields, including in persisted plans
    created by older versions. It is not general text or secret redaction:
    approved questions, excerpts, memories and history retain their content.
    """
    projected = dict(context)
    if 'evidence' in context:
        projected['evidence'] = [
            {key: value for key, value in item.items()
             if key not in ('source_url', 'original_source_url')}
            for item in context['evidence']
        ]
    return projected
