// Тест обмена между игроками (web/battle/js/trade.js) на подставной базе с теми же правилами, что в trade_commit:
// запись сделки и героя — одна транзакция с проверкой версий. Проверяет «мошеннические» схемы.
// Запуск: node web/battle/tools/trade-test.js
const path = require('path');
const assert = require('assert');
['version', 'data', 'classes', 'stats', 'items-data', 'monsters', 'world-data', 'engine', 'items', 'progression', 'economy', 'world', 'actions', 'trade']
  .forEach((f) => require(path.join(__dirname, '..', 'js', `${f}.js`)));
const PC = globalThis.PC, { data, items: I, progression: P, makeRng } = PC;
const { handle, TradeError } = PC.trade;

const U = (n) => `00000000-0000-4000-8000-00000000000${n}`;
const A = U(1), B = U(2), C = U(3);
const clone = (v) => JSON.parse(JSON.stringify(v));

function world() {
  const heroes = new Map(), trades = new Map();
  let now = Date.UTC(2026, 9, 24, 12, 0, 0), seq = 0;
  const mkHero = (uid, nick) => {
    const c = P.newCharacter(data, { nick, gender: 'm', job: Object.keys(data.classes)[0] });
    c.gold = 5000;
    heroes.set(uid, { data: c, stash: null, rev: 1 });
  };
  mkHero(A, 'Альфа'); mkHero(B, 'Бета'); mkHero(C, 'Гамма');
  const io = {
    async hero(uid) { const h = heroes.get(uid); return h ? clone(h) : null; },
    async trade(id) { const t = trades.get(id); return t ? clone(t) : null; },
    async create(a, b, loc) {
      for (const t of trades.values()) if (t.state === 'open' && now - Date.parse(t.updated_at) < 15 * 60000 && [t.a, t.b].some((x) => x === a || x === b)) throw new TradeError('busy');
      const t = { id: `10000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`, a, b, loc, state: 'open', accepted: false, ver: 0, offer_a: { items: [], gold: 0 }, offer_b: { items: [], gold: 0 }, ok_a: false, ok_b: false, claimed_a: false, claimed_b: false, updated_at: new Date(now).toISOString() };
      trades.set(t.id, t);
      return clone(t);
    },
    // одна «транзакция»: проверяем обе версии до любой записи
    async commit({ uid, tradeId, ver, patch, char, stash, rev }) {
      const t = trades.get(tradeId), h = heroes.get(uid);
      if (!t || t.ver !== ver) throw new TradeError('stale');
      if (char && h.rev !== rev) throw new TradeError('stale');
      if (char) { h.data = clone(char); h.stash = stash; h.rev++; }
      Object.assign(t, clone(patch), { ver: t.ver + 1, updated_at: new Date(now).toISOString() });
      return { trade: clone(t), rev: char ? h.rev : null };
    },
  };
  const call = (uid, op, args) => handle(op, args || {}, io, { uid, now });
  const expect = async (code, uid, op, args, msg) => {
    try { await call(uid, op, args); } catch (e) { assert.ok(e instanceof TradeError, `${msg}: ждали TradeError, пришло ${e && e.stack}`); assert.strictEqual(e.message, code, msg); return; }
    assert.fail(`${msg}: ждали ошибку ${code}`);
  };
  return { heroes, trades, io, call, expect, tick: (ms) => { now += ms; }, hero: (u) => heroes.get(u).data };
}

// Вся «денежная» масса: золото, вещи (по uid) и ресурсы у героев + в залогах. Должна сохраняться при любых действиях.
function ledger(w) {
  const m = { gold: 0, items: [], mats: {} };
  const addOffer = (o) => { m.gold += o.gold; for (const it of o.items) { if (it.stack) m.mats[it.stack] = (m.mats[it.stack] || 0) + it.count; else m.items.push(it.uid); } };
  for (const h of w.heroes.values()) {
    m.gold += h.data.gold;
    for (const it of h.data.bag) if (it) { if (it.stack) m.mats[it.stack] = (m.mats[it.stack] || 0) + it.count; else m.items.push(it.uid); }
    for (const it of Object.values(h.data.equipment)) if (it) m.items.push(it.uid);
  }
  for (const t of w.trades.values()) { if (t.state === 'open') { addOffer(t.offer_a); addOffer(t.offer_b); continue; } for (const s of ['a', 'b']) { if (t.state === 'done' ? !t[`claimed_${s === 'a' ? 'b' : 'a'}`] : !t[`claimed_${s}`]) addOffer(t[`offer_${s}`]); } }
  m.items.sort();
  return JSON.stringify(m);
}

