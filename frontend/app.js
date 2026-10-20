import { countNewErrors, liveMetrics, isUnlocked } from './engine.js';

const $ = (selector, scope = document) => scope.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const icons = {
  home: '<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>',
  keyboard: '<rect x="2" y="5" width="20" height="14" rx="3"/><path d="M6 9h.01M10 9h.01M14 9h.01M18 9h.01M6 12h.01M10 12h.01M14 12h.01M18 12h.01M7 16h10"/>',
  chinese: '<path d="M5 5h14M12 3v2M8 5c1 7 5 11 11 14M16 5c-1 7-5 11-11 14M4 13h6"/>',
  history: '<circle cx="12" cy="12" r="9"/><path d="M12 7v6l4 2"/>',
  book: '<path d="M12 5v15M12 5C8 2 4 3 2 4v15c3-1 7-1 10 1 3-2 7-2 10-1V4c-2-1-6-2-10 1Z"/>',
  arrow: '<path d="M5 12h14M14 7l5 5-5 5"/>',
  back: '<path d="M19 12H5M10 7l-5 5 5 5"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
  bolt: '<path d="m13 2-9 12h7l-1 8 10-12h-7l1-8Z"/>',
  award: '<circle cx="12" cy="9" r="6"/><path d="m8 14-1 8 5-3 5 3-1-8"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3"/>',
  check: '<path d="m5 12 4 4 10-10"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  bulb: '<path d="M9 18h6M9 21h6M8 14a6 6 0 1 1 8 0c-1 1-1 3-1 3H9s0-2-1-3Z"/>',
  file: '<path d="M14 2H5v20h14V7l-5-5ZM14 2v6h5M8 12h8M8 16h7"/>',
};
const icon = name => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${icons[name] || icons.keyboard}</svg>`;
const kindNames = { phrase: '词组练习', sentence: '句子练习', article: '文章练习' };
const tierNames = ['轻松入门', '稳步进阶', '熟练提升', '高手挑战'];
const navigation = [['home', 'home', '学习概览'], ['en', 'keyboard', '英文练习'], ['zh', 'chinese', '中文练习'], ['history', 'history', '练习记录'], ['library', 'book', '素材图书馆']];
let corpus, stats, session = null, toastTimer, currentRoute = '', tickTimer;
let selectedKind = 'phrase', mode = 'challenge';
const main = $('#main');
const modal = $('#modal');

function toast(message) {
  $('#toast').textContent = message;
  $('#toast').classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $('#toast').classList.remove('show'), 3500);
}

async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { 'Content-Type': 'application/json', ...options.headers } });
  if (!response.ok) {
    let message;
    try { message = (await response.json()).error; } catch { /* generic error below */ }
    throw new Error(message || '无法连接本地服务，请检查启动窗口是否仍然打开。');
  }
  return response.json();
}

function openModal(content) {
  $('#modal-content').innerHTML = content;
  if (!modal.open) modal.showModal();
}
const modalHeader = title => `<div class="modal-head"><h2>${esc(title)}</h2><button class="close-button" data-action="close-modal" aria-label="关闭弹窗">×</button></div>`;
function stars(count, className = 'stars') {
  return `<span class="${className}" aria-label="${count} 星">${[1, 2, 3].map(x => `<span class="${x <= count ? 'lit' : ''}">★</span>`).join('')}</span>`;
}
function track(language, kind) {
  return corpus.lessons.filter(x => x.language === language && (!kind || x.kind === kind)).sort((a, b) => a.order - b.order);
}
function nextLesson(language = 'en', kind = 'phrase') {
  const lessons = track(language, kind);
  return lessons.find(x => !stats.progress[x.id]?.passed && isUnlocked(x, corpus.lessons, stats.progress)) || lessons[0];
}
function completed(language, kind) {
  return track(language, kind).filter(x => stats.progress[x.id]?.passed).length;
}
function updateShell(route) {
  const section = route.startsWith('practice/') ? session?.lesson.language : route;
  $('#navigation').innerHTML = navigation.map(([id, glyph, label]) => `<a href="#${id}" class="nav-link ${section === id ? 'active' : ''}" ${section === id ? 'aria-current="page"' : ''} title="${label}">${icon(glyph)}<span>${label}</span></a>`).join('');
  $('#breadcrumb').textContent = route.startsWith('practice/') ? '专注练习' : navigation.find(x => x[0] === route)?.[2] || '学习概览';
  $('#daily-progress').style.width = `${Math.min(100, stats.todaySeconds / 9)}%`;
  $('#daily-time').textContent = `${Math.floor(stats.todaySeconds / 60)} / 15 分钟`;
}

function metric(glyph, name, value, unit, foot) {
  return `<div class="metric"><div class="metric-head">${icon(glyph)}${name}</div><div class="metric-value">${value}<small>${unit}</small></div><div class="metric-foot">${foot}</div></div>`;
}
function keyboardArt() {
  const keys = '1234567890QWERTYUIOPASDFGHJKL;ZXCVBNM,./'.split('');
  return `<div class="hero-art" aria-hidden="true"><div class="orbit"></div><div class="orbit two"></div><i class="orbit-dot"></i><div class="float-key">A</div><div class="float-key two">中</div><span class="art-star">✦</span><div class="keyboard-illustration">${keys.map((x, i) => `<i class="${[13, 24, 32].includes(i) ? 'purple' : ''}">${x}</i>`).join('')}<i>ctrl</i><i>⌘</i><i class="space">space</i><i>alt</i><i>↵</i></div><span class="art-label">FIND YOUR FLOW.</span></div>`;
}
function courseCard(language) {
  const zh = language === 'zh', count = track(language).length, passed = completed(language);
  return `<article class="course ${zh ? 'zh' : ''}"><div class="course-top"><div class="course-icon">${zh ? '中' : 'En'}</div><span class="course-badge">${zh ? 'MATHORCUP 优秀论文' : 'IELTS WRITING'}</span></div><h3>${zh ? '中文打字练习' : '英文打字练习'}<span>${zh ? 'Chinese' : 'English'}</span></h3><p>${zh ? '在优秀建模论文中，积累专业表达与输入手感。' : '以雅思写作主题为素材，让打字与英语一起进步。'}</p><div class="course-kinds">${Object.entries(kindNames).map(([kind, label]) => `<a href="#${language}/${kind}">${label}</a>`).join('')}</div><div class="course-bottom"><span>已解锁 <b>${track(language).filter(x => isUnlocked(x, corpus.lessons, stats.progress)).length}</b> 关 <span>·</span> 已通关 <b>${passed} / ${count}</b></span><a href="#${language}">进入练习 ${icon('arrow')}</a></div></article>`;
}
function home() {
  const totalPassed = Object.values(stats.progress).filter(x => x.passed).length;
  const time = new Date().getHours();
  const greeting = time < 12 ? '上午好' : time < 18 ? '下午好' : '晚上好';
  const latest = stats.history[0] && corpus.lessons.find(x => x.id === stats.history[0].lesson_id);
  const next = nextLesson(latest?.language || 'en', latest?.kind || 'phrase');
  main.innerHTML = `<div class="page-heading"><div><div class="eyebrow">YOUR LEARNING JOURNEY</div><h1>${greeting}，欢迎回到练习室 <span style="font-size:21px">☀</span></h1><p>保持自己的节奏，今天也向前一点。</p></div><div class="streak-badge"><span>♨</span> 已连续练习 <b>${stats.streak}</b> 天</div></div>
    <section class="hero"><div class="hero-copy"><div class="hero-tag">SMALL STEPS. STEADY PROGRESS.</div><h2>让每一次敲击，<br>都成为<em>进步。</em></h2><p>从词组到文章，从准确到流畅。<br>在熟悉的知识里，找到属于你的打字节奏。</p><div class="hero-actions"><button class="btn primary" data-start="${next.id}">${stats.totalAttempts ? '继续我的练习' : '开始第一次练习'} ${icon('arrow')}</button><button class="btn ghost" data-action="guide">了解闯关规则 ↗</button></div></div>${keyboardArt()}</section>
    <section class="metrics" aria-label="学习数据">${metric('history', '累计练习时长', Math.floor(stats.totalSeconds / 60), '分钟', stats.totalAttempts ? `来自 ${stats.totalAttempts} 次专注练习` : '从今天开始，记录你的投入')}${metric('award', '已通关关卡', totalPassed, `/ ${corpus.lessons.length} 关`, `<span class="positive">✦</span> 六条路线，各自成长`)}${metric('target', '平均正确率', stats.totalAttempts ? stats.averageAccuracy.toFixed(1) : '—', '%', '改对就算对，认真纠错也很棒')}${metric('bolt', '英文最佳速度', stats.bestSpeed.en ? stats.bestSpeed.en.toFixed(1) : '—', 'WPM', `中文最佳 ${stats.bestSpeed.zh ? stats.bestSpeed.zh.toFixed(0) : '—'} 字/分钟`)}</section>
    <div class="section-title"><h2>选择你的练习 <span>两种语言，六条进阶路线</span></h2><a href="#library">探索全部素材 ${icon('arrow')}</a></div><section class="courses">${courseCard('en')}${courseCard('zh')}</section>
    <section class="lower-grid"><div class="panel"><div class="panel-title">这一周的小小坚持 <small>最近 7 天 · 分钟</small></div><div class="chart" role="img" aria-label="最近七天练习时长：${stats.days.map(x => `${x.date} ${x.minutes}分钟`).join('，')}">${stats.days.map(day => { const max = Math.max(15, ...stats.days.map(d => d.minutes)); return `<div class="chart-day" title="${day.date} · ${day.minutes} 分钟"><div class="chart-bar" style="height:${Math.max(4, day.minutes / max * 80)}px"></div><small>${new Date(day.date + 'T12:00:00').toLocaleDateString('zh-CN', { weekday: 'short' })}</small></div>`; }).join('')}</div><p class="chart-empty">${stats.totalAttempts ? '每一段专注的时间，都有迹可循。' : '你的第一段练习完成后，进步会在这里留下痕迹。'}</p></div><div class="panel tip-panel"><div class="panel-title">${icon('bulb')}练习小贴士 <small>DAILY TIP</small></div><h3>先打准，再打快。</h3><p>不必急着追赶速度。保持放松，让每一个字符<br>落在正确的位置，流畅自然会慢慢发生。</p><button class="text-link" data-action="guide">找到适合你的练习节奏 ↗</button></div></section>`;
}

function renderTrack(language) {
  const zh = language === 'zh', lessons = track(language, selectedKind), passed = completed(language, selectedKind);
  const first = nextLesson(language, selectedKind);
  main.innerHTML = `<div class="page-heading"><div><div class="eyebrow">${zh ? 'MATHORCUP · CHINESE' : 'IELTS WRITING · ENGLISH'}</div><h1>${zh ? '中文打字练习' : '英文打字练习'}</h1><p>${zh ? '用优秀建模论文，练熟每一段专业表达。' : '让雅思写作表达，在一次次敲击中变得熟悉。'}</p></div><span class="study-pill">${zh ? corpus.sources.length + ' 篇真实论文' : '6 大雅思写作主题'}</span></div>
    <div class="track-banner ${zh ? 'zh' : ''}"><div><strong>${mode === 'challenge' ? '一步一关，把进步变得看得见。' : '自由探索，按自己的节奏练习。'}</strong><p>${mode === 'challenge' ? '速度与正确率同时达标，即可解锁下一关。' : '所有素材均可练习；自由练习计入记录，不解锁关卡。'}</p></div><div class="track-progress">${passed} / ${lessons.length} 关已通关<div class="progress-track"><i style="width:${passed * 100 / lessons.length}%"></i></div></div></div>
    <div class="tabs-bar"><div class="tabs" role="tablist" aria-label="练习类型">${Object.entries(kindNames).map(([kind, label]) => `<button role="tab" aria-selected="${selectedKind === kind}" class="${selectedKind === kind ? 'active' : ''}" data-kind="${kind}">${label}</button>`).join('')}</div><label class="mode-control">练习模式 <select id="mode-select" aria-label="练习模式"><option value="challenge" ${mode === 'challenge' ? 'selected' : ''}>闯关模式</option><option value="free" ${mode === 'free' ? 'selected' : ''}>自由练习</option></select></label></div><p class="practice-count">${kindNames[selectedKind]} · 共 ${lessons.length} 关 · ${zh ? '速度单位：正确字符/分钟' : '速度单位：WPM（5 个正确字符计 1 词）'}</p>
    <div class="level-grid">${lessons.map(lesson => {
      const record = stats.progress[lesson.id], accessible = mode === 'free' || isUnlocked(lesson, corpus.lessons, stats.progress);
      return `<article class="level-card ${!accessible ? 'locked' : first.id === lesson.id ? 'current' : ''}"><div class="level-top"><span class="level-number">LEVEL <b>${String(lesson.order).padStart(2, '0')}</b></span><span class="tier">${tierNames[lesson.tier]}</span></div><h3 class="level-title">${esc(lesson.title)}</h3><p class="level-excerpt">${esc(lesson.text.slice(0, 100))}</p><div class="level-targets"><span>↗ ${lesson.targetSpeed} ${zh ? '字/分钟' : 'WPM'}</span><span>◎ ${lesson.targetAccuracy}% 正确率</span></div><div class="level-footer">${stars(record?.stars || 0)}${accessible ? `<button class="btn ${first.id === lesson.id ? 'primary' : 'secondary'} small" data-start="${lesson.id}">${record?.passed ? '再次挑战' : mode === 'free' ? '自由练习' : '开始挑战'} ${icon('arrow')}</button>` : `<span title="通过上一关后解锁">${icon('lock')}</span>`}</div></article>`;
    }).join('')}</div>`;
}

function renderHistory(filter = 'all') {
  const rows = stats.history.filter(row => filter === 'all' || corpus.lessons.find(x => x.id === row.lesson_id)?.language === filter);
  main.innerHTML = `<div class="page-heading"><div><div class="eyebrow">YOUR PROGRESS, IN NUMBERS</div><h1>每一份努力，都有记录。</h1><p>已完成 ${stats.totalAttempts} 次练习 · 展示最近 100 条记录</p></div><div class="history-controls"><button class="btn secondary small" data-action="export">${icon('download')} 导出全部记录</button><select class="filter-select" id="history-filter" aria-label="记录语言"><option value="all">全部语言</option><option value="en">英文练习</option><option value="zh">中文练习</option></select></div></div>${rows.length ? `<div class="table-wrap"><table><thead><tr><th>练习内容</th><th>时间</th><th>速度</th><th>正确率</th><th>用时</th><th>结果</th><th>评分</th></tr></thead><tbody>${rows.map(row => { const l = corpus.lessons.find(x => x.id === row.lesson_id); return `<tr><td>${esc(l?.title || row.lesson_id)}<br><span class="tag">${l?.language === 'en' ? '英文' : '中文'} · ${kindNames[l?.kind] || ''}</span></td><td>${esc(row.created_at.replace('T', ' '))}</td><td>${row.speed.toFixed(1)} ${l?.language === 'en' ? 'WPM' : '字/分'}</td><td>${row.accuracy.toFixed(1)}%</td><td>${formatTime(row.elapsed)}</td><td><span class="tag ${row.passed ? 'green' : 'orange'}">${row.mode === 'free' ? '自由练习' : row.passed ? '已通关' : row.complete ? '继续加油' : '未完成'}</span></td><td>${row.score} 分 ${row.mode === 'challenge' ? stars(row.stars) : ''}</td></tr>`; }).join('')}</tbody></table></div>` : `<div class="empty-state">${icon('history')}<h3>故事从第一次练习开始</h3><p>完成一关，你的速度、准确率与成长就会出现在这里。</p><a class="btn primary" href="#en">去练习 ${icon('arrow')}</a></div>`}`;
  $('#history-filter').value = filter;
}

function library() {
  main.innerHTML = `<div class="page-heading"><div><div class="eyebrow">WORDS WORTH PRACTISING</div><h1>好素材，让练习更有意义。</h1><p>中文来自你的本地论文，英文围绕雅思写作主题。</p></div><span class="study-pill">${corpus.lessons.length} 份练习</span></div><div class="notice">中文已收录 ${corpus.sources.length} 篇 MathorCup 优秀论文，文章练习为正文节选，保留来源与 PDF 页码。英文为原创 IELTS Task 2 主题范文，不代表官方范文或官方评分。</div><div class="tabs library-tabs" role="tablist" aria-label="素材语言"><button class="active" data-library="zh" role="tab" aria-selected="true">MathorCup 论文</button><button data-library="en" role="tab" aria-selected="false">雅思写作主题</button></div><div class="search-row"><input id="source-search" class="search-input" type="search" placeholder="搜索论文名称、年份或英文主题…" aria-label="搜索素材"><span class="study-pill" id="source-count"></span></div><div class="source-list" id="sources"></div>`;
  renderSources('zh', '');
}
let libraryLanguage = 'zh';
function renderSources(language, query) {
  libraryLanguage = language;
  const entries = language === 'zh' ? corpus.sources.filter(x => x.title.toLowerCase().includes(query.toLowerCase())) : track('en', 'article').filter(x => (x.title + x.topic + x.prompt).toLowerCase().includes(query.toLowerCase()));
  $('#source-count').textContent = `${entries.length} ${language === 'zh' ? '篇论文' : '个主题'}`;
  $('#sources').innerHTML = entries.length ? entries.map(x => language === 'zh' ? `<article class="source-row">${icon('file')}<div class="source-info"><strong>${esc(x.title)}</strong><small>本地 PDF · ${esc(x.file.split('/')[0])}</small></div><span>${x.pages} 页</span></article>` : `<article class="source-row library-essay">${icon('book')}<div class="source-info"><strong>${esc(x.title)} <span class="tag">${esc(x.topic)}</span></strong><small>IELTS Writing Task 2 · 原创主题范文 · ${x.text.split(/\s+/).length} 词</small><p>${esc(x.translation)}</p></div><button class="btn secondary small" data-free="${x.id}">练习这篇 ${icon('arrow')}</button></article>`).join('') : '<div class="empty-state"><p>没有匹配的素材，换个关键词试试。</p></div>';
}

function formatTime(seconds) {
  const whole = Math.floor(seconds);
  return `${String(Math.floor(whole / 60)).padStart(2, '0')}:${String(whole % 60).padStart(2, '0')}`;
}
function elapsed() {
  return session ? session.accumulated + (session.running ? (performance.now() - session.segmentStart) / 1000 : 0) : 0;
}
function startTimer() {
  if (!session || session.finished || session.paused || session.running) return;
  session.running = true;
  session.segmentStart = performance.now();
  session.hasStarted = true;
}
function stopTimer() {
  if (session?.running) { session.accumulated = elapsed(); session.running = false; }
}
function startLesson(id, free = false) {
  const lesson = corpus.lessons.find(x => x.id === id);
  if (!lesson) return toast('这份练习不存在。');
  const attemptMode = free ? 'free' : mode;
  if (attemptMode === 'challenge' && !isUnlocked(lesson, corpus.lessons, stats.progress)) return toast('请先通过上一关，或切换到自由练习。');
  session = { lesson, mode: attemptMode, typed: '', errors: 0, accumulated: 0, running: false, paused: false, finished: false, composing: false, hasStarted: false, size: 28, requestId: crypto.randomUUID(), saved: false, saving: false };
  location.hash = `practice/${id}`;
  if (currentRoute === `practice/${id}`) renderPractice();
}
function renderPractice() {
  const l = session.lesson, zh = l.language === 'zh';
  main.innerHTML = `<div class="practice-header"><div class="practice-title"><button class="back-button" data-action="leave-practice">${icon('back')} 返回${zh ? '中文' : '英文'}练习</button><h1>${esc(l.title)}</h1><small>${kindNames[l.kind]} · ${tierNames[l.tier]} · ${session.mode === 'challenge' ? '闯关模式' : '自由练习'}</small></div><div class="practice-tools"><button data-action="font-smaller" aria-label="缩小参考文字">A−</button><button data-action="font-larger" aria-label="放大参考文字">A+</button><button data-action="focus" aria-label="切换专注模式">专注</button></div></div>
    <div class="practice-stats" aria-label="实时练习数据"><div class="practice-stat"><small>当前速度</small><b id="live-speed">0<span>${zh ? '字/分钟' : 'WPM'}</span></b></div><div class="practice-stat"><small>正确率</small><b id="live-accuracy">100<span>%</span></b></div><div class="practice-stat"><small>练习用时</small><b id="live-time">00:00</b></div><div class="practice-stat"><small>输入进度</small><b id="live-progress">0<span>/ ${l.text.length}</span></b></div></div>
    ${l.prompt ? `<div class="prompt-box"><b>WRITING TASK 2</b> · ${esc(l.prompt)}</div>` : ''}<section class="typing-card"><div class="typing-card-top"><span>${icon('keyboard').replace('class="icon"', 'class="icon" style="display:inline-block;width:13px;height:13px;vertical-align:middle;margin-right:6px"')} ${zh ? '数学建模 · 论文原文' : '雅思写作 · 原创表达'}</span><span id="typing-status">输入第一个字符开始计时</span></div><div class="reference-wrap"><div class="reference-text ${zh ? 'zh' : ''}" id="reference" aria-label="练习原文"></div></div><div class="entry-wrap"><label for="typing-input">在下方逐字输入 · ${zh ? '支持中文输入法，选字后判定' : '注意大小写、空格与标点'}</label><textarea id="typing-input" class="typing-input" spellcheck="false" autocomplete="off" autocapitalize="off" autocorrect="off" aria-label="打字输入区" placeholder="${zh ? '切换到中文输入法，跟着原文开始敲击…' : 'Ready when you are. 从第一个字符开始…'}"></textarea></div><div class="typing-bottom"><span><kbd>Esc</kbd> 暂停 / 继续 &nbsp; <kbd>Ctrl</kbd> + <kbd>Enter</kbd> 结束练习</span><span>本关目标：${l.targetSpeed} ${zh ? '字/分' : 'WPM'} · 正确率 ≥ ${l.targetAccuracy}%</span></div><div class="typing-progress"><i id="typing-progress-bar"></i></div><div class="paused-cover" id="paused-cover" hidden><h3>休息一下，再继续。</h3><p>已暂停计时，当前输入会被保留。</p><button class="btn primary" data-action="resume">继续练习 ${icon('arrow')}</button></div></section>
    <div class="session-actions"><button class="btn secondary" id="pause-button" data-action="pause">暂停练习</button><button class="btn secondary" data-action="restart">重新开始</button><button class="btn primary" data-action="finish">结束并评分 ${icon('arrow')}</button></div><div class="practice-notes"><div class="practice-note"><strong>素材来源</strong>${esc(l.sourceLabel)}${l.references ? ' · <button data-action="source">查看论文与页码 ↗</button>' : ''}${l.translation ? `<br>${esc(l.translation)}` : ''}</div><div class="practice-note"><strong>慢慢来，改对就算对</strong>支持退格修改，更正后恢复正确率。完成全文就有 60 分基础分。标点已全部换成空格，只需输入文字和空格，不用回车。</div></div>`;
  // A hidden attribute must win over the flex layout of the pause overlay.
  $('#paused-cover').style.display = 'none';
  const input = $('#typing-input');
  input.value = session.typed;
  input.addEventListener('compositionstart', () => { session.composing = true; startTimer(); });
  input.addEventListener('compositionend', () => { session.composing = false; processInput(); });
  input.addEventListener('input', event => { if (!event.isComposing && !session.composing) processInput(); });
  input.addEventListener('beforeinput', event => {
    if (session.finished || session.paused || ['insertFromPaste', 'insertFromDrop'].includes(event.inputType)) { event.preventDefault(); return; }
    if (event.inputType === 'insertLineBreak') event.preventDefault();
    else if (event.inputType.startsWith('insert')) startTimer();
  });
  input.addEventListener('keydown', event => {
    if (event.isComposing || session.composing) return;
    if (event.key === 'Enter' && !event.ctrlKey) event.preventDefault();
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'PageUp', 'PageDown'].includes(event.key)) event.preventDefault();
    if ((event.ctrlKey || event.metaKey) && !['Enter'].includes(event.key)) { if (['a', 'v', 'x', 'z', 'y'].includes(event.key.toLowerCase())) event.preventDefault(); }
    input.setSelectionRange(input.value.length, input.value.length);
  });
  input.addEventListener('click', () => { if (!session.composing) input.setSelectionRange(input.value.length, input.value.length); });
  for (const type of ['paste', 'drop']) input.addEventListener(type, event => { event.preventDefault(); toast('逐字输入才能记录真实进步，练习区暂不支持粘贴。'); });
  renderReference();
  $('#reference').style.fontSize = `${session.size}px`;
  clearInterval(tickTimer);
  tickTimer = setInterval(updateLive, 150);
  if (session.paused) pausePractice();
  else input.focus({ preventScroll: true });
  updateLive();
}
function processInput() {
  if (!session || session.finished || session.paused) return;
  const input = $('#typing-input');
  if (!input) return;
  let value = input.value.replace(/[\r\n]/g, '').slice(0, session.lesson.text.length);
  if (value !== input.value) input.value = value;
  if (value === session.typed) return;
  startTimer();
  session.errors += countNewErrors(session.typed, value, session.lesson.text);
  session.typed = value;
  renderReference();
  updateLive();
  if (value.length === session.lesson.text.length) finishPractice();
}
function renderReference() {
  const node = $('#reference');
  if (!node || !session) return;
  node.innerHTML = [...session.lesson.text].map((char, i) => `<span class="${i < session.typed.length ? char === session.typed[i] ? 'correct' : 'incorrect' : i === session.typed.length ? 'cursor' : ''}">${esc(char)}</span>`).join('');
  const cursor = $('.cursor', node);
  const wrap = $('.reference-wrap');
  if (cursor && cursor.offsetTop - wrap.offsetTop > wrap.scrollTop + wrap.clientHeight - 65) wrap.scrollTop = cursor.offsetTop - wrap.offsetTop - 50;
}
function updateLive() {
  if (!session || !$('#live-speed')) return;
  const seconds = elapsed(), m = liveMetrics(session.lesson.text, session.typed, session.errors, seconds, session.lesson.language);
  $('#live-speed').innerHTML = `${m.speed.toFixed(1)}<span>${session.lesson.language === 'en' ? 'WPM' : '字/分钟'}</span>`;
  $('#live-accuracy').innerHTML = `${m.accuracy.toFixed(1)}<span>%</span>`;
  $('#live-time').textContent = formatTime(seconds);
  $('#live-progress').innerHTML = `${session.typed.length}<span>/ ${session.lesson.text.length}</span>`;
  $('#typing-progress-bar').style.width = `${m.progress}%`;
  $('#typing-status').textContent = session.finished ? '本次练习已结束' : session.paused ? '已暂停计时' : session.hasStarted ? '保持节奏，你做得很好。' : '输入第一个字符开始计时';
}
function pausePractice() {
  if (!session || session.finished) return;
  stopTimer(); session.paused = true;
  if ($('#paused-cover')) { $('#paused-cover').hidden = false; $('#paused-cover').style.display = 'flex'; $('#typing-input').disabled = true; $('#pause-button').textContent = '继续练习'; }
  updateLive();
}
function resumePractice() {
  if (!session || session.finished) return;
  session.paused = false;
  $('#paused-cover').hidden = true; $('#paused-cover').style.display = 'none';
  $('#typing-input').disabled = false; $('#pause-button').textContent = '暂停练习';
  if (session.hasStarted) startTimer();
  $('#typing-input').focus({ preventScroll: true });
  updateLive();
}
async function finishPractice() {
  if (!session) return;
  if (session.finished) { if (session.result) showResult(session); else if (!session.saving) finalize(); return; }
  if (session.composing) return toast('请先完成输入法选字，再结束练习。');
  if (!session.typed.length) return toast('先输入一些文字，再结束练习。');
  if (session.typed.length < session.lesson.text.length) {
    pausePractice();
    openModal(`${modalHeader('提前结束这次练习？')}<div class="guide"><p>已输入 ${session.typed.length} / ${session.lesson.text.length} 个字符。未完成全文的练习会记录成绩，但不能通关。</p><div class="result-actions"><button class="btn secondary" data-action="cancel-finish">继续输入</button><button class="btn primary" data-action="confirm-finish">结束并记录</button></div></div>`);
    return;
  }
  await finalize();
}
async function finalize() {
  if (!session || session.saving || session.saved) return;
  stopTimer(); session.finished = true; session.paused = false;
  clearInterval(tickTimer);
  $('#typing-input').disabled = true;
  $('#paused-cover').hidden = true; $('#paused-cover').style.display = 'none';
  updateLive();
  const active = session;
  active.payload ??= { lessonId: active.lesson.id, typed: active.typed, elapsed: Math.max(.1, active.accumulated), errors: active.errors, mode: active.mode, requestId: active.requestId };
  active.saving = true;
  openModal(`<div class="result"><div class="result-emblem">✦</div><h2>正在整理这次进步…</h2><p>成绩会自动保存在本机。</p></div>`);
  try {
    const data = await api('/api/attempts', { method: 'POST', body: JSON.stringify(active.payload) });
    active.saved = true; active.result = data.result; stats = data.stats;
    localStorage.removeItem('typeflow-pending');
    updateShell(currentRoute);
    showResult(active);
  } catch (error) {
    try { localStorage.setItem('typeflow-pending', JSON.stringify(active.payload)); } catch { /* optional recovery */ }
    openModal(`${modalHeader('成绩暂未保存')}<div class="guide"><p>${esc(error.message)}</p><p>这次输入已暂存在浏览器，请恢复服务后重试。</p><div class="result-actions"><button class="btn primary" data-action="retry-save">重试保存</button><button class="btn secondary" data-action="close-modal">稍后再试</button></div></div>`);
  } finally { active.saving = false; }
}
function showResult(active) {
  const r = active.result, l = active.lesson, isChallenge = active.mode === 'challenge';
  const next = track(l.language, l.kind).find(x => x.order === l.order + 1);
  let feedback = !r.complete ? `你已经完成了 ${Math.round(active.typed.length * 100 / l.text.length)}%，每一个字都是积累。休息好了再来，我们按自己的节奏慢慢练。` : r.passed ? '做到了！你的认真练习有了回响。下一关也不用着急，保持自己的节奏就很好。' : `能坚持敲完全文已经很棒了！${r.accuracy < l.targetAccuracy ? '下次试试慢一点，用退格改对就能恢复正确率。' : '准确率已经很稳了，速度会随着熟悉慢慢提高。'} 轻松目标：${l.targetSpeed} ${l.language === 'en' ? 'WPM' : '字/分钟'}、${l.targetAccuracy}% 正确率。`;
  if (!isChallenge) feedback += ' 自由练习已计入记录，切换闯关模式可解锁后续关卡。';
  const mismatches = [...l.text].filter((char, i) => i < active.typed.length && char !== active.typed[i]).slice(0, 12);
  openModal(`<div class="result"><div class="modal-head" style="margin-bottom:0"><span></span><button class="close-button" data-action="close-modal" aria-label="关闭成绩">×</button></div><div class="result-emblem">${r.passed ? '✦' : '◌'}</div><h2>${isChallenge && r.passed ? '这一关，漂亮通过！' : r.complete ? '坚持完成，你很棒！' : '每一步，都算数。'}</h2><p>${esc(l.title)} · ${r.score} 分</p>${isChallenge ? stars(r.stars, 'result-stars') : '<span class="tag">自由练习</span>'}<div class="result-grid"><div><b>${r.speed.toFixed(1)}</b><small>${l.language === 'en' ? 'WPM' : '字 / 分钟'}</small></div><div><b>${r.accuracy.toFixed(1)}%</b><small>正确率</small></div><div><b>${formatTime(r.elapsed)}</b><small>练习用时</small></div></div><div class="result-feedback">${feedback}<br>准确输入 ${r.correct} 个字符${r.errors ? ` · 练习中调整了 ${r.errors} 次，认真纠错也值得鼓励` : ' · 这次输入很稳，给自己点个赞'}${mismatches.length ? `<br>下次可以留意：${esc(mismatches.map(x => x === ' ' ? '空格' : x).join(' '))}` : ''}</div><div class="result-actions"><button class="btn secondary" data-action="result-back">返回关卡</button><button class="btn ${r.passed && next && isChallenge ? 'secondary' : 'primary'}" data-action="result-retry">再练一次</button>${r.passed && next && isChallenge ? `<button class="btn primary" data-start="${next.id}">下一关 ${icon('arrow')}</button>` : ''}</div><div class="save-state"><span class="status-dot"></span>已保存到本机 · 重启后仍可继续</div></div>`);
}
function sourceDetails() {
  if (!session?.lesson.references) return;
  const l = session.lesson;
  const sources = l.references.map(ref => ({ ...ref, source: corpus.sources.find(x => x.id === ref.sourceId) }));
  openModal(`${modalHeader('这段文字从哪里来？')}<div class="source-detail">${sources.map(ref => `<article><strong>${esc(ref.source?.title || 'MathorCup 优秀论文')}</strong><p>PDF 第 ${ref.page} 页${ref.text ? ` · 词组「${esc(ref.text)}」` : ''}</p><p class="path">${esc(corpus.chineseSourceRoot)} / ${esc(ref.source?.file)}</p></article>`).join('')}<p style="margin-top:15px">正文合并了 PDF 排版换行和空格，文章练习为原文节选。</p></div>`);
}
function guide() {
  openModal(`${modalHeader('把练习变成小小的进步')}<div class="guide"><h3>六条路线，各自闯关</h3><p>英文和中文分别包含词组、句子、文章练习。每条路线从第一关开始，同时达到本关的速度与正确率目标即可解锁下一关；自由练习可以体验全部素材。</p><h3>速度和准确率怎么算？</h3><ul><li>英文 WPM = 正确字符数 ÷ 5 ÷ 实际练习分钟数。</li><li>中文速度 = 正确字符数 ÷ 实际练习分钟数；标点和空格也计为字符。</li><li>正确率 = 当前正确字符数 ÷（当前正确字符数 + 累计错误次数）。退格更正不会抹去错误记录。</li><li>从第一次输入开始计时；暂停和切换浏览器标签页会暂停计时。输入法选字期间计时，但不判错。</li></ul><h3>星级与综合评分</h3><p>完成全文且达到双目标获 1 星；正确率至少 97% 且速度达到目标的 1.15 倍获 2 星；正确率至少 99% 且速度达到目标的 1.4 倍获 3 星。自由练习不解锁关卡、不累计通关星级。</p><p>综合评分满分 100：正确率占 70 分，速度达标程度占 30 分。未完成全文计 0 分，仍记录练习时间。</p><h3>输入与保存</h3><p>支持中文输入法、退格纠错、暂停与专注模式。英文区分大小写，中文标点需与原文一致。练习区禁止粘贴；按 Esc 暂停，Ctrl + Enter 提前结束。成绩存放在本机 data/progress.sqlite3，练习记录页可导出 JSON。</p><h3>素材说明</h3><p>中文来自你提供的 ${corpus.sources.length} 篇 MathorCup 优秀论文，练习页可查看 PDF 页码。英文是 6 个雅思 Task 2 常见主题的原创范文，并非官方范文或官方评分。</p></div>`);
}
function restart() {
  if (!session) return;
  if (session.finished || !session.typed.length) { const { lesson, mode: m } = session; modal.close(); mode = m; startLesson(lesson.id); return; }
  pausePractice();
  openModal(`${modalHeader('从头再练一次？')}<div class="guide"><p>当前这次输入还没有保存，重新开始会清空本次计时与输入。</p><div class="result-actions"><button class="btn secondary" data-action="cancel-finish">继续练习</button><button class="btn primary" data-action="confirm-restart">重新开始</button></div></div>`);
}
function leavePractice() {
  if (!session) return;
  if (!session.finished && session.typed.length) {
    pausePractice();
    openModal(`${modalHeader('离开当前练习？')}<div class="guide"><p>本次练习尚未提交。可以先结束并评分，或者放弃本次输入返回关卡。</p><div class="result-actions"><button class="btn secondary" data-action="cancel-finish">继续练习</button><button class="btn secondary" data-action="discard">放弃并返回</button><button class="btn primary" data-action="confirm-finish">保存这次练习</button></div></div>`);
  } else exitSession();
}
function exitSession() {
  modal.close();
  const lang = session?.lesson.language || 'en';
  if (session) selectedKind = session.lesson.kind;
  clearInterval(tickTimer); session = null;
  document.body.classList.remove('focus-mode');
  location.hash = lang;
}

document.addEventListener('click', async event => {
  const button = event.target.closest('button, a');
  if (!button) return;
  if (button.dataset.start || button.dataset.free) {
    modal.close(); startLesson(button.dataset.start || button.dataset.free, Boolean(button.dataset.free)); return;
  }
  if (button.dataset.kind) { selectedKind = button.dataset.kind; renderTrack(currentRoute); return; }
  if (button.dataset.library) {
    document.querySelectorAll('[data-library]').forEach(x => { x.classList.toggle('active', x === button); x.setAttribute('aria-selected', x === button ? 'true' : 'false'); });
    renderSources(button.dataset.library, $('#source-search').value); return;
  }
  const action = button.dataset.action;
  if (!action) return;
  switch (action) {
    case 'guide': guide(); break;
    case 'close-modal': modal.close(); break;
    case 'pause': session?.paused ? resumePractice() : pausePractice(); break;
    case 'resume': resumePractice(); break;
    case 'finish': finishPractice(); break;
    case 'confirm-finish': finalize(); break;
    case 'cancel-finish': modal.close(); resumePractice(); break;
    case 'retry-save': finalize(); break;
    case 'restart': restart(); break;
    case 'confirm-restart': if (session) { const id = session.lesson.id, free = session.mode === 'free'; session.finished = true; modal.close(); startLesson(id, free); } break;
    case 'leave-practice': leavePractice(); break;
    case 'discard': if (session) session.finished = true; exitSession(); break;
    case 'result-back': exitSession(); break;
    case 'result-retry': restart(); break;
    case 'source': pausePractice(); sourceDetails(); break;
    case 'focus': document.body.classList.toggle('focus-mode'); break;
    case 'font-larger': case 'font-smaller':
      session.size = Math.max(16, Math.min(36, session.size + (action === 'font-larger' ? 2 : -2))); $('#reference').style.fontSize = `${session.size}px`; break;
    case 'export':
      try { const data = await api('/api/export'); const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })); const a = document.createElement('a'); a.href = url; a.download = `TypeFlow-练习记录-${new Date().toLocaleDateString('sv-SE')}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); toast('全部练习记录已导出。'); } catch (error) { toast(error.message); } break;
  }
});
document.addEventListener('change', event => {
  if (event.target.id === 'mode-select') { mode = event.target.value; renderTrack(currentRoute); }
  if (event.target.id === 'history-filter') renderHistory(event.target.value);
});
document.addEventListener('input', event => {
  if (event.target.id === 'source-search') renderSources(libraryLanguage, event.target.value);
});
document.addEventListener('keydown', event => {
  if (!session || session.finished || event.isComposing) return;
  if (event.key === 'Escape' && !modal.open) { event.preventDefault(); session.paused ? resumePractice() : pausePractice(); }
  if (event.ctrlKey && event.key === 'Enter' && !modal.open) { event.preventDefault(); finishPractice(); }
});
document.addEventListener('visibilitychange', () => { if (document.hidden && session?.hasStarted && !session.finished) pausePractice(); });
window.addEventListener('beforeunload', event => { if (session?.typed.length && !session.finished) { event.preventDefault(); event.returnValue = ''; } });
$('#help-button').addEventListener('click', guide);
modal.addEventListener('click', event => { if (event.target === modal) modal.close(); });

