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

const fightLen = (w, ms) => w.advance(ms);
const closeAll = (...ss) => ss.forEach((x) => x.stop());

test('хозяин закрыл страницу: его герой AFK, расчёт переходит к другому, бой идёт до конца', () => {
  const w = makeWorld();
  const host = join(w, { host: true, uid: 'h', job: jobs[0], monster: tank(5) });
  const a = join(w, { uid: 'a', job: jobs[1] });
  const b = join(w, { uid: 'b', job: jobs[2] });
  w.advance(25000);
  const turnBefore = a.battle.turn;
  host.stop();                                   // закрыли страницу без «выхода»
  w.advance(60000);
  assert.ok(a.host || b.host, 'кто-то стал хозяином');
  assert.ok(a.battle.turn > turnBefore + 2, 'бой не остановился');
  assert.ok(!a.battle.playerByKey('h').left, 'герой хозяина остался в бою');
  assert.ok(a.battle.log.some((e) => /замешкал/.test(e.text) && /h/.test(e.text) || /замешкал/.test(e.text)), 'пропускает ходы');
  w.advance(900000);
  for (const s of [a, b]) assert.ok(s.battle.ended, 'бой закончился');
  sameBattle(a, b, 'a/b после смены хозяина');
});

test('хозяин вышел из боя: расчёт передаётся сразу', () => {
  const w = makeWorld();
  const host = join(w, { host: true, uid: 'h', job: jobs[0], monster: tank(30) });
  const a = join(w, { uid: 'a', job: jobs[1] });
  const b = join(w, { uid: 'b', job: jobs[2] });
  w.advance(25000);
  const t0 = a.battle.turn;
  host.leave();
  w.advance(20000);
  assert.ok(a.host || b.host);
  assert.ok(a.battle.playerByKey('h').left, 'вышедший убран из боя');
  assert.ok(a.battle.turn > t0, 'бой пошёл дальше');
  sameBattle(a, b, 'после выхода хозяина');
});

test('закрыли страницу и хозяин, и первый кандидат: берёт третий', () => {
  const w = makeWorld();
  const host = join(w, { host: true, uid: 'h', job: jobs[0], monster: tank(30) });
  const a = join(w, { uid: 'a', job: jobs[1] });
  const b = join(w, { uid: 'b', job: jobs[2] });
  const c = join(w, { uid: 'c', job: jobs[3] });
  w.advance(25000);
  closeAll(host, a);
  const t0 = b.battle.turn;
  w.advance(90000);
  assert.ok(b.host, 'b стал хозяином (следующий по порядку после a)');
  assert.ok(b.battle.turn > t0 + 3);
  sameBattle(b, c, 'b/c');
});

test('хозяин успел отправить ход только одному: новый хозяин догоняет, расхождения нет', () => {
  let n3 = false;
  const w = makeWorld({ drop: (m, uid) => { if (m.t === 'turn' && m.rec.n === 3 && uid === 'a') { n3 = true; w.setT(() => host.stop(), 60); return true; } return false; } });
  const host = join(w, { host: true, uid: 'h', job: jobs[0], monster: tank(30) });
  const a = join(w, { uid: 'a', job: jobs[1] });
  const b = join(w, { uid: 'b', job: jobs[2] });
  w.advance(60000);
  assert.ok(n3);
  assert.ok(a.host, 'a — первый кандидат');
  w.advance(50000);
  sameBattle(a, b, 'a/b: ход 3 не пропал и не пересчитан иначе');
  assert.ok(a.battle.turn >= 6);
});

test('разрыв связи у участника (ложная тревога): после восстановления хозяин один и все согласны', () => {
  let cut = false;
  const w = makeWorld({ drop: (m, uid) => cut && ((uid === 'a' && m.h === 'h') || (m.t === 'act' || m.t === 'hello') && m.uid === 'a' && uid === 'h') });
  const host = join(w, { host: true, uid: 'h', job: jobs[0], monster: tank(30) });
  const a = join(w, { uid: 'a', job: jobs[1] });
  const b = join(w, { uid: 'b', job: jobs[2] });
  w.advance(25000);
  cut = true;
  w.advance(30000);
  cut = false;
  w.advance(60000);
  const hosts = [host, a, b].filter((s) => s.host);
  assert.strictEqual(hosts.length, 1, `хозяин один, а их ${hosts.length}`);
  sameBattle(host, b, 'h/b');
  sameBattle(a, b, 'a/b');
});

