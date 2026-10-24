// Тест серверной функции game (supabase/functions/game) без Deno и базы: те же операции на игровом коде в Node.
// Запуск: node web/battle/tools/server-test.js
const path = require('path');
const fs = require('fs');
const assert = require('assert');
const root = path.join(__dirname, '..', '..', '..');
const fnDir = path.join(root, 'supabase', 'functions', 'game');

// Список файлов в game.js и sync.sh совпадает и идёт в том же порядке, что в index.html
const imports = [...fs.readFileSync(path.join(fnDir, 'game.js'), 'utf8').matchAll(/_game\/([a-z-]+)\.js/g)].map((m) => m[1]);
const synced = fs.readFileSync(path.join(fnDir, 'sync.sh'), 'utf8').match(/for f in ([^;]+);/)[1].trim().split(/\s+/);
assert.deepStrictEqual(synced, imports, 'sync.sh и game.js копируют разные файлы');
const html = fs.readFileSync(path.join(root, 'web', 'battle', 'index.html'), 'utf8');
const order = [...html.matchAll(/src="js\/([a-z-]+)\.js/g)].map((m) => m[1]).filter((f) => imports.includes(f));
assert.deepStrictEqual(order, imports, 'порядок файлов функции отличается от index.html');
for (const f of imports) require(path.join(root, 'web', 'battle', 'js', `${f}.js`));
const PC = globalThis.PC, data = PC.data;
{ // стаки ресурсов в сумке: лимит ячейки, переполнение, миграция, кузнечные ресурсы отдельно
  const I = PC.items, h = PC.progression.newCharacter(data, { nick: 'Стак', gender: 'm', job: Object.keys(data.classes)[0] });
  assert.strictEqual(I.matCount(data, h, 'hp_potion_1'), 5, 'стартовые зелья в сумке');
  assert.strictEqual(h.materials.hp_potion_1, undefined, 'зелья не лежат в materials');
  assert.strictEqual(I.matAdd(data, h, 'herb_stjohn', 450), 450);
  assert.deepStrictEqual(h.bag.filter((x) => x && x.stack === 'herb_stjohn').map((x) => x.count).sort((p, q) => p - q), [50, 200, 200], 'стаки по 200');
  assert.strictEqual(I.matAdd(data, h, 'stone1', 450), 450, 'кузнечные тоже стаками');
  assert.strictEqual(I.matCount(data, h, 'stone1'), 453);
  I.matTake(data, h, 'herb_stjohn', 260);
  assert.strictEqual(I.matCount(data, h, 'herb_stjohn'), 190);
  assert.strictEqual(h.bag.filter((x) => x && x.stack === 'herb_stjohn').length, 1, 'пустые стаки убираются');
  const idx = h.bag.findIndex((x) => x && x.stack === 'herb_stjohn');
  I.matAdd(data, h, 'herb_stjohn', 30);   // 190 → стак 200 + новый 20
  const [a, b] = h.bag.map((x, i) => (x && x.stack === 'herb_stjohn' ? i : -1)).filter((i) => i >= 0);
  I.moveInBag(h, b, a, data);
  assert.ok(h.bag.every((x) => !x || x.stack !== 'herb_stjohn' || x.count <= data.STACK_MAX), 'слияние не превышает лимит');
  assert.strictEqual(I.matCount(data, h, 'herb_stjohn'), 220);
  assert.ok(!I.equip(data, h, idx).ok, 'ресурс нельзя надеть');
  // сумка полна: лишнее не помещается
  h.bag = h.bag.map((x) => x || { stack: 'ore_dummy', count: 1 });
  data.materials.ore_dummy = { name: 'x', art: 'x', price: 0 };
  assert.strictEqual(I.matRoom(data, h, 'spider_gland'), 0);
  assert.strictEqual(I.matAdd(data, h, 'spider_gland', 5), 0, 'в полную сумку не кладём');
  delete data.materials.ore_dummy;
  // миграция 6 → 7: нековальные ресурсы переезжают в сумку, остаток, не влезший, остаётся в materials
  const old = PC.progression.newCharacter(data, { nick: 'Старый', gender: 'm', job: Object.keys(data.classes)[0] });
  old.bag = old.bag.map(() => null);
  old.materials = { hp_potion_1: 250, stone2: 7, herb_stjohn: 3 };
  old.version = 6;
  const m = PC.progression.migrate(data, old);
  assert.strictEqual(m.version, PC.progression.CHAR_VERSION);
  assert.strictEqual(I.matCount(data, m, 'stone2'), 7, 'кузнечные тоже переехали в сумку');
  assert.strictEqual(m.materials.stone2, undefined);
  assert.strictEqual(m.materials.hp_potion_1, undefined);
  assert.strictEqual(I.matCount(data, m, 'hp_potion_1'), 250);
  // миграция 8 → 9: кузнечное дело — с уровня, открывающего уже пройденные тиры ковки
  const vet = PC.progression.newCharacter(data, { nick: 'Ветеран', gender: 'm', job: Object.keys(data.classes)[0] });
  vet.version = 8; vet.maxTier = 6; delete vet.prof;
  PC.progression.migrate(data, vet);
  assert.strictEqual(PC.progression.profLevel(vet, 'smith'), data.professions.smith.craftLevel(6), 'ковка T6 не закрылась');
  assert.strictEqual(I.matCount(data, m, 'herb_stjohn'), 3);
  // варка: результат не влез — откат
  const r = PC.data.recipes[0], need = Object.keys(r.need);
  const bk = PC.progression.newCharacter(data, { nick: 'Варка', gender: 'm', job: Object.keys(data.classes)[0] });
  bk.gold = 1e6;
  for (const k of need) I.matAdd(data, bk, k, 10);
  bk.bag = bk.bag.map((x) => x || { stack: 'x', count: 1 });   // свободных ячеек нет, но стаки сырья освободят место...
  const snap = JSON.stringify(bk);
  const res = PC.economy.brew(data, bk, 0, 1);
  if (!res.ok) assert.strictEqual(JSON.stringify(bk), snap, 'неудачная варка ничего не меняет');
}
{ // автоохота: монстр уровня героя, иначе ближайший ниже
  const W = PC.world, h = PC.progression.newCharacter(data, { nick: 'Охотник', gender: 'm', job: Object.keys(data.classes)[0] });
  h.location = Object.keys(data.locations).find((k) => !data.locations[k].safe);
  W.update(data, h, Date.now(), PC.makeRng(1));
  const lv = W.aliveMobs(data, h).map((m) => m.level).sort((a, b) => a - b);
  assert.ok(lv.length > 1 && lv[0] < lv[lv.length - 1], 'нужны монстры разных уровней');
  h.level = lv[lv.length - 1];
  assert.strictEqual(W.pickForAutoHunt(data, h, null, PC.makeRng(2)).level, lv[lv.length - 1]);
  h.level = lv[lv.length - 1] + 20;
  assert.strictEqual(W.pickForAutoHunt(data, h, null, PC.makeRng(2)).level, lv[lv.length - 1]);
  h.level = lv[0] - 1;
  assert.strictEqual(W.pickForAutoHunt(data, h, null, PC.makeRng(2)).level, lv[0]);
}

(async () => {
  const { run, ops } = await import(path.join(fnDir, 'ops.js'));
  const ctx = () => ({ now: Date.now(), rng: PC.makeRng(12345), uid: 'u1' });
  const hero = PC.progression.newCharacter(data, { nick: 'Тест', gender: 'm', job: Object.keys(data.classes)[0] });
  const row = { data: hero, stash: null };

  let out = run('ping', {}, row, ctx());
  assert.strictEqual(out.result.build, PC.BUILD);
  assert.strictEqual(out.changed, false);

  out = run('load', {}, row, ctx());
  assert.strictEqual(out.changed, false);
  assert.strictEqual(out.char.nick, 'Тест');
  assert.notStrictEqual(out.char, row.data, 'операция должна работать на копии героя');

  out = run('load', {}, null, ctx());
  assert.strictEqual(out.char, null);

  for (const bad of ['nope', 'constructor', '__proto__', 'toString']) {
    assert.throws(() => run(bad, {}, row, ctx()), /bad_op/);
  }
  assert.ok(ops.buy && ops.enhance && ops.stashPut, 'действия из actions.js подключены');
  // каждое действие, которое вызывает клиент, есть на сервере
  const jsDir = path.join(root, 'web', 'battle', 'js');
  for (const f of fs.readdirSync(jsDir)) {
    for (const m of fs.readFileSync(path.join(jsDir, f), 'utf8').matchAll(/\.act\('([a-zA-Z]+)'/g)) assert.ok(ops[m[1]] || PC.trade.OPS.includes(m[1]), `${f}: нет действия ${m[1]} на сервере`);
  }

  // ---- действия вне боя: читерские аргументы отклоняются, честные работают ----
  const job = Object.keys(data.classes)[0];
  out = run('create', { nick: '  Новый  ', gender: 'f', job }, null, ctx());
  assert.ok(out.changed && out.char.nick === 'Новый' && out.char.gender === 'f');
  assert.throws(() => run('create', { nick: 'X', job: 'god' }, null, ctx()), /bad_args/);
  let cur = { data: out.char, stash: null };
  const step = (op, args) => { const o = run(op, args, cur, ctx()); cur = { data: o.char, stash: o.stash }; return o.result; };
  assert.strictEqual(step('create', { nick: 'Ещё', job }).ok, false, 'второй герой поверх первого');

  cur.data.gold = 1000;
  const shopId = data.shopStock[0], price = data.materials[shopId].price;
  for (const n of [-100, 0, 1.5, '5', 1e6]) assert.throws(() => run('buy', { id: shopId, n }, cur, ctx()), /bad_args/, `buy n=${n}`);
  assert.throws(() => run('buy', { id: 'stone3', n: 1 }, cur, ctx()), /bad_args/, 'товара нет в лавке');
  const had = PC.items.matCount(data, cur.data, shopId);
  assert.ok(step('buy', { id: shopId, n: 2 }).ok);
  assert.strictEqual(cur.data.gold, 1000 - 2 * price);
  assert.strictEqual(PC.items.matCount(data, cur.data, shopId), had + 2);

  cur.data.location = Object.keys(data.locations).find((k) => k !== data.HOME);
  assert.throws(() => run('buy', { id: shopId, n: 1 }, cur, ctx()), /not_in_village/);
  cur.data.location = data.HOME;

  cur.data.statPoints = 3;
  const [k1, k2] = PC.stats.PRIMARY;
  assert.throws(() => run('allocate', { alloc: { [k1]: 100, [k2]: -97 } }, cur, ctx()), /bad_args/, 'отрицательные очки');
  assert.throws(() => run('allocate', { alloc: { __proto__x: 1 } }, cur, ctx()), /bad_args/);
  const before = cur.data.stats[k1];
  assert.ok(step('allocate', { alloc: { [k1]: 3 } }).ok);
  assert.strictEqual(cur.data.stats[k1], before + 3);
  assert.strictEqual(step('allocate', { alloc: { [k1]: 1 } }).ok, false, 'очков больше нет');

  assert.throws(() => run('settings', { patch: { autoHunt: 'yes' } }, cur, ctx()), /bad_args/);
  assert.throws(() => run('settings', { patch: { gold: 5 } }, cur, ctx()), /bad_args/);
  assert.ok(step('settings', { patch: { potionAt: 50 } }).ok);

  // расширение сумки: платно, +8 ячеек, не больше максимума
  const bag0 = cur.data.bag.length;
  cur.data.gold = 0;
  assert.ok(!step('expandBag', {}).ok && cur.data.bag.length === bag0, 'без золота — отказ');
  cur.data.gold = 1e6;
  while (step('expandBag', {}).ok);
  assert.ok(cur.data.bag.length === data.bagExpand.max && cur.data.bag.length > bag0, 'сумка расширена до максимума');
  assert.ok(!step('expandBag', {}).ok, 'дальше максимума нельзя');

  // прочность: поражение снимает прочность, сломанная вещь не даёт характеристик, ремонт у кузнеца
  {
    const eq = Object.values(cur.data.equipment).filter(Boolean);
    const w = eq[0], I = PC.items, Dd = data.durability;
    assert.ok(eq.length && I.durOf(data, w) === Dd.max, 'новая вещь целая');
    I.wear(data, cur.data, PC.makeRng(1), { defeat: true });
    assert.ok(eq.every((it) => I.durOf(data, it) <= Dd.max - Dd.defeatLoss), 'поражение повреждает всё надетое');
    w.dur = 0;
    assert.deepStrictEqual(I.totals(data, w), {}, 'сломанная вещь ничего не даёт');
    const brokenCost = I.repairCost(data, w);
    w.dur = 1;
    assert.ok(brokenCost > I.repairCost(data, w) * 2, 'сломанную чинить заметно дороже');
    w.dur = 0;
    cur.data.gold = 0;
    assert.ok(!step('repairAll', {}).ok, 'без золота ремонта нет');
    cur.data.gold = 1e6;
    assert.ok(step('repairAll', {}).ok && Object.values(cur.data.equipment).filter(Boolean).every((it) => I.durOf(data, it) === Dd.max), 'всё починено');
    assert.ok(!step('repairAll', {}).ok, 'чинить нечего');
    assert.ok(PC.progression.profOf(cur.data, 'smith').exp > 0 || PC.progression.profLevel(cur.data, 'smith') > 1, 'ремонт даёт опыт кузнечного дела');
    w.dur = 0;
    const full = I.repairCost(data, w);
    cur.data.prof = { smith: { lvl: 11, exp: 0 } };
    assert.ok(I.repairCost(data, w, cur.data) < full, 'кузнечное дело снижает цену ремонта');
    w.dur = Dd.max;
  }

  // начертание: закрытый рецепт — отказ, открытый даёт результат и опыт профессии
  {
    const I = PC.items, rs = data.scribeRecipes;
    for (const [k, n] of Object.entries({ ...rs[0].need, ...rs[rs.length - 1].need })) I.matAdd(data, cur.data, k, n * 3);
    assert.ok(!step('inscribe', { i: rs.length - 1, n: 1 }).ok, 'высокий рецепт закрыт на 1 уровне');
    const before = I.matCount(data, cur.data, rs[0].out);
    assert.ok(step('inscribe', { i: 0, n: 1 }).ok && I.matCount(data, cur.data, rs[0].out) >= before + rs[0].n, 'начерчено');
    assert.ok(PC.progression.profOf(cur.data, 'scribe').exp > 0 || PC.progression.profLevel(cur.data, 'scribe') > 1, 'опыт начертания');
    assert.throws(() => run('inscribe', { i: 99, n: 1 }, cur, ctx()), /bad_args/);
  }

  // сундук: вещь из сумки и обратно, без дублей
  const item = PC.items.generate(data, { ilvl: 5, cls: job, mf: 0 }, PC.makeRng(7));
  PC.items.bagAdd(cur.data, item);
  const idx = cur.data.bag.findIndex((x) => x && x.uid === item.uid);
  assert.ok(step('stashPut', { index: idx }).ok);
  assert.ok(!cur.data.bag.some((x) => x && x.uid === item.uid) && cur.stash.items.filter(Boolean).length === 1);
  assert.ok(step('stashTake', { index: cur.stash.items.findIndex(Boolean) }).ok);
  assert.ok(cur.data.bag.some((x) => x && x.uid === item.uid) && !cur.stash.items.some(Boolean));
  assert.throws(() => run('stashTake', { index: 999 }, cur, ctx()), /bad_args/);
  // ресурсы в сундуке: стак переезжает целиком, сумка и сундук не теряют и не плодят штуки
  {
    const total = () => PC.items.matCount(data, cur.data, 'ore') + cur.stash.items.reduce((n, x) => n + (x && x.stack === 'ore' ? x.count : 0), 0);
    PC.items.matAdd(data, cur.data, 'ore', 250);
    const before = total();
    const bi = cur.data.bag.findIndex((x) => x && x.stack === 'ore');
    assert.ok(step('stashPut', { index: bi }).ok);
    assert.equal(total(), before, 'ресурсы не теряются при складывании');
    assert.equal(PC.items.matCount(data, cur.data, 'ore'), before - cur.stash.items.filter((x) => x && x.stack === 'ore').reduce((n, x) => n + x.count, 0));
    const si = cur.stash.items.findIndex((x) => x && x.stack === 'ore');
    assert.ok(step('stashTake', { index: si }).ok);
    assert.equal(total(), before, 'и при возврате');
    assert.ok(cur.stash.items.every((x) => !x || x.count > 0 && x.count <= data.STACK_MAX));
  }

  // продажа: цена считается сервером, дубли uid не продают дважды
  const gold0 = cur.data.gold;
  const sold = step('sell', { uids: [item.uid, item.uid] });
  assert.strictEqual(sold.count, 1);
  assert.strictEqual(cur.data.gold, gold0 + PC.items.sellPrice(data, item));
  // ---- бои: сервер выдаёт бой, переигрывает историю и сам даёт награду ----
  const zone = Object.keys(data.locations).find((k) => !data.locations[k].safe && data.locations[k].tier === 1);
  const T0 = 1_800_000_000_000;
  const mkHero = (nick) => {
    const h = PC.progression.newCharacter(data, { nick, gender: 'm', job });
    h.location = zone; h.level = 5; h.gold = 1000;
    return { data: h, stash: null };
  };
  const at = (now, uid) => ({ now, rng: PC.makeRng(now % 99991), uid });
  const runAt = (holder, op, args, ctx) => { const o = run(op, args, holder.row, ctx); holder.row = { data: o.char, stash: o.stash }; return o.result; };
  const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  // История как у хозяина lockstep: удар, ход монстра, конец хода — пока бой не кончится
  function play(rec, roster, script) {
    const b = new PC.Battle({ players: roster, monster: rec.monster, seed: rec.seed, data, localKey: roster[0].key });
    const ev = [];
    const push = (e) => { b.applyEvent(e); ev.push(e); };
    for (let t = 0; t < 200 && !b.ended; t++) script(push, b, t);
    return { hist: { seed: rec.seed, monster: rec.monster, roster, ev }, battle: b };
  }
  const basic = (keys) => (push, b) => { for (const k of keys) push({ k: 'a', key: k, s: 'basic' }); push({ k: 'm' }); push({ k: 'e' }); };

  const A = { row: mkHero('Хозяин') };
  let ctxA = at(T0, 'host-uid');
  PC.world.update(data, A.row.data, T0, ctxA.rng);
  const mob = PC.world.aliveMobs(data, A.row.data)[0];
  let res = runAt(A, 'fightStart', { id: uuid(1), uid: mob.uid }, ctxA);
  assert.ok(res.ok && res.seed && res.tpl && res.monster, 'бой выдан');
  const rec = ctxA.saveFight;
  assert.strictEqual(rec.owner, 'host-uid');
  assert.strictEqual(rec.mob.uid, mob.uid);
  assert.strictEqual(runAt(A, 'fightStart', { id: uuid(2), uid: mob.uid }, at(T0 + 10, 'host-uid')).ok, false, 'занятого монстра второй раз не дают');
  // сбросили бой выше (dropFight) — выдаём заново для честной проверки
  A.row = { data: mkHero('Хозяин').data, stash: null };
  ctxA = at(T0, 'host-uid');
  PC.world.update(data, A.row.data, T0, ctxA.rng);
  res = runAt(A, 'fightStart', { id: uuid(1), uid: mob.uid }, ctxA);
  const fightRec = ctxA.saveFight;
  const roster = [{ key: 'host-uid', tpl: res.tpl }];
  const { hist, battle } = play(fightRec, roster, basic(['host-uid']));
  assert.ok(battle.ended, 'бой закончился');
  const endAt = T0 + battle.turn * PC.world.TICK_MS;
  const tamper = (fn) => { const h = JSON.parse(JSON.stringify(hist)); fn(h); return h; };
  const tryEnd = (h, now) => { const H = { row: JSON.parse(JSON.stringify(A.row)) }; return { r: runAt(H, 'fightEnd', { id: uuid(1), hist: h }, { ...at(now, 'host-uid'), fight: fightRec }), H }; };
  assert.strictEqual(tryEnd(tamper((h) => { h.roster[0].tpl.stats.atk = 99999; }), endAt).r.ok, false, 'подделанный герой');
  assert.strictEqual(tryEnd(tamper((h) => { h.monster.stats.maxHp = 1; }), endAt).r.ok, false, 'подделанный монстр');
  assert.strictEqual(tryEnd(tamper((h) => { h.seed += 1; }), endAt).r.ok, false, 'другой seed');
  if (battle.turn >= 2) assert.strictEqual(tryEnd(hist, T0 + 1000).r.ok, false, 'слишком быстрый бой');
  const exp0 = A.row.data.exp + A.row.data.level * 1e6, goldA = A.row.data.gold;
  const won = battle.winner === battle.player;
  res = runAt(A, 'fightEnd', { id: uuid(1), hist }, { ...at(endAt, 'host-uid'), fight: fightRec });
  assert.ok(res.ok, JSON.stringify(res));
  assert.strictEqual(res.summary.win, won);
  if (won) assert.ok(A.row.data.exp + A.row.data.level * 1e6 > exp0 && A.row.data.gold >= goldA, 'награда начислена');
  assert.strictEqual(A.row.data.fight, null);
  assert.strictEqual(runAt(A, 'fightEnd', { id: uuid(1), hist }, { ...at(endAt + 1, 'host-uid'), fight: fightRec }).ok, false, 'награда второй раз');

  // общий бой: вступивший получает долю, подделанный снимок вступившего — ничего
  const H2 = { row: mkHero('Хозяин2') }, J = { row: mkHero('Гость') };
  const c2 = at(T0, 'h2');
  PC.world.update(data, H2.row.data, T0, c2.rng);
  const r2 = runAt(H2, 'fightStart', { id: uuid(3), uid: PC.world.aliveMobs(data, H2.row.data)[0].uid }, c2);
  const rec2 = c2.saveFight;
  const rj = runAt(J, 'fightJoin', { id: uuid(3) }, { ...at(T0 + 500, 'g1'), fight: rec2 });
  assert.ok(rj.ok && rj.tpl);
  assert.deepStrictEqual(runAt(J, 'fightJoin', { id: uuid(3) }, { ...at(T0 + 600, 'g1'), fight: rec2 }).tpl, rj.tpl, 'повторное вступление после обновления страницы');
  const coop = play(rec2, [{ key: 'h2', tpl: r2.tpl }], (push, b, t) => {
    if (t === 0) push({ k: 'j', key: 'g1', tpl: rj.tpl });
    basic(['h2', 'g1'])(push, b);
  });
  const coopEnd = T0 + coop.battle.turn * PC.world.TICK_MS;
  const bad = JSON.parse(JSON.stringify(coop.hist));
  bad.ev[0].tpl.stats.atk = 99999;
  const J2 = { row: JSON.parse(JSON.stringify(J.row)) };
  assert.strictEqual(runAt(J2, 'fightEnd', { id: uuid(3), hist: bad }, { ...at(coopEnd, 'g1'), fight: rec2 }).ok, false, 'подделанный вступивший');
  const rr = runAt(J, 'fightEnd', { id: uuid(3), hist: coop.hist }, { ...at(coopEnd, 'g1'), fight: rec2 });
  assert.ok(rr.ok, JSON.stringify(rr));
  if (rr.summary.win) assert.ok(rr.contrib && rr.contrib.n === 2, 'доля в общем бою');
  assert.ok(runAt(H2, 'fightEnd', { id: uuid(3), hist: coop.hist }, { ...at(coopEnd, 'h2'), fight: rec2 }).ok);

  // зелья: выпитое списывается из текущего запаса, продажа зелий во время боя не даёт дубля
  const P3 = { row: mkHero('Зельевар') };
  PC.items.matTake(data, P3.row.data, 'hp_potion_1', PC.items.matCount(data, P3.row.data, 'hp_potion_1'));
  PC.items.matAdd(data, P3.row.data, 'hp_potion_1', 3);
  const c3 = at(T0, 'p3');
  PC.world.update(data, P3.row.data, T0, c3.rng);
  const r3 = runAt(P3, 'fightStart', { id: uuid(4), uid: PC.world.aliveMobs(data, P3.row.data)[0].uid }, c3);
  const rec3 = c3.saveFight;
  const pot = play(rec3, [{ key: 'p3', tpl: r3.tpl }], (push, b, t) => {
    if (t === 0) push({ k: 'p', key: 'p3', id: 'hp_potion_1' });
    basic(['p3'])(push, b);
  });
  PC.items.matTake(data, P3.row.data, 'hp_potion_1', PC.items.matCount(data, P3.row.data, 'hp_potion_1'));   // «продал» все зелья во время боя
  runAt(P3, 'fightEnd', { id: uuid(4), hist: pot.hist }, { ...at(T0 + pot.battle.turn * PC.world.TICK_MS, 'p3'), fight: rec3 });
  assert.strictEqual(PC.items.matCount(data, P3.row.data, 'hp_potion_1'), 0, 'зелья не вернулись из снимка');

  // вышел из боя (кнопка «Сбежать») — бегство: без потерь золота и без отправки домой
  const P5 = { row: mkHero('Беглец') };
  const c5 = at(T0, 'p5');
  PC.world.update(data, P5.row.data, T0, c5.rng);
  const r5 = runAt(P5, 'fightStart', { id: uuid(6), uid: PC.world.aliveMobs(data, P5.row.data)[0].uid }, c5);
  const left = { seed: c5.saveFight.seed, monster: c5.saveFight.monster, roster: [{ key: 'p5', tpl: r5.tpl }], ev: [{ k: 'l', key: 'p5' }] };
  const g5 = P5.row.data.gold;
  const s5 = runAt(P5, 'fightEnd', { id: uuid(6), hist: left, fled: true }, { ...at(T0 + 1000, 'p5'), fight: c5.saveFight }).summary;
  assert.ok(s5.fled && !s5.goldLost && P5.row.data.gold === g5 && P5.row.data.location === zone, 'бегство без потерь');

  // гибель героя: его отправляют в деревню, но монстр прежней локации обязан освободиться (иначе «в бою» до перезагрузки)
  {
    const P6 = { row: mkHero('Павший') };
    const c6 = at(T0, 'p6');
    PC.world.update(data, P6.row.data, T0, c6.rng);
    const m6 = PC.world.aliveMobs(data, P6.row.data)[0];
    const r6 = runAt(P6, 'fightStart', { id: uuid(10), uid: m6.uid }, c6);
    const rec6 = c6.saveFight;
    const dead = play(rec6, [{ key: 'p6', tpl: r6.tpl }], (push) => { push({ k: 'm' }); push({ k: 'e' }); });
    assert.ok(dead.battle.ended && dead.battle.winner !== dead.battle.player, 'герой погиб');
    const o6 = run('fightEnd', { id: uuid(10), hist: dead.hist }, P6.row, { ...at(T0 + dead.battle.turn * PC.world.TICK_MS, 'p6'), fight: rec6 });
    assert.ok(o6.result.ok && o6.result.summary.sentHome, 'отправлен домой');
    const old = o6.char.world[zone].mobs.find((m) => m.uid === m6.uid);
    assert.ok(old && !old.busy, 'монстр прежней локации свободен');
  }

  // переход: нельзя уйти посреди боя
  const P4 = { row: mkHero('Путник') };
  const c4 = at(T0, 'p4');
  PC.world.update(data, P4.row.data, T0, c4.rng);
  runAt(P4, 'fightStart', { id: uuid(5), uid: PC.world.aliveMobs(data, P4.row.data)[0].uid }, c4);
  const to = Object.keys(data.locations[zone].routes)[0];
  assert.strictEqual(runAt(P4, 'travel', { to }, at(T0 + 100, 'p4')).ok, false, 'переход в бою');
  runAt(P4, 'fightAbort', { id: uuid(5) }, at(T0 + 200, 'p4'));
  assert.ok(runAt(P4, 'travel', { to }, at(T0 + 300, 'p4')).ok);
  assert.strictEqual(runAt(P4, 'arrive', {}, at(T0 + 400, 'p4')).ok, false, 'прийти раньше времени');
  assert.ok(runAt(P4, 'arrive', {}, at(T0 + 3600e3, 'p4')).ok);
  assert.strictEqual(P4.row.data.location, to);

  // общий мир: монстра возродили/убили другие игроки (world_mobs) — сервер узнаёт его по тому же uid, что и клиент
  {
    const W = PC.world, T1 = T0 + 50 * W.TICK_MS, tick = W.tickOf(T1);
    const H = { row: mkHero('Сосед') };
    W.update(data, H.row.data, T0, PC.makeRng(1));          // так сервер помнит локацию с прошлого раза
    const client = JSON.parse(JSON.stringify(H.row.data));
    const rows = [{ slot: 1, cycle: 7, dead_until: null, busy_until: null }, { slot: 2, cycle: 3, dead_until: tick + 1, busy_until: null }];
    W.update(data, client, T1, PC.makeRng(2));
    W.applyShared(data, client, zone, rows, T1, null, null);
    const reborn = W.findMob(data, client, `${zone}.1.7`);
    assert.ok(reborn && reborn.deadUntil == null, 'клиент видит монстра нового цикла');
    assert.strictEqual(runAt(H, 'fightStart', { id: uuid(7), uid: reborn.uid }, at(T1, 'h')).ok, false, 'без общего мира сервер монстра не знает (старая ошибка)');
    const o = run('fightStart', { id: uuid(7), uid: reborn.uid }, H.row, { ...at(T1, 'h'), world: rows });
    assert.ok(o.result.ok && o.result.mob.uid === reborn.uid, 'с общим миром — тот же монстр');
    assert.ok(o.world.some((w) => w.slot === 1 && w.cycle === 7 && w.busy > tick), 'сервер отмечает «занят» в общем мире');
    const dead = run('fightStart', { id: uuid(8), uid: `${zone}.2.3` }, H.row, { ...at(T1, 'h'), world: rows });
    assert.strictEqual(dead.result.ok, false, 'убитого другим игроком не дают');
    // +2 слота за второго игрока: последний слот есть только при players: 2
    const last = W.poolSize(data.locations[zone], 2) - 1;
    const extra = W.rollMob(data.locations[zone], zone, last, 0).uid;
    assert.strictEqual(run('fightStart', { id: uuid(9), uid: extra }, H.row, { ...at(T1, 'h'), world: [] }).result.ok, false);
    assert.ok(run('fightStart', { id: uuid(9), uid: extra, players: 2 }, H.row, { ...at(T1, 'h'), world: [] }).result.ok, 'слот второго игрока');
    assert.throws(() => run('fightStart', { id: uuid(9), uid: extra, players: 999 }, H.row, at(T1, 'h')), /bad_args/);
  }

  console.log(`бои: одиночный ${won ? 'победа' : 'поражение'} за ${battle.turn} ход., общий ${rr.summary.win ? 'победа' : 'поражение'} (доля ${rr.contrib ? rr.contrib.pct : 0}%)`);
  console.log('server-test: ok');
})().catch((e) => { console.error(e); process.exit(1); });
