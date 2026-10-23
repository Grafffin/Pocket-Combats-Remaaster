// Стресс-тест общего боя: 2–10 клиентов на подставной сети с задержками, перестановкой и потерей сообщений.
// Каждую секунду боя сравниваем всех клиентов между собой: общий лог, цель монстра, здоровье и ресурсы бойцов.
// Сценарии: вступление в разные ходы, бегство, закрытие страницы, возврат после обновления, смена хозяина,
// смерть игрока, смерть монстра, 10 игроков, всё вперемешку. Каждый сценарий — на нескольких случайных зёрнах.
// Запуск: node web/battle/tools/lockstep-stress.js [число зёрен, по умолчанию 12]
const path = require('path');
const dir = path.join(__dirname, '..', 'js');
for (const f of ['data', 'classes', 'stats', 'items-data', 'monsters', 'world-data', 'engine', 'items', 'progression', 'lockstep']) require(path.join(dir, `${f}.js`));
const PC = globalThis.PC, data = PC.data;
const jobs = Object.keys(data.classes);
const SEEDS = +process.argv[2] || 12;
const stat = { takeovers: 0, resyncs: 0, joins: 0 };

function rand(seed) {
  let s = seed >>> 0 || 1;
  const next = () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  return { next, int: (a, b) => a + Math.floor(next() * (b - a + 1)), chance: (p) => next() < p };
}

// Сеть: у каждой посылки своя задержка (сообщения обгоняют друг друга), часть теряется, клиента можно «отключить»
function makeWorld(r, { lat = [30, 400], drop = 0.02 } = {}) {
  const w = { t: 1000000, timers: [], seq: 0, peers: new Map(), off: new Set() };
  w.now = () => w.t;
  w.setT = (fn, ms) => { const id = ++w.seq; w.timers.push({ id, at: w.t + ms, fn, every: 0 }); return id; };
  w.setI = (fn, ms) => { const id = ++w.seq; w.timers.push({ id, at: w.t + ms, fn, every: ms }); return id; };
  w.clear = (id) => { w.timers = w.timers.filter((x) => x.id !== id); };
  w.advance = (ms, each) => {
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
    if (each) each();
  };
  w.deliver = (from, msg) => {
    if (w.off.has(from)) return;
    const copy = JSON.stringify(msg);
    for (const [uid, s] of w.peers) {
      if (uid === from || w.off.has(uid) || r.chance(drop)) continue;
      w.setT(() => { if (w.peers.get(uid) === s && !w.off.has(uid)) s.receive(JSON.parse(copy)); }, r.int(lat[0], lat[1]));
    }
  };
  return w;
}

const tpls = {};
const tplOf = (uid, job) => tpls[uid] || (tpls[uid] = PC.progression.toFighter(data, PC.progression.newCharacter(data, { nick: uid, job })));
const monster = (idx, lvl, mult) => { const m = PC.monsters.monsterAt(Object.keys(data.monsters)[idx], lvl, 0); m.stats = { ...m.stats, maxHp: Math.round(m.stats.maxHp * mult) }; return m; };

// Клиент: страница игрока. Автобой жмёт умение в случайный момент хода (или не успевает), иногда пьёт зелье.
function client(w, r, { host = false, uid, job, mob, seed }) {
  const s = PC.lockstep.create({
    host, uid, tpl: JSON.parse(JSON.stringify(tplOf(uid, job))), monster: mob, seed, data,
    send: (m) => w.deliver(uid, m), now: w.now, setT: w.setT, clearT: w.clear, setI: w.setI, clearI: w.clear,
  });
  s.uid = uid; s.events = [];
  s.on('host', () => stat.takeovers++).on('reset', () => stat.resyncs++).on('ready', () => stat.joins++);
  s.on('end', () => s.events.push('end')).on('abort', (x) => s.events.push(`abort:${x}`)).on('desync', (n) => s.events.push(`desync:${n}`));
  s.on('turn', (t) => {
    if (r.chance(0.15)) return;   // не успел
    w.setT(() => {
      if (s.stopped || !s.turn || s.turn.n !== t.n) return;
      const b = s.battle, me = b && b.player;
      if (me && me.hp > 0) s.submit(b.autoAction(me));
    }, r.int(100, 9000));
  });
  w.peers.set(uid, s);
  s.start();
  return s;
}

