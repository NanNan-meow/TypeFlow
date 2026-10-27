// Use an isolated Edge profile and static Pages preview; never touch the user's records.
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const artifacts = path.join(root, 'test-artifacts');
const profilePath = path.join(artifacts, `profile-edge-${Date.now()}`);
await fs.mkdir(profilePath, { recursive: true });
const downloads = path.join(profilePath, 'downloads');
await fs.mkdir(downloads);
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (!url.pathname.startsWith('/TypeFlow/')) { res.writeHead(404).end(); return; }
  const target = path.resolve(dist, url.pathname.slice('/TypeFlow/'.length) || 'index.html');
  if (!target.startsWith(dist + path.sep)) { res.writeHead(404).end(); return; }
  try {
    const data = await fs.readFile(target);
    const type = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json' }[path.extname(target)];
    res.writeHead(200, { 'Content-Type': `${type || 'application/octet-stream'}; charset=utf-8`, 'Cache-Control': 'no-store' }); res.end(data);
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}/TypeFlow/`;
const edge = spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--remote-debugging-port=0', `--user-data-dir=${profilePath}`, '--window-size=1440,1100', 'about:blank'], { stdio: 'ignore', windowsHide: true });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let ws;
try {
  let port;
  for (let i = 0; i < 80; i++) { try { port = Number((await fs.readFile(path.join(profilePath, 'DevToolsActivePort'), 'utf8')).split('\n')[0]); if (port) break; } catch {} await delay(100); }
  if (!port) throw new Error('Isolated Edge did not start');
  const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const page = pages.find(item => item.type === 'page');
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.addEventListener('open', resolve, { once: true }); ws.addEventListener('error', reject, { once: true }); });
  let id = 0;
  const pending = new Map(), errors = [];
  ws.addEventListener('message', event => {
    const data = JSON.parse(event.data);
    if (pending.has(data.id)) { const task = pending.get(data.id); pending.delete(data.id); clearTimeout(task.timer); data.error ? task.reject(new Error(JSON.stringify(data.error))) : task.resolve(data.result); }
    if (data.method === 'Runtime.exceptionThrown') errors.push(data.params.exceptionDetails.exception?.description || data.params.exceptionDetails.text);
  });
  function cdp(method, params = {}) {
    return new Promise((resolve, reject) => { const requestId = ++id; const timer = setTimeout(() => { pending.delete(requestId); reject(new Error(`CDP timeout: ${method}`)); }, 10000); pending.set(requestId, { resolve, reject, timer }); ws.send(JSON.stringify({ id: requestId, method, params })); });
  }
  async function read(expression) { const result = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (result.exceptionDetails) throw new Error(result.exceptionDetails.text); return result.result.value; }
  async function until(expression) { for (let i = 0; i < 70; i++) { if (await read(expression)) return; await delay(100); } throw new Error('UI condition failed: ' + expression); }
  async function click(selector) {
    const point = await read(`(() => { const node = document.querySelector(${JSON.stringify(selector)}); if (!node) throw new Error('Element missing'); const r = node.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`);
    await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...point });
    await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...point });
  }
  async function key(key, code, virtualKey, modifiers = 0) {
    await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: virtualKey, modifiers, ...(key === 'Enter' ? { text: '\r', unmodifiedText: '\r' } : {}) });
    await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: virtualKey, modifiers });
  }
  async function screenshot(name) { const data = await cdp('Page.captureScreenshot', { format: 'png' }); await fs.writeFile(path.join(artifacts, name), Buffer.from(data.data, 'base64')); }
  await cdp('Runtime.enable'); await cdp('Page.enable');
  await cdp('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads });
  await cdp('Page.navigate', { url: base });
  await until("Boolean(document.querySelector('.hero'))");
  assert.equal(await read("document.querySelector('#personal-space-button').tagName"), 'BUTTON');
  await click('#personal-space-button');
  await until("document.querySelector('#modal').open && Boolean(document.querySelector('#personal-space-form'))");
  assert.equal(await read("document.querySelector('#space-font-size').value"), '28');
  await screenshot('personal-space-desktop.png');
  await click('#space-nickname'); await cdp('Input.insertText', { text: 'Test Learner' });
  await click('#space-daily-goal'); await key('End', 'End', 35); await key('Enter', 'Enter', 13);
  await click('#space-font-size'); await key('End', 'End', 35); await key('Enter', 'Enter', 13);
  assert.equal(await read("document.querySelector('#space-font-size').value"), '36');
  await click('#personal-space-form button[type="submit"]');
  await until("!document.querySelector('#modal').open");
  assert.equal(await read("document.querySelector('.avatar').textContent"), 'T');
  assert.match(await read("document.querySelector('#daily-time').textContent"), /60/);
  assert.match(await read("document.querySelector('h1').textContent"), /Test Learner/);
  await cdp('Page.reload'); await until("Boolean(document.querySelector('.hero'))");
  assert.match(await read("document.querySelector('h1').textContent"), /Test Learner/);
  await click('.avatar'); await until("Boolean(document.querySelector('#personal-space-form'))");
  assert.equal(await read("document.querySelector('#space-nickname').value"), 'Test Learner');
  assert.equal(await read("document.querySelector('#space-font-size').value"), '36');
  await click('[data-action="export"]');
  let exported;
  for (let i = 0; i < 40; i++) { exported = (await fs.readdir(downloads)).find(name => name.endsWith('.json')); if (exported) break; await delay(100); }
  assert.ok(exported, 'export downloaded a JSON file');
  assert.equal(JSON.parse(await fs.readFile(path.join(downloads, exported), 'utf8')).app, 'typeflow');
  await click('[data-action="space-history"]');
  await until("location.hash === '#history' && Boolean(document.querySelector('#history-filter'))");
  await click('[href="#en"]'); await until("document.querySelectorAll('.level-card').length === 12");
  await click('[data-start="en-phrase-01"]'); await until("Boolean(document.querySelector('#typing-input'))");
  assert.equal(await read("document.querySelector('#reference').style.fontSize"), '36px');
  await cdp('Input.insertText', { text: 'abc' });
  await click('#personal-space-button'); await until("document.querySelector('#modal').open");
  assert.equal(await read("document.querySelector('#typing-input').value"), 'abc');
  assert.equal(await read("document.querySelector('#typing-input').disabled"), true, 'opening personal space pauses practice');
  await key('Escape', 'Escape', 27); await until("!document.querySelector('#modal').open");
  assert.equal(await read("document.activeElement.id"), 'personal-space-button', 'closing the dialog restores focus to the opener');
  await key('Enter', 'Enter', 13); await until("document.querySelector('#modal').open");
  assert.ok(await read("Boolean(document.querySelector('#personal-space-form'))"), 'button supports keyboard activation after closing');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await screenshot('personal-space-mobile.png');
  assert.equal(await read('document.documentElement.scrollWidth <= innerWidth'), true);
  assert.equal(await read("document.querySelector('#modal').scrollWidth <= document.querySelector('#modal').clientWidth"), true);
  assert.deepEqual(errors, [], 'no browser exceptions');
  console.log(JSON.stringify({ result: 'PASS', checks: ['mouse and keyboard activation', 'settings saved', 'refresh persistence', 'daily goal', 'nickname', 'practice font', 'export download', 'history navigation', 'pause without losing input', 'mobile layout', 'no browser exceptions'], screenshots: ['personal-space-desktop.png', 'personal-space-mobile.png'] }, null, 2));
  await cdp('Browser.close').catch(() => {});
} finally { ws?.close(); edge.kill(); await new Promise(resolve => server.close(resolve)); }
