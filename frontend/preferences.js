export const defaultPreferences = Object.freeze({ nickname: '', dailyGoalMinutes: 15, fontSize: 28 });

function validNumber(value, minimum, maximum) {
  return Number.isInteger(value) && value >= minimum && value <= maximum;
}

export function createPreferences({ storage, baseUrl = new URL('.', import.meta.url) } = {}) {
  const key = `typeflow:preferences:v1:${baseUrl.pathname}`;
  const store = () => storage ?? globalThis.localStorage;
  return {
    load() {
      try {
        const saved = JSON.parse(store().getItem(key));
        if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return { ...defaultPreferences };
        return {
          nickname: typeof saved.nickname === 'string' ? [...saved.nickname.trim()].slice(0, 20).join('') : '',
          dailyGoalMinutes: validNumber(saved.dailyGoalMinutes, 5, 120) ? saved.dailyGoalMinutes : 15,
          fontSize: validNumber(saved.fontSize, 20, 36) ? saved.fontSize : 28,
        };
      } catch { return { ...defaultPreferences }; }
    },
    save(values) {
      const nickname = String(values.nickname ?? '').trim();
      const dailyGoalMinutes = Number(values.dailyGoalMinutes);
      const fontSize = Number(values.fontSize);
      if ([...nickname].length > 20) throw new Error('昵称最多填写 20 个字。');
      if (!validNumber(dailyGoalMinutes, 5, 120)) throw new Error('每日目标请选择 5 到 120 分钟。');
      if (!validNumber(fontSize, 20, 36)) throw new Error('字体大小请选择 20 到 36。');
      const next = { nickname, dailyGoalMinutes, fontSize };
      try { store().setItem(key, JSON.stringify(next)); }
      catch { throw new Error('设置暂未保存，请检查浏览器是否允许保存网站数据。'); }
      return next;
    },
  };
}
