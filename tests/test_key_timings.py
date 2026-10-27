from contextlib import closing
import json
from pathlib import Path
import sqlite3
import sys
import unittest
from unittest.mock import patch
import uuid

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from backend.key_timings import normalize_key_timings
from backend import server


class KeyTimingsTests(unittest.TestCase):
    def test_validate_optional_and_aggregate_payload(self):
        self.assertIsNone(normalize_key_timings(None))
        value = {"version": 1, "letters": {"a": {"samples": 2, "totalMs": 400, "errors": 1}}}
        self.assertEqual(normalize_key_timings(value)["letters"]["a"], {"samples": 2, "totalMs": 400, "errors": 1, "longPauses": 0})
        for invalid in [{"version": True, "letters": {}}, {"version": 1, "letters": {"A": {"samples": 1, "totalMs": 100}}}, {"version": 1, "letters": {"a": {"samples": True, "totalMs": 10}}}, {"version": 1, "letters": {"a": {"samples": 0, "totalMs": 100}}}, {"version": 1, "letters": {"a": {"samples": 1, "totalMs": float("nan")}}}, {"version": 1, "letters": {"a": {"samples": 1, "totalMs": 5001}}}]:
            with self.assertRaises(ValueError):
                normalize_key_timings(invalid)

    def test_existing_database_migration_preserves_records(self):
        destination = ROOT / "test-artifacts" / f"timing-migration-{uuid.uuid4().hex}.sqlite3"
        destination.parent.mkdir(exist_ok=True)
        try:
            with closing(sqlite3.connect(destination)) as db:
                db.executescript("""CREATE TABLE attempts (
                    id INTEGER PRIMARY KEY AUTOINCREMENT, request_id TEXT UNIQUE NOT NULL,
                    lesson_id TEXT NOT NULL, mode TEXT NOT NULL, created_at TEXT NOT NULL,
                    elapsed REAL NOT NULL, speed REAL NOT NULL, accuracy REAL NOT NULL,
                    errors INTEGER NOT NULL, correct INTEGER NOT NULL, score INTEGER NOT NULL,
                    stars INTEGER NOT NULL, passed INTEGER NOT NULL, complete INTEGER NOT NULL);
                    INSERT INTO attempts VALUES(1,'legacy-001','en-phrase-01','challenge','2026-10-16T10:00:00',20,30,100,0,50,100,3,1,1);""")
                db.commit()
            with patch.object(server, "DATABASE", destination):
                server.init_db()
                server.init_db()
                with closing(server.connect()) as db:
                    saved = server.attempt_record(db.execute("SELECT * FROM attempts").fetchone())
                    self.assertEqual(saved["request_id"], "legacy-001")
                    self.assertEqual(saved["score"], 100)
                    self.assertIsNone(saved["keyTimings"])
        finally:
            for suffix in ("", "-wal", "-shm"):
                target = Path(str(destination) + suffix)
                self.assertTrue(target.resolve().is_relative_to(ROOT / "test-artifacts"))
                target.unlink(missing_ok=True)
