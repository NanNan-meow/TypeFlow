// Browser fallback used only when the in-app browser execution tool is unavailable.
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const artifacts = path.join(root, 'test-artifacts');
export const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

export async function launchBrowserTest(name) {
  const dist = path.join(root, 'dist');
  const profile = path.join(artifacts, `${name}-edge-${Date.now()}`);
  await fs.mkdir(profile, { recursive: true });
  const server = http.createServer(async (req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    const qa = pathname.startsWith('/qa/');
    const allowedRoot = qa ? artifacts : dist;
    const tail = pathname.slice(qa ? 4 : '/TypeFlow/'.length) || 'index.html';
    if (!qa && !pathname.startsWith('/TypeFlow/')) { res.writeHead(404).end(); return; }
    const target = path.resolve(allowedRoot, tail);
    if (!target.startsWith(allowedRoot + path.sep) || (qa && !['.html', '.png'].includes(path.extname(target)))) { res.writeHead(404).end(); return; }
    try {
      const data = await fs.readFile(target);
      const type = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png' }[path.extname(target)];
      res.writeHead(200, { 'Content-Type': type || 'application/octet-stream', 'Cache-Control': 'no-store' }); res.end(data);
    } catch { res.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const edge = spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--window-size=1440,1100', 'about:blank'], { stdio: 'ignore', windowsHide: true });
  let ws;
  try {
    let port;
    for (let i = 0; i < 100; i++) { try { port = Number((await fs.readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]); if (port) break; } catch {} await delay(100); }
    if (!port) throw new Error('Isolated Edge could not start');
    const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    ws = new WebSocket(pages.find(page => page.type === 'page').webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { ws.addEventListener('open', resolve, { once: true }); ws.addEventListener('error', reject, { once: true }); });
  } catch (error) { edge.kill(); await new Promise(resolve => server.close(resolve)); throw error; }
  let sequence = 0;
  const pending = new Map(), errors = [];
  ws.addEventListener('message', event => {
    const data = JSON.parse(event.data);
    if (pending.has(data.id)) { const task = pending.get(data.id); pending.delete(data.id); clearTimeout(task.timer); data.error ? task.reject(new Error(JSON.stringify(data.error))) : task.resolve(data.result); }
    if (data.method === 'Runtime.exceptionThrown') errors.push(data.params.exceptionDetails.exception?.description || data.params.exceptionDetails.text);
  });
  const cdp = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 12000);
    pending.set(id, { resolve, reject, timer }); ws.send(JSON.stringify({ id, method, params }));
  });
  async function read(expression) {
    const result = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  }
  async function until(expression) { for (let i = 0; i < 80; i++) { if (await read(expression)) return; await delay(100); } throw new Error('UI condition failed: ' + expression); }
  async function click(selector) {
    await read(`document.querySelector(${JSON.stringify(selector)})?.scrollIntoView({block:'center',inline:'nearest'})`);
    const point = await read(`(() => {const el=document.querySelector(${JSON.stringify(selector)});if(!el)throw new Error('Missing click target');const r=el.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
    await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...point });
    await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...point });
  }
  async function key(key, code, virtualKey, modifiers = 0) {
    await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: virtualKey, modifiers, ...(key === 'Enter' ? { text: '\r', unmodifiedText: '\r' } : {}) });
    await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: virtualKey, modifiers });
  }
  async function screenshot(name) { const image = await cdp('Page.captureScreenshot', { format: 'png' }); const file = path.join(artifacts, name); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, Buffer.from(image.data, 'base64')); return name; }
  async function viewport(width, height) { await cdp('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 640 }); }
  async function close() { await cdp('Browser.close').catch(() => {}); ws.close(); edge.kill(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  await cdp('Runtime.enable'); await cdp('Page.enable');
  return { base: origin + '/TypeFlow/', origin, profile, cdp, read, until, click, key, screenshot, viewport, close, errors };
}
