"""Independent executable check for the SQL tutoring fixture; no model or app DB."""
from itertools import combinations
import json
from pathlib import Path
import sqlite3


def check():
    fixture = json.loads((Path(__file__).resolve().parents[1] / "evals/tutoring/sql-exemption.fixture.json").read_text(encoding="utf-8"))
    query = fixture["task"]["reference_answer"]
    records = [("P1", "C1", "T", 10, 1), ("P1", "C1", "T", 10, 1),
               ("P2", "C1", "T", 20, 1), ("P1", "C2", "T", 30, 1),
               (None, "C1", "T", 40, 1)]
    candidates = [("C1", "P1"), ("C2", "P1"), ("C1", "P2"), ("C1", None), (None, "P1")]
    checked = 0
    with sqlite3.connect(":memory:") as db:
        db.execute("CREATE TABLE REPORT(PID TEXT,CID TEXT,TPID TEXT,PRICE INT,QTY INT)")
        db.execute("CREATE TABLE WHITELIST(CID TEXT,PID TEXT)")
        db.executemany("INSERT INTO REPORT VALUES (?,?,?,?,?)", records)
        for size in range(len(candidates) + 1):
            for subset in combinations(candidates, size):
                # Repeat whitelist entries to expose JOIN fan-out; preserve report multiplicity.
                whitelist = list(subset) * 2
                db.execute("DELETE FROM WHITELIST")
                db.executemany("INSERT INTO WHITELIST VALUES (?,?)", whitelist)
                expected = [(pid, price) for pid, cid, _, price, _ in records
                            if cid == "C1" and pid is not None and any(wc == cid and wp == pid for wc, wp in whitelist)]
                expected.sort(key=lambda row: row[0], reverse=True)
                actual = db.execute(query).fetchall()
                assert actual == expected, (subset, actual, expected)
                checked += 1
        # Explicit counterexamples to tempting alternative expressions.
        db.execute("DELETE FROM WHITELIST")
        db.execute("INSERT INTO WHITELIST VALUES ('C2','P1')")
        missing_country = query.replace("W.CID = R.CID AND ", "")
        assert db.execute(query).fetchall() == []
        assert len(db.execute(missing_country).fetchall()) == 2
        db.execute("DELETE FROM WHITELIST")
        db.executemany("INSERT INTO WHITELIST VALUES (?,?)", [("C1", "P1")] * 2)
        join = "SELECT R.PID,R.PRICE FROM REPORT R JOIN WHITELIST W ON R.CID=W.CID AND R.PID=W.PID WHERE R.CID='C1' ORDER BY R.PID DESC"
        assert len(db.execute(query).fetchall()) == 2
        assert len(db.execute(join).fetchall()) == 4
        assert len(db.execute(join.replace("SELECT ", "SELECT DISTINCT ")).fetchall()) == 1
    return {"datasets": checked, "counterexamples": ["missing_country", "join_fanout", "distinct_loses_reports"],
            "scope": "SQLite execution and independent row filtering; not a proof over every dialect or human review"}


if __name__ == "__main__":
    print(json.dumps(check(), ensure_ascii=False))
