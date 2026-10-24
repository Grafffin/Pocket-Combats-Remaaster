// Сквозной тест обмена в браузере: два игрока на одной локации, подставные Supabase (сделки, Realtime, присутствие) и серверная функция game
// на тех же правилах, что в проде (trade.js + ops.js). Карточка игрока → приглашение → окно обмена → подтверждения → получено.
// Запуск: NODE_PATH=$(npm root -g) node web/battle/tools/e2e-trade.js   (Playwright и Chromium)
const path = require('path');
const http = require('http');
const fs = require('fs');
const assert = require('assert');
const { chromium } = require('playwright');

const webRoot = path.join(__dirname, '..', '..');
const dir = path.join(__dirname, '..', 'js');
for (const f of ['version', 'data', 'classes', 'stats', 'items-data', 'monsters', 'world-data', 'engine', 'items', 'progression', 'economy', 'world', 'actions', 'trade']) require(path.join(dir, `${f}.js`));
const PC = globalThis.PC;
let gameRun = null;
const clone = (v) => JSON.parse(JSON.stringify(v));

// ---------- «сервер» ----------
const chars = new Map(), trades = new Map(), metas = new Map(), pages = [];
let seq = 0;
const io = {
  async hero(u) { const h = chars.get(u); return h ? clone(h) : null; },
  async trade(id) { const t = trades.get(id); return t ? clone(t) : null; },
  async create(a, b, loc) {
    for (const t of trades.values()) if (t.state === 'open' && [t.a, t.b].some((x) => x === a || x === b)) throw new PC.trade.TradeError('busy');
    const t = { id: `20000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`, a, b, loc, state: 'open', accepted: false, ver: 0, offer_a: { items: [], gold: 0 }, offer_b: { items: [], gold: 0 }, ok_a: false, ok_b: false, claimed_a: false, claimed_b: false, updated_at: new Date().toISOString() };
    trades.set(t.id, t); push(t);
    return clone(t);
  },
  async commit({ uid, tradeId, ver, patch, char, stash, rev }) {
    const t = trades.get(tradeId), h = chars.get(uid);
    if (!t || t.ver !== ver) throw new PC.trade.TradeError('stale');
    if (char && h.rev !== rev) throw new PC.trade.TradeError('stale');
    if (char) { h.data = clone(char); h.stash = stash; h.rev++; }
    Object.assign(t, clone(patch), { ver: t.ver + 1, updated_at: new Date().toISOString() });
    push(t);
    return { trade: clone(t), rev: char ? h.rev : null };
  },
};
const push = (t) => { for (const p of pages) p.page.evaluate((row) => window.__pgRow && window.__pgRow(row), clone(t)).catch(() => {}); };
async function game(uid, body) {
  const fail = (error, status, extra) => ({ data: null, error: { status, body: { error, ...extra } } });
  const { op, args } = body;
  if (body.v !== PC.BUILD) return fail('version', 409, { build: PC.BUILD });
  if (op === 'ping') return { data: { result: { build: PC.BUILD, fights: false, trades: true } }, error: null };
  if (PC.trade.OPS.includes(op)) {
    try { return { data: await PC.trade.handle(op, args || {}, io, { uid, now: Date.now() }), error: null }; } catch (e) {
      if (process.env.DEBUG_E2E) console.log('  [trade]', op, uid, e.message);
      if (e instanceof PC.trade.TradeError) return fail(e.message, e.message === 'stale' ? 409 : 400);
      throw e;
    }
  }
  const row = chars.get(uid) || null;
  const out = gameRun(op, args, row, { now: Date.now(), rng: PC.makeRng(1), uid });
  if (out.changed) chars.set(uid, { data: out.char, stash: out.stash, rev: (row ? row.rev : 0) + 1 });
  const cur = chars.get(uid);
  return { data: { char: cur.data, stash: cur.stash, rev: cur.rev, result: out.result }, error: null };
}

const server = http.createServer((req, res) => {
  const p = path.join(webRoot, decodeURIComponent(req.url.split('?')[0]));
  fs.readFile(p, (e, buf) => {
    if (e) { res.writeHead(404); return res.end(); }
    const type = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' }[path.extname(p)] || 'application/octet-stream';
    res.writeHead(200, { 'content-type': `${type}; charset=utf-8` });
    res.end(buf);
  });
});

