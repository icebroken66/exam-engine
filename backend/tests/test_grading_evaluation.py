"""Paid evaluation must fail before importing the gateway or changing old DBs."""
import json
from pathlib import Path
import subprocess
import sys

import pytest


@pytest.mark.parametrize("guard", ["no_marker", "existing_db", "wrong_source"])
def test_grading_replay_refuses_unsafe_inputs_before_calls(tmp_path, guard):
    root = Path(__file__).resolve().parents[2]
    directory = tmp_path / "isolated"
    directory.mkdir()
    if guard != "no_marker":
        (directory / "ISOLATED_ACCEPTANCE").touch()
    database = directory / "exam_engine.db"
    if guard == "existing_db":
        database.write_bytes(b"preserve this existing database")
    source = tmp_path / "source.pdf"
    source.write_bytes(b"not the checked source")
    fixture = tmp_path / "fixture.json"
    fixture.write_text(json.dumps({"source_sha256": "wrong"}), encoding="utf-8")
    cases = tmp_path / "cases.json"
    cases.write_text('[{"id":"one"}]', encoding="utf-8")
    result = subprocess.run([
        sys.executable, str(root / "scripts/evaluate_grading.py"), "--live",
        "--data-dir", str(directory), "--source", str(source),
        "--fixture", str(fixture), "--cases", str(cases),
    ], capture_output=True, text=True)
    assert result.returncode == 2
    assert not (directory / "grading.json").exists()
    if guard == "existing_db":
        assert database.read_bytes() == b"preserve this existing database"
    else:
        assert not database.exists()
