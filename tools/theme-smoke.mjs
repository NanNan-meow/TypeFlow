// Test every route in both themes at desktop, laptop and phone widths.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { launchBrowserTest, artifacts, root, delay } from './browser-test-harness.mjs';

const corpus = JSON.parse(await fs.readFile(path.join(root, 'data/corpus.json'), 'utf8'));
const browser = await launchBrowserTest('themes');
const { cdp, read, until, click, key, screenshot } = browser;
const checks = [], shots = [];

// Read visible text colors against the composited background, including nested cards.
const auditScript = `(() => {
  function rgb(value) { const parts=value.match(/[\\d.]+/g)?.map(Number)||[];return [parts[0]||0,parts[1]||0,parts[2]||0,parts.length>3?parts[3]:1]; }
  function over(top,bottom) { return [0,1,2].map(i=>top[i]*top[3]+bottom[i]*(1-top[3])); }
  function background(node) { const layers=[];for(let el=node;el;el=el.parentElement) layers.push(rgb(getComputedStyle(el).backgroundColor));let color=[255,255,255];for(let i=layers.length-1;i>=0;i--)color=over(layers[i],color);return color; }
  function luminance(color) {return color.map(x=>{x/=255;return x<=.04045?x/12.92:Math.pow((x+.055)/1.055,2.4);}).reduce((n,x,i)=>n+x*[.2126,.7152,.0722][i],0);}
  const modal=document.querySelector('dialog[open]');const scope=modal||document.body;
  const bad=[];let textChecks=0;
  const walker=document.createTreeWalker(scope,NodeFilter.SHOW_TEXT);
  while(walker.nextNode()){
    const text=walker.currentNode;const el=text.parentElement;
    if(!el||!text.textContent.trim()||el.closest('script,style,[aria-hidden="true"],.brand-mark,.stars,.result-stars,.theme-swatch,option'))continue;
    const cs=getComputedStyle(el),r=el.getBoundingClientRect();
    if(cs.visibility==='hidden'||cs.display==='none'||Number(cs.opacity)===0||r.width<1||r.height<1||el.closest('button:disabled,[hidden]'))continue;
    const bg=background(el),fg=over(rgb(cs.color),bg);const a=luminance(bg),b=luminance(fg);const ratio=(Math.max(a,b)+.05)/(Math.min(a,b)+.05);
    const large=parseFloat(cs.fontSize)>=24||(parseFloat(cs.fontSize)>=18.66&&parseInt(cs.fontWeight)>=700);const target=large?3:4.5;
    textChecks++;if(ratio<target-.03)bad.push({text:text.textContent.trim().slice(0,42),selector:el.tagName.toLowerCase()+'.'+el.className,ratio:Math.round(ratio*100)/100,target,color:cs.color,bg});
  }
  const overlaps=[];for(const grid of document.querySelectorAll('.metrics,.courses,.level-grid,.lower-grid,.theme-options')){const children=[...grid.children].map(n=>n.getBoundingClientRect());for(let i=0;i<children.length;i++)for(let j=i+1;j<children.length;j++){const a=children[i],b=children[j];if(Math.min(a.right,b.right)-Math.max(a.left,b.left)>1&&Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>1)overlaps.push(grid.className);}}
  return {theme:document.documentElement.dataset.theme,bodyBackground:getComputedStyle(document.body).backgroundColor,width:innerWidth,documentWidth:document.documentElement.scrollWidth,dialogOverflow:modal?modal.scrollWidth>modal.clientWidth+1:false,textChecks,bad,overlaps};
})()`;

async function audit(name, theme, size, image = true) {
  await read('window.scrollTo(0,0)');
  const state = await read(auditScript);
  checks.push({ name, theme, size, ...state });
  assert.equal(state.theme, theme, `${name}: theme applied`);
  assert.equal(state.bodyBackground, theme==='dark'?'rgb(19, 22, 34)':'rgb(248, 249, 252)',`${name}: theme colors are actually painted`);
  assert.ok(state.documentWidth <= state.width + 1, `${name} ${theme} ${size}: page overflows horizontally (${state.documentWidth}/${state.width})`);
  assert.equal(state.dialogOverflow, false, `${name}: dialog must fit`);
  assert.deepEqual(state.overlaps, [], `${name}: grid cards must not overlap`);
  // Collect contrast findings so all routes can be reviewed in one pass.
  if (image) { const filename = `theme-shots/${size}-${theme}-${name}.png`; shots.push({ name, theme, size, filename }); await screenshot(filename); }
}

