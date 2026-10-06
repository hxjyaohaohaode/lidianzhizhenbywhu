"""Exact generated backend artifacts; safe to import before dependencies install."""
OUTPUTS = ('pytest.xml', 'pytest-progress.jsonl', 'pytest-progress.stacks.log',
    'pytest.log', 'pytest-collection.json', 'pytest-collection.log',
    'pytest-manifest.json', 'pytest-shards.json',
    *(f'pytest-shard-{i}{suffix}' for i in range(2)
      for suffix in ('.log', '.xml', '-progress.jsonl', '-progress.stacks.log')))
