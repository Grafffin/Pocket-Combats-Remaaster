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
  assert.ok(Object.keys(ops).length >= 2);
  console.log('server-test: ok');
})().catch((e) => { console.error(e); process.exit(1); });