test('AFK-участник остаётся в бою до конца и может вернуться', () => {
  const w = makeWorld();
  const host = join(w, { host: true, uid: 'h', job: jobs[0], monster: tank(30) });
  const a = join(w, { uid: 'a', job: jobs[1] });
  w.advance(25000);
  a.stop();                                         // закрыл страницу
  w.advance(100000);
  assert.ok(!host.battle.ended);
  assert.ok(!host.battle.playerByKey('a').left, 'остался в бою, а не выбыл');
  const a2 = join(w, { uid: 'a', job: jobs[1] });   // открыл заново
  w.advance(4000);
  sameBattle(host, a2, 'после возврата AFK');
  assert.strictEqual(host.battle.players.filter((f) => f.key === 'a').length, 1);
  w.advance(500000);
  sameBattle(host, a2, 'в конце');
});

test('вернувшийся прежний хозяин становится обычным участником', () => {
  const w = makeWorld();
  const host = join(w, { host: true, uid: 'h', job: jobs[0], monster: tank(30) });
  const a = join(w, { uid: 'a', job: jobs[1] });
  w.advance(25000);
  host.stop();
  w.advance(40000);
  assert.ok(a.host);
  const h2 = join(w, { uid: 'h', job: jobs[0] });   // страницу открыли заново: уже как участник
  w.advance(4000);
  assert.ok(!h2.host && h2.battle, 'синхронизировался как участник');
  sameBattle(a, h2, 'новый хозяин и вернувшийся');
  assert.strictEqual(a.battle.players.filter((f) => f.key === 'h').length, 1);
});

test('одиночный хозяин закрыл страницу, остался один участник: он доигрывает бой', () => {
  const w = makeWorld();
  const host = join(w, { host: true, uid: 'h', job: jobs[0], monster: tank(4) });
  const a = join(w, { uid: 'a', job: jobs[1] });
  w.advance(15000);
  host.stop();
  w.advance(500000);
  assert.ok(a.battle.ended && a.battle.monster.dead, 'монстр убит');
  assert.strictEqual(a.battle.winner, a.battle.player, 'победа участнику');
});

test('вступление видно сразу, а новичок пропускает текущий ход', () => {
  const w = makeWorld();
  const host = join(w, { host: true, uid: 'h', job: jobs[0], monster: tank() });
  const a = join(w, { uid: 'a', job: jobs[1] });
  w.advance(25000);                       // середина хода
  const turnNow = host.turn.n;
  const late = join(w, { uid: 'late', job: jobs[3] });
  w.advance(300);                         // чуть больше задержки сети: хода не прошло
  assert.strictEqual(host.turn.n, turnNow, 'ход ещё не сменился');
  for (const s of [host, a, late]) assert.ok(s.battle.players.some((f) => f.key === 'late'), 'новичок виден сразу');
  assert.ok(late.turn.joinWait && late.turn.acted, 'новичок в ожидании');
  assert.strictEqual(late.submit('basic'), false, 'в этом ходу действовать нельзя');
  const hp0 = host.battle.playerByKey('late').hp;
  w.advance(12000);                       // ход закончился
  assert.ok(host.battle.turn > turnNow, 'ход прошёл');
  const f = host.battle.playerByKey('late');
  assert.strictEqual(f.dealt, 0, 'в пропущенном ходу новичок не бил');
  assert.ok(!late.turn.joinWait, 'в следующем ходу уже действует');
  w.advance(22000);
  assert.ok(f.dealt > 0 || f.support > 0 || host.battle.turn > turnNow + 1, 'дальше участвует');
  sameBattle(host, a, 'host/a'); sameBattle(host, late, 'host/late');
});

test('награда делится по вкладу: больше импакта — больше доля', () => {
  const b = new PC.Battle({ players: [{ key: 'x', tpl: mkTpl('x', jobs[0]) }, { key: 'y', tpl: mkTpl('y', jobs[1]) }, { key: 'z', tpl: mkTpl('z', jobs[2]) }], monster: weakMonster(), seed: 3, data, localKey: 'x' });
  const [x, y, z] = b.players;
  x.dealt = 600; y.dealt = 300; z.dealt = 100;
  const r = [x, y, z].map((f) => b.rewardMult(f));
  assert.ok(r[0].mult > r[1].mult && r[1].mult > r[2].mult, 'порядок по вкладу');
  const sum = r.reduce((q, v) => q + v.mult, 0);
  assert.ok(Math.abs(sum - r[0].pool) < 1e-9, 'сумма = пул 1 + 0.6·(n−1)');
  assert.ok(Math.abs(r.reduce((q, v) => q + v.share, 0) - 1) < 1e-9, 'доли в сумме 1');
  z.dealt = 0; z.support = 400;
  assert.ok(b.rewardMult(z).share > 0.15, 'лечение и щиты тоже считаются');
});

console.log(`\nвсе тесты прошли: ${n}`);
