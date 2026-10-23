// Сквозной тест общего боя в настоящем браузере: две страницы-игрока, подставные Supabase (база, RPC, Realtime) в этом процессе.
// Проверяет: вступление из списка «Бои», общий лог и здоровье монстра, карточки союзников, смерть монстра у всех,
// возврат после обновления страницы, обрыв боя при уходе хозяина.
// Запуск: NODE_PATH=$(npm root -g) node web/battle/tools/e2e-coop.js   (нужен playwright и Chromium; сайт отдаётся с localhost)
const path = require('path');
const http = require('http');
const fs = require('fs');
const assert = require('assert');
const { chromium } = require('playwright');

const webRoot = path.join(__dirname, '..', '..');
const dir = path.join(__dirname, '..', 'js');
for (const f of ['data', 'classes', 'stats', 'items-data', 'monsters', 'world-data', 'engine', 'items', 'progression']) require(path.join(dir, `${f}.js`));
const PC = globalThis.PC;

// ---------- статический сервер ----------
const server = http.createServer((req, res) => {
  const p = path.join(webRoot, decodeURIComponent(req.url.split('?')[0]));
  fs.readFile(p, (e, buf) => {
    if (e) { res.writeHead(404); return res.end(); }
    const type = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' }[path.extname(p)] || 'application/octet-stream';
    res.writeHead(200, { 'content-type': `${type}; charset=utf-8` });
    res.end(buf);
  });
});

// ---------- подставная «база» ----------
const db = { battles: [], members: [] };
const pages = [];   // { uid, page }
const uuid = () => 'b' + Math.random().toString(16).slice(2, 10) + Date.now().toString(16);

async function pgChange(table) { for (const p of pages) p.page.evaluate((t) => window.__pg && window.__pg(t), table).catch(() => {}); }
async function bcast(from, name, event, payload) {
  for (const p of pages) if (p.uid !== from) p.page.evaluate(([n, e, pl]) => window.__deliver && window.__deliver(n, e, pl), [name, event, payload]).catch(() => {});
}

function match(row, filters) {
  return filters.every(([op, k, v]) => {
    const val = k.split('.').reduce((o, key) => (o == null ? o : o[key]), row);
    if (op === 'eq') return val === v;
    if (op === 'is') return v === null ? val == null : val === v;
    if (op === 'gt') return val > v;
    if (op === 'lt') return val < v;
    return true;
  });
}

function query(uid, st) {
  const ok = (data) => ({ data, error: null });
  if (st.table === 'profiles') return ok(null);
  if (st.table === 'battle_history') return ok(null);
  if (st.table === 'battles') {
    if (st.op === 'insert') {
      if (db.battles.some((b) => b.owner_id === st.payload.owner_id && Date.now() - Date.parse(b.started_at) < 2000)) return { data: null, error: { code: 'P0001', message: 'too fast' } };   // защита 0007
      if (process.env.OLD_INDEX === '1' && db.battles.some((b) => b.owner_id === st.payload.owner_id && b.status === 'running')) return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "battles_one_running_per_owner"' } };   // индекс из 0004
      const row = { id: st.payload.id || uuid(), status: 'running', max_players: 10, started_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...st.payload };
      db.battles.push(row);
      pgChange('battles');
      return ok({ id: row.id });
    }
    if (st.op === 'delete') {
      const n = db.battles.length;
      db.battles = db.battles.filter((b) => !match(b, st.filters));
      if (n !== db.battles.length) pgChange('battles');
      return ok(null);
    }
    let rows = db.battles.filter((b) => match(b, st.filters));
    rows = rows.map((b) => ({ ...b, battle_members: db.members.filter((m) => m.battle_id === b.id) }));
    return ok(rows);
  }
  if (st.table === 'battle_members') {
    if (st.op === 'insert') { db.members.push({ ...st.payload }); pgChange('battle_members'); return ok(null); }
    let rows = db.members.map((m) => ({ ...m, battles: db.battles.find((b) => b.id === m.battle_id) })).filter((m) => m.battles);
    rows = rows.filter((m) => match(m, st.filters));
    return ok(rows);
  }
  return { data: null, error: { code: '42P01', message: `relation "${st.table}" does not exist` } };
}

