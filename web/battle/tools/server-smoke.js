// Проверка выложенной функции game на живом Supabase: гостевой вход, создание героя, покупка, отказ читерских
// аргументов, удаление героя. Запуск (из GitHub Actions после деплоя): node web/battle/tools/server-smoke.js <версия>
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const cfg = fs.readFileSync(path.join(__dirname, '..', 'js', 'config.js'), 'utf8');
const url = cfg.match(/supabaseUrl: '([^']+)'/)[1];
const anon = cfg.match(/supabaseAnonKey: '([^']+)'/)[1];
const build = process.argv[2] || '__BUILD__';

async function call(token, body) {
  const r = await fetch(`${url}/functions/v1/game`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, apikey: anon, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  return { status: r.status, body: await r.json().catch(() => null) };
}

(async () => {
  let r = await call(anon, { op: 'ping', v: build });
  assert.strictEqual(r.status, 200, JSON.stringify(r));
  assert.strictEqual(r.body.result.build, build);
  r = await call(anon, { op: 'ping', v: 'old' });
  assert.strictEqual(r.status, 409);
  assert.strictEqual(r.body.error, 'version');
  r = await call(anon, { op: 'load', v: build });
  assert.strictEqual(r.body.error, 'not_auth');
  console.log('ping, version, not_auth: ok');

  const s = await fetch(`${url}/auth/v1/signup`, { method: 'POST', headers: { apikey: anon, 'Content-Type': 'application/json' }, body: '{}' });
  const token = (await s.json()).access_token;
  assert.ok(token, 'гостевой вход');
  let rev = 0;
  const act = async (op, args) => {
    const res = await call(token, { op, args, rev, v: build });
    if (res.body && res.body.rev != null) rev = res.body.rev;
    return res;
  };
  r = await act('create', { nick: 'Smoke', job: 'warrior' });
  assert.strictEqual(r.status, 200, JSON.stringify(r));
  const gold = r.body.char.gold;
  r = await act('buy', { id: 'hp_potion_1', n: -50 });
  assert.strictEqual(r.body.error, 'bad_args');
  r = await act('buy', { id: 'hp_potion_1', n: 1 });
  assert.strictEqual(r.status, 200, JSON.stringify(r));
  assert.ok(r.body.result.ok ? r.body.char.gold < gold : r.body.char.gold === gold);
  r = await call(token, { op: 'buy', args: { id: 'hp_potion_1', n: 1 }, rev: rev - 1, v: build });
  assert.strictEqual(r.body.error, 'stale');
  r = await act('remove', {});
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.char, null);
  console.log('create, buy, bad_args, stale, remove: ok');
})().catch((e) => { console.error(e); process.exit(1); });
