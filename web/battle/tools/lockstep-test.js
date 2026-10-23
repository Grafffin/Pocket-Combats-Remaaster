// Автотест общего боя: хозяин и несколько участников на подставной сети и поддельных часах.
// Запуск: node web/battle/tools/lockstep-test.js
const path = require('path');
const assert = require('assert');
const dir = path.join(__dirname, '..', 'js');
for (const f of ['data', 'classes', 'stats', 'items-data', 'monsters', 'world-data', 'engine', 'items', 'progression', 'lockstep']) require(path.join(dir, `${f}.js`));
const PC = globalThis.PC, data = PC.data;
const jobs = Object.keys(data.classes);

// ---- подставные часы и сеть ----
function makeWorld({ latency = 40, drop = null } = {}) {
  const w = { t: 1000000, timers: [], seq: 0, peers: new Map(), sent: [] };
  w.now = () => w.t;
  w.setT = (fn, ms) => { const id = ++w.seq; w.timers.push({ id, at: w.t + ms, fn, every: 0 }); return id; };
  w.setI = (fn, ms) => { const id = ++w.seq; w.timers.push({ id, at: w.t + ms, fn, every: ms }); return id; };
  w.clear = (id) => { w.timers = w.timers.filter((x) => x.id !== id); };
  w.advance = (ms) => {
    const end = w.t + ms;
    for (;;) {
      w.timers.sort((a, b) => a.at - b.at || a.id - b.id);
      const nx = w.timers[0];
      if (!nx || nx.at > end) break;
      w.t = nx.at;
      if (nx.every) nx.at += nx.every; else w.timers.shift();
      nx.fn();
    }
    w.t = end;
  };
  w.deliver = (from, msg) => {
    w.sent.push(msg);
    const copy = JSON.stringify(msg);
    for (const [uid, s] of w.peers) {
      if (uid === from) continue;
      if (drop && drop(msg, uid)) continue;
      w.setT(() => { if (w.peers.get(uid) === s) s.receive(JSON.parse(copy)); }, latency);
    }
  };
  return w;
}

const mkTpl = (nick, job) => PC.progression.toFighter(data, PC.progression.newCharacter(data, { nick, job }));
const weakMonster = () => PC.monsters.monsterAt(Object.keys(data.monsters)[0], 1, 0);
// живучий, но слабо бьющий монстр: бой длится много ходов
const tank = (mult = 60) => { const m = weakMonster(); m.stats = { ...m.stats, maxHp: m.stats.maxHp * mult }; return m; };

function join(w, { host = false, uid, job, monster, seed = 7, auto = true }) {
  const tpl = mkTpl(uid, job);
  const s = PC.lockstep.create({
    host, uid, tpl, monster, seed, data,
    send: (m) => w.deliver(uid, m),
    now: w.now, setT: w.setT, clearT: w.clear, setI: w.setI, clearI: w.clear,
    tickLeft: (now) => 10000 - (now % 10000),
  });
  s.events = [];
  s.on('end', () => s.events.push('end')).on('abort', (r) => s.events.push(`abort:${r}`));
  s.on('turn', () => {   // автобой: выбираем первое готовое умение в начале хода
    if (!auto) return;
    const b = s.battle, me = b && b.player;
    if (me && me.hp > 0) s.submit(b.autoAction(me));
  });
  w.peers.set(uid, s);
  s.start();
  return s;
}

const texts = (s) => s.battle.log.map((e) => e.text);
const sameBattle = (a, b, msg) => {
  assert.strictEqual(a.battle.monster.hp, b.battle.monster.hp, `${msg}: hp монстра`);
  assert.strictEqual(a.battle.monster.maxHp, b.battle.monster.maxHp, `${msg}: maxHp монстра`);
  assert.deepStrictEqual(texts(a), texts(b), `${msg}: лог`);
  assert.strictEqual(a.battle.turn, b.battle.turn, `${msg}: ход`);
  assert.deepStrictEqual(a.battle.players.map((f) => [f.key, f.hp, f.dealt]), b.battle.players.map((f) => [f.key, f.hp, f.dealt]), `${msg}: бойцы`);
};

