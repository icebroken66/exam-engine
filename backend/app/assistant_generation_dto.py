"""Frozen public inputs. Model cannot create actions or URLs."""
from typing import Literal
from uuid import UUID
from pydantic import BaseModel, ConfigDict, Field, model_validator
from .assistant_workspace_dto import DTO, Id, Revision, Command

class RequestCreate(DTO):
    request_id: UUID
    expected_revision: Revision
    context_revision: Revision
    text: str = Field(min_length=1,max_length=10000)
    binding_ids: list[Id] = Field(default_factory=list,max_length=4)
    user_provided_binding_ids: list[Id] = Field(default_factory=list,max_length=4)
    retry_of: UUID | None = None
    clarification_of: UUID | None = None
    continuation_of: UUID | None = None
    answer_mode: Literal['short','complete'] = 'short'
    support_mode: Literal['auto','step','different','pause'] = 'auto'

    @model_validator(mode='after')
    def valid(self):
        if not self.text.strip() or len(set(self.binding_ids)) != len(self.binding_ids) or not set(self.user_provided_binding_ids) <= set(self.binding_ids):
            raise ValueError('正文或确认附件无效')
        return self

class Resolve(DTO):
    expected_revision: Revision
    allow_retest_help: bool = False
    user_provided_binding_ids: list[Id] = Field(default_factory=list,max_length=4)

class SaveExplanation(DTO):
    command_id: Id
    expected_revision: Revision
    evidence_ids: list[Id] = Field(default_factory=list,max_length=4)

    @model_validator(mode='after')
    def unique_evidence(self):
        if len(set(self.evidence_ids)) != len(self.evidence_ids):
            raise ValueError('引用目标不能重复')
        return self

class RevokeExplanation(Command):
    pass

class Claim(BaseModel):
    model_config = ConfigDict(extra='forbid')
    text: str = Field(min_length=1,max_length=6000)
    kind: Literal['evidence','model_explanation']
    evidence_ids: list[str] = Field(max_length=4)
    quote: str = Field(default='',max_length=10000)
    image_uncertainty: bool = False
    learning_observation: str = Field(default='',max_length=300)
    student_quote: str = Field(default='',max_length=2000)

class MentorReply(BaseModel):
    model_config = ConfigDict(extra='forbid')
    reply: str = Field(min_length=1,max_length=12000)
    claims: list[Claim] = Field(min_length=1,max_length=20)
