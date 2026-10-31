from dataclasses import dataclass
from hashlib import sha256
from pathlib import Path, PurePath
from uuid import uuid4

from fastapi import HTTPException, UploadFile, status


MAX_UPLOAD_BYTES = 50 * 1024 * 1024
CHUNK_BYTES = 1024 * 1024
ALLOWED_EXTENSIONS = {
    ".pdf", ".docx", ".pptx", ".txt", ".md", ".png", ".jpg", ".jpeg",
}


@dataclass(frozen=True)
class StoredUpload:
    original_name: str
    storage_key: str
    extension: str
    media_type: str
    size_bytes: int
    sha256: str
    path: Path


def clean_filename(value: str | None) -> str:
    name = PurePath((value or "").replace("\\", "/")).name.strip()
    name = "".join(char for char in name if char.isprintable())
    if not name or name in {".", ".."}:
        raise HTTPException(status_code=422, detail="文件名无效")
    return name[:180]


def persist_bytes(content: bytes, filename: str, media_type: str, storage_dir: Path) -> StoredUpload:
    original_name = clean_filename(filename)
    extension = Path(original_name).suffix.casefold()
    if extension not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=415, detail="仅支持 PDF、DOCX、PPTX、TXT、MD、PNG、JPG 文件")
    if not content:
        raise HTTPException(status_code=422, detail="不能上传空文件")
    if len(content) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="单个文件不能超过 50 MB")

    storage_dir.mkdir(parents=True, exist_ok=True)
    storage_key = f"{uuid4().hex}{extension}"
    destination = storage_dir / storage_key
    temporary = storage_dir / f".{storage_key}.part"
    try:
        with temporary.open("xb") as output:
            output.write(content)
        temporary.replace(destination)
    finally:
        temporary.unlink(missing_ok=True)
    return StoredUpload(
        original_name=original_name,
        storage_key=storage_key,
        extension=extension,
        media_type=media_type,
        size_bytes=len(content),
        sha256=sha256(content).hexdigest(),
        path=destination,
    )


async def persist_upload(upload: UploadFile, storage_dir: Path) -> StoredUpload:
    original_name = clean_filename(upload.filename)
    extension = Path(original_name).suffix.casefold()
    if extension not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=415, detail="仅支持 PDF、DOCX、PPTX、TXT、MD、PNG、JPG 文件")

    storage_dir.mkdir(parents=True, exist_ok=True)
    storage_key = f"{uuid4().hex}{extension}"
    destination = storage_dir / storage_key
    temporary = storage_dir / f".{storage_key}.part"
    digest = sha256()
    size = 0

    try:
        with temporary.open("xb") as output:
            while chunk := await upload.read(CHUNK_BYTES):
                size += len(chunk)
                if size > MAX_UPLOAD_BYTES:
                    raise HTTPException(status_code=413, detail="单个文件不能超过 50 MB")
                digest.update(chunk)
                output.write(chunk)
        if size == 0:
            raise HTTPException(status_code=422, detail="不能上传空文件")
        temporary.replace(destination)
    finally:
        temporary.unlink(missing_ok=True)
        await upload.close()

    return StoredUpload(
        original_name=original_name,
        storage_key=storage_key,
        extension=extension,
        media_type=upload.content_type or "application/octet-stream",
        size_bytes=size,
        sha256=digest.hexdigest(),
        path=destination,
    )
