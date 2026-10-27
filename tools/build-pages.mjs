import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = await fs.realpath(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'));
const output = path.resolve(root, 'dist');
// Only this build's fixed output directory may be replaced, including on Windows.
if (path.dirname(output) !== root || path.basename(output) !== 'dist') throw new Error('Unexpected Pages output path');
const existing = await fs.lstat(output).catch(error => { if (error.code !== 'ENOENT') throw error; });
if (existing?.isSymbolicLink()) throw new Error('Pages output must not be a symlink');
if (existing) await fs.rm(output, { recursive: true, force: true });
await fs.mkdir(output);
const assets = ['index.html', 'app.js', 'engine.js', 'browser-store.js', 'preferences.js', 'styles.css', 'favicon.svg'];
for (const asset of assets) await fs.copyFile(path.join(root, 'frontend', asset), path.join(output, asset));
const indexPath = path.join(output, 'index.html');
const html = (await fs.readFile(indexPath, 'utf8')).replace('name="typeflow-storage" content="server"', 'name="typeflow-storage" content="browser"');
if (!html.includes('name="typeflow-storage" content="browser"')) throw new Error('Pages storage mode was not enabled');
await fs.writeFile(indexPath, html);
const corpus = JSON.parse(await fs.readFile(path.join(root, 'data/corpus.json'), 'utf8'));
delete corpus.chineseSourceRoot;
await fs.writeFile(path.join(output, 'corpus.json'), JSON.stringify(corpus));
await fs.writeFile(path.join(output, '.nojekyll'), '');
console.log(`Pages site built: dist/ (${corpus.lessons.length} lessons, browser-local progress).`);
