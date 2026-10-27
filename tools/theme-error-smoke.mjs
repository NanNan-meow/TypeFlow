import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { launchBrowserTest, artifacts } from './browser-test-harness.mjs';

const browser=await launchBrowserTest('theme-error');
const results=[];
try {
  await browser.cdp('Page.navigate',{url:browser.base});
  await browser.until("Boolean(document.querySelector('.hero'))");
  for(const [size,width,height] of [['desktop',1440,1100],['laptop',1024,900],['phone',390,844]])for(const theme of ['light','dark']){
    await browser.viewport(width,height);
    await browser.click('#personal-space-button');
    await browser.click(`[data-theme-option="${theme}"]`);
    await browser.click('#personal-space-form button[type="submit"]');
    await browser.until("!document.querySelector('#modal').open");
    await browser.click('#personal-space-button');
    await browser.read("globalThis.originalSetItem=Storage.prototype.setItem;Storage.prototype.setItem=function(){throw new Error('QA quota')}");
    await browser.click('#personal-space-form button[type="submit"]');
    await browser.until("!document.querySelector('#space-error').hidden");
    const visible=await browser.read("(()=>{const e=document.querySelector('#space-error').getBoundingClientRect(),d=document.querySelector('#modal').getBoundingClientRect(),a=document.querySelector('.space-actions').getBoundingClientRect();return {top:e.top,bottom:e.bottom,dialogTop:d.top,footerTop:a.top,visible:e.top>=d.top&&e.bottom<=a.top+1};})()");
    assert.equal(visible.visible,true,JSON.stringify({theme,size,...visible}));
    assert.equal(await browser.read('document.documentElement.dataset.theme'),theme);
    await browser.screenshot(`theme-shots/${size}-${theme}-personal-space-save-error.png`);
    results.push({name:'settings-error-visible-above-footer',size,theme,passed:true});
    await browser.read('Storage.prototype.setItem=globalThis.originalSetItem');
    await browser.key('Escape','Escape',27);await browser.until("!document.querySelector('#modal').open");
  }
  assert.deepEqual(browser.errors,[]);
  const file=path.join(artifacts,'theme-checks.json');
  const report=JSON.parse(await fs.readFile(file,'utf8'));report.followUpChecks=results;
  await fs.writeFile(file,JSON.stringify(report,null,2));
  console.log('PASS: settings errors are visible above the sticky footer in both themes at all three screen sizes.');
}finally{await browser.close();}
