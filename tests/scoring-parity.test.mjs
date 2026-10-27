import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { scoreAttempt } from '../frontend/browser-store.js';

// The Python suite checks this same contract against the backend implementation.
const cases = JSON.parse(await fs.readFile(new URL('./scoring-fixtures.json', import.meta.url), 'utf8'));
cases.forEach((item, i) => assert.deepEqual(scoreAttempt(item.lesson, item.typed, item.elapsed, item.errors), item.expected, `${item.lesson.id}, case ${i}`));
console.log(`${cases.length} browser/Python scoring contract cases passed.`);