function query(uid, st) {
  const ok = (data) => ({ data, error: null });
  if (st.table === 'profiles') return ok([{ nick: 'Игрок' }]);
  if (st.table === 'characters') { const row = chars.get(uid); return ok(row ? [{ data: row.data, stash: row.stash, rev: row.rev }] : []); }
  if (st.table === 'game_trades') return ok([...trades.values()].filter((t) => t.a === uid || t.b === uid).map(clone));
  if (st.table === 'world_mobs') return ok([]);
  if (st.table === 'battles' || st.table === 'battle_members' || st.table === 'battle_history') return ok([]);
  return { data: null, error: { code: '42P01', message: `relation "${st.table}" does not exist` } };
}

const INIT = `
(() => {
  window.__toasts = []; new MutationObserver((ms) => { for (const m of ms) for (const n of m.addedNodes) if (n.className && /toast/.test(n.className)) window.__toasts.push(n.textContent); }).observe(document, { childList: true, subtree: true });
  const chans = [];
  window.__pgRow = (row) => { for (const c of chans) for (const h of c.handlers) if (h.type === 'postgres_changes' && h.filter.table === 'game_trades' && h.filter.filter === (h.filter.filter.startsWith('a=') ? 'a=eq.' + row.a : 'b=eq.' + row.b)) h.cb({ new: row }); };
  window.__presence = {};
  window.__sync = (all) => { window.__presence = Object.fromEntries(Object.entries(all).map(([k, v]) => [k, [v]])); for (const c of chans) for (const h of c.handlers) if (h.type === 'presence') h.cb({}); };
  const builder = (table) => {
    const st = { table, op: 'select', filters: [], payload: null };
    const b = { select() { return b; }, insert() { return b; }, update() { return b; }, delete() { return b; }, eq(k, v) { st.filters.push(['eq', k, v]); return b; }, is() { return b; }, gt() { return b; }, lt() { return b; }, or() { return b; },
      order() { return b; }, limit() { return b; }, single() { st.single = true; return b; }, maybeSingle() { st.single = true; return b; },
      then(res, rej) { return window.__rpc('q', st).then((r) => { if (st.single && Array.isArray(r.data)) r = { ...r, data: r.data[0] || null }; return r; }).then(res, rej); } };
    return b;
  };
  const user = { id: window.__UID };
  window.supabase = { createClient: () => ({
    auth: { getSession: async () => ({ data: { session: { user } } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }), signOut: async () => ({}) },
    from: builder,
    rpc: async () => ({ data: null, error: null }),
    functions: { invoke: (name, o) => window.__rpc('fn', { body: o.body }).then((r) => (r.error ? { data: null, error: { context: { json: async () => r.error.body } } } : r)) },
    channel(name) {
      const ch = { name, handlers: [],
        on(type, filter, cb) { ch.handlers.push({ type, filter, cb }); return ch; },
        subscribe(cb) { chans.push(ch); if (cb) setTimeout(() => cb('SUBSCRIBED'), 5); return ch; },
        send() { return Promise.resolve('ok'); },
        track: async (m) => { window.__rpc('track', m); return {}; }, untrack: async () => ({}), presenceState: () => window.__presence,
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
  for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) throw new Error(`не дождались: ${what}`); await sleep(150); }
}

function heroOf(nick, job, extra) {
  const c = PC.progression.newCharacter(PC.data, { nick, job });
  c.location = 'forest_edge'; c.gold = 1000;
  extra(c);
  return c;
}

async function openPlayer(browser, uid, hero) {
  const ctx = await browser.newContext({ viewport: { width: 375, height: 812 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  chars.set(uid, { data: hero, stash: null, rev: 1 });
  await page.exposeFunction('__rpc', (op, args) => {
    if (op === 'q') return query(uid, args);
    if (op === 'fn') return game(uid, args.body);
    if (op === 'track') { metas.set(uid, args); for (const p of pages) p.page.evaluate((all) => window.__sync(all), Object.fromEntries(metas)).catch(() => {}); return null; }
    return null;
  });
  await page.addInitScript(`window.__UID = ${JSON.stringify(uid)}; localStorage.setItem('pc-character-v3', ${JSON.stringify(JSON.stringify(hero))});`);
  await page.route('**/cdn.jsdelivr.net/**', (r) => r.abort());
  await page.addInitScript(INIT);
  const p = { uid, page, errors };
  pages.push(p);
  await page.goto(`http://localhost:${server.address().port}/battle/index.html`);
  await page.waitForFunction(() => window.PC && PC.app && PC.app.state.char && PC.auth && PC.auth.user);
  return p;
}

