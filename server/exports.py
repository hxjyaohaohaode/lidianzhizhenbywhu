"""Consistent, account-owned portable records; deliberately not a database restore."""
from .security import public_user
from .store import digest, now


def export_account(store, user_id):
    # One transaction prevents concurrent deletion/update from splitting snapshots
    # across revisions. Explicit table/column allowlists exclude authentication and
    # encrypted credentials; a new table is never exported automatically.
    with store.transaction():
        user = store.one('SELECT * FROM users WHERE id=?', (user_id,))
        from .security import fail
        if not user:
            fail('UNAUTHORIZED', '账户已不存在', 401)
        owned_tables = (
            'datasets', 'conversations', 'memories', 'evidence', 'runs',
            'messages', 'feedback', 'workspace_objects', 'dataset_revisions', 'dataset_import_receipts',
            'copilot_messages', 'tracking_receipts', 'adaptive_controls',
            'adaptive_graphs', 'adaptive_calls', 'audit',
        )
        data = {table: store.all(f'SELECT * FROM {table} WHERE user_id=? ORDER BY rowid', (user_id,))
                for table in owned_tables}
        for table in ('run_events', 'event_integrity', 'agent_artifacts', 'adaptive_checkpoints'):
            data[table] = store.all(
                f'SELECT t.* FROM {table} t JOIN runs r ON r.id=t.run_id WHERE r.user_id=? ORDER BY t.rowid',
                (user_id,))
        data['connections'] = store.all(
            'SELECT id,name,host,path,model,version,created_at,updated_at FROM private_connections WHERE user_id=? ORDER BY id',
            (user_id,))
        manifest = {table: {'count': len(rows), 'sha256': digest(rows)} for table, rows in data.items()}
        return {
            'format': 'lidian-user-export-v4', 'created_at': now(),
            'user': public_user(user), 'data': data, 'manifest': manifest,
            'scope': '账户业务记录与完整执行凭据；不含登录会话、密码哈希、模型密钥或加密密文',
            'restore': '这是可审阅的数据导出，不可直接还原数据库。灾难恢复请使用 SQLite 在线备份和原配对主密钥。',
            'schema_versions': {table: store.one(f'SELECT MAX(version) AS version FROM {table}')['version']
                                for table in ('schema_version', 'workspace_schema', 'adaptive_schema')},
        }
