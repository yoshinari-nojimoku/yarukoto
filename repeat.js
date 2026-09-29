// 繰り返しタスク
// 表記はGoogleタスクの書き方に合わせる：
//   「毎日」「3 日ごと」「毎週・月曜日」「2 週ごと・月曜日・木曜日」
//   「毎月・10 日」「6 か月ごと・10 日」「毎年・4 月 1」
const Repeat = {
  WEEK: ['日', '月', '火', '水', '木', '金', '土'],

  // 文字列 → 規則。読めないときは null
  parse(s) {
    if (!s) return null;
    const parts = s.split('・').map(x => x.trim());
    const head = parts[0], rest = parts.slice(1);
    let m;
    if (head === '毎日') return { unit: 'day', every: 1 };
    if ((m = head.match(/^(\d+) ?日ごと$/))) return { unit: 'day', every: +m[1] };
    const weekdays = () => rest.map(x => this.WEEK.indexOf(x.replace('曜日', ''))).filter(i => i >= 0);
    if (head === '毎週') return { unit: 'week', every: 1, days: weekdays() };
    if ((m = head.match(/^(\d+) ?週ごと$/))) return { unit: 'week', every: +m[1], days: weekdays() };
    const monthDay = () => { const x = (rest[0] || '').match(/(\d+) ?日/); return x ? +x[1] : null; };
    if (head === '毎月') return { unit: 'month', every: 1, day: monthDay() };
    if ((m = head.match(/^(\d+) ?か月ごと$/))) return { unit: 'month', every: +m[1], day: monthDay() };
    if (head === '毎年') {
      const x = (rest[0] || '').match(/(\d+) ?月 ?(\d+)/);
      return { unit: 'year', every: 1, month: x ? +x[1] : null, day: x ? +x[2] : null };
    }
    return null;
  },

  // base の「次の回」。ずっと前の期日なら、今日以降になるまで進める
  next(rule, baseIso, todayDate) {
    const d = baseIso ? toDate(baseIso) : new Date(todayDate);
    const step = () => {
      if (rule.unit === 'day') d.setDate(d.getDate() + rule.every);
      else if (rule.unit === 'week') {
        if (!rule.days || !rule.days.length) { d.setDate(d.getDate() + 7 * rule.every); return; }
        // 同じ週の中で次の曜日があればそこへ、なければ every 週後の最初の曜日へ
        const later = rule.days.filter(w => w > d.getDay()).sort((a, b) => a - b);
        if (later.length) { d.setDate(d.getDate() + later[0] - d.getDay()); return; }
        const first = Math.min(...rule.days);
        d.setDate(d.getDate() - d.getDay() + 7 * rule.every + first);
      } else if (rule.unit === 'month') {
        const day = rule.day || d.getDate();
        d.setDate(1); d.setMonth(d.getMonth() + rule.every);
        d.setDate(Math.min(day, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()));
      } else if (rule.unit === 'year') {
        const mon = rule.month ? rule.month - 1 : d.getMonth(), day = rule.day || d.getDate();
        d.setDate(1); d.setFullYear(d.getFullYear() + rule.every); d.setMonth(mon);
        d.setDate(Math.min(day, new Date(d.getFullYear(), mon + 1, 0).getDate()));
      }
    };
    step();
    for (let i = 0; i < 1000 && d < todayDate; i++) step();
    return iso(d);
  },

  // フォームの選択肢（締め切りの日付から作る）
  options(dueIso, current) {
    const d = dueIso ? toDate(dueIso) : null;
    const opts = [['', 'なし'], ['毎日', '毎日']];
    if (d) {
      opts.push([`毎週・${this.WEEK[d.getDay()]}曜日`, `毎週 ${this.WEEK[d.getDay()]}曜日`]);
      opts.push([`毎月・${d.getDate()} 日`, `毎月 ${d.getDate()}日`]);
      opts.push([`毎年・${d.getMonth() + 1} 月 ${d.getDate()}`, `毎年 ${d.getMonth() + 1}月${d.getDate()}日`]);
    }
    if (current && !opts.some(o => o[0] === current)) opts.push([current, current.replace(/・/g, ' ')]);
    return opts;
  },
};
