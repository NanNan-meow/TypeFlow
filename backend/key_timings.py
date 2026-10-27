"""Validate the optional, aggregate-only English typing analysis payload."""
import re


def normalize_key_timings(value):
    if value is None:
        return None
    if not isinstance(value, dict) or type(value.get("version")) not in (int, float) or value.get("version") != 1 or not isinstance(value.get("letters"), dict):
        raise ValueError("按键统计格式无效")
    letters = {}
    def integer(number, maximum=100000):
        return type(number) in (int, float) and 0 <= number <= maximum and number == int(number)
    for letter, row in value["letters"].items():
        if not re.fullmatch("[a-z]", letter) or not isinstance(row, dict):
            raise ValueError("按键统计格式无效")
        samples, total_ms = row.get("samples"), row.get("totalMs")
        errors, pauses = row.get("errors", 0), row.get("longPauses", 0)
        if not integer(samples) or not integer(errors) or not integer(pauses) or not integer(total_ms, samples * 5000) or (samples == 0 and total_ms != 0):
            raise ValueError("按键统计数值无效")
        if samples or errors or pauses:
            letters[letter] = {"samples": int(samples), "totalMs": int(total_ms), "errors": int(errors), "longPauses": int(pauses)}
    return {"version": 1, "letters": letters}
