from __future__ import annotations
import os
from dataclasses import dataclass, field
from pathlib import Path

@dataclass(frozen=True)
class Settings:
    data_dir: Path = field(default_factory=lambda: Path(os.getenv('DATA_DIR', '.runtime/workbench')).resolve())
    production: bool = field(default_factory=lambda: os.getenv('APP_ENV', 'development') == 'production')
    origin: str = field(default_factory=lambda: os.getenv('APP_ORIGIN', 'http://127.0.0.1:8000').rstrip('/'))
    invite_code: str = field(default_factory=lambda: os.getenv('REGISTRATION_CODE', ''))
    session_hours: int = 12
    concurrency: int = 2
    max_queued_per_user: int = 6
    max_body_bytes: int = 2_000_000
    max_context_chars: int = 18000
    run_timeout: float = 90.0
    provider_timeout: float = 20.0
    allowed_hosts: tuple[str, ...] = ('www.cninfo.com.cn','static.cninfo.com.cn','www.sse.com.cn','www.szse.cn','www.bse.cn','www.stats.gov.cn','data.stats.gov.cn','data.eastmoney.com','pdf.dfcfw.com')

    def validate(self) -> None:
        from urllib.parse import urlsplit
        url = urlsplit(self.origin)
        if url.scheme not in ('http','https') or not url.hostname or url.path not in ('','/') or url.query or url.fragment or url.username:
            raise RuntimeError('APP_ORIGIN必须是完整且不带路径的http/https源。')
        if self.production and (not self.origin.startswith('https://') or len(self.invite_code) < 16):
            raise RuntimeError('生产环境要求 HTTPS APP_ORIGIN 和至少16位 REGISTRATION_CODE。')
        if self.concurrency < 1 or self.max_context_chars < 1024:
            raise RuntimeError('无效的任务/上下文配置。')
