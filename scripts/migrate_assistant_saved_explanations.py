"""Explicit additive FE-V11 migration for saved explanation relations.

Pass an explicit local SQLite URL and a fresh backup path. This script never
loads application settings, drops tables, or migrates a database implicitly.
"""
import argparse
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'backend'))
from sqlalchemy import create_engine, inspect
from app import models
from app.assistant_workspace_models import Topic
from app.assistant_generation_models import AssistantRequest, AssistantMessage, SavedExplanation

def migrate(url, backup_file):
    engine=create_engine(url)
    try:
        inspector=inspect(engine)
        if not all(inspector.has_table(t) for t in ('courses','assistant_topics','assistant_requests','assistant_messages')):
            raise ValueError('请先建立课程、主题和助手回答表；本迁移只增加保存关系表')
        if inspector.has_table(SavedExplanation.__tablename__):return {'table':SavedExplanation.__tablename__,'created':False}
        if engine.dialect.name!='sqlite':raise ValueError('当前迁移只支持显式SQLite库')
        import sqlite3
        source=Path(engine.url.database).resolve();backup=Path(backup_file).resolve()
        if source==backup or backup.exists():raise ValueError('备份必须是与原库不同的全新文件，禁止覆盖')
        backup.parent.mkdir(parents=True,exist_ok=True)
        original=sqlite3.connect(source);destination=sqlite3.connect(backup)
        try:original.backup(destination)
        finally:destination.close();original.close()
        SavedExplanation.__table__.create(engine,checkfirst=True)
        return {'table':SavedExplanation.__tablename__,'created':True,'backup':str(backup)}
    finally:engine.dispose()

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--database-url',required=True);parser.add_argument('--backup-file',type=Path,required=True);args=parser.parse_args();print(migrate(args.database_url,args.backup_file))
