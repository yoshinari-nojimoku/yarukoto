// やること（案B 優先度ボード）
// 並び順：優先度の列ごとに、締め切りが近い順（期限なしは最後）。サブタスクは親カードの中。

const PRI = { 3: '高', 2: '中', 1: '低' };
const PRI_COLOR = { 3: '#953525', 2: '#A89A2E', 1: '#7F9C9F' };
const WEEK = ['日', '月', '火', '水', '木', '金', '土'];
const SUB_FOLD = 3; // サブタスクがこれより多いカードは畳んで表示

let tasks = [];
let filter = 'all', showDone = false, mobilePri = 3, editingId = null;
const openSubs = new Set();

// ---- 日付 ----
function today() { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
function toDate(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
function iso(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
function addDays(n) { const d = today(); d.setDate(d.getDate() + n); return iso(d); }
function daysLeft(s) { return s ? Math.round((toDate(s) - today()) / 86400000) : null; }
function fmtDate(s) {
  if (!s) return '';
  const d = toDate(s), sameYear = d.getFullYear() === today().getFullYear();
  return `${sameYear ? '' : d.getFullYear() + '/'}${d.getMonth() + 1}/${d.getDate()}(${WEEK[d.getDay()]})`;
}
function dueInfo(s) {
  const n = daysLeft(s);
  if (n === null) return { text: '期限なし', state: 'none' };
  if (n < 0) return { text: `${-n}日超過`, state: 'over' };
  if (n === 0) return { text: '今日', state: 'soon' };
  if (n === 1) return { text: '明日', state: 'soon' };
  return { text: `あと${n}日`, state: n <= 3 ? 'soon' : 'normal' };
}

// ---- データの扱い ----
const catOf = id => CATEGORIES.find(c => c.id === id) || { name: '未分類', color: '#999' };
const byId = id => tasks.find(t => String(t.id) === String(id));
const childrenOf = id => tasks.filter(t => t.parent != null && String(t.parent) === String(id));
const needsNudge = t => !t.done && t.assignee && t.remind && daysLeft(t.remind) <= 0;

function byPriorityThenDue(a, b) {
  if (a.pri !== b.pri) return b.pri - a.pri;
  const da = a.due ? toDate(a.due) : Infinity, db = b.due ? toDate(b.due) : Infinity;
  return da - db;
}

function save() { Store.save(tasks); }
function newId() { return crypto.randomUUID(); }

function esc(s) { return String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
// URL をリンクにし、長いURLは短く見せる
function linkify(s) {
  return esc(s).replace(/(https?:\/\/[^\s<]+|file:\/\/\/[^\s<]+)/g, u => {
    let label = u;
    try { const x = new URL(u.replace(/&amp;/g, '&')); label = x.protocol === 'file:' ? '📄ローカルファイル' : '🔗' + x.hostname; } catch (e) {}
    return `<a href="${u}" target="_blank" rel="noopener">${label}</a>`;
  });
}

// ---- 描画 ----
function render() {
  const t0 = today();
  document.getElementById('today').textContent = `${t0.getMonth() + 1}月${t0.getDate()}日(${WEEK[t0.getDay()]})`;
  const open = tasks.filter(t => !t.done);
  document.getElementById('doneCount').textContent = `(${tasks.filter(t => t.done).length})`;

  document.getElementById('filters').innerHTML = [{ id: 'all', name: 'すべて' }, ...CATEGORIES].map(c => {
    const n = c.id === 'all' ? open.length : open.filter(t => t.cat === c.id).length;
    return `<button data-f="${c.id}" class="${filter === c.id ? 'on' : ''}">${esc(c.name)}<span class="n">${n}</span></button>`;
  }).join('');

  // 返事待ち
  const nudges = tasks.filter(needsNudge);
  const bar = document.getElementById('nudgebar');
  bar.classList.toggle('hidden', !nudges.length);
  bar.innerHTML = `<b>🔔 返事は来ましたか？</b>` + nudges.map(t =>
    `<span class="nudge-item">${esc(t.assignee)}：${esc(t.title)}<button data-came="${t.id}">来た</button><button data-notyet="${t.id}">まだ</button></span>`).join('');

  // 表示する親タスク
  const inFilter = t => filter === 'all' || t.cat === filter;
  const parents = tasks.filter(t => t.parent === null && inFilter(t))
    .filter(p => showDone || !p.done || childrenOf(p.id).some(c => !c.done))
    .sort(byPriorityThenDue);

  document.getElementById('pritabs').innerHTML = [3, 2, 1].map(pri => {
    const n = parents.filter(p => p.pri === pri).length;
    return `<button data-tab="${pri}" class="${mobilePri === pri ? 'on' : ''}" style="${mobilePri === pri ? `background:${PRI_COLOR[pri]}` : ''}">優先度 ${PRI[pri]}（${n}）</button>`;
  }).join('');

  document.getElementById('board').innerHTML = [3, 2, 1].map(pri => {
    const items = parents.filter(p => p.pri === pri);
    return `<section class="col ${mobilePri === pri ? 'active' : ''}" data-col="${pri}">
      <h2><span class="pill" style="background:${PRI_COLOR[pri]}">優先度 ${PRI[pri]}</span><span class="n">${items.length}件・締め切り順</span>
        <button class="plus" data-addpri="${pri}" title="この優先度で追加">＋</button></h2>
      ${items.map(cardHtml).join('') || '<div class="empty">ここにカードを引っぱってくると<br>優先度が変わります</div>'}
    </section>`;
  }).join('');
}

function dueChip(t) {
  if (t.done) return '<span>完了</span>';
  const di = dueInfo(t.due);
  if (!t.due) return '';
  return `<span class="${di.state}" ${t.dueApprox ? 'title="Googleタスクでは「○週間前」表示だったため、日付はおおよそです"' : ''}>${t.dueApprox ? '≒' : ''}${fmtDate(t.due)}・${di.text}</span>`;
}

function cardHtml(p) {
  const c = catOf(p.cat);
  const kids = childrenOf(p.id).filter(k => showDone || !k.done).sort(byPriorityThenDue);
  const allKids = childrenOf(p.id);
  const doneN = allKids.filter(k => k.done).length;
  const folded = kids.length > SUB_FOLD && !openSubs.has(String(p.id));
  return `<article class="card ${p.done ? 'done' : ''}" style="border-left-color:${c.color}" draggable="true" data-card="${p.id}">
    <div class="top"><span class="chk ${p.done ? 'on' : ''}" data-chk="${p.id}"></span><span class="title" data-edit="${p.id}">${linkify(p.title)}</span></div>
    ${p.memo ? `<div class="memo">${linkify(p.memo)}</div>` : ''}
    <div class="meta">${dueChip(p)}
      ${filter === 'all' ? `<span style="color:${c.color}">${esc(c.name)}</span>` : ''}
      ${p.repeat ? `<span title="${Repeat.parse(p.repeat) ? '完了にすると次の回を自動で作ります' : 'この書き方は読めないため、次の回は作られません'}">🔁 ${esc(p.repeat.replace(/・/g, ' '))}${Repeat.parse(p.repeat) ? '' : ' ⚠'}</span>` : ''}
      ${p.assignee ? `<span class="who">→ ${esc(p.assignee)}</span>` : ''}
      ${needsNudge(p) ? '<span class="nudge">催促日</span>' : ''}
      ${p.attach ? '<span title="Googleタスクに添付ファイルあり">📎添付</span>' : ''}</div>
    <div class="subs" ${allKids.length ? '' : 'style="border:none;padding-top:0"'}>
      ${folded
        ? `<button class="subtoggle" data-unfold="${p.id}">▸ サブタスク ${kids.length}件を表示</button>`
        : kids.map(subHtml).join('') + (kids.length > SUB_FOLD ? `<button class="subtoggle" data-fold="${p.id}">▴ たたむ</button>` : '')}
      ${allKids.length ? `<div class="progress"><i style="width:${doneN / allKids.length * 100}%"></i></div>` : ''}
      <button class="addsub" data-addsub="${p.id}">＋ サブタスク</button>
    </div>
  </article>`;
}

function subHtml(k) {
  const di = dueInfo(k.due);
  return `<div class="sub ${k.done ? 'done' : ''}"><span class="chk ${k.done ? 'on' : ''}" data-chk="${k.id}"></span>
    <span class="t" data-edit="${k.id}">${linkify(k.title)}${k.assignee ? ` <span style="color:var(--teal)">→${esc(k.assignee)}</span>` : ''}${needsNudge(k) ? ' 🔔' : ''}</span>
    ${k.due ? `<span class="d ${k.done ? '' : di.state}">${k.done ? '済' : fmtDate(k.due)}</span>` : ''}</div>`;
}

// ---- 完了・取り消し ----
let toastTimer;
function toast(msg, undo) {
  const el = document.getElementById('toast');
  el.innerHTML = esc(msg) + (undo ? ' <button id="undo">元に戻す</button>' : '');
  el.classList.add('show');
  if (undo) document.getElementById('undo').onclick = () => { undo(); el.classList.remove('show'); };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 4000);
}

function toggleDone(id) {
  const t = byId(id); t.done = !t.done;
  const { created, closed } = t.done ? spawnNext(t) : { created: [], closed: [] };
  save(); render();
  if (!t.done) return;
  const undo = () => {
    t.done = false; closed.forEach(k => k.done = false);
    tasks = tasks.filter(x => !created.includes(x)); save(); render();
  };
  if (created.length) toast(`完了。次の回（${fmtDate(created[0].due)}）を作りました`, undo);
  else toast(`「${t.title.slice(0, 20)}」を完了にしました`, undo);
}

// 繰り返しタスクを完了したら、次の回を作る（サブタスクも未完了に戻して複製）
function spawnNext(t) {
  const rule = Repeat.parse(t.repeat);
  if (!rule || t.parent !== null) return { created: [], closed: [] };
  const due = Repeat.next(rule, t.due, today());
  const shift = t.due ? Math.round((toDate(due) - toDate(t.due)) / 86400000) : 0;
  const move = s => { if (!s) return s; const d = toDate(s); d.setDate(d.getDate() + shift); return iso(d); };
  const copy = { ...t, id: newId(), due, remind: move(t.remind), done: false };
  delete copy.dueApprox;
  tasks.push(copy);
  const old = childrenOf(t.id);
  const kids = old.map((k, i) => ({ ...k, id: newId(), parent: copy.id, due: move(k.due), remind: move(k.remind), done: false }));
  tasks.push(...kids);
  // 今回の回に残っていたサブタスクは次の回へ持ち越したので、こちらは閉じる
  const closed = old.filter(k => !k.done);
  closed.forEach(k => k.done = true);
  return { created: [copy, ...kids], closed };
}

// ---- フォーム ----
const $ = id => document.getElementById(id);
let formPri = 2;

function setPri(p) { formPri = p; document.querySelectorAll('#fPri button').forEach(b => b.classList.toggle('on', +b.dataset.pri === p)); }

function openForm(t, preset = {}) {
  editingId = t ? t.id : null;
  $('formTitle').textContent = t ? 'タスクを編集' : (preset.parent ? 'サブタスクを追加' : 'タスクを追加');
  $('fTitle').value = t?.title || '';
  $('fMemo').value = t?.memo || '';
  $('fDue').value = t?.due || '';
  $('fWho').value = t?.assignee || '';
  $('fRemind').value = t?.remind || '';
  $('fCat').innerHTML = CATEGORIES.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
  $('fCat').value = t?.cat || preset.cat || (filter !== 'all' ? filter : CATEGORIES[0].id);
  setPri(t?.pri || preset.pri || 2);

  fillRepeat(t?.repeat || '');

  // 親に選べるのは「親タスク」だけ（孫を作らない）。子を持つタスクは子になれない
  const hasKids = t && childrenOf(t.id).length > 0;
  const candidates = tasks.filter(x => x.parent === null && !x.done && (!t || x.id !== t.id)).sort((a, b) => a.title.localeCompare(b.title, 'ja'));
  $('fParent').innerHTML = '<option value="">（なし＝親タスク）</option>' + candidates.map(x => `<option value="${x.id}">${esc(x.title.slice(0, 40))}</option>`).join('');
  $('fParent').value = t?.parent ?? preset.parent ?? '';
  $('fParent').disabled = hasKids;
  $('parentNote').textContent = hasKids ? 'サブタスクを持っているので、親タスクのままにしています' : '';
  syncParentFields();

  $('fDelete').classList.toggle('hidden', !t);
  $('overlay').hidden = false;
  setTimeout(() => $('fTitle').focus(), 50);
}

// 繰り返しの選択肢は締め切りの日付から作る
function fillRepeat(current) {
  $('fRepeat').innerHTML = Repeat.options($('fDue').value, current).map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join('');
  $('fRepeat').value = current;
}

// サブタスクは親と同じ優先度・カテゴリーになるので、入力欄を隠す
function syncParentFields() {
  const isChild = !!$('fParent').value;
  $('priRow').classList.toggle('hidden', isChild);
  $('catRow').classList.toggle('hidden', isChild);
}

function closeForm() { $('overlay').hidden = true; editingId = null; }

$('form').addEventListener('submit', e => {
  e.preventDefault();
  const title = $('fTitle').value.trim();
  if (!title) return;
  const parentId = $('fParent').value || null;
  const parent = parentId ? byId(parentId) : null;
  const data = {
    title, memo: $('fMemo').value.trim() || undefined,
    due: $('fDue').value || null,
    parent: parentId,
    pri: parent ? parent.pri : formPri,
    cat: parent ? parent.cat : $('fCat').value,
    assignee: $('fWho').value.trim() || null,
    remind: $('fWho').value.trim() ? ($('fRemind').value || null) : null,
    repeat: parentId ? undefined : ($('fRepeat').value || undefined),
  };
  if (editingId) {
    const t = byId(editingId);
    if (data.due !== t.due) delete t.dueApprox; // 日付を直したら「おおよそ」印は外す
    Object.assign(t, data);
    if (!t.memo) delete t.memo;
    if (!t.repeat) delete t.repeat;
    childrenOf(t.id).forEach(k => { k.pri = t.pri; k.cat = t.cat; }); // 子は親に合わせる
  } else {
    const t = { id: newId(), done: false, ...data };
    if (!t.memo) delete t.memo;
    if (!t.repeat) delete t.repeat;
    tasks.push(t);
    if (parent) openSubs.add(String(parent.id));
    mobilePri = t.pri;
  }
  save(); closeForm(); render();
});

$('fDelete').onclick = () => {
  const t = byId(editingId), kids = childrenOf(t.id);
  if (!confirm(`「${t.title}」を削除します${kids.length ? `（サブタスク${kids.length}件も一緒に）` : ''}。よろしいですか？`)) return;
  const removed = tasks.filter(x => x.id === t.id || x.parent === t.id);
  tasks = tasks.filter(x => !removed.includes(x));
  save(); closeForm(); render();
  toast('削除しました', () => { tasks.push(...removed); save(); render(); });
};
$('fCancel').onclick = closeForm;
$('overlay').addEventListener('click', e => { if (e.target.id === 'overlay') closeForm(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('overlay').hidden) closeForm(); });
$('fParent').onchange = syncParentFields;
$('fPri').onclick = e => { const b = e.target.closest('[data-pri]'); if (b) setPri(+b.dataset.pri); };
document.querySelectorAll('[data-due]').forEach(b => b.onclick = () => { $('fDue').value = b.dataset.due === '' ? '' : addDays(+b.dataset.due); fillRepeat($('fRepeat').value); });
$('fDue').onchange = () => fillRepeat($('fRepeat').value);
document.querySelectorAll('[data-remind]').forEach(b => b.onclick = () => { $('fRemind').value = addDays(+b.dataset.remind); });
$('fab').onclick = () => openForm(null, { pri: window.innerWidth <= 760 ? mobilePri : 2 });
$('showDone').onchange = e => { showDone = e.target.checked; render(); };

// ---- クリック操作 ----
document.addEventListener('click', e => {
  const q = sel => e.target.closest(sel);
  let el;
  if (q('a')) return; // リンクはそのまま開く
  if ((el = q('[data-chk]'))) return toggleDone(el.dataset.chk);
  if ((el = q('[data-edit]'))) return openForm(byId(el.dataset.edit));
  if ((el = q('[data-addsub]'))) return openForm(null, { parent: el.dataset.addsub });
  if ((el = q('[data-addpri]'))) return openForm(null, { pri: +el.dataset.addpri });
  if ((el = q('[data-unfold]'))) { openSubs.add(el.dataset.unfold); return render(); }
  if ((el = q('[data-fold]'))) { openSubs.delete(el.dataset.fold); return render(); }
  if ((el = q('[data-f]'))) { filter = el.dataset.f; return render(); }
  if ((el = q('[data-tab]'))) { mobilePri = +el.dataset.tab; return render(); }
  if ((el = q('[data-came]'))) return toggleDone(el.dataset.came);
  if ((el = q('[data-notyet]'))) {
    const t = byId(el.dataset.notyet); t.remind = addDays(3); save(); render();
    return toast(`${t.assignee}さんの件、${fmtDate(t.remind)}にもう一度お知らせします`);
  }
});

// ---- ドラッグで優先度を変える（PC） ----
let dragId = null;
document.addEventListener('dragstart', e => {
  const card = e.target.closest('[data-card]');
  if (!card) return;
  dragId = card.dataset.card; card.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
});
document.addEventListener('dragend', e => { e.target.closest?.('[data-card]')?.classList.remove('dragging'); document.querySelectorAll('.col').forEach(c => c.classList.remove('dragover')); });
document.addEventListener('dragover', e => {
  const col = e.target.closest('[data-col]');
  if (!col || dragId === null) return;
  e.preventDefault();
  document.querySelectorAll('.col').forEach(c => c.classList.toggle('dragover', c === col));
});
document.addEventListener('drop', e => {
  const col = e.target.closest('[data-col]');
  if (!col || dragId === null) return;
  e.preventDefault();
  const t = byId(dragId), pri = +col.dataset.col;
  if (t.pri !== pri) {
    const before = t.pri;
    t.pri = pri; childrenOf(t.id).forEach(k => k.pri = pri);
    save(); render();
    toast(`優先度を「${PRI[pri]}」にしました`, () => { t.pri = before; childrenOf(t.id).forEach(k => k.pri = before); save(); render(); });
  }
  dragId = null;
});

// ---- 起動 ----
Store.onError = msg => toast(msg);

async function start() {
  const box = $('gate');
  try {
    const r = await Store.init();
    if (r.needLogin) { box.hidden = false; box.innerHTML = gateLogin(); return; }
    tasks = r.tasks;
  } catch (e) {
    box.hidden = false; box.innerHTML = `<div class="gatebox"><h2>読み込めませんでした</h2><p>${esc(e.message)}</p><button onclick="location.reload()">もう一度</button></div>`;
    return;
  }
  box.hidden = true;
  $('account').innerHTML = Store.remote
    ? `<button id="logout" title="${esc(Store.user.email)}">ログアウト</button>`
    : '<span title="config.js が空のため、このブラウザ内だけに保存しています">試作モード</span>';
  if ($('logout')) $('logout').onclick = () => Store.logout();
  render();
  offerImport();
}

function gateLogin() {
  return `<div class="gatebox"><h1>やること</h1><p>野地さん専用のToDoです。<br>Googleアカウントでログインしてください。</p>
    <button id="login">Googleでログイン</button></div>`;
}
document.addEventListener('click', e => { if (e.target.id === 'login') Store.login(); });

// 試作モードで使っていたデータがあり、Supabase がまだ空なら移し替えを勧める
function offerImport() {
  if (!Store.remote || tasks.length) return;
  const local = Store.localBackup();
  const src = local && local.length ? local : (typeof SEED_TASKS !== 'undefined' ? SEED_TASKS : null);
  if (!src || !src.length) return;
  const box = $('gate');
  box.hidden = false;
  box.innerHTML = `<div class="gatebox"><h2>データを移しますか？</h2>
    <p>${local && local.length ? 'このブラウザで使っていたデータ' : 'Googleタスクから取り込んだデータ'}（${src.length}件）を、Supabase へ移します。</p>
    <button id="doImport">移す</button> <button id="skipImport" class="ghost">空のまま始める</button></div>`;
  $('doImport').onclick = async () => {
    $('doImport').disabled = true; $('doImport').textContent = '移しています…';
    try { tasks = await Store.importLocal(src); box.hidden = true; render(); toast(`${tasks.length}件を移しました`); }
    catch (e) { box.innerHTML = `<div class="gatebox"><h2>移せませんでした</h2><p>${esc(e.message)}</p><button onclick="location.reload()">もう一度</button></div>`; }
  };
  $('skipImport').onclick = () => { box.hidden = true; };
}

// ほかの端末で変えた分を、画面に戻ってきたときに取り込む
document.addEventListener('visibilitychange', async () => {
  if (document.hidden || !Store.remote || !Store.user || !$('overlay').hidden) return;
  try { tasks = await Store.reload(); render(); } catch (e) { /* 次の機会に */ }
});

start();
