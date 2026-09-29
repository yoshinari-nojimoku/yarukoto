// データの保存先
//   config.js が空  → このブラウザ内（localStorage）だけ。試作モード
//   config.js あり → Supabase。Googleでログインした本人のデータだけを読み書きする
// app.js からは Store.init() / Store.save(tasks) / Store.reload() だけを使う。

const Store = {
  KEY: 'todo-proto-v1',
  remote: !!(SUPABASE_URL && SUPABASE_ANON_KEY),
  sb: null,
  user: null,
  last: new Map(),     // Supabase に送った最後の状態（差分だけ送るため）
  onError: msg => alert(msg),

  // ---- 起動 ----
  // 戻り値：{ tasks } / ログインが要るときは { needLogin: true }
  async init() {
    if (!this.remote) return { tasks: this.loadLocal() };
    this.sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const { data: { session } } = await this.sb.auth.getSession();
    if (!session) return { needLogin: true };
    this.user = session.user;
    return { tasks: await this.fetch() };
  },

  login() {
    return this.sb.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: location.origin + location.pathname },
    });
  },

  async logout() { await this.sb.auth.signOut(); location.reload(); },

  async reload() { return this.remote ? this.fetch() : this.loadLocal(); },

  // ---- このブラウザ内 ----
  loadLocal() {
    try {
      const s = localStorage.getItem(this.KEY);
      if (s) return JSON.parse(s);
    } catch (e) { /* 保存領域が使えないときは初期データで動かす */ }
    return typeof SEED_TASKS !== 'undefined' ? JSON.parse(JSON.stringify(SEED_TASKS)) : [];
  },

  reset() { try { localStorage.removeItem(this.KEY); } catch (e) {} },

  // 試作モードで貯めたデータ（Supabase へ移すときに使う）
  localBackup() {
    try { const s = localStorage.getItem(this.KEY); return s ? JSON.parse(s) : null; } catch (e) { return null; }
  },

  // ---- Supabase ----
  toRow(t) {
    return {
      id: String(t.id), title: t.title, memo: t.memo || null, due: t.due || null, due_approx: !!t.dueApprox,
      cat: t.cat, pri: t.pri, parent_id: t.parent ? String(t.parent) : null, assignee: t.assignee || null,
      remind: t.remind || null, repeat: t.repeat || null, attach: !!t.attach, done: !!t.done,
    };
  },
  fromRow(r) {
    const t = { id: r.id, title: r.title, due: r.due, cat: r.cat, pri: r.pri, parent: r.parent_id,
      assignee: r.assignee, remind: r.remind, done: r.done };
    if (r.memo) t.memo = r.memo;
    if (r.repeat) t.repeat = r.repeat;
    if (r.due_approx) t.dueApprox = true;
    if (r.attach) t.attach = true;
    return t;
  },

  async fetch() {
    const rows = [];
    for (let from = 0; ; from += 1000) {   // 1回に1000行までなので分けて取る
      const { data, error } = await this.sb.from('tasks').select('*').order('created_at').range(from, from + 999);
      if (error) throw new Error('読み込みに失敗しました：' + error.message);
      rows.push(...data);
      if (data.length < 1000) break;
    }
    const tasks = rows.map(r => this.fromRow(r));
    this.last = new Map(tasks.map(t => [String(t.id), JSON.stringify(this.toRow(t))]));
    return tasks;
  },

  // 変わった行だけ送る。親を先に送らないと、子が親を見つけられない
  save(tasks) {
    if (!this.remote) {
      try { localStorage.setItem(this.KEY, JSON.stringify(tasks)); } catch (e) {}
      return;
    }
    const now = new Map(tasks.map(t => [String(t.id), JSON.stringify(this.toRow(t))]));
    const changed = [...now].filter(([id, j]) => this.last.get(id) !== j).map(([, j]) => JSON.parse(j));
    const removed = [...this.last.keys()].filter(id => !now.has(id));
    this.last = now;
    this.queue = (this.queue || Promise.resolve()).then(() => this.push(changed, removed));
  },

  async push(changed, removed) {
    try {
      const parents = changed.filter(r => !r.parent_id), kids = changed.filter(r => r.parent_id);
      for (const batch of [parents, kids]) {
        if (!batch.length) continue;
        const { error } = await this.sb.from('tasks').upsert(batch);
        if (error) throw error;
      }
      if (removed.length) {
        const { error } = await this.sb.from('tasks').delete().in('id', removed);
        if (error) throw error;
      }
    } catch (e) {
      this.last = new Map();   // 次の保存で全件を送り直す
      this.onError('保存に失敗しました。通信を確認して、もう一度操作してください。\n' + (e.message || e));
    }
  },

  // 試作モードのデータを Supabase へ移す。番号のIDを新しいIDに付け替える
  async importLocal(list) {
    const map = new Map(list.map(t => [String(t.id), crypto.randomUUID()]));
    const moved = list.map(t => ({ ...t, id: map.get(String(t.id)), parent: t.parent ? map.get(String(t.parent)) || null : null }));
    const rows = moved.map(t => this.toRow(t));
    for (const batch of [rows.filter(r => !r.parent_id), rows.filter(r => r.parent_id)]) {
      for (let i = 0; i < batch.length; i += 500) {
        const { error } = await this.sb.from('tasks').insert(batch.slice(i, i + 500));
        if (error) throw new Error('移し替えに失敗しました：' + error.message);
      }
    }
    return this.fetch();
  },
};
