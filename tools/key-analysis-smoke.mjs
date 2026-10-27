import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { launchBrowserTest, artifacts, root, delay } from './browser-test-harness.mjs';

const corpus=JSON.parse(await fs.readFile(path.join(root,'data/corpus.json'),'utf8'));
const browser=await launchBrowserTest('key-analysis');
const {read,cdp,until,click,key}=browser;
const checks=[];
async function press(char,wait=35){
  if(wait)await delay(wait);
  const letter=/^[a-z]$/i.test(char);
  const punctuation={' ':['Space',32],'.':['Period',190],',':['Comma',188],"'":['Quote',222],'-':['Minus',189]};
  const [code,vk]=letter?['Key'+char.toUpperCase(),char.toUpperCase().charCodeAt(0)]:(punctuation[char]||['Unidentified',0]);
  await cdp('Input.dispatchKeyEvent',{type:'keyDown',key:char,code,windowsVirtualKeyCode:vk,text:char,unmodifiedText:char,modifiers:letter&&char===char.toUpperCase()?8:0});
  await cdp('Input.dispatchKeyEvent',{type:'keyUp',key:char,code,windowsVirtualKeyCode:vk});
}
async function go(route){await read(`location.hash=${JSON.stringify(route)}`);await delay(60);}
async function theme(value){await click('#personal-space-button');await click(`[data-theme-option="${value}"]`);await click('#personal-space-form button[type="submit"]');await until("!document.querySelector('#modal').open");}
async function screenshot(name){await browser.screenshot(`key-analysis/${name}.png`);}
async function layout(label){const state=await read("({width:innerWidth,documentWidth:document.documentElement.scrollWidth,dialogOverflow:document.querySelector('#modal').scrollWidth>document.querySelector('#modal').clientWidth+1})");assert.ok(state.documentWidth<=state.width+1,label);assert.equal(state.dialogOverflow,false,label);}
try{
  await cdp('Page.navigate',{url:browser.base});await until("Boolean(document.querySelector('.hero'))");
  for(const [size,width,height]of[['desktop',1440,1100],['phone',390,844]])for(const mode of ['light','dark']){
    await browser.viewport(width,height);await theme(mode);
    for(const kind of ['phrase','sentence','article']){
      await go(`en/${kind}`);await until("Boolean(document.querySelector('.level-card'))");
      const lesson=corpus.lessons.find(row=>row.language==='en'&&row.kind===kind&&row.order===1);
      await click(`[data-start="${lesson.id}"]`);await until("Boolean(document.querySelector('#typing-input'))");
      // An actual wrong key + Backspace must not become a slow-key timing sample.
      await press('x');await key('Backspace','Backspace',8);
      const fragment=lesson.text.slice(0,48);
      const counts={};for(const char of fragment.slice(1).toLowerCase())if(/[a-z]/.test(char))counts[char]=(counts[char]||0)+1;
      const slow=Object.keys(counts).sort((a,b)=>counts[b]-counts[a])[0];
      let expectedSamples=0;
      for(let i=0;i<fragment.length;i++){
        if(i===12){await click('[data-action="pause"]');await delay(1000);await click('[data-action="resume"]');}
        await press(fragment[i],fragment[i].toLowerCase()===slow?240:25);
        if(i!==0&&i!==12&&/[a-z]/i.test(fragment[i]))expectedSamples++;
      }
      // The remainder intentionally arrives in one batch and must create no fake timings.
      await cdp('Input.insertText',{text:lesson.text.slice(fragment.length)});
      await until("Boolean(document.querySelector('.result-grid'))");
      await until("Boolean(document.querySelector('.key-summary'))");
      const saved=await read("JSON.parse(localStorage.getItem('typeflow:pages:v1:/TypeFlow/')).attempts.at(-1)");
      assert.equal(saved.lesson_id,lesson.id);assert.equal(saved.accuracy,100);
      const sampled=Object.values(saved.keyTimings.letters).reduce((sum,row)=>sum+row.samples,0);
      assert.equal(sampled,expectedSamples,'only measured physical-letter intervals are counted');
      assert.equal(Object.values(saved.keyTimings.letters).reduce((sum,row)=>sum+row.errors,0),1,'the required letter records the corrected mistake');
      assert.ok(Object.values(saved.keyTimings.letters).every(row=>!row.samples||row.totalMs/row.samples<900),'pause time does not inflate averages');
      await layout('result '+size+mode+kind);await screenshot(`${size}-${mode}-${kind}-result`);
      await click('[data-action="show-key-analysis"]');await until("Boolean(document.querySelector('.letter-keyboard'))");
      assert.equal(await read("document.querySelector('#modal').scrollTop"),0,'analysis opens from the heading after scrolling the result');
      assert.equal(await read("document.querySelectorAll('.letter-key').length"),26);
      assert.ok(await read(`Boolean(document.querySelector('.key-slow-chip[data-analysis-key="${slow}"]'))`),'the deliberately slower repeated letter is highlighted');
      await layout('analysis '+size+mode+kind);await screenshot(`${size}-${mode}-${kind}-analysis`);
      await click(`.letter-key[data-analysis-key="${slow}"]`);
      assert.equal(await read("document.querySelector('#key-analysis-detail > strong').textContent"),slow.toUpperCase());
      await layout('selected letter '+size+mode+kind);
      await click('.key-analysis-table summary');
      assert.equal(await read("document.querySelectorAll('.key-analysis-table tbody tr').length"),26);
      await layout('expanded detail table');
      await click('[data-action="analysis-back"]');await until("Boolean(document.querySelector('.result-grid'))");
      await click('[data-action="result-back"]');await until("Boolean(document.querySelector('.level-card'))");
      checks.push({size,theme:mode,kind,samples:sampled,slowLetter:slow,passed:true});
      console.log(`PASS: ${size} ${mode} ${kind} — ${sampled} physical-key samples, corrected mistake and pause excluded.`);
    }
    await go('history');await until("Boolean(document.querySelector('.history-key-analysis'))");
    await click('.history-key-analysis');await until("Boolean(document.querySelector('.letter-keyboard'))");await layout('history analysis');
    await click('[data-action="analysis-back"]');await until("!document.querySelector('#modal').open");
    await cdp('Page.reload');await until("Boolean(document.querySelector('.history-key-analysis'))");
    await click('.history-key-analysis');await until("Boolean(document.querySelector('.letter-keyboard'))");
    await key('Escape','Escape',27);await until("!document.querySelector('#modal').open");
  }
  // Old/batch-only attempts show a useful missing-data state rather than zero-millisecond claims.
  await go('en/phrase');await click('[data-start="en-phrase-01"]');await until("Boolean(document.querySelector('#typing-input'))");
  await cdp('Input.insertText',{text:corpus.lessons.find(row=>row.id==='en-phrase-01').text});await until("Boolean(document.querySelector('.key-summary'))");
  assert.match(await read("document.querySelector('.key-summary').textContent"),/没有足够/);
  await click('[data-action="show-key-analysis"]');await until("Boolean(document.querySelector('.key-analysis-notice'))");
  await screenshot('phone-dark-no-samples');
  await click('[data-action="analysis-back"]');await click('[data-action="result-back"]');
  await go('zh/phrase');await click('[data-start="zh-phrase-01"]');await until("Boolean(document.querySelector('#typing-input'))");
  await cdp('Input.insertText',{text:corpus.lessons.find(row=>row.id==='zh-phrase-01').text});await until("Boolean(document.querySelector('.result-grid'))");
  assert.equal(await read("document.querySelector('.key-summary')===null"),true,'Chinese results keep their original flow');
  assert.deepEqual(browser.errors,[]);
  await fs.writeFile(path.join(artifacts,'key-analysis-checks.json'),JSON.stringify({result:'PASS',checks,extraChecks:['history persistence','empty samples','Chinese unaffected','light/dark','mobile layout','no browser exceptions']},null,2));
  console.log('PASS: English timing results, all 26 letters, history reload, empty samples and Chinese compatibility.');
}finally{await browser.close();}