function rpc(uid, fn, a) {
  if (fn === 'join_battle') {
    const b = db.battles.find((x) => x.id === a.p_battle);
    if (!b || b.status !== 'running' || !(b.monster_hp > 0)) return { data: null, error: { message: 'battle_closed' } };
    const n = db.members.filter((m) => m.battle_id === b.id).length;
    if (n >= b.max_players) return { data: null, error: { message: 'battle_full' } };
    db.members = db.members.filter((m) => m.user_id !== uid);
    db.members.push({ battle_id: b.id, user_id: uid, nick: a.p_nick, level: a.p_level, job: a.p_job });
    pgChange('battle_members');
    return { data: b, error: null };
  }
  if (fn === 'leave_battle') {
    db.members = db.members.filter((m) => !(m.battle_id === a.p_battle && m.user_id === uid));
    db.battles = db.battles.filter((b) => b.id !== a.p_battle || db.members.some((m) => m.battle_id === b.id));
    pgChange('battle_members');
    return { data: null, error: null };
  }
  if (fn === 'battle_state') {
    const b = db.battles.find((x) => x.id === a.p_battle && x.owner_id === uid);
    if (b) { b.monster_hp = Math.max(0, a.p_hp); b.monster_max = a.p_max; if (a.p_finished) b.status = 'finished'; b.updated_at = new Date().toISOString(); }
    return { data: null, error: null };
  }
  if (fn === 'battle_hit') return { data: null, error: null };
  return { data: null, error: { code: 'PGRST202', message: 'not found' } };
}

// ---------- код, подставляемый в страницу до загрузки скриптов ----------
const INIT = `
(() => {
  window.__calls = []; window.__toasts = []; new MutationObserver((ms) => { for (const m of ms) for (const n of m.addedNodes) if (n.className && /toast/.test(n.className)) window.__toasts.push(n.textContent); }).observe(document, { childList: true, subtree: true }); window.addEventListener('unhandledrejection', (e) => window.__calls.push('REJECT:' + (e.reason && e.reason.stack || e.reason))); const call = (op, args) => { window.__calls.push(op + ':' + (args.fn || args.event || args.table || '') + (args.payload && args.payload.t ? '/' + args.payload.t : '')); return window.__rpc(op, args); };
  const chans = [];
  window.__deliver = (name, event, payload) => {
    for (const c of chans) if (c.name === name) for (const h of c.handlers) if (h.type === 'broadcast' && h.filter.event === event) h.cb({ payload });
  };
  window.__pg = (table) => { for (const c of chans) for (const h of c.handlers) if (h.type === 'postgres_changes' && h.filter.table === table) h.cb({}); };
  const builder = (table) => {
    const st = { table, op: 'select', filters: [], payload: null };
    const b = {
      select(c) { st.cols = c; return b; }, insert(v) { st.op = 'insert'; st.payload = v; return b; }, delete() { st.op = 'delete'; return b; },
      eq(k, v) { st.filters.push(['eq', k, v]); return b; }, is(k, v) { st.filters.push(['is', k, v]); return b; }, gt(k, v) { st.filters.push(['gt', k, v]); return b; }, lt(k, v) { st.filters.push(['lt', k, v]); return b; },
      order() { return b; }, limit() { return b; }, single() { st.single = true; return b; }, maybeSingle() { st.single = true; return b; },
      then(res, rej) { return call('q', st).then((r) => { if (st.single && Array.isArray(r.data)) r = { ...r, data: r.data[0] || null }; return r; }).then(res, rej); },
    };
    return b;
  };
  const user = { id: window.__UID };
  window.supabase = { createClient: () => ({
    auth: { getSession: async () => ({ data: { session: { user } } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }), signOut: async () => ({}) },
    from: builder,
    rpc: (fn, args) => call('rpc', { fn, args }),
    channel(name) {
      const ch = { name, handlers: [],
        on(type, filter, cb) { ch.handlers.push({ type, filter, cb }); return ch; },
        subscribe(cb) { chans.push(ch); if (cb) setTimeout(() => cb('SUBSCRIBED'), 5); return ch; },
        send(m) { call('bcast', { name, event: m.event, payload: JSON.parse(JSON.stringify(m.payload)) }); return Promise.resolve('ok'); },
        track: async () => ({}), untrack: async () => ({}), presenceState: () => ({}),
      };
      return ch;
    },
    removeChannel(ch) { const i = chans.indexOf(ch); if (i >= 0) chans.splice(i, 1); return Promise.resolve(); },
  }) };
})();
`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms, what) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`не дождались: ${what}`);
    await sleep(300);
  }
}

