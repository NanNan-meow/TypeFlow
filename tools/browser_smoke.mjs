// Local Edge fallback for environments without the in-app browser execution tool.
// All writes use the isolated test database supplied to launcher.py by the test run.
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

const root = path.resolve(import.meta.dirname, '..');
const artifacts = path.join(root, 'test-artifacts');
await fs.mkdir(artifacts, { recursive: true });
const runtime = JSON.parse(await fs.readFile(path.join(root, 'data/runtime.json'), 'utf8'));
const base = `http://127.0.0.1:${runtime.frontend}`;
assert.equal((await (await fetch(base + '/api/health')).json()).testDatabase, true, 'Browser smoke tests require an isolated test database.');
const corpus = await (await fetch(base + '/api/corpus')).json();
const edgePath = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const edgeLog = await fs.open(path.join(artifacts, 'edge-smoke.log'), 'w');
const edge = spawn(edgePath, ['--headless=new', '--no-sandbox', '--single-process', '--in-process-gpu', '--disable-gpu', '--disable-extensions', '--disable-breakpad', '--disable-crash-reporter', '--disable-features=RendererCodeIntegrity,NetworkServiceSandbox', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=9447', `--user-data-dir=${path.join(artifacts, 'edge-profile-single')}`, '--window-size=1440,1100', 'about:blank'], { stdio: ['ignore', edgeLog.fd, edgeLog.fd], windowsHide: true });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let ws;
try {
  let pages;
  for (let i = 0; i < 60; i++) {
    try { pages = await (await fetch('http://127.0.0.1:9447/json/list')).json(); if (pages.some(x => x.type === 'page')) break; } catch {}
    await delay(200);
  }
  const page = pages?.find(x => x.type === 'page');
  if (!page) throw new Error('Edge debugging connection unavailable');
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.addEventListener('open', resolve, { once: true }); ws.addEventListener('error', reject, { once: true }); });
  let sequence = 0;
  const callbacks = new Map(), errors = [];
  ws.addEventListener('message', event => {
    const data = JSON.parse(event.data);
    if (data.id && callbacks.has(data.id)) {
      const { resolve, reject } = callbacks.get(data.id); callbacks.delete(data.id);
      data.error ? reject(new Error(JSON.stringify(data.error))) : resolve(data.result);
    }
    if (data.method === 'Runtime.exceptionThrown') errors.push(data.params.exceptionDetails.text + ' ' + (data.params.exceptionDetails.exception?.description || ''));
  });
  function cdp(method, params = {}) {
    return new Promise((resolve, reject) => { const id = ++sequence; callbacks.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
  }
  async function evaluate(expression) {
    const data = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (data.exceptionDetails) throw new Error(data.exceptionDetails.exception?.description || data.exceptionDetails.text);
    return data.result?.value;
  }
  async function until(expression) {
    for (let i = 0; i < 60; i++) { if (await evaluate(expression)) return; await delay(100); }
    throw new Error('UI condition failed: ' + expression);
  }
  async function click(selector) {
    await evaluate(`(() => { const element = document.querySelector(${JSON.stringify(selector)}); if (!element) throw new Error('Missing UI element'); element.click(); })()`);
  }
  async function screenshot(name) {
    const { data } = await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    await fs.writeFile(path.join(artifacts, name), Buffer.from(data, 'base64'));
  }
  await cdp('Runtime.enable');
  await cdp('Page.enable');
  await cdp('Page.navigate', { url: base });
  await until("Boolean(document.querySelector('.hero'))");
  assert.equal(await evaluate("document.querySelectorAll('.course').length"), 2);
  assert.equal(await evaluate("getComputedStyle(document.querySelector('.hero')).display"), 'flex');
  await screenshot('01-dashboard-desktop.png');
  await click('[href="#en"]');
  await until("document.querySelectorAll('.level-card').length === 12");
  assert.equal(await evaluate("document.querySelectorAll('[data-start]').length"), 12, 'all challenge levels are selectable');
  await screenshot('02-english-levels.png');
  await click('[data-start="en-phrase-01"]');
  await until("Boolean(document.querySelector('#typing-input'))");
  assert.equal(await evaluate("getComputedStyle(document.querySelector('#paused-cover')).display"), 'none');
  const first = corpus.lessons.find(x => x.id === 'en-phrase-01');
  await cdp('Input.insertText', { text: 'x' });
  await delay(500);
  assert.equal(await evaluate("document.querySelectorAll('#reference .incorrect').length"), 1);
  await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
  await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
  await cdp('Input.insertText', { text: first.text.slice(0, 20) });
  await delay(500);
  await click('[data-action="pause"]');
  assert.equal(await evaluate("getComputedStyle(document.querySelector('#paused-cover')).display"), 'flex');
  const pausedTime = await evaluate("document.querySelector('#live-time').textContent");
  await delay(1200);
  assert.equal(await evaluate("document.querySelector('#live-time').textContent"), pausedTime, 'paused clock remains stable');
  await click('[data-action="resume"]');
  await screenshot('03-typing-desktop.png');
  await cdp('Input.insertText', { text: first.text.slice(20) });
  await until("Boolean(document.querySelector('.result-grid'))");
  assert.match(await evaluate("document.querySelector('#modal-content').textContent"), /漂亮通过/);
  let stats = await (await fetch(base + '/api/stats')).json();
  assert.equal(stats.progress['en-phrase-01'].passed, true);
  assert.equal(stats.history[0].errors, 1);
  await screenshot('04-result.png');
  await click('[data-action="result-back"]');
  await until("document.querySelectorAll('.level-card').length === 12");
  assert.equal(await evaluate("document.querySelectorAll('[data-start]').length"), 12);
  await click('[href="#zh"]');
  await until("document.querySelectorAll('.level-card').length === 26");
  await click('[data-start="zh-phrase-01"]');
  await until("Boolean(document.querySelector('#typing-input'))");
  const chinese = corpus.lessons.find(x => x.id === 'zh-phrase-01');
  // Native CDP IME lifecycle: uncommitted pinyin must not be judged.
  await cdp('Input.imeSetComposition', { text: 'shu', selectionStart: 3, selectionEnd: 3 });
  await delay(350);
  assert.equal(await evaluate("document.querySelectorAll('#reference .incorrect').length"), 0);
  await cdp('Input.insertText', { text: chinese.text.slice(0, 2) });
  await delay(350);
  assert.equal(await evaluate("document.querySelectorAll('#reference .correct').length"), 2);
  await cdp('Input.insertText', { text: chinese.text.slice(2) });
  await until("Boolean(document.querySelector('.result-grid'))");
  stats = await (await fetch(base + '/api/stats')).json();
  assert.equal(stats.progress['zh-phrase-01'].passed, true);
  assert.equal(stats.history[0].errors, 0, 'IME composition must not add errors');
  await click('[data-action="result-back"]');
  await until("document.querySelectorAll('.level-card').length === 26");
  await click('[href="#library"]');
  await until("document.querySelectorAll('.source-row').length === 41");
  await click('[data-library="en"]');
  assert.equal(await evaluate("document.querySelectorAll('.library-essay').length"), 6);
  await click('[href="#history"]');
  await until("Boolean(document.querySelector('table'))");
  assert.equal(await evaluate("document.querySelectorAll('tbody tr').length"), 2);
  await screenshot('05-history.png');
  await click('[href="#home"]');
  await until("Boolean(document.querySelector('.hero'))");
  await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await screenshot('06-dashboard-mobile.png');
  assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true, 'mobile has no horizontal overflow');
  await click('[href="#en"]');
  await until("document.querySelectorAll('.level-card').length === 12");
  await screenshot('07-levels-mobile.png');
  assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true);
  assert.deepEqual(errors, [], 'no browser exceptions');
  console.log(JSON.stringify({ result: 'PASS', checks: ['dashboard', 'all levels open', 'English typing', 'correction accounting', 'pause timer', 'save progress', 'Chinese native IME', 'library', 'history', 'desktop and mobile layouts', 'no browser exceptions'], screenshots: 7 }, null, 2));
} finally {
  ws?.close();
  edge.kill();
  await edgeLog.close();
}