function route() {
  const requested = location.hash.slice(1) || 'home';
  const [section, detail] = requested.split('/');
  if (session && !session.finished && session.typed.length && requested !== `practice/${session.lesson.id}`) {
    history.replaceState(null, '', `#practice/${session.lesson.id}`);
    leavePractice(); return;
  }
  if (section !== 'practice') { stopTimer(); clearInterval(tickTimer); session = null; document.body.classList.remove('focus-mode'); }
  if (section === 'practice') {
    if (!session || session.lesson.id !== detail) { location.replace('#en'); return; }
    currentRoute = requested; renderPractice();
  } else if (['en', 'zh'].includes(section)) {
    if (Object.keys(kindNames).includes(detail)) selectedKind = detail;
    currentRoute = section; renderTrack(section);
  } else {
    currentRoute = ['home', 'history', 'library'].includes(section) ? section : 'home';
    if (currentRoute === 'home') home();
    if (currentRoute === 'history') renderHistory();
    if (currentRoute === 'library') library();
  }
  updateShell(currentRoute);
  window.scrollTo({ top: 0, behavior: 'instant' });
}
window.addEventListener('hashchange', route);

async function init() {
  $('#today-date').textContent = new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' });
  try {
    [corpus, stats] = await Promise.all([api('/api/corpus'), api('/api/stats')]);
    let pending;
    try { pending = JSON.parse(localStorage.getItem('typeflow-pending')); } catch { /* invalid recovery data */ }
    if (pending) {
      try { const data = await api('/api/attempts', { method: 'POST', body: JSON.stringify(pending) }); stats = data.stats; localStorage.removeItem('typeflow-pending'); toast('上次未保存的练习成绩已恢复。'); } catch { toast('有一条待保存成绩，恢复本地服务后刷新可重试。'); }
    }
    route();
  } catch (error) {
    main.innerHTML = `<div class="error-box"><h2>练习室还没有连接成功</h2><p>${esc(error.message)}</p><button class="btn primary" id="retry-init">重新连接</button></div>`;
    $('#retry-init').addEventListener('click', init);
  }
}
init();
