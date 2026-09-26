from __future__ import annotations
import re
from datetime import date
from typing import Annotated, Literal
from pydantic import BaseModel, ConfigDict, Field, model_validator, field_validator

class StrictModel(BaseModel):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True, allow_inf_nan=False)

Text = Annotated[str, Field(min_length=1, max_length=200)]
Number = Annotated[float, Field(strict=True, ge=-1e15, le=1e15)]
Nonnegative = Annotated[float, Field(strict=True, ge=0, le=1e15)]
Mode = Literal['operational', 'margin', 'industry', 'investment', 'deep_dive']
Persona = Literal['enterprise', 'investor', 'analyst', 'advisor']

class Register(StrictModel):
    email: str = Field(min_length=5, max_length=180)
    password: str = Field(min_length=12, max_length=128)
    name: Text
    role: Persona = 'enterprise'
    invitation: str = Field(default='',max_length=200)
    @field_validator('email')
    @classmethod
    def email_check(cls, v):
        if not re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+', v):raise ValueError('邮箱格式不正确')
        return v.lower()

class Login(StrictModel):
    email: str = Field(min_length=1,max_length=180)
    password: str = Field(min_length=1,max_length=128)

class Preferences(StrictModel):
    role: Persona = 'enterprise'
    theme: Literal['light','dark','system'] = 'light'
    amount_unit: Literal['yuan','wan','yi'] = 'wan'
    risk_appetite: Literal['low','medium','high'] = 'medium'
    horizon: Literal['short','medium','long'] = 'long'
    interests: list[Text] = Field(default_factory=list,max_length=12)
    watchlist: list[Text] = Field(default_factory=list,max_length=20)
    memory_enabled: bool = True
    name: Text
    version: int = Field(ge=1)

class RoleSwitch(StrictModel):
    role: Persona
    version: int = Field(ge=1)

class Period(StrictModel):
    period: str = Field(pattern=r'^20\d{2}-Q[1-4]$')
    revenue: Nonnegative
    cost: Nonnegative
    net_profit: Number | None = None
    cash_flow: Number | None = None
    assets: Nonnegative | None = None
    liabilities: Nonnegative | None = None
    equity_begin: Number | None = None
    equity_end: Number | None = None
    inventory: Nonnegative | None = None
    sales_volume: Nonnegative | None = None
    production_volume: Nonnegative | None = None
    manufacturing_cost: Nonnegative | None = None
    rd_expense: Nonnegative | None = None
    lithium_price: Nonnegative | None = None
    industry_volatility: Annotated[float, Field(strict=True,ge=0,le=5)] | None = None
    @model_validator(mode='after')
    def meaningful(self):
        year=int(self.period[:4]); quarter=int(self.period[-1])
        if date(year,(quarter-1)*3+1,1)>date.today():raise ValueError('不接受未来季度作为历史实际数据')
        if self.assets==0 and (self.liabilities or 0)>0:raise ValueError('资产为0时不能填入正数负债；请检查单位和口径')
        return self

class Dataset(StrictModel):
    name: Text
    company: Text
    source_kind: Literal['user_provided','sample','public_document'] = 'user_provided'
    source_url: str = Field(default='',max_length=1000)
    currency: Literal['CNY'] = 'CNY'
    amount_unit: Literal['yuan','wan','yi'] = 'yuan'
    volume_unit: Literal['ton'] = 'ton'
    period_basis: Literal['standalone_quarter'] = 'standalone_quarter'
    notes: str = Field(default='',max_length=2000)
    periods: list[Period] = Field(min_length=1,max_length=40)
    @model_validator(mode='after')
    def valid_periods(self):
        labels=[p.period for p in self.periods]
        if len(labels)!=len(set(labels)):raise ValueError('季度不能重复')
        self.periods.sort(key=lambda p:p.period)
        return self
    @field_validator('source_url')
    @classmethod
    def source_url_check(cls,v):
        if v and not v.startswith('https://'):raise ValueError('来源地址必须使用https；留空表示未提供')
        return v

class DatasetUpdate(Dataset):
    version: int = Field(ge=1)

class Conversation(StrictModel):
    title: Text = '新的经营诊断'
    mode: Mode = 'operational'
    company: str = Field(default='',max_length=200)

class RunRequest(StrictModel):
    session_id: str = Field(min_length=1,max_length=80)
    dataset_id: str = Field(min_length=1,max_length=80)
    query: str = Field(min_length=1,max_length=3000)
    mode: Mode = 'operational'
    use_llm: bool = False
    provider: str = Field(default='',max_length=40)
    include_memory: bool = True
    comparison: Literal['previous','year_over_year'] = 'year_over_year'

class Evidence(StrictModel):
    title: Text
    text: str = Field(min_length=20,max_length=120000)
    source_url: str = Field(default='',max_length=1000)
    published_at: date | None = None
    @field_validator('source_url')
    @classmethod
    def safe_url(cls,v):
        if v and not v.startswith('https://'):raise ValueError('仅支持https来源链接')
        return v
    @field_validator('published_at')
    @classmethod
    def no_future_date(cls,v):
        if v and v>date.today():raise ValueError('发布日期不能晚于今天')
        return v

class FetchEvidence(StrictModel):
    url: str = Field(min_length=8,max_length=1000)
    title: Text
    published_at: date | None = None

class Memory(StrictModel):
    identity_id: str = Field(default='', max_length=80)
    text: str = Field(min_length=1,max_length=1500)
    kind: Literal['preference','fact','note'] = 'note'
    company: str = Field(default='',max_length=200)
    role: Persona | Literal['all'] = 'all'
    approved: bool = False
    expires_at: date | None = None
    source: str = Field(default='user',max_length=120)

class MemoryUpdate(Memory):
    version: int = Field(ge=1)

class Feedback(StrictModel):
    run_id: str = Field(min_length=1,max_length=80)
    rating: Literal['useful','incorrect','unclear']
    comment: str = Field(default='',max_length=2000)

class PasswordChange(StrictModel):
    current_password: str = Field(min_length=1,max_length=128)
    new_password: str = Field(min_length=12,max_length=128)

class Scenario(StrictModel):
    run_id: str = Field(default='',max_length=80)
    dataset_id: str = Field(min_length=1,max_length=80)
    price_change: float = Field(strict=True,ge=-0.8,le=1)
    cost_change: float = Field(strict=True,ge=-0.8,le=1)
    volume_change: float = Field(strict=True,ge=-0.8,le=1)

class CompareRequest(StrictModel):
    dataset_ids: list[Annotated[str,Field(min_length=1,max_length=80)]] = Field(min_length=2,max_length=8)
    comparison: Literal['previous','year_over_year'] = 'year_over_year'
    @field_validator('dataset_ids')
    @classmethod
    def unique_ids(cls,v):
        if len(v)!=len(set(v)):raise ValueError('比较对象不能重复')
        return v

class SearchRequest(StrictModel):
    query: str = Field(min_length=2,max_length=500)
    consent: Literal[True]

class BatchDelete(StrictModel):
    ids: list[Annotated[str,Field(min_length=1,max_length=80)]] = Field(min_length=1,max_length=20)
    @field_validator('ids')
    @classmethod
    def unique_ids(cls,v):
        if len(v)!=len(set(v)):raise ValueError('资源ID不能重复')
        return v
