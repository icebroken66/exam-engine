from collections.abc import Generator

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from .config import get_database_url


class Base(DeclarativeBase):
    pass


connect_args = {"check_same_thread": False} if get_database_url().startswith("sqlite") else {}
engine = create_engine(get_database_url(), connect_args=connect_args)
SessionLocal = sessionmaker(bind=engine, expire_on_commit=False)


def migrate_schema() -> None:
    inspector = inspect(engine)
    if not inspector.has_table("learning_tasks"):
        return
    columns = {column["name"] for column in inspector.get_columns("learning_tasks")}
    if "remediation_answer" in columns:
        return
    with engine.begin() as connection:
        connection.execute(text("ALTER TABLE learning_tasks ADD COLUMN remediation_answer TEXT"))
        connection.execute(text(
            "UPDATE learning_tasks SET remediation_answer = reference_answer WHERE remediation_answer IS NULL"
        ))


def get_db() -> Generator[Session, None, None]:
    with SessionLocal() as session:
        yield session