// Сравнение двух клиентов: общий префикс лога одинаков (текст, цель монстра, снимок бойцов);
// если оба на одном и том же месте лога — совпадает и полный отпечаток боя
const seen = new WeakMap();   // уже сверенная часть лога для пары боёв
function compare(a, b) {
  const la = a.battle.log, lb = b.battle.log;
  const n = Math.min(la.length, lb.length);
  if (!seen.has(a.battle)) seen.set(a.battle, new WeakMap());
  const from = seen.get(a.battle).get(b.battle) || 0;
  seen.get(a.battle).set(b.battle, n);
  for (let i = from; i < n; i++) {
    const x = la[i], y = lb[i];
    if (x.text !== y.text) return `лог #${i}: «${x.text}» ≠ «${y.text}»`;
    if (JSON.stringify(x.snap) !== JSON.stringify(y.snap)) return `снимок #${i} («${x.text}»)`;
  }
  if (la.length === lb.length && a.battle.turn === b.battle.turn && PC.lockstep.checksum(a.battle) !== PC.lockstep.checksum(b.battle)) return 'отпечаток боя';
  return null;
}

// Живые, вошедшие в бой клиенты; «вышедшие» и закрытые страницы не сравниваем
const live = (w) => [...w.peers.values()].filter((s) => s.ready && s.battle && !s.stopped && !s.aborted && !w.off.has(s.uid));

function run(name, seed, script) {
  const r = rand(seed * 7919 + name.length);
  const w = makeWorld(r, script.net);
  const errors = [];
  let checks = 0;
  const check = () => {
    const ls = live(w);
    for (let i = 0; i < ls.length; i++) for (let j = i + 1; j < ls.length; j++) {
      checks++;
      const e = compare(ls[i], ls[j]);
      if (e && errors.length < 3) errors.push(`${(w.t - 1000000) / 1000}с ${ls[i].uid}/${ls[j].uid}: ${e}`);
    }
  };
  const ctx = {
    w, r,
    join: (uid, opt = {}) => client(w, r, { uid, job: jobs[(uid.charCodeAt(uid.length - 1) + seed) % jobs.length], ...opt }),
    wait: (ms) => { for (let t = 0; t < ms; t += 1000) w.advance(Math.min(1000, ms - t), check); },
    fail: (msg) => errors.push(msg),
  };
  script.body(ctx);
  // в конце: бой у всех доигран (или ещё идёт у всех одинаково), хозяин не больше одного
  const ls = live(w);
  const hosts = ls.filter((s) => s.host && !s.ended);
  if (hosts.length > 1) errors.push(`хозяев ${hosts.length}: ${hosts.map((s) => s.uid)}`);
  if (script.ends && ls.some((s) => !s.ended)) errors.push(`бой не закончился у ${ls.filter((s) => !s.ended).map((s) => s.uid)}`);
  for (const s of ls) if (s.events.some((e) => e.startsWith('desync') || e === 'abort:desync')) errors.push(`${s.uid}: расхождение с хозяином (${s.events.filter((e) => /desync/.test(e))})`);
  if (script.after) script.after(ctx, ls);
  return { errors, checks };
}

