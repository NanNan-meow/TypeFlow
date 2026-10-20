import assert from 'node:assert/strict';
import { countNewErrors, liveMetrics, isUnlocked } from '../frontend/engine.js';

assert.equal(countNewErrors('', 'abx', 'abc'), 1);
assert.equal(countNewErrors('abx', 'ab', 'abc'), 0, 'backspace must not add errors');
assert.equal(countNewErrors('ab', 'abc', 'abc'), 0, 'correction does not add errors');
assert.equal(countNewErrors('', '数学模型', '数学建模'), 2, 'committed IME batch is counted per character');
assert.equal(countNewErrors('abc', 'abx', 'abc'), 1);
assert.equal(liveMetrics('abcde', 'abcde', 0, 60, 'en').speed, 1);
assert.equal(liveMetrics('数学建模', '数学建模', 0, 60, 'zh').speed, 4);
assert.equal(liveMetrics('abcde', 'abcde', 1, 60, 'en').accuracy, 100, 'correction restores full accuracy');
const lessons = [{ id: 'a', order: 1, language: 'en', kind: 'phrase' }, { id: 'b', order: 2, language: 'en', kind: 'phrase' }];
assert.equal(isUnlocked(lessons[0], lessons, {}), true);
assert.equal(isUnlocked(lessons[1], lessons, {}), true, 'future levels are always open');
assert.equal(isUnlocked(lessons[1], lessons, { a: { passed: true } }), true);
console.log('12 typing-engine assertions passed.');