(async () => {
  await new Promise((r) => server.listen(0, r));
  gameRun = (await import(path.join(__dirname, '..', '..', '..', 'supabase', 'functions', 'game', 'ops.js'))).run;
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium' });
  let stage = 'старт';
  const rng = PC.makeRng(11);
  const jobs = Object.keys(PC.data.classes);
  let sword, ringB;
  try {
    const A = await openPlayer(browser, 'aaaaaaaa-0000-4000-8000-000000000001', heroOf('Альфа', jobs[0], (c) => { sword = PC.items.generate(PC.data, { ilvl: 5, tier: 1, rarityFloor: 2, cls: c.job }, rng); PC.items.bagAdd(c, sword); PC.items.matAdd(PC.data, c, 'ore', 40); }));
    const B = await openPlayer(browser, 'bbbbbbbb-0000-4000-8000-000000000002', heroOf('Бета', jobs[1], (c) => { ringB = PC.items.generate(PC.data, { ilvl: 5, tier: 1, rarityFloor: 1, cls: c.job }, rng); PC.items.bagAdd(c, ringB); }));

    stage = 'список игроков и карточка';
    await until(() => A.page.evaluate(() => window.PC && PC.presence && PC.presence.players.length === 2 && !!document.querySelector('[data-player="bbbbbbbb-0000-4000-8000-000000000002"]')), 15000, 'Бета в списке игроков у Альфы');
    await A.page.click('[data-player="bbbbbbbb-0000-4000-8000-000000000002"]');
    const card = await A.page.evaluate(() => document.querySelector('#modal-title').textContent + '|' + document.querySelector('#modal-body').textContent);
    assert.ok(/Бета/.test(card) && /уровень/.test(card) && /Здоровье/.test(card), `карточка игрока с характеристиками: ${card}`);
    console.log('ok   тап по игроку открывает карточку с уровнем и характеристиками');

    stage = 'приглашение';
    await A.page.click('[data-act="trade"]');
    await until(() => B.page.evaluate(() => !!document.querySelector('.trade-banner')), 8000, 'приглашение у Беты');
    await B.page.click('.trade-banner [data-b="ok"]');
    await until(() => A.page.evaluate(() => !!document.querySelector('#modal-title[data-trade]')), 8000, 'окно обмена у Альфы');
    await until(() => B.page.evaluate(() => !!document.querySelector('#modal-title[data-trade]')), 8000, 'окно обмена у Беты');
    console.log('ok   приглашение, принятие, окно обмена у обоих');

    stage = 'предложения';
    assert.strictEqual(await A.page.evaluate(() => document.querySelectorAll('.trade-side:first-child .trade-grid .tile').length), 8, '8 ячеек');
    const idxOf = (pg, uid, stack) => pg.evaluate(([u, st]) => PC.app.state.char.bag.findIndex((x) => x && (u ? x.uid === u : x.stack === st)), [uid, stack]);
    await A.page.click(`[data-bag="${await idxOf(A.page, sword.uid)}"]`);                // меч
    await A.page.click(`[data-bag="${await idxOf(A.page, null, 'ore')}"]`);              // руда
    await until(() => B.page.evaluate(() => document.querySelectorAll('[data-their]').length >= 1 && /✓|подтвердил/.test(document.body.textContent) || document.querySelectorAll('[data-their].tile:not(.empty)').length >= 2), 8000, 'Бета видит предложение Альфы');
    assert.strictEqual(chars.get('aaaaaaaa-0000-4000-8000-000000000001').data.bag.filter((x) => x && x.uid === sword.uid).length, 0, 'вещь Альфы ушла в залог');
    // Бета предлагает вещь и золото
    await B.page.click(`[data-bag="${await idxOf(B.page, ringB.uid)}"]`);
    await B.page.evaluate(() => { const el = document.querySelector('[data-gold]'); el.value = '50'; el.dispatchEvent(new Event('change', { bubbles: true })); });
    await until(() => trades.size && [...trades.values()][0].offer_b.gold === 50 && [...trades.values()][0].offer_b.items.length === 1, 8000, 'залог Беты на сервере');
    console.log('ok   предложения обеих сторон на сервере, вещи ушли в залог');

    if (process.env.SHOT) { await sleep(700); await A.page.evaluate(() => document.querySelector('#modal .modal').scrollTo(0, 0)); await A.page.screenshot({ path: '/tmp/claude-0/trade-a.png' }); await B.page.screenshot({ path: '/tmp/claude-0/trade-b.png' }); }
    stage = 'осмотр вещи партнёра';
    await B.page.click('[data-their="0"]');
    assert.ok(await B.page.evaluate(() => !!document.querySelector('.item-card')), 'карточка вещи партнёра');
    await B.page.click('[data-act="back"]');
    await until(() => B.page.evaluate(() => !!document.querySelector('#modal-title[data-trade]')), 3000, 'возврат в окно обмена');
    // закрыть карточку крестиком — обмен возвращается, у партнёра он не закрывается
    await B.page.click('[data-their="0"]');
    await B.page.click('[data-mclose]', { position: { x: 5, y: 5 } });
    await until(() => B.page.evaluate(() => !!document.querySelector('#modal-title[data-trade]')), 3000, 'обмен вернулся после крестика карточки');
    assert.ok(await A.page.evaluate(() => !!document.querySelector('#modal-title[data-trade]')), 'у партнёра обмен остался');
    // крестик самого обмена закрывает окно, но не сделку, и само не открывается
    await B.page.click('[data-mclose]', { position: { x: 5, y: 5 } });
    await until(() => B.page.evaluate(() => !!document.querySelector('.trade-banner')), 600, 'плашка «Обмен идёт» сразу после закрытия окна');
    assert.ok(await B.page.evaluate(() => document.querySelector('#modal').hidden), 'окно обмена закрыто вручную остаётся закрытым');
    await B.page.click('.trade-banner [data-b="ok"]');
    await until(() => B.page.evaluate(() => !!document.querySelector('#modal-title[data-trade]')), 3000, 'обмен открывается из плашки');
    console.log('ok   вещь партнёра можно осмотреть и вернуться в обмен');

    stage = 'подтверждения';
    await sleep(3300);   // пауза после правки
    const disabled = (p) => p.page.evaluate(() => document.querySelector('[data-act="confirm"]').disabled);
    await until(async () => !(await disabled(A)), 6000, 'кнопка подтверждения у Альфы');
    await A.page.click('[data-act="confirm"]');
    await until(() => [...trades.values()][0].ok_a === true, 4000, 'подтверждение Альфы');
    // Альфа меняет предложение — подтверждение сбрасывается
    await A.page.click('[data-mine="1"]');
    await A.page.evaluate(() => { document.querySelector('[data-act="qty"]').click(); });
    await until(() => [...trades.values()][0].ok_a === false, 5000, 'подтверждение сброшено правкой');
    console.log('ok   правка предложения сбрасывает подтверждение');
    await sleep(3300);
    await until(async () => !(await disabled(A)) && !(await disabled(B)), 6000, 'кнопки активны');
    await A.page.click('[data-act="confirm"]');
    await until(() => [...trades.values()][0].ok_a === true, 4000, 'подтверждение Альфы');
    await until(async () => !(await disabled(B)), 6000, 'кнопка Беты');
    await B.page.click('[data-act="confirm"]');
    await until(() => [...trades.values()][0].state === 'done', 6000, 'сделка завершена');
    await until(() => [...trades.values()][0].claimed_a && [...trades.values()][0].claimed_b, 8000, 'оба забрали своё');
    const a = chars.get('aaaaaaaa-0000-4000-8000-000000000001').data, b = chars.get('bbbbbbbb-0000-4000-8000-000000000002').data;
    assert.ok(a.bag.some((x) => x && x.uid === ringB.uid), 'Альфа получила вещь Беты');
    assert.ok(b.bag.some((x) => x && x.uid === sword.uid), 'Бета получил меч');
    assert.strictEqual(a.gold, 1050); assert.strictEqual(b.gold, 950);
    assert.ok(!a.bag.some((x) => x && x.uid === sword.uid), 'меч не размножился');
    await until(() => A.page.evaluate(() => document.querySelector('#modal').hidden), 4000, 'окна закрылись');
    const tt = await A.page.evaluate(() => window.__toasts.filter((t) => /Обмен завершён/.test(t)).length);
    assert.strictEqual(tt, 1, 'итог показан один раз');
    console.log('ok   сделка завершена, вещи и золото у новых владельцев, окна закрыты');
    assert.deepStrictEqual([A.errors, B.errors], [[], []], 'в страницах нет ошибок');
    console.log('\nвсе сквозные проверки обмена прошли');
  } catch (e) {
    console.error(`\nПРОВАЛ на этапе «${stage}»:`, e.message);
    for (const p of pages) { console.error(p.uid, 'ошибки:', p.errors, 'тосты:', await p.page.evaluate(() => window.__toasts).catch(() => '?')); await p.page.screenshot({ path: `/tmp/claude-0/e2e-trade-${p.uid}.png` }).catch(() => {}); }
    process.exitCode = 1;
  } finally { await browser.close(); server.close(); }
})();
