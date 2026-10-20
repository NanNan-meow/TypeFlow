"""Phrase drills omit punctuation; sentence and article drills retain original punctuation."""
import re
import unicodedata


def practice_text(text, kind="phrase"):
    replaced = "".join(" " if unicodedata.category(char)[0] in "PS" else char for char in text) if kind == "phrase" else text
    return re.sub(r"\s+", " ", replaced).strip()
