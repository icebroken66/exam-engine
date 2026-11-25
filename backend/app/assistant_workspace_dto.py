"""Public, bounded inputs. Client roles/messages are deliberately unsupported."""
from typing import Annotated, Literal
from pydantic import BaseModel, ConfigDict, Field, model_validator

Id = Annotated[str, Field(min_length=1, max_length=100)]
Revision = Annotated[int, Field(ge=0, strict=True)]


class DTO(BaseModel):
    model_config = ConfigDict(extra='forbid', allow_inf_nan=False)
    schema_version: Literal[2] = 2


class Command(DTO):
    command_id: Id
    expected_revision: Revision


class ItemCreate(Command):
    kind: Literal['platform_task', 'exploration']
    title: str = Field(min_length=1, max_length=200)
    session_id: Id | None = None
    task_id: Id | None = None

    @model_validator(mode='after')
    def target(self):
        if not self.title.strip() or ((self.kind == 'platform_task') != bool(self.session_id and self.task_id)):
            raise ValueError('平台事项需要真实会话和任务；探索不绑定平台任务')
        if self.kind == 'exploration' and (self.task_id or self.session_id):
            raise ValueError('探索不绑定平台任务')
        return self


class ViewRef(DTO):
    view: Literal['learn', 'reader', 'overview', 'materials', 'history']
    session_id: Id | None = None
    task_id: Id | None = None
    source_id: Id | None = None
    page: int | None = Field(default=None, ge=1, strict=True)


class Bookmark(DTO):
    relation: Literal['known', 'unknown']
    origin: ViewRef
    target: ViewRef


class AttentionWrite(Command):
    attention: Literal['ongoing', 'paused', 'finished']
    bookmark: Bookmark | None = None


class TopicCreate(Command):
    title: str = Field(min_length=1, max_length=200)
    mode: Literal['single', 'independent', 'compare']
    item_ids: list[Id] = Field(default_factory=list, max_length=2)

    @model_validator(mode='after')
    def count(self):
        if not self.title.strip() or len(set(self.item_ids)) != len(self.item_ids) or len(self.item_ids) != {'single': 1, 'independent': 0, 'compare': 2}[self.mode]:
            raise ValueError('主题目标数不匹配；比较需明确选择两项')
        return self


class ComposerWrite(Command):
    text: str = Field(max_length=10000)


class TopicUpdate(Command):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    mode: Literal['single', 'independent', 'compare'] | None = None
    item_ids: list[Id] | None = Field(default=None, max_length=2)

    @model_validator(mode='after')
    def metadata(self):
        if self.title is not None and not self.title.strip():
            raise ValueError('标题不能为空')
        if (self.mode is None) != (self.item_ids is None):
            raise ValueError('目标范围和目标必须一起修改')
        if self.mode is not None and (len(set(self.item_ids)) != len(self.item_ids) or len(self.item_ids) != {'single': 1, 'independent': 0, 'compare': 2}[self.mode]):
            raise ValueError('目标数量与范围不匹配')
        if self.title is None and self.mode is None:
            raise ValueError('没有需要修改的内容')
        return self


class Region(BaseModel):
    model_config = ConfigDict(extra='forbid', allow_inf_nan=False)
    x: float = Field(ge=0, le=1)
    y: float = Field(ge=0, le=1)
    width: float = Field(gt=0, le=1)
    height: float = Field(gt=0, le=1)

    @model_validator(mode='after')
    def bounds(self):
        if self.x + self.width > 1.000001 or self.y + self.height > 1.000001:
            raise ValueError('区域超出页面')
        return self


class Binding(DTO):
    role: Literal['document_excerpt', 'question', 'student_work', 'submitted_answer', 'visible_feedback']
    source_id: Id | None = None
    source_sha256: str | None = Field(default=None, min_length=64, max_length=64)
    preview_version: Id | None = None
    page: int | None = Field(default=None, ge=1, strict=True)
    regions: list[Region] = Field(default_factory=list, max_length=20)
    precision: Literal['text', 'region', 'page'] = 'text'
    text: str = Field(default='', max_length=10000)
    session_id: Id | None = None
    task_id: Id | None = None
    task_fingerprint: str | None = Field(default=None, min_length=64, max_length=64)
    attempt_id: Id | None = None
    image_id: Id | None = None
    image_sha256: str | None = Field(default=None, min_length=64, max_length=64)
    image_version: Id | None = None
    image_width: int | None = Field(default=None, ge=1, le=2400, strict=True)
    image_height: int | None = Field(default=None, ge=1, le=2400, strict=True)
    image_correction: str = Field(default='', max_length=2000)
    learning_focus: str = Field(default='', max_length=2000)

    @model_validator(mode='after')
    def target(self):
        if self.learning_focus and (self.role=='document_excerpt' or not self.learning_focus.strip()):
            raise ValueError('卡点说明需要题目身份和非空文字')
        if self.image_correction and (not self.image_correction.strip() or not self.image_id or self.role!='student_work'):
            raise ValueError('图片纠正需要明确的未提交纸稿身份和非空文字')
        if self.role == 'document_excerpt':
            if not all([self.source_id, self.source_sha256, self.preview_version, self.page]) or self.task_id or self.session_id or self.attempt_id or self.task_fingerprint or any([self.image_id,self.image_sha256,self.image_version,self.image_width,self.image_height]):
                raise ValueError('资料身份无效')
            if self.precision != 'page' and not self.regions:
                raise ValueError('选字或区域需要位置')
        else:
            if not self.task_id or not self.session_id or self.source_id or self.source_sha256 or self.preview_version or self.page or self.regions:
                raise ValueError('题目身份无效')
            if self.role in ('submitted_answer', 'visible_feedback') and not self.attempt_id:
                raise ValueError('需要明确已提交作答记录')
            if self.role not in ('submitted_answer', 'visible_feedback') and self.attempt_id:
                raise ValueError('该角色不接受作答记录')
            image_fields=[self.image_id,self.image_sha256,self.image_version,self.image_width,self.image_height]
            if any(image_fields) and (self.role!='student_work' or not all(image_fields)):
                raise ValueError('图片只能完整绑定到当前未提交作答')
        return self


class BindingWrite(Command):
    confirmed: Literal[True]
    binding: Binding
    replace_id: Id | None = None


class ManifestRead(DTO):
    expected_revision: Revision
    context_revision: Revision
    question: str = Field(min_length=1, max_length=10000)


class LegacyCopy(Command):
    source_fingerprint: str = Field(min_length=64, max_length=64)
    entry_id: Id | None = None
