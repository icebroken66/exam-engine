"""Explicit additive FE-V10 migration. Never reads .env or drops data."""
import argparse
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'backend'))
from sqlalchemy import create_engine, inspect
from app import models
from app.assistant_workspace_models import Topic
from app.assistant_generation_models import AssistantRequest, AssistantMessage

def migrate(url,check_only=False,backup_file=None):
    engine=create_engine(url)
    try:
        if not all(inspect(engine).has_table(t) for t in ['courses','assistant_topics']):raise ValueError('请先建立原课程及v2表，本迁移不改旧表')
        before={t:[(c['name'],str(c['type'])) for c in inspect(engine).get_columns(t)] for t in inspect(engine).get_table_names()}
        if not check_only:
            if engine.dialect.name!='sqlite' or not backup_file:raise ValueError('首版SQLite迁移必须指定全新 --backup-file；正式库不自动操作')
            import sqlite3
            backup=Path(backup_file).resolve()
            source=Path(engine.url.database).resolve()
            if backup==source or backup.exists():raise ValueError('备份必须是与原库不同的全新文件，禁止覆盖')
            backup.parent.mkdir(parents=True,exist_ok=True)
            with sqlite3.connect(source) as original, sqlite3.connect(backup) as destination:original.backup(destination)
            for model in [AssistantRequest,AssistantMessage]:model.__table__.create(engine,checkfirst=True)
        for t,columns in before.items():
            assert columns==[(c['name'],str(c['type'])) for c in inspect(engine).get_columns(t)]
        return {m.__tablename__:inspect(engine).has_table(m.__tablename__) for m in [AssistantRequest,AssistantMessage]}
    finally:engine.dispose()

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--database-url',required=True);parser.add_argument('--check-only',action='store_true');parser.add_argument('--backup-file',type=Path);args=parser.parse_args();print(migrate(args.database_url,args.check_only,args.backup_file))
