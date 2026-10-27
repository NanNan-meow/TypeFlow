import assert from 'node:assert/strict';
import { createKeyTimingTracker, analyzeKeyTimings, normalizeKeyTimings, formatKeyTime } from '../frontend/key-timings.js';
import { keyAnalysisSummary, keyAnalysisView } from '../frontend/key-analysis-view.js';

function editor(target) {
  const tracker=createKeyTimingTracker();let value='';
  return {tracker,get value(){return value;},type(key,at,flags={}){tracker.keyDown({key,...flags},at);const before=value;value+=key;tracker.commit(before,value,target);},backspace(at){tracker.keyDown({key:'Backspace'},at);const before=value;value=value.slice(0,-1);tracker.commit(before,value,target);},batch(text){const before=value;value+=text;tracker.commit(before,value,target);}};
}
let e=editor('Aa aa');
e.type('A',100);e.type('a',300);e.type(' ',400);e.type('a',500);e.type('a',700);
assert.deepEqual(e.tracker.snapshot().letters.a,{samples:3,totalMs:500,errors:0,longPauses:0},'merge case, exclude initial input, use space as an interval boundary');
assert.equal(analyzeKeyTimings(e.tracker.snapshot()).samples,3);

e=editor('aaaaa');e.type('a',100);e.type('a',300);e.tracker.interrupt();e.type('a',10300);e.type('a',10500);
assert.equal(e.tracker.snapshot().letters.a.totalMs,400,'pause or blur breaks the timing chain');
e.backspace(10600);e.type('a',20000);
assert.equal(e.tracker.snapshot().letters.a.samples,2,'correcting after a backspace does not include correction delay');

e=editor('abc');e.type('x',100);e.backspace(200);e.type('a',300);e.type('b',500);e.type('c',800);
assert.equal(e.tracker.snapshot().letters.a.errors,1,'mistakes are assigned to the required letter');
assert.equal(e.tracker.snapshot().letters.x,undefined,'a wrong X is not a valid X timing');
assert.equal(e.tracker.snapshot().letters.b.totalMs,200);

e=editor('aaaa');e.type('a',100);e.type('a',6200);e.type('a',6400);
assert.deepEqual(e.tracker.snapshot().letters.a,{samples:1,totalMs:200,errors:0,longPauses:1},'long thinking breaks are reported separately');

e=editor('aaaa');e.type('a',100);e.type('a',200,{repeat:true});e.type('a',300);e.type('a',500);
assert.equal(e.tracker.snapshot().letters.a.samples,1,'auto-repeat is not a sample or a timing boundary');
e=editor('aaaa');e.type('a',100);e.type('a',200,{isComposing:true});e.type('a',300);e.type('a',500);
assert.equal(e.tracker.snapshot().letters.a.samples,1,'composition is excluded');
e=editor('abc');e.batch('abc');assert.deepEqual(e.tracker.snapshot().letters,{},'batch insertion cannot invent individual key timings');
e=editor('aA');e.type('a',100);e.tracker.keyDown({key:'Shift'},200);e.type('A',400);
assert.equal(e.tracker.snapshot().letters.a.totalMs,300,'shift preserves normal uppercase input');

const value={version:1,letters:{a:{samples:2,totalMs:200,errors:1},b:{samples:1,totalMs:1000},c:{samples:5,totalMs:1000},d:{samples:2,totalMs:1800}}};
const analysis=analyzeKeyTimings(value);
assert.equal(analysis.averageMs,400,'overall average is weighted by sample count');
assert.equal(analysis.coveredLetters,4);
assert.equal(analysis.letters.length,26);
assert.deepEqual(analysis.slowKeys.map(row=>row.letter),['d'],'one slow sample alone is not a weak-key recommendation');
assert.equal(analysis.letters.find(row=>row.letter==='z').averageMs,null);
for(const invalid of [{version:true,letters:{}},{version:1,letters:{A:{samples:1,totalMs:100}}},{version:1,letters:{a:{samples:0,totalMs:100}}},{version:1,letters:{a:{samples:1,totalMs:Infinity}}},{version:1,letters:{a:{samples:true,totalMs:10}}},{version:1,letters:{a:{samples:1,totalMs:5001}}}])assert.throws(()=>normalizeKeyTimings(invalid));
assert.equal(normalizeKeyTimings(null),null);
assert.equal(formatKeyTime(null),'—');assert.equal(formatKeyTime(1250),'1.25 秒');
assert.ok(keyAnalysisSummary(value).includes('400 ms'));
assert.ok(keyAnalysisSummary(null).includes('还没有足够'));
const html=keyAnalysisView(value,'<img src=x onerror=alert(1)>');
assert.ok(html.includes('&lt;img'));assert.ok(!html.includes('<img'));
assert.equal((html.match(/class="letter-key /g)||[]).length,26);
console.log('English key timing tests passed: real-key intervals, pause/IME/backspace/repeat exclusion, sample confidence, weighted averages and rendering.');
