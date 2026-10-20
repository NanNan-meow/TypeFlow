// Pure typing accounting, shared with the Node verification suite.
export function countNewErrors(previous, value, target) {
  let prefix = 0;
  while (prefix < previous.length && prefix < value.length && previous[prefix] === value[prefix]) prefix++;
  let errors = 0;
  for (let i = prefix; i < value.length; i++) if (value[i] !== target[i]) errors++;
  return errors;
}

export function liveMetrics(target, typed, errors, elapsed, language) {
  let correct = 0;
  for (let i = 0; i < typed.length; i++) if (typed[i] === target[i]) correct++;
  return {
    correct,
    accuracy: typed.length ? correct * 100 / typed.length : 100,
    speed: elapsed > 0 ? correct * 60 / elapsed / (language === 'en' ? 5 : 1) : 0,
    progress: Math.min(100, typed.length * 100 / target.length),
  };
}

export function isUnlocked(lesson, lessons, progress) {
  // Every valid lesson is selectable. Progress records achievements, never access gates.
  return Boolean(lesson);
}
