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
    for (const m of fs.readFileSync(path.join(jsDir, f), 'utf8').matchAll(/\.act\('([a-zA-Z]+)'/g)) assert.ok(ops[m[1]], `${f}: нет действия ${m[1]} на сервере`);
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
  const had = cur.data.materials[shopId] || 0;
  assert.ok(step('buy', { id: shopId, n: 2 }).ok);
  assert.strictEqual(cur.data.gold, 1000 - 2 * price);
  assert.strictEqual(cur.data.materials[shopId], had + 2);

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

  // сундук: вещь из сумки и обратно, без дублей
  const item = PC.items.generate(data, { ilvl: 5, cls: job, mf: 0 }, PC.makeRng(7));
  PC.items.bagAdd(cur.data, item);
  const idx = cur.data.bag.findIndex((x) => x && x.uid === item.uid);
  assert.ok(step('stashPut', { index: idx }).ok);
  assert.ok(!cur.data.bag.some((x) => x && x.uid === item.uid) && cur.stash.items.filter(Boolean).length === 1);
  assert.ok(step('stashTake', { index: cur.stash.items.findIndex(Boolean) }).ok);
  assert.ok(cur.data.bag.some((x) => x && x.uid === item.uid) && !cur.stash.items.some(Boolean));
  assert.throws(() => run('stashTake', { index: 999 }, cur, ctx()), /bad_args/);

  // продажа: цена считается сервером, дубли uid не продают дважды
  const gold0 = cur.data.gold;
  const sold = step('sell', { uids: [item.uid, item.uid] });
  assert.strictEqual(sold.count, 1);
  assert.strictEqual(cur.data.gold, gold0 + PC.items.sellPrice(data, item));
  console.log('server-test: ok');
})().catch((e) => { console.error(e); process.exit(1); });