async function closeModal() { if (await read("document.querySelector('#modal').open")) { await key('Escape', 'Escape', 27); await until("!document.querySelector('#modal').open"); await delay(35); } }
async function setThemeOnCurrentPage(theme) {
  await click('#personal-space-button');
  await until("Boolean(document.querySelector('#personal-space-form'))");
  await click(`[data-theme-option="${theme === 'dark' ? 'light' : 'dark'}"]`);
  await click(`[data-theme-option="${theme}"]`);
  assert.equal(await read('document.documentElement.dataset.theme'), theme, 'radio choice previews immediately');
  await click('#personal-space-form button[type="submit"]');
  await until("!document.querySelector('#modal').open");
  assert.equal(await read('document.documentElement.dataset.theme'), theme, 'saved theme remains active');
}
async function navigate(route) {
  await closeModal();
  await read(`location.hash=${JSON.stringify(route)}`);
  await until(`location.hash===${JSON.stringify('#' + route)}`);
  await delay(45);
}
async function leavePractice() {
  await closeModal();
  await click('[data-action="leave-practice"]');
  if (await read("Boolean(document.querySelector('[data-action=discard]'))")) await click('[data-action="discard"]');
  await until("!document.querySelector('#typing-input')");
}
async function startLesson(language, kind) {
  await navigate(`${language}/${kind}`);
  await until("Boolean(document.querySelector('.level-card'))");
  const lesson = corpus.lessons.find(item => item.language === language && item.kind === kind && item.order === 1);
  await click(`[data-start="${lesson.id}"]`);
  await until("Boolean(document.querySelector('#typing-input'))");
  return lesson;
}

