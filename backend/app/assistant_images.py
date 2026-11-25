"""Bounded, immutable image attachments for explicit assistant context."""
from dataclasses import dataclass
from hashlib import sha256
from io import BytesIO
import json
from pathlib import Path
from uuid import UUID, uuid4

from PIL import Image, ImageOps, UnidentifiedImageError

from .model_gateway import VisionImage
from . import assistant_workspace as ws

IMAGE_VERSION = 'assistant-image-normalized-v1'
MAX_UPLOAD_BYTES = 8 * 1024 * 1024
MAX_PIXELS = 25_000_000
MAX_EDGE = 2400


@dataclass(frozen=True)
class StoredImage:
    image_id: str
    sha256: str
    version: str
    width: int
    height: int
    size_bytes: int


def normalize(data: bytes) -> tuple[bytes, int, int]:
    if not data or len(data) > MAX_UPLOAD_BYTES:
        ws.fail('image_size', '图片为空或超过8 MB限制', 413)
    try:
        with Image.open(BytesIO(data)) as opened:
            if opened.format not in {'JPEG', 'PNG'}:
                ws.fail('image_format', '只接受JPEG或PNG图片', 415)
            if opened.width < 64 or opened.height < 64 or opened.width * opened.height > MAX_PIXELS:
                ws.fail('image_dimensions', '图片尺寸过小或像素总量超过限制', 422)
            image = ImageOps.exif_transpose(opened).convert('RGB')
            image.thumbnail((MAX_EDGE, MAX_EDGE))
            output = BytesIO()
            image.save(output, format='JPEG', quality=90, optimize=True)
            return output.getvalue(), image.width, image.height
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError):
        ws.fail('image_decode', '图片无法解码；未保存或发送', 422)


def store(upload_dir: Path, course_id: str, data: bytes) -> StoredImage:
    normalized, width, height = normalize(data)
    identity = str(uuid4())
    root = (Path(upload_dir).resolve() / 'assistant_images' / course_id).resolve()
    parent = (Path(upload_dir).resolve() / 'assistant_images').resolve()
    if not root.is_relative_to(parent):
        ws.fail('image_path', '图片存储位置无效', 500)
    root.mkdir(parents=True, exist_ok=True)
    with Image.open(BytesIO(data)) as original:
        metadata = {'schema_version':1,'original_sha256':sha256(data).hexdigest(),
                    'original_media_type':'image/png' if original.format=='PNG' else 'image/jpeg',
                    'original_width':original.width,'original_height':original.height,
                    'original_size_bytes':len(data),'exif_orientation':original.getexif().get(274,1),
                    'normalized_sha256':sha256(normalized).hexdigest(),'normalized_width':width,'normalized_height':height,
                    'normalization_version':IMAGE_VERSION,'transform':'exif_transpose_then_contain_no_crop'}
    # A new opaque identity owns all files; failed writes never return a usable upload receipt.
    files = [root / f'{identity}.original',root / f'{identity}.json',root / f'{identity}.jpg']
    try:
        files[0].write_bytes(data)
        files[1].write_text(json.dumps(metadata,ensure_ascii=False,sort_keys=True),encoding='utf-8')
        files[2].write_bytes(normalized)
    except OSError:
        for path in files:
            path.unlink(missing_ok=True)
        raise
    return StoredImage(identity, sha256(normalized).hexdigest(), IMAGE_VERSION, width, height, len(normalized))


def resolve(upload_dir: Path, course_id: str, binding: dict) -> tuple[Path, bytes]:
    identity = binding.get('image_id')
    try:
        UUID(identity)
    except (ValueError, TypeError, AttributeError):
        ws.fail('image_identity', '纸稿图片身份无效', 422)
    if binding.get('image_version') != IMAGE_VERSION:
        ws.fail('image_version', '纸稿图片处理版本已变化，请重新附加', 409)
    root = (Path(upload_dir).resolve() / 'assistant_images' / course_id).resolve()
    path = (root / f'{identity}.jpg').resolve()
    if not path.is_relative_to(root) or not path.is_file():
        ws.fail('image_missing', '纸稿图片已移除或不可用', 410)
    data = path.read_bytes()
    if sha256(data).hexdigest() != binding.get('image_sha256'):
        ws.fail('image_changed', '纸稿图片版本已变化，请重新附加', 409)
    try:
        with Image.open(BytesIO(data)) as opened:
            if opened.format != 'JPEG' or (opened.width, opened.height) != (binding.get('image_width'), binding.get('image_height')):
                ws.fail('image_changed', '纸稿图片尺寸或格式已变化，请重新附加', 409)
    except (UnidentifiedImageError, OSError):
        ws.fail('image_decode', '纸稿图片无法读取', 410)
    return path, data


def original_metadata(upload_dir: Path, course_id: str, binding: dict) -> dict | None:
    path, _ = resolve(upload_dir,course_id,binding)
    manifest=path.with_suffix('.json')
    if not manifest.is_file():
        return None
    if not manifest.resolve().is_relative_to(path.parent):
        ws.fail('image_original_changed','原图记录位置无效',409)
    try:
        metadata=json.loads(manifest.read_text(encoding='utf-8'))
        if (metadata['schema_version']!=1 or metadata['normalized_sha256']!=binding['image_sha256']
            or metadata['normalization_version']!=binding['image_version']
            or metadata['normalized_width']!=binding['image_width'] or metadata['normalized_height']!=binding['image_height']
            or metadata['original_media_type'] not in ('image/png','image/jpeg')):
            raise ValueError('metadata mismatch')
    except (OSError,ValueError,KeyError,TypeError):
        ws.fail('image_original_changed','原图与规范化图片的关系记录已变化，不能提供原件',409)
    return metadata


def resolve_original(upload_dir: Path, course_id: str, binding: dict) -> tuple[bytes, dict]:
    metadata=original_metadata(upload_dir,course_id,binding)
    if metadata is None:
        ws.fail('image_original_unavailable','此旧附件未保留上传原图，仅有规范化快照',410)
    if binding.get('image_original') and metadata!=binding['image_original']:
        ws.fail('image_original_changed','原图记录与确认时版本不一致',409)
    path=(Path(upload_dir).resolve()/'assistant_images'/course_id/f"{binding['image_id']}.original").resolve()
    root=(Path(upload_dir).resolve()/'assistant_images'/course_id).resolve()
    if not path.is_relative_to(root) or not path.is_file():
        ws.fail('image_original_unavailable','上传原图已移除，规范化快照仍可单独核对',410)
    data=path.read_bytes()
    if sha256(data).hexdigest()!=metadata['original_sha256'] or len(data)!=metadata['original_size_bytes']:
        ws.fail('image_original_changed','上传原图内容已变化，不能提供原件',409)
    return data,metadata


def vision_input(upload_dir: Path, course_id: str, binding: dict) -> VisionImage:
    _, data = resolve(upload_dir, course_id, binding)
    return VisionImage(data=data, media_type='image/jpeg', label='当前题未提交纸稿；用户提供图像，未经判分')
