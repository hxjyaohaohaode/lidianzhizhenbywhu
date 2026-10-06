"""Contracts for service identities, the research copilot and private connections.

Service identities personalize work inside an account. They never grant access to
another account and are deliberately not advertised as an organization/RBAC system.
"""
from __future__ import annotations
from datetime import date
from typing import Literal
from pydantic import Field, model_validator, field_validator
from .schemas import StorageInteger, StrictModel
from .autonomy_contracts import ExecutionOptions
from .business_provenance import SourceRef
from .contracts import ExperimentReference


class IdentitySpec(StrictModel):
    name: str = Field(min_length=1, max_length=60)
    perspective: Literal['operator', 'executive', 'investor', 'researcher', 'auditor', 'custom'] = 'operator'
    objective: str = Field(default='', max_length=1200)
    depth: Literal['concise', 'balanced', 'deep'] = 'balanced'
    output_style: Literal['actionable', 'analytical', 'evidence_first'] = 'actionable'
    dataset_ids: list[str] = Field(default_factory=list, max_length=40)
    allow_external: bool = False
    max_calls: int = Field(default=3, ge=0, le=8)
    include_shared_memory: bool = True
    version: StorageInteger = Field(default=0, ge=0)

    @field_validator('dataset_ids')
    @classmethod
    def unique(cls, value):
        if len(value) != len(set(value)) or any(not x or len(x) > 80 for x in value):
            raise ValueError('企业数据范围不能重复或使用无效标识')
        return value


class ThreadCreate(StrictModel):
    identity_id: str = Field(default='', max_length=80)
    dataset_id: str = Field(default='', max_length=80)
    title: str = Field(default='新的研究', min_length=1, max_length=100)
    request_id: str | None = Field(default=None, pattern=r'^[a-zA-Z0-9_-]{8,80}$')


class CopilotMessage(StrictModel):
    text: str = Field(min_length=1, max_length=3000)
    request_id: str = Field(pattern=r'^[a-zA-Z0-9_-]{8,80}$')
    version: StorageInteger = Field(ge=1)

    @field_validator('text')
    @classmethod
    def nonempty_text(cls, value):
        if not value.strip():
            raise ValueError('问题不能为空白')
        return value


class ProposalRequest(StrictModel):
    kind: Literal['research', 'action', 'watch', 'memory']
    title: str = Field(default='', max_length=200)
    text: str = Field(default='', max_length=3000)
    source_message_id: str = Field(default='', max_length=80)
    request_id: str = Field(pattern=r'^[a-zA-Z0-9_-]{8,80}$')
    include_thread_history: bool = False
    use_llm: bool = False
    provider: str = Field(default='', max_length=40)
    max_calls: int = Field(default=3, ge=0, le=8)
    execution: ExecutionOptions = Field(default_factory=ExecutionOptions)
    experiment: ExperimentReference | None = None
    comparison_artifact: ExperimentReference | None = None
    mode: Literal['operational', 'margin', 'industry', 'investment', 'deep_dive'] = 'operational'
    metric: Literal['gross_margin', 'cash_ratio', 'leverage', 'revenue_growth', 'cash_flow', 'revenue'] = 'gross_margin'
    operator: Literal['lt', 'gt'] = 'lt'
    threshold: float = Field(default=0.0, strict=True, ge=-1e15, le=1e15)
    due_at: date | None = None
    expires_at: date | None = None
    acceptance: str = Field(default='', max_length=2000)

    @model_validator(mode='after')
    def no_irrelevant_external(self):
        if self.kind != 'research' and self.use_llm:
            raise ValueError('此类操作不需要外部模型')
        if self.kind != 'research' and (self.experiment or self.comparison_artifact):
            raise ValueError('数学实验和企业对照只能明确加入研究提案')
        if self.kind == 'research' and len(self.acceptance) > 1000:
            raise ValueError('研究验收标准最多1000个字符')
        return self


class ProposalConfirm(StrictModel):
    version: StorageInteger = Field(ge=1)
    fingerprint: str = Field(pattern=r'^[a-f0-9]{64}$')
    external_consent: bool = False


class WatchSpec(StrictModel):
    request_id: str | None = Field(default=None, pattern=r'^[a-zA-Z0-9_-]{8,80}$')
    source_ref: SourceRef | None = Field(default=None, description='新建必须提供完整的数据修订引用或可核验的原始来源。更新必须省略此不可变来源，并使用跟踪记录自身版本。')
    title: str = Field(min_length=1, max_length=200)
    identity_id: str = Field(default='', max_length=80)
    dataset_id: str = Field(min_length=1, max_length=80)
    metric: Literal['gross_margin', 'cash_ratio', 'leverage', 'revenue_growth', 'cash_flow', 'revenue']
    operator: Literal['lt', 'gt']
    threshold: float = Field(strict=True, ge=-1e15, le=1e15)
    active: bool = True
    stale_after_days: int = Field(default=180, ge=30, le=1460)
    expires_at: date | None = None
    version: StorageInteger = Field(default=0, ge=0)

    @model_validator(mode='after')
    def request_id_create_only(self):
        if self.version and self.request_id is not None:
            raise ValueError('提交标识只用于新建跟踪；更新应使用记录版本')
        if not self.version and self.source_ref is None:
            raise ValueError('新跟踪必须提供已查看的数据版本和内容指纹，或指定可核验的原始来源')
        return self


class AlertAck(StrictModel):
    note: str = Field(default='已核对', min_length=2, max_length=1000)
    version: StorageInteger = Field(ge=1)


class PrivateConnection(StrictModel):
    name: str = Field(min_length=1, max_length=60)
    base_url: str = Field(min_length=8, max_length=500)
    model: str = Field(min_length=1, max_length=150)
    api_key: str = Field(default='', max_length=1000)
    password: str = Field(min_length=1, max_length=128)
    version: StorageInteger = Field(default=0, ge=0)


class Reauthenticate(StrictModel):
    password: str = Field(min_length=1, max_length=128)


class ConnectionRemove(Reauthenticate):
    version: StorageInteger = Field(ge=1)


class SessionRevoke(Reauthenticate):
    id: str = Field(default='', max_length=80)
    others: bool = False