try {
  await cdp('Page.navigate', { url: browser.base }); await until("Boolean(document.querySelector('.hero'))");
  assert.equal(await read("document.querySelectorAll('[data-action=personal-space]').length"), 1, 'one clear profile entry');
  // Preview cancellation must restore the saved light theme.
  await click('#personal-space-button'); await click('[data-theme-option="dark"]');
  assert.equal(await read('document.documentElement.dataset.theme'), 'dark');
  await closeModal(); assert.equal(await read('document.documentElement.dataset.theme'), 'light');
  // Check the empty history state before creating isolated test records.
  for (const theme of ['light', 'dark']) {
    await navigate('history'); await setThemeOnCurrentPage(theme); await audit('history-empty', theme, 'desktop');
  }
  // Use the actual editor and result dialog so populated records are tested too.
  for (const language of ['en', 'zh']) {
    const lesson = await startLesson(language, 'phrase');
    await cdp('Input.insertText', { text: lesson.text });
    await until("Boolean(document.querySelector('.result-grid'))");
    await audit(`result-${language}`, 'dark', 'desktop');
    await click('[data-action="result-back"]'); await until("Boolean(document.querySelector('.level-card'))");
  }
  for (const [size, width, height] of [['desktop',1440,1100],['laptop',1024,900],['phone',390,844]]) {
    await browser.viewport(width, height);
    for (const theme of ['light', 'dark']) {
      await navigate('home'); await setThemeOnCurrentPage(theme); await audit('home', theme, size);
      const recorded = await read(`JSON.parse(localStorage.getItem('typeflow:pages:v1:/TypeFlow/')).attempts.length`);
      // Settings, guide and validation-error colors are tested in both themes.
      await click('#personal-space-button'); await audit('personal-space', theme, size);
      await read("globalThis.originalSetItem=Storage.prototype.setItem;Storage.prototype.setItem=function(){throw new Error('QA quota');}");
      await click('#personal-space-form button[type="submit"]');
      await until("!document.querySelector('#space-error').hidden");
      await audit('personal-space-save-error',theme,size);
      await read('Storage.prototype.setItem=globalThis.originalSetItem');
      await closeModal();
      if (size !== 'phone') await click('#help-button');
      else await click('[data-action="guide"]');
      await audit('guide', theme, size); await closeModal();
      for (const language of ['en','zh']) for (const kind of ['phrase','sentence','article']) {
        await navigate(`${language}/${kind}`); await setThemeOnCurrentPage(theme); await audit(`${language}-${kind}-levels`, theme, size);
        const lesson = await startLesson(language,kind);
        await click('#typing-input'); await cdp('Input.insertText', { text: '?' });
        await setThemeOnCurrentPage(theme);
        assert.equal(await read("document.querySelector('#typing-input').value"), '?', 'switching themes preserves current input');
        await click('[data-action="resume"]');
        await audit(`${language}-${kind}-practice`, theme, size);
        if (kind==='article') {
          await click('[data-action="focus"]');
          await audit(`${language}-article-focus`,theme,size);
          await click('[data-action="focus"]');
        }
        // Color states and secondary dialogs are explicitly checked, beyond page backgrounds.
        await click('#typing-input'); await key('Backspace','Backspace',8); await cdp('Input.insertText',{text:lesson.text.slice(0,6)});
        await audit(`${language}-${kind}-correct-input`,theme,size,false);
        await click('[data-action="pause"]'); await audit(`${language}-${kind}-paused`,theme,size,false);
        if (language==='zh') { await click('[data-action="source"]'); await audit(`zh-${kind}-source`,theme,size); await closeModal(); }
        await click('[data-action="resume"]');
        if (kind === 'phrase') {
          await cdp('Input.insertText', { text: lesson.text.slice(6) });
          await until("Boolean(document.querySelector('.result-grid'))");
          await audit(`result-${language}`,theme,size);
          await click('[data-action="result-back"]'); await until("Boolean(document.querySelector('.level-card'))");
        } else await leavePractice();
      }
      await navigate('history'); await setThemeOnCurrentPage(theme); await audit('history',theme,size);
      assert.ok(await read("document.querySelectorAll('tbody tr').length > 0"));
      await navigate('library'); await setThemeOnCurrentPage(theme); await audit('library-zh',theme,size);
      await click('[data-library="en"]'); await setThemeOnCurrentPage(theme); await audit('library-en',theme,size);
      await navigate('home');
      const records = await read("localStorage.getItem('typeflow:pages:v1:/TypeFlow/')");
      await read("localStorage.setItem('typeflow:pages:v1:/TypeFlow/','{broken')");
      await cdp('Page.reload'); await until("Boolean(document.querySelector('.error-box'))");
      await audit('load-error',theme,size);
      await read(`localStorage.setItem('typeflow:pages:v1:/TypeFlow/',${JSON.stringify(records)})`);
      await click('#retry-init'); await until("Boolean(document.querySelector('.hero'))");
      assert.ok(await read(`JSON.parse(localStorage.getItem('typeflow:pages:v1:/TypeFlow/')).attempts.length`) >= recorded, 'theme settings never reset records');
      await cdp('Page.reload'); await until("Boolean(document.querySelector('.hero')) || Boolean(document.querySelector('.source-list'))");
      assert.equal(await read('document.documentElement.dataset.theme'),theme,'theme survives refresh');
      console.log(`PASS: ${size} ${theme} — every route, all six practice lanes, results, guide, settings and source dialogs.`);
    }
  }
  assert.deepEqual(browser.errors, [], 'no browser exceptions');
  const findings = checks.filter(check=>check.bad.length).map(({name,theme,size,bad})=>({name,theme,size,bad}));
  const report = { result:findings.length?'CONTRAST_REVIEW':'PASS', viewports:['1440×1100','1024×900','390×844'], checks:checks.length, screenshots:shots.length, textChecks:checks.reduce((sum,item)=>sum+item.textChecks,0), findings, pages:checks };
  await fs.writeFile(path.join(artifacts,'theme-checks.json'),JSON.stringify(report,null,2));
  await fs.writeFile(path.join(artifacts,'theme-shots.json'),JSON.stringify(shots,null,2));
  console.log(JSON.stringify({result:report.result,checks:report.checks,screenshots:report.screenshots,textChecks:report.textChecks,contrastFindings:findings.length,firstFindings:findings.slice(0,3)},null,2));
  if(findings.length) process.exitCode=1;
} finally { await browser.close(); }
