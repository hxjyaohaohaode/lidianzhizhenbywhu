"""Workspace contracts. All write requests reject unknown fields and non-finite values."""
from __future__ import annotations
from datetime import date
from typing import Literal
from pydantic import Field, model_validator
from .schemas import StrictModel, Text, Mode, Dataset
from .autonomy_contracts import ExecutionOptions


class CompanyProfile(StrictModel):
    company: Text
    sector: Literal['materials', 'cells', 'equipment', 'recycling', 'other'] = 'cells'
    focus: list[Literal['margin', 'cash', 'growth', 'inventory', 'leverage', 'evidence']] = Field(default_factory=lambda: ['margin', 'cash'], max_length=6)
    objective: str = Field(default='', max_length=1000)
    margin_floor: float | None = Field(default=None, ge=-1, le=1, strict=True)
    cash_floor: float | None = Field(default=None, ge=-5, le=5, strict=True)
    leverage_ceiling: float | None = Field(default=None, ge=0, le=5, strict=True)
    stale_after_days: int = Field(default=180, ge=30, le=730)
    version: int = Field(default=0, ge=0)


class PlanDraft(StrictModel):
    dataset_id: str = Field(min_length=1, max_length=80)
    query: str = Field(min_length=5, max_length=3000)
    mode: Mode = 'operational'
    comparison: Literal['previous', 'year_over_year'] = 'year_over_year'
    use_llm: bool = False
    provider: str = Field(default='', max_length=40)
    max_calls: int = Field(default=2, ge=0, le=8)
    execution: ExecutionOptions | None = None
    include_memory: bool = True
    include_history: bool = False
    session_id: str = Field(default='', max_length=80)
    success_criteria: str = Field(default='', max_length=1000)
    @model_validator(mode='after')
    def budget(self):
        if self.execution is None and self.max_calls > 3:
            raise ValueError('旧执行计划最多3次；更多调用必须明确使用自主编排合同')
        if self.execution and self.execution.model_planning and self.use_llm and self.max_calls < 2:
            raise ValueError('模型参与规划至少需要规划与执行两次预算')
        if self.use_llm and self.max_calls < 1:
            raise ValueError('启用模型时至少授权一次调用；不启用模型不会发出请求')
        return self


class PlanConsent(StrictModel):
    version: int = Field(ge=1)
    fingerprint: str = Field(pattern='^[a-f0-9]{64}$')
    external_consent: bool = False


class EvidenceReview(StrictModel):
    company: str = Field(default='', max_length=200)
    tags: list[Text] = Field(default_factory=list, max_length=8)
    status: Literal['unreviewed', 'accepted', 'rejected'] = 'unreviewed'
    stance: Literal['context', 'supports', 'contradicts'] = 'context'
    note: str = Field(default='', max_length=2000)
    expires_at: date | None = None
    version: int = Field(default=0, ge=0)
    @model_validator(mode='after')
    def reasoning(self):
        if self.status != 'unreviewed' and not self.note.strip():
            raise ValueError('接受或排除证据必须写明人工审阅依据')
        return self


class ActionCreate(StrictModel):
    title: Text
    company: str = Field(default='', max_length=200)
    dataset_id: str = Field(default='', max_length=80)
    run_id: str = Field(default='', max_length=80)
    source_key: str = Field(default='', max_length=200)
    priority: Literal['high', 'normal', 'low'] = 'normal'
    owner: str = Field(default='', max_length=100)
    due_at: date | None = None
    acceptance: str = Field(min_length=5, max_length=2000)
    description: str = Field(default='', max_length=3000)


class ActionTransition(StrictModel):
    version: int = Field(ge=1)
    status: Literal['open', 'in_progress', 'blocked', 'done', 'dismissed']
    note: str = Field(default='', max_length=2000)
    evidence_ids: list[str] = Field(default_factory=list, max_length=10)
    @model_validator(mode='after')
    def completion_proof(self):
        if self.status in ('done', 'blocked', 'dismissed') and len(self.note.strip()) < 5:
            raise ValueError('完成、阻塞或搁置时必须记录具体原因或验收结果')
        return self


class ExperimentRequest(StrictModel):
    dataset_id: str = Field(min_length=1, max_length=80)
    name: Text
    kind: Literal['scenario', 'forecast']
    price_change: float = Field(default=0.0, ge=-0.8, le=1, strict=True)
    cost_change: float = Field(default=0.0, ge=-0.8, le=1, strict=True)
    volume_change: float = Field(default=0.0, ge=-0.8, le=1, strict=True)
    fixed_cost_share: float = Field(default=0.0, ge=0, le=1, strict=True)
    metric: Literal['revenue', 'cost', 'cash_flow', 'gross_margin'] = 'revenue'
    horizon: int = Field(default=2, ge=1, le=4)
    assumptions: str = Field(min_length=5, max_length=2000)


class ImportPreview(StrictModel):
    dataset: Dataset
    basis: Literal['standalone_quarter', 'year_to_date'] = 'standalone_quarter'
    target_id: str = Field(default='', max_length=80)
    target_version: int = Field(default=0, ge=0)
    @model_validator(mode='after')
    def target(self):
        if bool(self.target_id) != bool(self.target_version):
            raise ValueError('替换已有数据时必须同时指定数据集与版本')
        return self


class RevisionRestore(StrictModel):
    version: int = Field(ge=1)
    target_revision: int = Field(ge=1)


class ClaimReview(StrictModel):
    claim_id: str = Field(min_length=1, max_length=100)
    verdict: Literal['accepted', 'rejected', 'needs_evidence']
    note: str = Field(min_length=5, max_length=2000)
    version: int = Field(default=0, ge=0)


class TaskTemplate(StrictModel):
    name: Text
    query: str = Field(min_length=5, max_length=3000)
    mode: Mode = 'operational'
    success_criteria: str = Field(default='', max_length=1000)


class AssistantRequest(StrictModel):
    query: str = Field(min_length=1, max_length=1000)
    dataset_id: str = Field(default='', max_length=80)


class StageCommit(StrictModel):
    fingerprint: str = Field(pattern='^[a-f0-9]{64}$')
    version: int = Field(ge=1)


class DismissInsight(StrictModel):
    key: str = Field(min_length=1, max_length=200)
    note: str = Field(min_length=5, max_length=1000)