let n = 0;
const test = (name, fn) => { fn(); n++; console.log('ok  ', name); };

test('хозяин и двое участников: один лог, одно здоровье, смерть монстра у всех', () => {
  const w = makeWorld();
  const host = join(w, { host: true, uid: 'h', job: jobs[0], monster: weakMonster() });
  const a = join(w, { uid: 'a', job: jobs[1] });
  w.advance(500);
  const b = join(w, { uid: 'b', job: jobs[2] });
  w.advance(200000);
  for (const s of [host, a, b]) assert.ok(s.battle.ended, 'бой закончился');
  assert.ok(host.battle.monster.dead, 'монстр пал');
  for (const s of [host, a, b]) assert.ok(s.events.includes('end'));
  sameBattle(host, a, 'host/a');
  sameBattle(host, b, 'host/b');
  assert.strictEqual(host.battle.players.length, 3);
  assert.ok(host.battle.log.some((e) => /вступает в бой/.test(e.text)), 'в логе есть вступление');
  const total = host.battle.players.reduce((s, f) => s + f.dealt, 0);
  assert.strictEqual(total, host.battle.totalDealt);
  for (const s of [host, a, b]) assert.strictEqual(s.battle.winner, s.battle.player, 'победа у каждого живого');
});

test('вступивший посреди боя получает всю историю', () => {
  const w = makeWorld();
  const strong = tank();
  const host = join(w, { host: true, uid: 'h', job: jobs[0], monster: strong });
  w.advance(45000);
  assert.ok(!host.battle.ended, 'бой ещё идёт');
  const late = join(w, { uid: 'late', job: jobs[3] });
  w.advance(12000);
  assert.ok(late.ready || late.battle, 'вступил');
  assert.ok(late.battle.players.some((f) => f.key === 'late'));
  assert.strictEqual(late.battle.log[0].text, host.battle.log[0].text, 'история с первого хода');
  assert.strictEqual(late.battle.monster.maxHp, host.battle.monster.maxHp, 'здоровье монстра выросло и у вступившего');
  assert.ok(late.battle.monster.maxHp > Math.round(strong.stats.maxHp), 'масштаб монстра');
  sameBattle(host, late, 'после вступления');
});

test('обновление страницы: участник возвращается и догоняет', () => {
  const w = makeWorld();
  const strong = tank();
  const host = join(w, { host: true, uid: 'h', job: jobs[0], monster: strong });
  const a = join(w, { uid: 'a', job: jobs[1] });
  w.advance(35000);
  assert.ok(a.battle.players.length === 2);
  a.stop();                                       // страницу закрыли
  w.advance(25000);                               // бой идёт без него
  const a2 = join(w, { uid: 'a', job: jobs[1] }); // страницу открыли заново
  w.advance(3000);
  sameBattle(host, a2, 'после возврата');
  assert.strictEqual(host.battle.players.filter((f) => f.key === 'a').length, 1, 'не задвоился');
  w.advance(200000);
  sameBattle(host, a2, 'в конце');
});

test('потерянный ход: участник сам запрашивает историю заново', () => {
  let dropped = false;
  const w = makeWorld({ drop: (m, uid) => { if (!dropped && uid === 'a' && m.t === 'turn' && m.rec.n === 3) { dropped = true; return true; } return false; } });
  const strong = tank();
  const host = join(w, { host: true, uid: 'h', job: jobs[0], monster: strong });
  const a = join(w, { uid: 'a', job: jobs[1] });
  w.advance(80000);
  assert.ok(dropped);
  sameBattle(host, a, 'после потери хода');
});

