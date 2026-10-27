import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const output = new URL('../dist/', import.meta.url);
const files = (await fs.readdir(output)).sort();
assert.deepEqual(files, ['.nojekyll', 'app.js', 'browser-store.js', 'corpus.json', 'engine.js', 'favicon.svg', 'index.html', 'styles.css'].sort());
const html = await fs.readFile(new URL('index.html', output), 'utf8');
assert.match(html, /name="typeflow-storage" content="browser"/);
for (const match of html.matchAll(/(?:src|href)="([^"#][^"]*)"/g)) {
  assert.ok(match[1].startsWith('./'), `Asset must support a repository subpath: ${match[1]}`);
  const url = new URL(match[1], 'https://example.github.io/TypeFlow/');
  assert.ok(url.pathname.startsWith('/TypeFlow/'));
  await fs.access(new URL(match[1], output));
}
const corpus = JSON.parse(await fs.readFile(new URL('corpus.json', output), 'utf8'));
assert.equal(corpus.lessons.length, 106);
assert.equal(corpus.chineseSourceRoot, undefined, 'local machine paths must not enter the public artifact');
assert.ok(!JSON.stringify(corpus).includes('C:\\Users\\'));
const source = await fs.readFile(new URL('../frontend/index.html', import.meta.url), 'utf8');
assert.match(source, /name="typeflow-storage" content="server"/, 'local mode remains unchanged');
console.log('Pages artifact passed: relative assets, browser mode, all lessons, and no local database or machine paths.');
