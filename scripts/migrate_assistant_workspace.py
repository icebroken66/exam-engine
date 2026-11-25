"""Explicit additive FE-V08 migration; requires a database URL, never uses .env.

python scripts/migrate_assistant_workspace.py --database-url sqlite:///TEMP/test.db
Rollback disables ASSISTANT_WORKSPACE_WRITES; never drops user records.
"""
import argparse
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from sqlalchemy import create_engine, inspect
from app import models  # Register existing FK targets without connecting or migrating.
from app.assistant_workspace_models import Topic, WorkItem, WorkspaceCommand


def migrate(url):
    engine = create_engine(url)
    try:
        if not inspect(engine).has_table('courses'):
            raise ValueError('先建立原课程schema；本迁移不创建或修改旧表')
        for model in (WorkItem, Topic, WorkspaceCommand):
            model.__table__.create(engine, checkfirst=True)
        return [m.__tablename__ for m in (WorkItem, Topic, WorkspaceCommand)]
    finally:
        engine.dispose()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--database-url', required=True)
    args = parser.parse_args()
    print({'created_or_existing': migrate(args.database_url)})
