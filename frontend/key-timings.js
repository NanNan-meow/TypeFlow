const LETTERS = 'abcdefghijklmnopqrstuvwxyz';
export const MAX_KEY_GAP_MS = 5000;
const isLetter = value => typeof value === 'string' && /^[a-z]$/i.test(value);
const integer = value => Number.isInteger(value) && value >= 0 && value <= 100000;

// Store aggregates only, without a raw key sequence or absolute key timestamps.
export function normalizeKeyTimings(value) {
  if (value == null) return null;
  if (typeof value !== 'object' || Array.isArray(value) || value.version !== 1 || !value.letters || typeof value.letters !== 'object' || Array.isArray(value.letters)) throw new Error('按键统计格式无效');
  const letters = {};
  for (const [letter, row] of Object.entries(value.letters)) {
    if (!/^[a-z]$/.test(letter) || !row || typeof row !== 'object' || Array.isArray(row)) throw new Error('按键统计格式无效');
    const { samples, totalMs, errors = 0, longPauses = 0 } = row;
    if (!integer(samples) || !integer(errors) || !integer(longPauses) || !Number.isInteger(totalMs) || totalMs < 0 || totalMs > samples * MAX_KEY_GAP_MS || (samples === 0 && totalMs !== 0)) throw new Error('按键统计数值无效');
    if (samples || errors || longPauses) letters[letter] = { samples, totalMs, errors, longPauses };
  }
  return { version: 1, letters };
}

export function createKeyTimingTracker() {
  const letters = {};
  let pending = null, previousAt = null;
  const row = letter => letters[letter] ??= { samples: 0, totalMs: 0, errors: 0, longPauses: 0 };
  function interrupt() { pending = null; previousAt = null; }
  return {
    interrupt,
    keyDown(event, at) {
      if (event.key === 'Shift' && !event.repeat && !event.isComposing && !event.ctrlKey && !event.metaKey && !event.altKey) return;
      if (!Number.isFinite(at) || event.repeat || event.isComposing || event.ctrlKey || event.metaKey || event.altKey || typeof event.key !== 'string' || event.key.length !== 1) { interrupt(); return; }
      pending = { key: event.key, at };
    },
    commit(previous, value, target) {
      const press = pending;
      pending = null;
      if (!press || value.length !== previous.length + 1 || !value.startsWith(previous) || value.at(-1) !== press.key) { interrupt(); return; }
      const expected = target[previous.length];
      const letter = isLetter(expected) ? expected.toLowerCase() : null;
      if (press.key !== expected) {
        if (letter) row(letter).errors++;
        previousAt = null;
        return;
      }
      const gap = previousAt == null ? null : press.at - previousAt;
      previousAt = press.at;
      if (!letter || gap == null || gap <= 0) return;
      if (gap > MAX_KEY_GAP_MS) { row(letter).longPauses++; return; }
      row(letter).samples++;
      row(letter).totalMs += gap;
    },
    snapshot() {
      return normalizeKeyTimings({ version: 1, letters: Object.fromEntries(Object.entries(letters).map(([letter, data]) => [letter, { ...data, totalMs: Math.round(data.totalMs) }])) });
    },
  };
}

export function analyzeKeyTimings(value) {
  const normalized = normalizeKeyTimings(value);
  const letters = [...LETTERS].map(letter => {
    const data = normalized?.letters[letter] ?? { samples: 0, totalMs: 0, errors: 0, longPauses: 0 };
    return { letter, ...data, averageMs: data.samples ? data.totalMs / data.samples : null };
  });
  const samples = letters.reduce((sum, row) => sum + row.samples, 0);
  const totalMs = letters.reduce((sum, row) => sum + row.totalMs, 0);
  const averageMs = samples ? totalMs / samples : null;
  const ranked = letters.filter(row => row.samples >= 2).sort((a, b) => b.averageMs - a.averageMs || b.samples - a.samples || a.letter.localeCompare(b.letter));
  const slowKeys = ranked.filter(row => row.averageMs >= Math.max(averageMs * 1.25, averageMs + 40)).slice(0, 3);
  for (const row of letters) row.tone = !row.samples ? 'unmeasured' : row.samples < 2 ? 'limited' : row.averageMs >= Math.max(averageMs * 1.25, averageMs + 40) ? 'slow' : row.averageMs <= averageMs * .85 ? 'quick' : 'steady';
  return { letters, samples, averageMs, coveredLetters: letters.filter(row => row.samples).length, slowKeys, longPauses: letters.reduce((sum, row) => sum + row.longPauses, 0) };
}

export function formatKeyTime(value) {
  return value == null ? '—' : value < 1 ? '<1 ms' : value >= 1000 ? `${(value / 1000).toFixed(2)} 秒` : `${Math.round(value)} ms`;
}