(async () => {
  const rng = makeRng(7);
  const gift = (w, uid, n) => {
    const c = w.hero(uid), out = [];
    for (let i = 0; i < n; i++) { const it = I.generate(data, { ilvl: 5, tier: 1, rarityFloor: 1, cls: w.hero(uid).job }, rng); I.bagAdd(c, it); out.push(it); }
    return out;
  };
  const open = async (w, from = A, to = B) => {
    const r = await w.call(from, 'tradeOpen', { to });
    const id = r.result.trade.id;
    await w.call(to, 'tradeAccept', { id });
    return id;
  };

  { // обычная сделка: вещь + ресурсы + золото на обе стороны
    const w = world(), [sword] = gift(w, A, 1), [ring] = gift(w, B, 1);
    I.matAdd(data, w.hero(A), 'ore', 30);
    const before = ledger(w);
    const id = await open(w);
    await w.call(A, 'tradeOffer', { id, items: [{ uid: sword.uid }, { stack: 'ore', count: 20 }], gold: 100 });
    assert.strictEqual(ledger(w), before, 'залог не меняет общую массу');
    assert.ok(!w.hero(A).bag.some((x) => x && x.uid === sword.uid), 'вещь ушла в залог: её нельзя продать или потратить');
    assert.strictEqual(I.matCount(data, w.hero(A), 'ore'), 10);
    await w.call(B, 'tradeOffer', { id, items: [{ uid: ring.uid }], gold: 0 });
    let t = w.trades.get(id);
    await w.call(A, 'tradeConfirm', { id, ver: t.ver });
    t = w.trades.get(id);
    assert.ok(t.ok_a && !t.ok_b);
    await w.call(B, 'tradeConfirm', { id, ver: t.ver });
    t = w.trades.get(id);
    assert.strictEqual(t.state, 'done');
    assert.ok(w.hero(B).bag.some((x) => x && x.uid === sword.uid), 'второй подтвердил — получил сразу');
    await w.call(A, 'tradeClaim', { id });
    assert.ok(w.hero(A).bag.some((x) => x && x.uid === ring.uid));
    assert.strictEqual(I.matCount(data, w.hero(B), 'ore'), 20);
    assert.strictEqual(w.hero(B).gold, 5100);
    assert.strictEqual(w.hero(A).gold, 4900);
    assert.strictEqual(ledger(w), before, 'после сделки ничего не пропало и не появилось');
    const rev = w.heroes.get(A).rev;
    await w.call(A, 'tradeClaim', { id });
    await w.call(B, 'tradeClaim', { id });
    assert.strictEqual(w.heroes.get(A).rev, rev, 'повторный сбор ничего не выдаёт');
    assert.strictEqual(ledger(w), before);
    console.log('ok   обычная сделка и сохранение массы');
  }

  { // подмена после подтверждения: правка предложения сбрасывает подтверждения, старая версия не проходит
    const w = world(), [cheap, good] = gift(w, A, 2), [gem] = gift(w, B, 1);
    const id = await open(w);
    await w.call(A, 'tradeOffer', { id, items: [{ uid: cheap.uid }], gold: 0 });
    await w.call(B, 'tradeOffer', { id, items: [{ uid: gem.uid }], gold: 0 });
    const seen = w.trades.get(id).ver;               // версию видит оба
    await w.call(B, 'tradeConfirm', { id, ver: seen });
    await w.call(A, 'tradeOffer', { id, items: [{ uid: good.uid }], gold: 0 });   // A «меняет» предложение под шумок
    let t = w.trades.get(id);
    assert.ok(!t.ok_a && !t.ok_b, 'подтверждения сброшены');
    await w.expect('changed', A, 'tradeConfirm', { id, ver: seen }, 'подтверждение по старой версии');
    await w.expect('changed', B, 'tradeConfirm', { id, ver: seen }, 'и у второго тоже');
    assert.ok(w.hero(A).bag.some((x) => x && x.uid === cheap.uid), 'прежний залог вернулся к владельцу');
    console.log('ok   подмена после подтверждения');
  }

  { // подделки в аргументах
    const w = world(), [mine, locked] = gift(w, A, 2), [theirs] = gift(w, B, 1);
    w.hero(A).bag.find((x) => x && x.uid === locked.uid).locked = true;
    const id = await open(w);
    await w.expect('no_item', A, 'tradeOffer', { id, items: [{ uid: theirs.uid }], gold: 0 }, 'чужая вещь');
    await w.expect('no_item', A, 'tradeOffer', { id, items: [{ uid: 'выдумана' }], gold: 0 }, 'несуществующая вещь');
    await w.expect('locked', A, 'tradeOffer', { id, items: [{ uid: locked.uid }], gold: 0 }, 'запертая вещь');
    await w.expect('bad_args', A, 'tradeOffer', { id, items: [{ uid: mine.uid }, { uid: mine.uid }], gold: 0 }, 'одна вещь дважды');
    await w.expect('no_gold', A, 'tradeOffer', { id, items: [], gold: 5001 }, 'золота больше, чем есть');
    for (const g of [-1, 1.5, NaN, Infinity, '100', null, 1e12]) await w.expect('bad_args', A, 'tradeOffer', { id, items: [], gold: g }, `золото ${g}`);
    await w.expect('no_item', A, 'tradeOffer', { id, items: [{ stack: 'ore', count: 5 }], gold: 0 }, 'ресурса нет');
    I.matAdd(data, w.hero(A), 'ore', 5);
    for (const c of [0, -3, 2.5, '5', 1e9]) await w.expect(c === 1e9 ? 'bad_args' : 'bad_args', A, 'tradeOffer', { id, items: [{ stack: 'ore', count: c }], gold: 0 }, `количество ${c}`);
    await w.expect('no_item', A, 'tradeOffer', { id, items: [{ stack: 'ore', count: 6 }], gold: 0 }, 'ресурсов больше, чем есть');
    await w.expect('bad_args', A, 'tradeOffer', { id, items: [{ stack: 'ore', count: 2 }, { stack: 'ore', count: 2 }], gold: 0 }, 'один ресурс двумя строками');
    await w.expect('bad_args', A, 'tradeOffer', { id, items: [{ stack: '__proto__', count: 1 }], gold: 0 }, 'выдуманный ресурс');
    await w.expect('bad_args', A, 'tradeOffer', { id, items: Array.from({ length: 9 }, () => ({ stack: 'ore', count: 1 })), gold: 0 }, 'больше 8 ячеек');
    // надетая вещь не лежит в сумке — предложить нельзя
    const worn = w.hero(A).equipment.weapon;
    if (worn) await w.expect('no_item', A, 'tradeOffer', { id, items: [{ uid: worn.uid }], gold: 0 }, 'надетая вещь');
    console.log('ok   подделки: чужое, запертое, дубли, золото, ресурсы');
  }

  { // чужак, самообмен, занятые, не та локация
    const w = world(), [it] = gift(w, A, 1);
    await w.expect('bad_args', A, 'tradeOpen', { to: A }, 'обмен с собой');
    await w.expect('bad_args', A, 'tradeOpen', { to: 'нет' }, 'мусор вместо id');
    await w.expect('not_here', A, 'tradeOpen', { to: U(9) }, 'нет такого героя');
    const id = await open(w);
    await w.expect('not_yours', C, 'tradeOffer', { id, items: [], gold: 0 }, 'посторонний правит чужую сделку');
    await w.expect('not_yours', C, 'tradeCancel', { id }, 'посторонний отменяет');
    await w.expect('not_yours', C, 'tradeClaim', { id }, 'посторонний забирает');
    await w.expect('busy', C, 'tradeOpen', { to: A }, 'у A уже сделка');
    await w.expect('busy', C, 'tradeOpen', { to: B }, 'у B уже сделка');
    await w.expect('bad_args', A, 'tradeAccept', { id }, 'принять своё приглашение (уже принято)');
    const w2 = world();
    w2.hero(B).location = 'forest_edge';
    await w2.expect('not_here', A, 'tradeOpen', { to: B }, 'другая локация');
    w2.hero(B).location = w2.hero(A).location; w2.hero(B).transit = { to: 'forest_edge', at: 1 };
    await w2.expect('not_here', A, 'tradeOpen', { to: B }, 'партнёр в пути');
    // партнёр ушёл посреди сделки
    const w3 = world(), [x] = gift(w3, A, 1), id3 = await open(w3);
    await w3.call(A, 'tradeOffer', { id: id3, items: [{ uid: x.uid }], gold: 0 });
    await w3.call(B, 'tradeOffer', { id: id3, items: [], gold: 10 });
    w3.hero(B).location = 'forest_edge';
    const ver3 = w3.trades.get(id3).ver;
    await w3.call(A, 'tradeConfirm', { id: id3, ver: ver3 });   // партнёр ушёл — сделка отменяется, ничего не завершается
    assert.strictEqual(w3.trades.get(id3).state, 'cancel', 'уход партнёра отменяет сделку');
    await w3.call(A, 'tradeClaim', { id: id3 });
    assert.ok(w3.hero(A).bag.some((q) => q && q.uid === x.uid), 'залог вернулся');
    await w3.call(B, 'tradeClaim', { id: id3 });
    assert.strictEqual(w3.hero(B).gold, 5000);
    console.log('ok   посторонние, занятость, локация');
  }

  { // пустая сделка, приглашение, доступ до принятия
    const w = world();
    const r = await w.call(A, 'tradeOpen', { to: B }), id = r.result.trade.id;
    await w.expect('not_accepted', A, 'tradeOffer', { id, items: [], gold: 1 }, 'предложение до принятия');
    await w.expect('not_accepted', A, 'tradeConfirm', { id, ver: 0 }, 'подтверждение до принятия');
    await w.call(B, 'tradeAccept', { id });
    await w.expect('empty', A, 'tradeConfirm', { id, ver: w.trades.get(id).ver }, 'пустая сделка');
    console.log('ok   пустая сделка и приглашение');
  }

  { // отмена: каждый забирает своё ровно один раз; после закрытия сделка не правится
    const w = world(), [it] = gift(w, A, 1), before = ledger(w);
    const id = await open(w);
    await w.call(A, 'tradeOffer', { id, items: [{ uid: it.uid }], gold: 700 });
    await w.call(B, 'tradeOffer', { id, items: [], gold: 300 });
    await w.call(A, 'tradeConfirm', { id, ver: w.trades.get(id).ver });
    await w.call(B, 'tradeCancel', { id });
    assert.strictEqual(ledger(w), before);
    await w.expect('closed', A, 'tradeOffer', { id, items: [], gold: 0 }, 'правка после отмены');
    await w.expect('closed', A, 'tradeConfirm', { id, ver: w.trades.get(id).ver }, 'подтверждение после отмены');
    await w.expect('closed', B, 'tradeCancel', { id }, 'повторная отмена');
    await w.call(A, 'tradeClaim', { id }); await w.call(A, 'tradeClaim', { id }); await w.call(B, 'tradeClaim', { id }); await w.call(B, 'tradeClaim', { id });
    assert.strictEqual(w.hero(A).gold, 5000); assert.strictEqual(w.hero(B).gold, 5000);
    assert.ok(w.hero(A).bag.some((x) => x && x.uid === it.uid), 'вещь вернулась владельцу');
    assert.strictEqual(w.hero(A).bag.filter((x) => x && x.uid === it.uid).length, 1, 'и не размножилась');
    assert.strictEqual(ledger(w), before);
    await w.expect('closed', A, 'tradeCancel', { id }, 'отмена закрытой');
    // закрытая «done» сделка не отменяется
    const w2 = world(), [x] = gift(w2, A, 1), id2 = await open(w2);
    await w2.call(A, 'tradeOffer', { id: id2, items: [{ uid: x.uid }], gold: 0 });
    await w2.call(A, 'tradeConfirm', { id: id2, ver: w2.trades.get(id2).ver });
    await w2.call(B, 'tradeConfirm', { id: id2, ver: w2.trades.get(id2).ver });
    await w2.expect('closed', A, 'tradeCancel', { id: id2 }, 'отмена после завершения');
    await w2.expect('closed', A, 'tradeOffer', { id: id2, items: [], gold: 0 }, 'правка после завершения');
    console.log('ok   отмена и повторный сбор');
  }

  { // сбор пока сделка открыта запрещён; устаревшая сделка закрывается, залог возвращается
    const w = world(), [it] = gift(w, A, 1), before = ledger(w);
    const id = await open(w);
    await w.call(A, 'tradeOffer', { id, items: [{ uid: it.uid }], gold: 50 });
    await w.expect('open', A, 'tradeClaim', { id }, 'сбор из открытой сделки');
    w.tick(16 * 60000);
    await w.expect('closed', B, 'tradeOffer', { id, items: [], gold: 1 }, 'правка устаревшей');
    await w.call(A, 'tradeClaim', { id });
    assert.strictEqual(w.trades.get(id).state, 'cancel');
    assert.ok(w.hero(A).bag.some((x) => x && x.uid === it.uid));
    assert.strictEqual(w.hero(A).gold, 5000);
    await w.call(B, 'tradeClaim', { id });
    assert.strictEqual(ledger(w), before);
    await w.call(C, 'tradeOpen', { to: B });   // B свободен: старая сделка не держит
    console.log('ok   срок сделки');
  }

  { // сумка получателя полна: ничего не теряется, сделка не завершается
    const w = world(), [it] = gift(w, A, 1), [x] = gift(w, B, 1);
    const id = await open(w);
    await w.call(A, 'tradeOffer', { id, items: [{ uid: it.uid }], gold: 0 });
    await w.call(B, 'tradeOffer', { id, items: [{ uid: x.uid }], gold: 0 });
    // B забивает сумку (после залога освободилась одна ячейка)
    const b = w.hero(B); const filler = []; while (I.bagAdd(b, (() => { const f = { stack: 'ore', count: 1 }; filler.push(f); return f; })()) >= 0) { /* */ }
    await w.call(A, 'tradeConfirm', { id, ver: w.trades.get(id).ver });
    await w.expect('bag_full', B, 'tradeConfirm', { id, ver: w.trades.get(id).ver }, 'у подтверждающего вторым нет места');
    assert.strictEqual(w.trades.get(id).state, 'open', 'сделка не закрылась');
    // а если нет места у того, кто подтвердил первым, второй не может завершить сделку
    await w.call(A, 'tradeUnconfirm', { id });
    await w.call(B, 'tradeConfirm', { id, ver: w.trades.get(id).ver });
    await w.expect('partner_bag_full', A, 'tradeConfirm', { id, ver: w.trades.get(id).ver }, 'у партнёра нет места');
    assert.strictEqual(w.trades.get(id).state, 'open');
    assert.ok(w.hero(A).bag.every((q) => !q || q.uid !== x.uid), 'ничего не выдано');
    // место освободилось — сделка проходит, масса сохраняется
    for (let i = 0; i < w.hero(B).bag.length; i++) if (w.hero(B).bag[i] && w.hero(B).bag[i].stack === 'ore') { w.hero(B).bag[i] = null; break; }
    filler.length = 0;
    const ledB = ledger(w);
    await w.call(A, 'tradeConfirm', { id, ver: w.trades.get(id).ver });
    assert.strictEqual(w.trades.get(id).state, 'done');
    await w.call(B, 'tradeClaim', { id });
    assert.ok(w.hero(B).bag.some((q) => q && q.uid === it.uid) && w.hero(A).bag.some((q) => q && q.uid === x.uid));
    console.log('ok   нет места в сумке');
  }

  { // гонка: два одновременных подтверждения и две правки — выигрывает одна запись
    const w = world(), [it, it2] = gift(w, A, 2), [g] = gift(w, B, 1);
    const id = await open(w);
    await w.call(A, 'tradeOffer', { id, items: [{ uid: it.uid }], gold: 0 });
    await w.call(B, 'tradeOffer', { id, items: [{ uid: g.uid }], gold: 0 });
    const ver = w.trades.get(id).ver;
    await w.call(A, 'tradeConfirm', { id, ver });
    const res = await Promise.allSettled([w.call(B, 'tradeConfirm', { id, ver: w.trades.get(id).ver }), w.call(A, 'tradeOffer', { id, items: [{ uid: it2.uid }], gold: 0 })]);
    const t = w.trades.get(id);
    const done = t.state === 'done';
    // либо сделка завершилась на старом предложении, либо предложение сменилось и подтверждения сброшены — смесь невозможна
    if (done) assert.ok(w.hero(B).bag.some((x) => x && x.uid === it.uid) && !w.hero(B).bag.some((x) => x && x.uid === it2.uid), 'получено ровно то, что подтверждали');
    else assert.ok(!t.ok_a && !t.ok_b, 'после смены предложения подтверждений нет');
    assert.ok(res.filter((r) => r.status === 'fulfilled').length >= 1);
    console.log(`ok   гонка (${done ? 'сделка завершилась' : 'предложение сменилось'})`);
  }

  console.log('\ntrade-test: ok');
})().catch((e) => { console.error(e); process.exit(1); });
