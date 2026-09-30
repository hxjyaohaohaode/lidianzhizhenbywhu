"""Declarative autonomy: goals and bounded capabilities, never executable model code."""
from __future__ import annotations
from typing import Literal
from pydantic import Field, model_validator
from .schemas import StrictModel

Role = Literal['planner', 'analyst', 'researcher', 'challenger', 'revision']
Focus = Literal['quality', 'margin', 'cash', 'forecast', 'sensitivity', 'evidence', 'counterevidence']

class ScenarioAssumptions(StrictModel):
    price_change: float = Field(default=0.0, ge=-.8, le=1, strict=True)
    cost_change: float = Field(default=0.0, ge=-.8, le=1, strict=True)
    volume_change: float = Field(default=0.0, ge=-.8, le=1, strict=True)
    fixed_cost_share: float = Field(default=0.0, ge=0, le=1, strict=True)
    note: str = Field(min_length=5, max_length=1000)

class ExecutionOptions(StrictModel):
    # None means a planning default; every explicit choice, including balanced,
    # must survive policy activation and replay unchanged.
    depth: Literal['concise', 'balanced', 'deep'] | None = None
    model_planning: bool = False
    max_revisions: int = Field(default=1, ge=0, le=2)
    local_recovery: bool = True
    parallelism: int = Field(default=2, ge=1, le=3)
    total_context_chars: int = Field(default=72000, ge=2000, le=144000)
    forecast: bool = False
    forecast_metric: Literal['revenue', 'cost', 'cash_flow', 'gross_margin'] = 'revenue'
    horizon: int = Field(default=2, ge=1, le=4)
    scenario: ScenarioAssumptions | None = None
    role_providers: dict[Role, str] = Field(default_factory=dict, max_length=5)
    # Empty by default. Only explicit opt-in fallback providers enter the disclosure envelope.
    fallback_providers: list[str] = Field(default_factory=list, max_length=2)
    @model_validator(mode='after')
    def bounded_ids(self):
        import re
        for value in [*self.role_providers.values(), *self.fallback_providers]:
            if not re.fullmatch(r'[a-z0-9_-]{1,40}', value):
                raise ValueError('模型标识必须来自服务端配置；不接受URL、脚本或空标识')
        if len(set(self.fallback_providers)) != len(self.fallback_providers):
            raise ValueError('候补模型不得重复')
        return self

class PlannerProposal(StrictModel):
    focus: list[Focus] = Field(default_factory=list, max_length=7)
    specialists: list[Literal['analyst', 'researcher', 'challenger']] = Field(default_factory=list, max_length=3)
    rationale: str = Field(min_length=1, max_length=800)
    execution_order: Literal['parallel','evidence_first','analysis_first'] = 'parallel'
    @model_validator(mode='after')
    def unique(self):
        if len(set(self.focus)) != len(self.focus) or len(set(self.specialists)) != len(self.specialists):
            raise ValueError('计划不得重复职责')
        return self

class RunControl(StrictModel):
    version: int = Field(ge=1)
    action: Literal['pause', 'resume']

class RunAssessment(StrictModel):
    verdict: Literal['useful', 'needs_revision', 'rejected']
    note: str = Field(min_length=5, max_length=2000)
    expected_capabilities: list[Literal['quality', 'quant', 'evidence', 'counterevidence', 'forecast', 'sensitivity', 'gaps']] = Field(default_factory=list, max_length=7)
    consent_replay: bool = False
    version: int = Field(default=0, ge=0)
    @model_validator(mode='after')
    def unique_rubric(self):
        if len(set(self.expected_capabilities)) != len(self.expected_capabilities):
            raise ValueError('人工验收能力不得重复')
        return self

class StrategySpec(StrictModel):
    name: str = Field(min_length=2, max_length=80)
    depth: Literal['concise', 'balanced', 'deep'] = 'balanced'
    require_counterevidence: bool = False
    require_gap_analysis: bool = False
    note: str = Field(min_length=5, max_length=1000)

class ActivateStrategy(StrictModel):
    evaluation_id: str = Field(min_length=1, max_length=80)
    expected_active_version: int = Field(ge=0)

class RollbackStrategy(StrictModel):
    expected_active_version: int = Field(ge=1)