const scenarios = {
  'вступление в разные ходы (4 клиента)': {
    ends: true,
    body: ({ join, wait, r }) => {
      join('h', { host: true, mob: monster(1, 4, 6), seed: r.int(1, 1e9) });
      wait(r.int(0, 9000)); join('a');
      wait(r.int(5000, 25000)); join('b');
      wait(r.int(1000, 30000)); join('c');
      wait(900000);
    },
  },
  'бегство посреди боя': {
    ends: true,
    body: ({ join, wait, r, w }) => {
      join('h', { host: true, mob: monster(1, 4, 8), seed: r.int(1, 1e9) });
      const a = join('a'), b = join('b');
      join('c');
      wait(r.int(12000, 40000)); a.leave();
      wait(r.int(5000, 30000)); b.leave();
      wait(900000);
      const h = w.peers.get('h');
      if (!h.battle.playerByKey('a').left || !h.battle.playerByKey('b').left) throw new Error('сбежавшие остались в бою');
    },
  },
  'закрытие страницы и возврат после обновления': {
    ends: true,
    body: ({ join, wait, r, w }) => {
      join('h', { host: true, mob: monster(1, 4, 10), seed: r.int(1, 1e9) });
      const a = join('a');
      join('b');
      wait(r.int(15000, 35000));
      a.stop();                                  // закрыл вкладку
      wait(r.int(3000, 40000));
      join('a');                                 // открыл заново: тот же игрок
      wait(900000);
      if (w.peers.get('h').battle.players.filter((f) => f.key === 'a').length !== 1) throw new Error('игрок задвоился');
    },
  },
  'смена хозяина: закрыл страницу, затем вернулся': {
    ends: true,
    body: ({ join, wait, r }) => {
      const h = join('h', { host: true, mob: monster(1, 4, 8), seed: r.int(1, 1e9) });
      join('a'); join('b'); join('c');
      wait(r.int(12000, 40000));
      h.stop();
      wait(r.int(20000, 60000));
      join('h');                                 // прежний хозяин вернулся участником
      wait(900000);
    },
  },
  'хозяин сбежал, следом закрыл страницу новый хозяин': {
    ends: true,
    body: ({ join, wait, r, w }) => {
      const h = join('h', { host: true, mob: monster(1, 4, 8), seed: r.int(1, 1e9) });
      join('a'); join('b'); join('c');
      wait(r.int(12000, 30000));
      h.leave();
      wait(r.int(8000, 20000));
      const nh = live(w).find((s) => s.host);
      if (nh) nh.stop();
      wait(900000);
    },
  },
  'смерть игроков от сильного монстра': {
    ends: true,
    body: ({ join, wait, r }) => {
      join('h', { host: true, mob: monster(3, 14, 1), seed: r.int(1, 1e9) });
      join('a'); wait(r.int(0, 15000)); join('b');
      wait(900000);
    },
    after: ({ fail }, ls) => { if (ls[0] && !ls[0].battle.players.some((f) => f.hp <= 0)) fail('никто не погиб — сценарий не проверил смерть'); },
  },
  'смерть монстра и награда': {
    ends: true,
    body: ({ join, wait, r }) => {
      join('h', { host: true, mob: monster(0, 1, 2), seed: r.int(1, 1e9) });
      join('a'); join('b');
      wait(400000);
    },
    after: ({ fail }, ls) => {
      for (const s of ls) if (!s.battle.monster.dead) fail(`${s.uid}: монстр жив`);
      const sums = ls.map((s) => s.battle.players.map((f) => s.battle.rewardMult(f).mult.toFixed(6)).join());
      if (new Set(sums).size > 1) fail('награды посчитаны по-разному');
    },
  },
  '10 игроков, потери 5%': {
    net: { lat: [20, 700], drop: 0.05 },
    ends: true,
    body: ({ join, wait, r }) => {
      join('h', { host: true, mob: monster(1, 4, 4), seed: r.int(1, 1e9) });
      for (let i = 0; i < 9; i++) { wait(r.int(0, 4000)); join(`p${i}`); }
      wait(1200000);
    },
    after: ({ fail }, ls) => { if (ls.length && ls[0].battle.players.length !== 10) fail(`в бою ${ls[0].battle.players.length} игроков`); },
  },
  'всё вперемешку (плохая сеть)': {
    net: { lat: [10, 1500], drop: 0.08 },
    body: ({ join, wait, r, w }) => {
      join('h', { host: true, mob: monster(1, 4, 12), seed: r.int(1, 1e9) });
      const names = ['a', 'b', 'c', 'd', 'e'];
      for (let step = 0; step < 40; step++) {
        wait(r.int(1000, 8000));
        const uid = names[r.int(0, names.length - 1)];
        const s = w.peers.get(uid);
        const x = r.next();
        if (!s || s.stopped) { if (x < 0.5) join(uid); }
        else if (x < 0.1) s.leave();
        else if (x < 0.3) s.stop();
        else if (x < 0.4) { w.off.add(uid); w.setT(() => w.off.delete(uid), r.int(2000, 25000)); }   // пропала связь
      }
      for (const h of live(w).filter((s) => s.host)) if (r.chance(0.5)) h.stop();
      wait(120000);
    },
  },
};

let failed = 0, total = 0, checks = 0;
for (const [name, sc] of Object.entries(scenarios)) {
  const bad = [];
  for (let seed = 1; seed <= SEEDS; seed++) {
    total++;
    let res;
    try { res = run(name, seed, sc); } catch (e) { res = { errors: [String(e && e.stack || e)], checks: 0 }; }
    checks += res.checks;
    if (res.errors.length) { failed++; bad.push(`  зерно ${seed}: ${res.errors.join('\n    ')}`); }
  }
  console.log(`${bad.length ? 'FAIL' : 'ok  '} ${name}`);
  for (const b of bad.slice(0, 4)) console.log(b);
}
console.log(`\n${total - failed}/${total} прогонов без расхождений, сравнений клиентов: ${checks}`);
console.log(`вступлений: ${stat.joins}, смен хозяина: ${stat.takeovers}, повторных загрузок истории: ${stat.resyncs}`);
if (failed) process.exit(1);
