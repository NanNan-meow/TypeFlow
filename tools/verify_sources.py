"""Audit every Chinese lesson against its cited PDF page. Rebuild-only dependency: PyMuPDF."""
import json
from pathlib import Path
import re
import fitz
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from backend.text_rules import practice_text
corpus = json.loads((ROOT / "data/corpus.json").read_text(encoding="utf-8"))
sources = {s["id"]: s for s in corpus["sources"]}
cache, failures, checked = {}, [], 0
for lesson in corpus["lessons"]:
    if lesson["language"] != "zh":
        continue
    for ref in lesson["references"]:
        key = ref["sourceId"], ref["page"]
        if key not in cache:
            with fitz.open(Path(corpus["chineseSourceRoot"]) / sources[key[0]]["file"]) as doc:
                cache[key] = re.sub(r"[\s\u3000\u00a0]+", "", doc[key[1] - 1].get_text())
        checked += 1
        if practice_text(ref.get("text", lesson["text"]), lesson["kind"]) not in practice_text(cache[key], lesson["kind"]):
            failures.append(lesson["id"])
assert not failures, f"Source audit failed: {failures}"
print(f"PASS: {checked} Chinese references match contiguous original PDF text.")
