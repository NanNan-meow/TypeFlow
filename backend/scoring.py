"""Shared server-side scoring rules. English WPM = five correct characters/minute."""
import math


def score_attempt(lesson, typed, elapsed, errors, mode="challenge"):
    if not isinstance(typed, str) or len(typed) > len(lesson["text"]):
        raise ValueError("输入长度无效")
    if isinstance(elapsed, bool) or not isinstance(elapsed, (float, int)) or not math.isfinite(elapsed) or elapsed < .1 or elapsed > 86400:
        raise ValueError("练习时间无效")
    if isinstance(errors, bool) or not isinstance(errors, int) or errors < 0 or errors > 100000:
        raise ValueError("错误数无效")
    if mode not in ("challenge", "free"):
        raise ValueError("练习模式无效")
    target = lesson["text"]
    correct = sum(a == b for a, b in zip(target, typed))
    remaining_errors = len(typed) - correct
    errors = max(errors, remaining_errors)
    # Corrections restore accuracy. The historical error count is feedback, not a penalty.
    accuracy = 100 * correct / len(typed) if typed else 0
    speed = correct * 60 / elapsed / (5 if lesson["language"] == "en" else 1)
    complete = len(typed) == len(target)
    passed = complete and accuracy >= lesson["targetAccuracy"] and speed >= lesson["targetSpeed"]
    stars = 0
    if passed:
        stars = 1
        if accuracy >= 90 and speed >= lesson["targetSpeed"]:
            stars = 2
        if accuracy >= 95 and speed >= lesson["targetSpeed"] * 1.1:
            stars = 3
    numeric = round(min(100, 60 + accuracy * .25 + min(speed / lesson["targetSpeed"], 1) * 15)) if complete else round(60 * len(typed) / len(target))
    return {"correct": correct, "errors": errors, "accuracy": round(accuracy, 2), "speed": round(speed, 2), "elapsed": round(elapsed, 2), "passed": passed, "stars": stars, "score": numeric, "complete": complete, "mode": mode}
