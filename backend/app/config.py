from functools import lru_cache
from pathlib import Path
import os


PROJECT_ROOT = Path(__file__).resolve().parents[2]


@lru_cache
def get_data_dir() -> Path:
    path = Path(os.getenv("EXAM_ENGINE_DATA_DIR", PROJECT_ROOT / "data"))
    path.mkdir(parents=True, exist_ok=True)
    return path


def get_database_url() -> str:
    return os.getenv(
        "DATABASE_URL",
        f"sqlite:///{(get_data_dir() / 'exam_engine.db').as_posix()}",
    )
