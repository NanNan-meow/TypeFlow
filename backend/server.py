"""Loopback-only JSON API with persistent SQLite progress; standard library only."""
import argparse
from contextlib import closing
from datetime import datetime, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import sqlite3
import sys
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from backend.scoring import score_attempt

CORPUS = json.loads((ROOT / "data" / "corpus.json").read_text(encoding="utf-8"))
LESSONS = {x["id"]: x for x in CORPUS["lessons"]}
DATABASE = Path(os.environ.get("TYPEFLOW_DB", str(ROOT / "data" / "progress.sqlite3")))


def connect():
    db = sqlite3.connect(DATABASE, timeout=10)
    db.row_factory = sqlite3.Row
    return db


def init_db():
    DATABASE.parent.mkdir(parents=True, exist_ok=True)
    with closing(connect()) as db:
        db.executescript("""
            PRAGMA journal_mode=WAL;
            CREATE TABLE IF NOT EXISTS attempts (
                id INTEGER PRIMARY KEY AUTOINCREMENT, request_id TEXT UNIQUE NOT NULL,
                lesson_id TEXT NOT NULL, mode TEXT NOT NULL, created_at TEXT NOT NULL,
                elapsed REAL NOT NULL, speed REAL NOT NULL, accuracy REAL NOT NULL,
                errors INTEGER NOT NULL, correct INTEGER NOT NULL, score INTEGER NOT NULL,
                stars INTEGER NOT NULL, passed INTEGER NOT NULL, complete INTEGER NOT NULL
            );
        """)
        db.commit()


def progress(db):
    return {row["lesson_id"]: {"passed": bool(row["passed"]), "stars": row["stars"], "bestSpeed": row["speed"], "bestAccuracy": row["accuracy"], "attempts": row["attempts"]} for row in db.execute("SELECT lesson_id, MAX(passed) passed, MAX(stars) stars, MAX(speed) speed, MAX(accuracy) accuracy, COUNT(*) attempts FROM attempts WHERE mode='challenge' GROUP BY lesson_id")}


def summary(db):
    rows = [dict(r) for r in db.execute("SELECT * FROM attempts ORDER BY id DESC")]
    today = datetime.now().date()
    days = [{"date": (today - timedelta(days=i)).isoformat(), "minutes": 0, "attempts": 0} for i in range(6, -1, -1)]
    for day in days:
        matches = [r for r in rows if r["created_at"][:10] == day["date"]]
        day["minutes"] = round(sum(r["elapsed"] for r in matches) / 60, 1)
        day["attempts"] = len(matches)
    active = {r["created_at"][:10] for r in rows}
    streak, current = 0, today
    if current.isoformat() not in active:
        current -= timedelta(days=1)
    while current.isoformat() in active:
        streak += 1
        current -= timedelta(days=1)
    return {"progress": progress(db), "history": rows[:100], "days": days, "streak": streak,
            "totalAttempts": len(rows), "totalSeconds": round(sum(r["elapsed"] for r in rows)),
            "todaySeconds": round(sum(r["elapsed"] for r in rows if r["created_at"][:10] == today.isoformat())),
            "averageAccuracy": round(sum(r["accuracy"] for r in rows) / len(rows), 1) if rows else 0,
            "bestSpeed": {lang: max((r["speed"] for r in rows if LESSONS.get(r["lesson_id"], {}).get("language") == lang), default=0) for lang in ["en", "zh"]}}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass

    def send_json(self, status, data):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/api/health":
            return self.send_json(200, {"app": "typeflow", "ok": True, "testDatabase": DATABASE.resolve().is_relative_to(ROOT / "test-artifacts")})
        if path == "/api/corpus":
            return self.send_json(200, CORPUS)
        with closing(connect()) as db:
            if path == "/api/stats":
                return self.send_json(200, summary(db))
            if path == "/api/export":
                return self.send_json(200, {"app": "typeflow", "version": 1, "exportedAt": datetime.now().isoformat(), "attempts": [dict(r) for r in db.execute("SELECT * FROM attempts ORDER BY id")]})
        self.send_json(404, {"error": "接口不存在"})

    def do_POST(self):
        if urlparse(self.path).path != "/api/attempts":
            return self.send_json(404, {"error": "接口不存在"})
        origin = self.headers.get("Origin")
        if origin and origin not in (f"http://127.0.0.1:{self.server.frontend_port}", f"http://localhost:{self.server.frontend_port}"):
            return self.send_json(403, {"error": "请求来源无效"})
        try:
            size = int(self.headers.get("Content-Length", "0"))
            if size <= 0 or size > 100000:
                raise ValueError("请求大小无效")
            body = json.loads(self.rfile.read(size))
            if not isinstance(body, dict):
                raise ValueError("请求内容无效")
            lesson = LESSONS.get(body.get("lessonId", ""))
            if lesson is None:
                raise ValueError("关卡不存在")
            req = body.get("requestId")
            if not isinstance(req, str) or not 8 <= len(req) <= 80:
                raise ValueError("记录编号无效")
            result = score_attempt(lesson, body.get("typed"), body.get("elapsed"), body.get("errors", 0), body.get("mode", "challenge"))
            with closing(connect()) as db:
                previous = db.execute("SELECT * FROM attempts WHERE request_id=?", (req,)).fetchone()
                if previous:
                    return self.send_json(200, {"result": dict(previous), "stats": summary(db)})
                keys = ["mode", "elapsed", "speed", "accuracy", "errors", "correct", "score", "stars", "passed", "complete"]
                db.execute("INSERT INTO attempts(request_id,lesson_id,created_at," + ",".join(keys) + ") VALUES (" + ",".join("?" for _ in range(len(keys) + 3)) + ")", [req, lesson["id"], datetime.now().isoformat(timespec="seconds")] + [result[k] for k in keys])
                db.commit()
                return self.send_json(200, {"result": result, "stats": summary(db)})
        except (ValueError, TypeError, json.JSONDecodeError) as exc:
            self.send_json(400, {"error": str(exc)})
        except sqlite3.Error:
            self.send_json(500, {"error": "成绩保存失败，请重试"})


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8766)
    parser.add_argument("--frontend-port", type=int, default=8765)
    args = parser.parse_args()
    init_db()
    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    server.frontend_port = args.frontend_port
    print(f"API ready: http://127.0.0.1:{args.port}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