function heroJson(nick, job) {
  const c = PC.progression.newCharacter(PC.data, { nick, job });
  c.location = 'forest_edge';
  c.settings = { ...c.settings, autoBattle: true };
  return JSON.stringify(c);
}

async function openPlayer(browser, uid, nick, job) {
  const ctx = await browser.newContext({ viewport: { width: 375, height: 812 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.exposeFunction('__rpc', (op, args) => {
    if (op === 'q') return query(uid, args);
    if (op === 'rpc') return rpc(uid, args.fn, args.args);
    if (op === 'bcast') { bcast(uid, args.name, args.event, args.payload); return null; }
    return null;
  });
  await page.addInitScript(`window.__UID = ${JSON.stringify(uid)}; localStorage.setItem('pc-character-v3', ${JSON.stringify(heroJson(nick, job))});`);
  await page.route('**/cdn.jsdelivr.net/**', (r) => r.abort());   // настоящий supabase-js не нужен
  await page.addInitScript(INIT);
  const p = { uid, nick, page, errors };
  pages.push(p);
  await page.goto(`http://localhost:${server.address().port}/battle/index.html`);
  await page.waitForFunction(() => window.PC && PC.app && PC.app.state.char && PC.auth && PC.auth.user);
  return p;
}

// Подмена монстров для теста: mult — множитель здоровья (живучий монстр держит бой долго), atk — множитель урона
const tankify = (page, mult, atk) => page.evaluate(([m, a]) => {
  const orig = window.__origMonsterAt || (window.__origMonsterAt = PC.monsters.monsterAt);
  PC.monsters.monsterAt = (id, L, D) => { const t = orig(id, L, D); t.stats = { ...t.stats, maxHp: Math.round(t.stats.maxHp * m), atk: Math.round(t.stats.atk * a), matk: Math.round(t.stats.matk * a), weaponMax: Math.round(t.stats.weaponMax * a) }; return t; };
}, [mult, atk]);

const logOf = (page) => page.evaluate(() => [...document.querySelectorAll('#log .entry')].map((e) => e.textContent.trim()));
const monHp = (page) => page.evaluate(() => (document.querySelector('#f-m .hp .v') || {}).textContent);
const visible = (page, sel) => page.evaluate((s) => { const e = document.querySelector(s); return !!e && !e.hidden; }, sel);
const turnNo = (page) => page.evaluate(() => (document.querySelector('#turn-title') || {}).textContent);

async function attack(p) {
  await p.page.evaluate(() => { const b = [...document.querySelectorAll('[data-attack]')].find((x) => !x.disabled); b.click(); });
}

(async () => {
  await new Promise((r) => server.listen(0, r));
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium' });
  let stage = 'старт';
  try {
    let A = await openPlayer(browser, 'user-a', 'Альфа', Object.keys(PC.data.classes)[0]);
    const B = await openPlayer(browser, 'user-b', 'Бета', Object.keys(PC.data.classes)[2]);
    await tankify(A.page, 40, 0.3); await tankify(B.page, 40, 0.3);

    stage = 'хозяин нападает';
    await until(() => A.page.evaluate(() => !!document.querySelector('[data-attack]')), 10000, 'монстры на локации');
    const t0 = Date.now();
    await attack(A);
    await until(() => db.battles.some((b) => b.owner_id === 'user-a' && b.status === 'running' && db.members.some((m) => m.battle_id === b.id && m.user_id === 'user-a')), 1500, 'бой записан в базу сразу при нажатии «Напасть»');
    const hostBattle = db.battles.find((b) => b.owner_id === 'user-a');
    assert.ok(hostBattle.monster_hp > 0 && hostBattle.monster_hp === hostBattle.monster_max, 'бой активен, монстр ещё цел');
    assert.ok(!(await A.page.evaluate(() => [...document.querySelectorAll('#log .entry')].some((e) => /^Ход 2/.test(e.textContent.trim())))), 'запись до первого хода');
    console.log(`ok   бой записан в базу как активный через ${Date.now() - t0} мс после нажатия`);
    await until(() => visible(A.page, '#battle'), 15000, 'экран боя хозяина');
    console.log('ok   хозяин начал бой');

    stage = 'вступление из списка «Бои»';
    await until(() => B.page.evaluate(() => !!document.querySelector('[data-act="join-battle"]')), 20000, 'кнопка «Вступить» у второго игрока');
    await B.page.evaluate(() => document.querySelector('[data-act="join-battle"]').click());
    await until(() => visible(B.page, '#battle'), 500, 'окно боя открылось сразу по «Вступить»');
    console.log('ok   окно боя открывается сразу по «Вступить», история догоняется в фоне');
    await until(() => visible(B.page, '#battle'), 25000, 'экран боя у вступившего');
    console.log('ok   второй игрок вступил из списка и видит бой');

    stage = 'общий лог и здоровье монстра';
    await sleep(35000);
    const la = await logOf(A.page), lb = await logOf(B.page);
    assert.ok(la.length > 8 && lb.length > 8, 'лог не пуст');
    const tail = (l) => l.slice(-12);
    assert.deepStrictEqual(tail(la), tail(lb), 'последние записи лога совпадают у хозяина и участника');
    assert.strictEqual(await monHp(A.page), await monHp(B.page), 'здоровье монстра одинаково');
    assert.strictEqual(await turnNo(A.page), await turnNo(B.page), 'номер хода одинаков');
    const partyA = await A.page.evaluate(() => document.querySelector('#party').textContent);
    const partyB = await B.page.evaluate(() => document.querySelector('#party').textContent);
    assert.ok(/Бета/.test(partyA), `у хозяина виден союзник: ${partyA}`);
    assert.ok(/Альфа/.test(partyB), `у вступившего виден хозяин: ${partyB}`);
    assert.ok(la.some((t) => /вступает в бой/.test(t)) || lb.some((t) => /вступает в бой/.test(t)), 'в логе есть вступление');
    await A.page.screenshot({ path: '/tmp/claude-0/e2e-a.png', clip: { x: 0, y: 0, width: 375, height: 420 } });
    await B.page.screenshot({ path: '/tmp/claude-0/e2e-b.png', clip: { x: 0, y: 0, width: 375, height: 420 } });
    console.log('ok   общий лог, одно здоровье монстра, оба героя на экране друг друга');

    stage = 'обновление страницы у участника';
    await B.page.reload();
    await B.page.waitForFunction(() => window.PC && PC.app && PC.app.state.char && PC.auth && PC.auth.user);
    await tankify(B.page, 40, 0.3);
    await until(() => visible(B.page, '#battle'), 30000, 'возврат в бой после обновления');
    await sleep(13000);
    assert.deepStrictEqual(tail(await logOf(A.page)), tail(await logOf(B.page)), 'после возврата лог совпадает');
    assert.strictEqual(await monHp(A.page), await monHp(B.page), 'после возврата здоровье монстра одинаково');
    console.log('ok   после обновления страницы участник вернулся в тот же бой');

    stage = 'хозяин закрыл страницу — бой идёт у остального';
    const turnBefore = Number(String(await turnNo(B.page)).replace(/\D/g, ''));
    await A.page.context().close();   // закрыли игру целиком, без «выхода»
    pages.splice(pages.indexOf(A), 1);
    await sleep(42000);               // 15 с тишины, передача расчёта и пара тиков
    const turnAfter = Number(String(await turnNo(B.page)).replace(/\D/g, ''));
    assert.ok(turnAfter > turnBefore + 1, `бой не остановился: ход ${turnBefore} → ${turnAfter}`);
    assert.ok(await visible(B.page, '#battle'), 'экран боя у участника остался');
    assert.ok((await logOf(B.page)).some((t) => /Альфа замешкал/.test(t)), 'герой ушедшего хозяина пропускает ходы (AFK)');
    assert.strictEqual(await B.page.evaluate(() => PC.app.state.char.losses), 0, 'поражение не засчитано');
    console.log('ok   хозяин закрыл игру: бой пошёл дальше у участника, герой хозяина AFK');

    stage = 'прежний хозяин возвращается';
    const A2 = await openPlayer(browser, 'user-a', 'Альфа', Object.keys(PC.data.classes)[0]);
    await tankify(A2.page, 40, 0.3);
    await until(() => visible(A2.page, '#battle'), 40000, 'возврат прежнего хозяина в бой');
    await sleep(14000);
    assert.deepStrictEqual(tail(await logOf(A2.page)), tail(await logOf(B.page)), 'вернувшийся видит тот же бой');
    assert.strictEqual(await monHp(A2.page), await monHp(B.page), 'здоровье монстра одинаково');
    console.log('ok   вернувшийся хозяин вернулся в тот же бой участником');

    stage = 'хозяин вышел из общего боя и начал новый — он виден в списке';
    await A2.page.evaluate(() => { window.confirm = () => true; document.querySelector('#leave').click(); });
    await sleep(2000);
    assert.strictEqual(db.battles.filter((b) => b.owner_id === 'user-a').length, 1, 'бой 1 идёт у участника, хозяин из него вышел');
    await A2.page.evaluate(() => { document.querySelector('#to-camp') && document.querySelector('#to-camp').click(); });
    await sleep(1500);
    await A2.page.evaluate(() => { PC.app.state.char.restTick = 0; });
    await attack(A2);
    await until(() => db.battles.filter((b) => b.owner_id === 'user-a').length === 2, 1500, 'второй бой хозяина записан в базу сразу');
    await until(() => visible(A2.page, '#battle'), 15000, 'второй бой хозяина');
    console.log('ok   бой хозяина, вышедшего из прежнего боя, записан и попадает в список «Бои»');

    stage = 'оба выходят из боя';
    for (const p of [A2, B]) await p.page.evaluate(() => { window.confirm = () => true; document.querySelector('#leave').click(); });
    A = A2;
    await sleep(2000);

    stage = 'бой до смерти монстра';
    await Promise.all([A, B].map((p) => p.page.evaluate(() => { document.querySelector('#to-camp') && document.querySelector('#to-camp').click(); })));
    await tankify(A.page, 2, 0.3); await tankify(B.page, 2, 0.3);
    await sleep(2500);
    await A.page.evaluate(() => { PC.app.state.char.restTick = 0; });
    await attack(A);
    await sleep(4000);   // список «Бои» успевает обновиться (иначе можно нажать на старую строку)
    await until(() => B.page.evaluate(() => document.querySelectorAll('[data-act="join-battle"]').length === 1), 20000, 'кнопка «Вступить» (бой 2)');
    await B.page.evaluate(() => { PC.app.state.char.restTick = 0; document.querySelector('[data-act="join-battle"]').click(); });
    if (process.env.DEBUG_E2E) { await sleep(15000); console.log('B', await B.page.evaluate(() => ({ battle: !document.querySelector('#battle').hidden, hub: !document.querySelector('#hub').hidden, toast: [...document.querySelectorAll('.toast')].map((t) => t.textContent), toasts: window.__toasts, calls: window.__calls.slice(-6), mine: PC.battles.mineId(), row: !!document.querySelector('[data-act=join-battle]') }))); }
    await until(async () => (await visible(A.page, '#result')) && (await visible(B.page, '#result')), 150000, 'итог боя у обоих');
    const ra = await A.page.evaluate(() => document.querySelector('#result-banner').textContent);
    const rb = await B.page.evaluate(() => document.querySelector('#result-banner').textContent);
    console.log(`ok   бой завершился у обоих: хозяин «${ra}», участник «${rb}»`);
    assert.strictEqual(ra, 'Победа!');
    assert.strictEqual(rb, 'Победа!');
    await A.page.screenshot({ path: '/tmp/claude-0/e2e-result.png' });

    for (const p of pages) assert.deepStrictEqual(p.errors, [], `ошибки JS у ${p.nick}: ${p.errors}`);
    console.log('\nвсе сквозные проверки прошли');
  } catch (e) {
    console.error(`\nПРОВАЛ на этапе «${stage}»:`, e.message);
    for (const p of pages) { console.error(p.nick, 'ошибки JS:', p.errors, await p.page.evaluate(() => ({ result: !document.querySelector('#result').hidden, battle: !document.querySelector('#battle').hidden, banner: document.querySelector('#result-banner').textContent, toasts: window.__toasts })).catch(() => null)); try { console.error((await logOf(p.page)).slice(-6)); } catch (x) { /* страница закрыта */ } }
    process.exitCode = 1;
  } finally {
    await browser.close();
    server.close();
  }
})();
