// Make a browsable screenshot report and browser-rendered visual review sheets.
import fs from 'node:fs/promises';
import path from 'node:path';
import { launchBrowserTest, artifacts } from './browser-test-harness.mjs';

const report = JSON.parse(await fs.readFile(path.join(artifacts,'theme-checks.json'),'utf8'));
const rawShots = JSON.parse(await fs.readFile(path.join(artifacts,'theme-shots.json'),'utf8'));
const shots = [...new Map(rawShots.map(shot=>[shot.filename,shot])).values()];
const escape = value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const figure = shot=>`<figure data-theme="${shot.theme}" data-size="${shot.size}"><figcaption>${escape(shot.size)} · ${shot.theme==='dark'?'黑夜':'白天'} · ${escape(shot.name)}</figcaption><a href="${shot.filename}" target="_blank"><img src="${shot.filename}" loading="eager" alt="${escape(shot.name)}"></a></figure>`;
const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>TypeFlow 主题检查报告</title><style>*{box-sizing:border-box}body{margin:32px;background:#f5f6fa;color:#30283d;font:15px/1.8 system-ui,"Microsoft YaHei",sans-serif}h1{font-size:27px}header,p{margin:0 0 16px}.summary{padding:18px;border:1px solid #ded8ed;border-radius:12px;background:white}label{margin-right:20px}select{padding:7px;margin-left:8px;border:1px solid #d6cce5;border-radius:6px}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:20px}figure{margin:0;background:white;border:1px solid #ded8ed;border-radius:9px;overflow:hidden}figcaption{padding:10px 14px;font-size:13px}img{display:block;width:100%;height:auto}[hidden]{display:none!important}</style><header><h1>TypeFlow 白天／黑夜主题检查报告</h1><p class="summary">状态：${escape(report.result)} · ${report.checks} 个页面／状态检查 · ${report.textChecks} 次文字对比度检查 · ${shots.length} 张截图<br>尺寸：1440×1100、1024×900、390×844。检查了全站页面、六种练习模式、输入与纠错、暂停、成绩、来源、设置、错误状态及刷新保留；测试使用独立浏览器数据。</p><label>主题<select id="theme"><option value="all">全部</option><option value="light">白天</option><option value="dark">黑夜</option></select></label><label>屏幕<select id="size"><option value="all">全部</option><option value="desktop">桌面</option><option value="laptop">笔记本</option><option value="phone">手机</option></select></label></header><main>${shots.map(figure).join('')}</main><script>for(const select of document.querySelectorAll('select'))select.onchange=()=>{for(const figure of document.querySelectorAll('figure'))figure.hidden=!(document.querySelector('#theme').value==='all'||figure.dataset.theme===document.querySelector('#theme').value)||!(document.querySelector('#size').value==='all'||figure.dataset.size===document.querySelector('#size').value)}</script></html>`;
await fs.writeFile(path.join(artifacts,'theme-report.html'),html);

const browser=await launchBrowserTest('theme-review');
const sheets=[];
try {
  for(const size of ['desktop','phone'])for(const theme of ['light','dark']){
    const subset=shots.filter(shot=>shot.size===size&&shot.theme===theme);
    for(let i=0;i<subset.length;i+=6){
      const name=`theme-review-${size}-${theme}-${Math.floor(i/6)+1}`;
      const review=`<!doctype html><html><meta charset="utf-8"><style>*{box-sizing:border-box}body{margin:18px;background:#eceef5;font:14px system-ui}h1{font-size:18px;margin:0 0 12px}main{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}figure{margin:0;background:white;border:1px solid #cfc8db;border-radius:7px;overflow:hidden}figcaption{padding:8px;font-size:13px}img{display:block;width:100%}</style><h1>${escape(size+' '+theme+' '+Math.floor(i/6+1))}</h1><main>${subset.slice(i,i+6).map(figure).join('')}</main></html>`;
      await fs.writeFile(path.join(artifacts,name+'.html'),review);
      await browser.viewport(1200,size==='phone'?1810:1020);
      await browser.cdp('Page.navigate',{url:browser.origin+'/qa/'+name+'.html'});
      await browser.until("document.images.length>0&&[...document.images].every(image=>image.complete&&image.naturalWidth>0)");
      const png=await browser.screenshot(name+'.png');sheets.push(png);
    }
  }
} finally {await browser.close();}
await fs.writeFile(path.join(artifacts,'theme-review-sheets.json'),JSON.stringify(sheets,null,2));
console.log(JSON.stringify({report:'test-artifacts/theme-report.html',sheets:sheets.length,images:shots.length,result:report.result},null,2));
