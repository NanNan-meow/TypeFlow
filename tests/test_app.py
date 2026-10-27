from contextlib import closing
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import uuid
import time
import unittest
import unicodedata
from urllib.error import HTTPError
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from backend.scoring import score_attempt
CORPUS = json.loads((ROOT / "data" / "corpus.json").read_text(encoding="utf-8"))
FIRST = next(x for x in CORPUS["lessons"] if x["id"] == "en-phrase-01")


class ScoringTests(unittest.TestCase):
    def test_browser_scoring_contract_matches_backend(self):
        cases = json.loads((ROOT / "tests/scoring-fixtures.json").read_text(encoding="utf-8"))
        for case in cases:
            self.assertEqual(score_attempt(case["lesson"], case["typed"], case["elapsed"], case["errors"]), case["expected"])

    def test_exact_speed_and_threshold(self):
        result = score_attempt(FIRST, FIRST["text"], len(FIRST["text"]) * 60 / 5 / FIRST["targetSpeed"], 0)
        self.assertTrue(result["passed"])
        self.assertEqual(result["speed"], FIRST["targetSpeed"])
        self.assertEqual(result["stars"], 2)

    def test_correcting_restores_accuracy_without_penalty(self):
        result = score_attempt(FIRST, FIRST["text"], 10, 100)
        self.assertTrue(result["passed"])
        self.assertEqual(result["accuracy"], 100)
        self.assertEqual(result["score"], 100)
        self.assertEqual(result["errors"], 100)

    def test_final_mistakes_count_even_if_client_sends_zero(self):
        result = score_attempt(FIRST, "x" * len(FIRST["text"]), 10, 0)
        self.assertFalse(result["passed"])
        self.assertGreater(result["errors"], 0)

    def test_partial_cannot_pass(self):
        result = score_attempt(FIRST, FIRST["text"][:-1], 1, 0)
        self.assertFalse(result["passed"])
        self.assertFalse(result["complete"])
        self.assertGreater(result["score"], 0)

    def test_chinese_character_speed(self):
        lesson = dict(FIRST, language="zh", text="数学建模，数据分析。", targetSpeed=10)
        result = score_attempt(lesson, lesson["text"], 60, 0)
        self.assertEqual(result["speed"], len(lesson["text"]))

    def test_invalid_payloads(self):
        for elapsed in [0, -1, float("nan"), float("inf"), True, "3"]:
            with self.assertRaises(ValueError):
                score_attempt(FIRST, FIRST["text"], elapsed, 0)
        for errors in [-1, 1.2, True, "0"]:
            with self.assertRaises(ValueError):
                score_attempt(FIRST, FIRST["text"], 2, errors)

    def test_stars(self):
        duration = len(FIRST["text"]) * 60 / 5 / (FIRST["targetSpeed"] * 1.5)
        self.assertEqual(score_attempt(FIRST, FIRST["text"], duration, 0)["stars"], 3)


class CorpusTests(unittest.TestCase):
    def test_all_six_tracks_and_contiguous_order(self):
        self.assertEqual(len({x["id"] for x in CORPUS["lessons"]}), len(CORPUS["lessons"]))
        for lang in ["en", "zh"]:
            for kind in ["phrase", "sentence", "article"]:
                lessons = [x for x in CORPUS["lessons"] if x["language"] == lang and x["kind"] == kind]
                self.assertGreaterEqual(len(lessons), 6)
                self.assertEqual(sorted(x["order"] for x in lessons), list(range(1, len(lessons) + 1)))

    def test_chinese_references_valid(self):
        sources = {x["id"]: x for x in CORPUS["sources"]}
        self.assertEqual(len(sources), 41)
        for lesson in CORPUS["lessons"]:
            self.assertNotIn("\n", lesson["text"])
            self.assertNotIn("\ufffd", lesson["text"])
            has_punctuation = any(unicodedata.category(char)[0] in "PS" for char in lesson["text"])
            if lesson["kind"] == "phrase":
                self.assertFalse(has_punctuation, lesson["id"])
            else:
                self.assertTrue(has_punctuation, f"Sentences and articles must preserve punctuation: {lesson['id']}")
            if lesson["language"] != "zh":
                continue
            self.assertTrue(lesson["references"])
            for ref in lesson["references"]:
                self.assertIn(ref["sourceId"], sources)
                self.assertLessEqual(ref["page"], sources[ref["sourceId"]]["pages"])

    def test_original_ielts_essays_long_enough(self):
        for lesson in CORPUS["lessons"]:
            if lesson["language"] == "en" and lesson["kind"] == "article":
                self.assertGreaterEqual(len(lesson["text"].split()), 250, lesson["title"])


class ApiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        artifacts = ROOT / "test-artifacts"
        artifacts.mkdir(exist_ok=True)
        cls.database = artifacts / f"api-test-{uuid.uuid4().hex}.sqlite3"
        with closing(socket.socket()) as s:
            s.bind(("127.0.0.1", 0))
            cls.port = s.getsockname()[1]
        env = dict(os.environ, TYPEFLOW_DB=str(cls.database))
        cls.env = env
        cls.start_backend()

    @classmethod
    def start_backend(cls):
        cls.proc = subprocess.Popen([sys.executable, str(ROOT / "backend/server.py"), "--port", str(cls.port)], env=cls.env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0)
        for _ in range(100):
            if cls.proc.poll() is not None:
                raise RuntimeError("Test backend exited during startup")
            try:
                if cls.request("/api/health")[0] == 200:
                    return
            except OSError:
                time.sleep(.05)
        raise RuntimeError("Test backend did not start")

    @classmethod
    def tearDownClass(cls):
        cls.proc.terminate()
        cls.proc.wait(timeout=5)
        for suffix in ("", "-wal", "-shm"):
            target = Path(str(cls.database) + suffix)
            assert target.resolve().is_relative_to(ROOT / "test-artifacts")
            target.unlink(missing_ok=True)

    @classmethod
    def request(cls, path, body=None, headers=None):
        req = Request(f"http://127.0.0.1:{cls.port}{path}", data=json.dumps(body).encode() if body is not None else None, headers={"Content-Type": "application/json", **(headers or {})})
        try:
            with urlopen(req, timeout=3) as r:
                return r.status, json.load(r)
        except HTTPError as e:
            with e:
                return e.code, json.load(e)

    def payload(self, id, request_id, mode="challenge"):
        lesson = next(x for x in CORPUS["lessons"] if x["id"] == id)
        return {"lessonId": id, "requestId": request_id, "typed": lesson["text"], "errors": 0, "elapsed": 15, "mode": mode}

    def test_01_future_level_is_selectable_without_prior_progress(self):
        status, _ = self.request("/api/attempts", self.payload("en-phrase-02", "locked-00001"))
        self.assertEqual(status, 200)

    def test_02_free_mode_does_not_unlock(self):
        status, _ = self.request("/api/attempts", self.payload("zh-article-20", "free-0000001", "free"))
        self.assertEqual(status, 200)
        _, stats = self.request("/api/stats")
        self.assertNotIn("zh-article-20", stats["progress"])

    def test_03_save_idempotency_and_independent_levels(self):
        body = self.payload("en-phrase-01", "unique-00001")
        for _ in range(2):
            status, data = self.request("/api/attempts", body)
            self.assertEqual(status, 200)
            self.assertTrue(data["result"]["passed"])
        _, stats = self.request("/api/stats")
        self.assertEqual(stats["progress"]["en-phrase-01"]["attempts"], 1)
        self.assertEqual(self.request("/api/attempts", self.payload("en-phrase-02", "next-0000001"))[0], 200)

    def test_04_bad_requests_rejected(self):
        self.assertEqual(self.request("/api/attempts", {"lessonId": "missing"})[0], 400)
        self.assertEqual(self.request("/api/attempts", self.payload("zh-phrase-01", "origin-00001"), {"Origin": "https://example.com"})[0], 403)

    def test_05_export_and_stats(self):
        status, data = self.request("/api/export")
        self.assertEqual(status, 200)
        self.assertEqual(data["app"], "typeflow")
        self.assertGreaterEqual(len(data["attempts"]), 3)
        _, stats = self.request("/api/stats")
        self.assertEqual(len(stats["days"]), 7)
        self.assertGreater(stats["totalSeconds"], 0)

    def test_06_restart_preserves_progress(self):
        _, before = self.request("/api/stats")
        self.__class__.proc.terminate()
        self.__class__.proc.wait(timeout=5)
        self.__class__.start_backend()
        _, after = self.request("/api/stats")
        self.assertEqual(before["progress"], after["progress"])
        self.assertEqual(before["totalAttempts"], after["totalAttempts"])


if __name__ == "__main__":
    unittest.main()
