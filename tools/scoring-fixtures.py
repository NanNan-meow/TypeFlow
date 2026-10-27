"""Regenerate the shared browser/backend scoring contract after intentional rule changes."""
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from backend.scoring import score_attempt

corpus = json.loads((ROOT / "data/corpus.json").read_text(encoding="utf-8"))
cases = []
for language in ("en", "zh"):
    for kind in ("phrase", "sentence", "article"):
        lesson = next(item for item in corpus["lessons"] if item["language"] == language and item["kind"] == kind)
        boundary = len(lesson["text"]) * 60 / (5 if language == "en" else 1) / lesson["targetSpeed"]
        for typed, elapsed, errors in [(lesson["text"], 17.35, 10), (lesson["text"], boundary, 0), (lesson["text"][:-1], 20, 1), ("", 2, 0), ("x" * len(lesson["text"]), 10, 0)]:
            small_lesson = {key: lesson[key] for key in ("id", "text", "language", "targetSpeed", "targetAccuracy")}
            cases.append({"lesson": small_lesson, "typed": typed, "elapsed": elapsed, "errors": errors, "expected": score_attempt(lesson, typed, elapsed, errors)})
(ROOT / "tests/scoring-fixtures.json").write_text(json.dumps(cases, ensure_ascii=False, indent=2), encoding="utf-8", newline="\n")
print(f"Generated {len(cases)} scoring contract cases.")