test('игрок погиб: бой идёт дальше у остальных, у всех одинаково', () => {
  const w = makeWorld();
  const strong = PC.monsters.monsterAt(Object.keys(data.monsters)[3], 14, 0);
  const host = join(w, { host: true, uid: 'h', job: jobs[0], monster: strong });
  const a = join(w, { uid: 'a', job: jobs[1] });
  const b = join(w, { uid: 'b', job: jobs[2] });
  w.advance(400000);
  for (const s of [host, a, b]) assert.ok(s.battle.ended);
  sameBattle(host, a, 'host/a');
  sameBattle(host, b, 'host/b');
  const deaths = host.battle.log.filter((e) => e.type === 'death').length;
  assert.ok(deaths >= 1, 'кто-то погиб');
});

test('выход участника: остальные продолжают, он убран из списка живых', () => {
  const w = makeWorld();
  const strong = tank();
  const host = join(w, { host: true, uid: 'h', job: jobs[0], monster: strong });
  const a = join(w, { uid: 'a', job: jobs[1] });
  const b = join(w, { uid: 'b', job: jobs[2] });
  w.advance(25000);
  a.leave();
  w.advance(15000);
  assert.ok(host.battle.playerByKey('a').left);
  assert.ok(!host.battle.alivePlayers().some((f) => f.key === 'a'));
  sameBattle(host, b, 'host/b после выхода a');
});

test('хозяин закрыл бой: остальные получают abort', () => {
  const w = makeWorld();
  const strong = tank();
  const host = join(w, { host: true, uid: 'h', job: jobs[0], monster: strong });
  const a = join(w, { uid: 'a', job: jobs[1] });
  w.advance(15000);
  host.leave();
  w.advance(500);
  assert.deepStrictEqual(a.events, ['abort:host_left']);
});

test('хозяин пропал без сообщения: через 30 секунд abort', () => {
  const w = makeWorld();
  const strong = tank();
  const host = join(w, { host: true, uid: 'h', job: jobs[0], monster: strong });
  const a = join(w, { uid: 'a', job: jobs[1] });
  w.advance(15000);
  host.stop();                  // страницу хозяина закрыли без «leave»
  w.advance(45000);
  assert.deepStrictEqual(a.events, ['abort:host_timeout']);
});

test('нет хозяина: вступающий получает abort:nohost', () => {
  const w = makeWorld();
  const a = join(w, { uid: 'a', job: jobs[1] });
  w.advance(40000);
  assert.deepStrictEqual(a.events, ['abort:nohost']);
});

test('11-й игрок не помещается', () => {
  const w = makeWorld();
  const strong = tank();
  const host = join(w, { host: true, uid: 'h', job: jobs[0], monster: strong });
  const peers = [];
  for (let i = 0; i < 10; i++) peers.push(join(w, { uid: `p${i}`, job: jobs[i % jobs.length] }));
  w.advance(12000);
  assert.strictEqual(host.battle.players.length, 10);
  assert.ok(peers.slice(0, 9).every((p) => p.battle && p.battle.players.length >= 2));
  assert.deepStrictEqual(peers[9].events, ['abort:full']);
  sameBattle(host, peers[0], '10 игроков');
});

test('молчун без действий выбывает через несколько ходов', () => {
  const w = makeWorld();
  const strong = tank();
  const host = join(w, { host: true, uid: 'h', job: jobs[0], monster: strong });
  const a = join(w, { uid: 'a', job: jobs[1], auto: false });
  w.advance(150000);
  const f = host.battle.playerByKey('a');
  assert.ok(f.left || f.hp <= 0, 'молчун убран или погиб');
});

test('зелье применяется у всех одинаково', () => {
  const w = makeWorld();
  const strong = tank();
  const host = join(w, { host: true, uid: 'h', job: jobs[0], monster: strong });
  const a = join(w, { uid: 'a', job: jobs[1] });
  w.advance(12000);
  // даём игроку зелье и пьём в следующем ходу
  for (const s of [host, a]) { const f = s.battle.playerByKey('a'); f.consumables.push({ id: Object.keys(data.consumables)[0], count: 2 }); }
  a.submitPotion(Object.keys(data.consumables)[0]);
  w.advance(30000);
  sameBattle(host, a, 'с зельем');
});

console.log(`\nвсе тесты прошли: ${n}`);
