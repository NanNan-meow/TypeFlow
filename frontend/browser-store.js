// GitHub Pages storage adapter. Local Python mode continues to use its HTTP API.
function roundEven(value, digits = 0) {
  const factor = 10 ** digits;
  const scaled = value * factor;
  const lower = Math.floor(scaled);
  return (scaled - lower === .5 ? lower + lower % 2 : Math.round(scaled)) / factor;
}

function dateString(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function scoreAttempt(lesson, typed, elapsed, errors = 0, mode = 'challenge') {
  if (typeof typed !== 'string' || typed.length > lesson.text.length) throw new Error('输入长度无效');
  if (typeof elapsed !== 'number' || !Number.isFinite(elapsed) || elapsed < .1 || elapsed > 86400) throw new Error('练习时间无效');
  if (!Number.isInteger(errors) || errors < 0 || errors > 100000) throw new Error('错误数无效');
  if (!['challenge', 'free'].includes(mode)) throw new Error('练习模式无效');
  let correct = 0;
  for (let i = 0; i < typed.length; i++) if (typed[i] === lesson.text[i]) correct++;
  errors = Math.max(errors, typed.length - correct);
  const accuracy = typed.length ? correct * 100 / typed.length : 0;
  const speed = correct * 60 / elapsed / (lesson.language === 'en' ? 5 : 1);
  const complete = typed.length === lesson.text.length;
  const passed = complete && accuracy >= lesson.targetAccuracy && speed >= lesson.targetSpeed;
  const stars = !passed ? 0 : accuracy >= 95 && speed >= lesson.targetSpeed * 1.1 ? 3 : accuracy >= 90 && speed >= lesson.targetSpeed ? 2 : 1;
  const score = complete ? roundEven(Math.min(100, 60 + accuracy * .25 + Math.min(speed / lesson.targetSpeed, 1) * 15)) : roundEven(60 * typed.length / lesson.text.length);
  return { correct, errors, accuracy: roundEven(accuracy, 2), speed: roundEven(speed, 2), elapsed: roundEven(elapsed, 2), passed, stars, score, complete, mode };
}

export function summarize(attempts, lessons, now = new Date()) {
  const byId = new Map(lessons.map(lesson => [lesson.id, lesson]));
  const progress = {}, bestSpeed = { en: 0, zh: 0 };
  const today = dateString(now);
  const days = Array.from({ length: 7 }, (_, i) => {
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6 + i, 12);
    return { date: dateString(date), minutes: 0, attempts: 0 };
  });
  const dayTotals = new Map(days.map(day => [day.date, { day, seconds: 0 }]));
  let seconds = 0, todaySeconds = 0, accuracy = 0;
  const activeDays = new Set();
  for (const row of attempts) {
    const date = row.created_at.slice(0, 10);
    activeDays.add(date);
    seconds += row.elapsed;
    accuracy += row.accuracy;
    if (date === today) todaySeconds += row.elapsed;
    const bucket = dayTotals.get(date);
    if (bucket) { bucket.seconds += row.elapsed; bucket.day.attempts++; }
    const language = byId.get(row.lesson_id)?.language;
    if (language) bestSpeed[language] = Math.max(bestSpeed[language], row.speed);
    if (row.mode !== 'challenge') continue;
    const p = progress[row.lesson_id] ??= { passed: false, stars: 0, bestSpeed: 0, bestAccuracy: 0, attempts: 0 };
    p.passed ||= Boolean(row.passed);
    p.stars = Math.max(p.stars, row.stars);
    p.bestSpeed = Math.max(p.bestSpeed, row.speed);
    p.bestAccuracy = Math.max(p.bestAccuracy, row.accuracy);
    p.attempts++;
  }
  for (const { day, seconds: total } of dayTotals.values()) day.minutes = roundEven(total / 60, 1);
  let streak = 0;
  let current = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12);
  if (!activeDays.has(dateString(current))) current.setDate(current.getDate() - 1);
  while (activeDays.has(dateString(current))) { streak++; current.setDate(current.getDate() - 1); }
  return { progress, bestSpeed, history: attempts.slice().reverse().slice(0, 100), days, streak, totalAttempts: attempts.length,
    totalSeconds: roundEven(seconds), todaySeconds: roundEven(todaySeconds), averageAccuracy: attempts.length ? roundEven(accuracy / attempts.length, 1) : 0 };
}

export function createBrowserApi({ storage, fetcher = fetch, baseUrl = new URL('.', import.meta.url), now = () => new Date() } = {}) {
  const storageKey = `typeflow:pages:v1:${baseUrl.pathname}`;
  let corpusPromise;
  const corpus = () => corpusPromise ??= fetcher(new URL('corpus.json', baseUrl)).then(response => {
    if (!response.ok) throw new Error('练习素材加载失败，请刷新页面重试。');
    return response.json();
  }).catch(error => { corpusPromise = undefined; throw error; });
  function read() {
    try {
      const raw = (storage ?? globalThis.localStorage).getItem(storageKey);
      if (!raw) return [];
      const data = JSON.parse(raw);
      if (data.version !== 1 || !Array.isArray(data.attempts)) throw new Error('Invalid saved records');
      return data.attempts;
    } catch { throw new Error('无法读取浏览器中的练习记录，请检查浏览器存储设置。'); }
  }
  return async function browserApi(path, options = {}) {
    const data = await corpus();
    if (path === '/api/corpus') return data;
    const attempts = read();
    if (path === '/api/stats') return summarize(attempts, data.lessons, now());
    if (path === '/api/export') return { app: 'typeflow', version: 1, exportedAt: now().toISOString(), attempts };
    if (path !== '/api/attempts' || options.method !== 'POST') throw new Error('接口不存在');
    const body = JSON.parse(options.body);
    const lesson = data.lessons.find(item => item.id === body.lessonId);
    if (!lesson) throw new Error('关卡不存在');
    if (typeof body.requestId !== 'string' || body.requestId.length < 8 || body.requestId.length > 80) throw new Error('记录编号无效');
    const previous = attempts.find(row => row.request_id === body.requestId);
    if (previous) return { result: previous, stats: summarize(attempts, data.lessons, now()) };
    const result = scoreAttempt(lesson, body.typed, body.elapsed, body.errors, body.mode);
    const date = now();
    const created_at = `${dateString(date)}T${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')}`;
    attempts.push({ id: attempts.reduce((max, row) => Math.max(max, row.id), 0) + 1, request_id: body.requestId, lesson_id: lesson.id, created_at, ...result });
    try { (storage ?? globalThis.localStorage).setItem(storageKey, JSON.stringify({ version: 1, attempts })); }
    catch { throw new Error('成绩暂未保存：请允许浏览器本地存储，或导出旧记录后释放浏览器存储空间再试。'); }
    return { result, stats: summarize(attempts, data.lessons, now()) };
  };
}
