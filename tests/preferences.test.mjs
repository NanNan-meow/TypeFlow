import assert from 'node:assert/strict';
import { createPreferences, defaultPreferences } from '../frontend/preferences.js';

const memory = new Map();
const storage = { getItem: key => memory.get(key) ?? null, setItem: (key, value) => memory.set(key, value) };
const options = { storage, baseUrl: new URL('https://example.github.io/TypeFlow/') };
const store = createPreferences(options);
assert.deepEqual(store.load(), defaultPreferences);
const values = store.save({ nickname: '  小南  ', dailyGoalMinutes: '30', fontSize: '32' });
assert.deepEqual(values, { nickname: '小南', dailyGoalMinutes: 30, fontSize: 32, theme: 'light' });
assert.deepEqual(createPreferences(options).load(), values, 'settings survive a reload');
assert.deepEqual(createPreferences({ ...options, baseUrl: new URL('https://example.github.io/Other/') }).load(), defaultPreferences);
for (const invalid of [{ dailyGoalMinutes: 0 }, { dailyGoalMinutes: 121 }, { fontSize: 100 }, { fontSize: 'large' }, { nickname: '长'.repeat(21) }, { theme: 'invalid' }]) {
  assert.throws(() => store.save({ ...values, ...invalid }));
  assert.deepEqual(store.load(), values, 'invalid settings do not overwrite saved preferences');
}
const dark = store.save({ ...values, theme: 'dark' });
assert.equal(createPreferences(options).load().theme, 'dark', 'dark theme survives refresh');
assert.equal(store.save({ ...dark, theme: 'light' }).theme, 'light', 'switching back to day mode is persisted');
const legacy = createPreferences({ storage: { getItem: () => JSON.stringify({ nickname: '旧设置', dailyGoalMinutes: 30, fontSize: 32 }) } });
assert.equal(legacy.load().theme, 'light', 'existing preferences remain compatible');
const unavailable = createPreferences({ storage: { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } } });
assert.deepEqual(unavailable.load(), defaultPreferences);
assert.throws(() => unavailable.save(values), /设置暂未保存/);
const invalid = createPreferences({ storage: { getItem: () => '{broken' } });
assert.deepEqual(invalid.load(), defaultPreferences);
console.log('Personal space preferences passed: defaults, persistence, project isolation, validation and blocked storage.');
