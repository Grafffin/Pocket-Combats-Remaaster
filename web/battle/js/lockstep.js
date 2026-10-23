// Общий бой: один источник правды — хозяин боя. Бой детерминирован (PC.Battle + seed), поэтому у каждого участника
// своя копия боя, которая получает от хозяина только список действий за ход и получается идентичной у всех:
// одно здоровье монстра, один лог, одна смерть. Без DOM и без сети: транспорт (broadcast) подставляется снаружи.
//
// Бой не зависит от одной страницы. Закрыл страницу любой участник, в том числе хозяин, — его герой остаётся в бою и
// просто пропускает ходы (AFK) до конца боя. Хозяин замолчал — расчёт берёт на себя следующий участник по порядку
// вступления (миграция хозяина): у всех есть полная история боя, а эпоха (ep) отсекает сообщения прежнего хозяина.
//
// Сообщения (все в один канал боя, объекты). Сообщения хозяина несут ep (эпоха) и h (кто хозяин):
//   хозяин → все:   { t:'ts', n, left }                  начался ход n, до его конца left мс
//                   { t:'turn', rec, next:{ left }|null } итог хода: rec = { n, joins, leaves, pots, actions }
//                   { t:'sync', to, hist, cur }            вся история для вступившего, вернувшегося или отставшего
//                   { t:'host', n }                        я новый хозяин, жду ход n
//                   { t:'resign' }                         хозяин вышел из боя, пусть выберут нового
//                   { t:'full', to, why? }                 мест нет, вернуться нельзя или why:'version' — другая версия игры
//                   { t:'hb', n }                          «я жив, идёт ход n» каждые HEARTBEAT мс: одна потерянная посылка не вызывает смену хозяина
// Версия игры (v) едет в hello и sync: клиенты с разным кодом боя считают по-разному, поэтому в один бой их не пускаем.
// Каждый turn и sync несёт cs — отпечаток состояния боя у хозяина; не совпал у участника — он берёт историю заново.
//   участник → хозяин: { t:'hello', uid, tpl, v }  хочу в бой / догнать;  { t:'act', n, uid, skill, pot };
//                      { t:'catchup', to, recs } ходы, которых не хватает новому хозяину
//   любой → все:       { t:'leave', uid }                 я выхожу из боя (герой уходит, а не стоит AFK)
(function (root) {
  'use strict';
  const PC = root.PC || (root.PC = {});

  const MAX_PLAYERS = 10;
  const HOST_SILENCE = 15000;   // хозяин молчит дольше — выбираем нового
  const TAKEOVER_STEP = 5000;   // каждый следующий кандидат ждёт ещё столько (на случай, что предыдущий тоже закрыл страницу)
  const CATCHUP_WAIT = 1500;    // новый хозяин ждёт ходы, которые видел кто-то из остальных, но не он
  const HEARTBEAT = 3000;       // хозяин подаёт голос между ходами
  const MAX_DESYNC = 3;         // столько раз подряд не сошёлся отпечаток после новой истории — бой обрываем

  // Отпечаток состояния боя: ход, длина лога, генератор случайностей, здоровье и ресурсы всех бойцов
  function checksum(b) {
    let str = `${b.turn}|${b.log.length}|${b.rng.state ? b.rng.state() : ''}|${b.ended ? 1 : 0}|${b.tank ? b.tank.id : ''}`;
    for (const f of b.fighters) str += `|${f.id}:${f.key || ''}:${Math.round(f.hp)}:${f.maxHp}:${Math.round(f.res || 0)}:${Math.round(f.dealt || 0)}:${f.left ? 1 : 0}:${f.effects.length}`;
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
    return (h >>> 0).toString(36);
  }

  const defaults = {
    now: () => Date.now(),
    setT: (fn, ms) => setTimeout(fn, ms),
    clearT: (id) => clearTimeout(id),
    setI: (fn, ms) => setInterval(fn, ms),
    clearI: (id) => clearInterval(id),
    TICK: 10000,
    grace: 700,
    tickLeft: (now) => 10000 - (now % 10000),
  };

  // o: { host, uid, tpl, monster (только хозяин), seed (только хозяин), data, send(msg), version } + необязательно часы для тестов
  function create(o) {
    const k = { ...defaults, version: PC.BUILD || 'dev', ...o };
    const S = { host: !!k.host, uid: k.uid, battle: null, turn: null, ready: false, ended: false, aborted: null, stopped: false, epoch: 0, hostUid: k.host ? k.uid : null };
    const subs = {};
    const emit = (ev, arg) => { for (const fn of subs[ev] || []) fn(arg); };
    S.on = (ev, fn) => { (subs[ev] = subs[ev] || []).push(fn); return S; };

    let timer = null, helloTimer = null, watch = null, catchTimer = null, beat = null, lastHeard = k.now();
    let desyncs = 0;                        // отпечаток не сошёлся подряд
    const buffer = new Map();               // пришедшие вперёд ходы
    let lastResync = 0;
    const knownLeaves = new Set();          // кто сказал, что выходит (нужно, если хозяин успел сказать это только остальным)
    let hist = null;                        // у всех: seed, монстр, первый состав и все ходы — по ним можно восстановить бой
    let joinBuf = [];                       // «вступил» для ходов, до которых мы ещё не дошли
    let pend = null, pj = [], pl = [], waiters = new Set(), waiting = false;

    const expected = () => hist.turns.length + 1;
    const hsend = (m) => k.send({ ...m, ep: S.epoch, h: k.uid });
    const nextLeft = () => {
      let left = k.tickLeft(k.now());
      if (left < 4000) left += k.TICK;
      return left;
    };
    const clearAll = () => { k.clearT(timer); k.clearT(catchTimer); k.clearI(helloTimer); k.clearI(watch); k.clearI(beat); };
    const resync = () => { if (k.now() - lastResync > 1500) { lastResync = k.now(); sendHello(); } };

    function setTurn(n, left, carry) {
      S.turn = { n, start: k.now(), end: k.now() + left, acted: !!(carry && carry.acted), potted: !!(carry && carry.potted), joinWait: !!(carry && carry.joinWait), skill: carry && carry.skill, pot: carry && carry.pot };
      emit('turn', S.turn);
    }

    function finish() {
      if (S.ended) return;
      S.ended = true;
      clearAll();
      emit('end', S.battle);
    }

    // ---------------- расчёт хода (хозяин) ----------------

    function beginTurn(n, left, announce, carry) {
      pend = { actions: {}, pots: {} };
      if (carry && carry.acted) pend.actions[k.uid] = carry.skill;
      if (carry && carry.potted) pend.pots[k.uid] = carry.pot;
      setTurn(n, left, carry);
      if (announce) hsend({ t: 'ts', n, left });
      k.clearT(timer);
      timer = k.setT(resolve, left + k.grace);
    }

    function resolve() {
      if (S.stopped || S.ended || !S.host) return;
      const n = S.turn.n, b = S.battle;
      const rec = { n, joins: pj, leaves: pl, pots: pend.pots, actions: pend.actions };
      pj = []; pl = [];
      hist.turns.push(rec);
      b.applyTurn(rec);
      emit('update', rec);
      const cs = checksum(b);
      if (b.ended) {
        hsend({ t: 'turn', rec, next: null, cs });
        for (const uid of waiters) hsend({ t: 'full', to: uid });
        waiters.clear();
        return finish();
      }
      const left = nextLeft();
      hsend({ t: 'turn', rec, next: { left }, cs });
      beginTurn(n + 1, left, false);
      for (const uid of waiters) sendSync(uid);
      waiters.clear();
    }

    // Вступление видно сразу: боец появляется в бою между ходами, но в текущем ходу не действует (с хода n он «ждёт»)
    function admit(j) {
      if (S.battle.playerByKey(j.key)) return;
      S.battle.addPlayer(j.tpl, j.key);
      hsend({ t: 'join', n: S.turn.n, key: j.key, tpl: j.tpl });
      emit('update', { n: S.turn.n, join: j.key });
    }

    function sendSync(uid) {
      hsend({ t: 'sync', to: uid, hist, pj: pj.slice(), cur: { n: S.turn.n, left: Math.max(0, S.turn.end - k.now()) }, v: k.version, cs: checksum(S.battle) });
    }

    function hostReceive(m) {
      const b = S.battle;
      if (m.t === 'act') {
        if (waiting || !S.turn || m.n !== S.turn.n || !b.playerByKey(m.uid)) return;
        if (m.skill != null) pend.actions[m.uid] = m.skill;
        if (m.pot) pend.pots[m.uid] = m.pot;
      } else if (m.t === 'hello') {
        if (m.v !== k.version) return hsend({ t: 'full', to: m.uid, why: 'version' });
        const f = b.playerByKey(m.uid);
        if (f) { if (f.left) hsend({ t: 'full', to: m.uid }); else if (!waiting) sendSync(m.uid); else waiters.add(m.uid); return; }
        if (pj.some((j) => j.key === m.uid)) { if (waiting) waiters.add(m.uid); else sendSync(m.uid); return; }
        if (b.ended || b.players.length + pj.filter((j) => !b.playerByKey(j.key)).length >= MAX_PLAYERS) return hsend({ t: 'full', to: m.uid });
        const j = { key: m.uid, tpl: m.tpl };
        pj.push(j);
        if (waiting) return void waiters.add(m.uid);   // новый хозяин ещё собирает ходы: впустим, когда начнёт ход
        admit(j);
        sendSync(m.uid);
      } else if (m.t === 'leave') {
        if (b.playerByKey(m.uid) && !pl.includes(m.uid)) pl.push(m.uid);
      } else if (m.t === 'catchup' && waiting) {
        applyCatchup(m.recs);
      }
    }

    // ---------------- участник ----------------

    function sendHello() { k.send({ t: 'hello', uid: k.uid, tpl: k.tpl, v: k.version }); }

    function applyRec(rec) {
      S.battle.applyTurn(rec);
      hist.turns.push(rec);
      emit('update', rec);
    }

    function drain() {
      while (buffer.has(expected()) && !S.ended) {
        const m = buffer.get(expected());
        buffer.delete(expected());
        applyRec(m.rec);
        if (m.cs && m.cs !== checksum(S.battle)) {   // мой бой разошёлся с боем хозяина: дальше не считаем, берём историю заново
          emit('desync', m.rec.n);
          buffer.clear();
          if (++desyncs > MAX_DESYNC) return abort('desync');
          lastResync = 0;
          return resync();
        }
        if (m.cs) desyncs = 0;
        if (S.battle.ended) return finish();
        if (m.next) setTurn(m.rec.n + 1, m.next.left);
        for (const j of joinBuf.filter((x) => x.n === expected())) if (!S.battle.playerByKey(j.key)) S.battle.addPlayer(j.tpl, j.key);
        joinBuf = joinBuf.filter((x) => x.n > expected());
      }
    }

    const rosterIndex = (uid) => S.battle.players.findIndex((f) => f.key === uid);

    // Хозяин потерял роль: мой бой мог разойтись с настоящим, поэтому берём историю заново
    function demote() {
      S.host = false;
      pend = null; pj = []; pl = []; waiters.clear(); waiting = false;
      k.clearT(timer); k.clearT(catchTimer);
      lastHeard = k.now();
      sendHello();
    }

    // Сообщение хозяина допускается, если его эпоха не старая. Новая эпоха (или хозяин, вступивший раньше при равной) снимает роль с меня.
    function gate(m) {
      if (m.ep < S.epoch) return false;
      if (m.ep > S.epoch) { S.epoch = m.ep; S.hostUid = m.h; if (S.host) demote(); lastHeard = k.now(); return true; }
      if (S.hostUid == null || m.h === S.hostUid) { S.hostUid = m.h; lastHeard = k.now(); return true; }
      const mine = S.host ? k.uid : S.hostUid;
      if (S.battle && rosterIndex(m.h) >= 0 && rosterIndex(m.h) < rosterIndex(mine)) { S.hostUid = m.h; if (S.host) demote(); lastHeard = k.now(); return true; }
      return false;
    }

    function peerReceive(m) {
      if (m.t === 'sync') {
        if (m.v !== k.version) return abort('version');
        buffer.clear();
        S.battle = new PC.Battle({ players: m.hist.roster, monster: m.hist.monster, seed: m.hist.seed, data: k.data, localKey: k.uid });
        hist = { seed: m.hist.seed, monster: m.hist.monster, roster: m.hist.roster, turns: [] };
        for (const rec of m.hist.turns) { S.battle.applyTurn(rec); hist.turns.push(rec); }
        for (const j of m.pj || []) S.battle.addPlayer(j.tpl, j.key);
        joinBuf = [];
        const first = !S.ready;
        S.ready = true;
        k.clearI(helloTimer);
        if (m.cs && m.cs !== checksum(S.battle)) { emit('desync', expected() - 1); if (++desyncs > MAX_DESYNC) return abort('desync'); }
        if (S.battle.ended) { emit(first ? 'ready' : 'reset', S.battle); return finish(); }
        const waitJoin = (m.pj || []).some((j) => j.key === k.uid) && !hist.turns.some((r) => (r.joins || []).some((j) => j.key === k.uid));
        setTurn(expected(), m.cur.left, waitJoin ? { acted: true, joinWait: true } : null);
        emit(first ? 'ready' : 'reset', S.battle);
      } else if (m.t === 'full') {
        abort(m.why === 'version' ? 'version' : 'full');
      } else if (!S.ready) {
        // ждём sync
      } else if (m.t === 'ts') {
        if (m.n === expected()) setTurn(m.n, m.left);
        else if (m.n > expected()) resync();
      } else if (m.t === 'hb') {
        if (m.n > expected() && !buffer.has(expected())) resync();   // ход потерялся по дороге
      } else if (m.t === 'join') {
        if (m.n === expected()) { if (!S.battle.playerByKey(m.key)) { S.battle.addPlayer(m.tpl, m.key); emit('update', { n: m.n, join: m.key }); } }
        else if (m.n > expected()) joinBuf.push(m);
      } else if (m.t === 'turn') {
        if (m.rec.n < expected()) return;
        buffer.set(m.rec.n, m);
        if (m.rec.n > expected()) resync();   // потеряли ход: просим историю заново
        drain();
      } else if (m.t === 'host') {
        // новый хозяин ждёт ход m.n: если мы видели больше, отдаём недостающее; своё действие в этом ходу присылаем заново
        if (hist.turns.length >= m.n) k.send({ t: 'catchup', to: m.h, recs: hist.turns.slice(m.n - 1) });
        if (S.turn && S.turn.acted && S.turn.n === m.n) k.send({ t: 'act', n: S.turn.n, uid: k.uid, skill: S.turn.skill, pot: S.turn.pot });
      } else if (m.t === 'resign') {
        lastHeard = k.now() - HOST_SILENCE;   // хозяин вышел: выборы начинаются сразу
      }
    }

    // Следующий по порядку вступления кандидат (кроме прежнего хозяина и вышедших) берёт расчёт на себя
    function checkHost() {
      if (S.host || !S.ready || S.ended || S.stopped) return;
      const cand = S.battle.players.filter((f) => !f.left && f.key !== S.hostUid).map((f) => f.key);
      const rank = cand.indexOf(k.uid);
      if (rank < 0) return;
      if (k.now() - lastHeard > HOST_SILENCE + rank * TAKEOVER_STEP) takeover();
    }

    function takeover() {
      S.epoch++;
      S.host = true;
      S.hostUid = k.uid;
      pend = { actions: {}, pots: {} }; waiters = new Set(); buffer.clear();
      const recorded = new Set(hist.roster.map((j) => j.key));
      for (const r of hist.turns) for (const j of r.joins || []) recorded.add(j.key);
      pj = S.battle.players.filter((f) => !recorded.has(f.key)).map((f) => ({ key: f.key, tpl: f.tpl }));   // вступили, но хозяин не успел записать
      pl = [...knownLeaves].filter((key) => { const f = S.battle.playerByKey(key); return f && !f.left; });
      waiting = true;
      const carry = S.turn && S.turn.n === expected() ? S.turn : null;
      hsend({ t: 'host', n: expected() });
      emit('host', S.epoch);
      // даём остальным время прислать ходы, которых нам не хватает, и свои действия за текущий ход
      catchTimer = k.setT(() => {
        waiting = false;
        if (S.stopped || S.ended) return;
        beginTurn(expected(), nextLeft(), true, carry);
        for (const j of pj) admit(j);
        for (const uid of waiters) sendSync(uid);
        waiters.clear();
      }, CATCHUP_WAIT);
    }

    function applyCatchup(recs) {
      for (const rec of recs || []) {
        if (rec.n !== expected()) continue;
        applyRec(rec);
        hsend({ t: 'turn', rec, next: null });
        if (S.battle.ended) { waiting = false; k.clearT(catchTimer); return finish(); }
      }
    }

    function abort(reason) {
      if (S.ended || S.aborted) return;
      S.aborted = reason;
      clearAll();
      emit('abort', reason);
    }

    // ---------------- общее ----------------

    function heartbeat() {
      if (S.host && !waiting && !S.stopped && !S.ended && S.turn) hsend({ t: 'hb', n: S.turn.n });
    }

    S.start = function () {
      if (S.host) {
        S.battle = new PC.Battle({ players: [{ key: k.uid, tpl: k.tpl }], monster: k.monster, seed: k.seed, data: k.data, localKey: k.uid });
        hist = { seed: k.seed, monster: k.monster, roster: [{ key: k.uid, tpl: k.tpl }], turns: [] };
        S.ready = true;
        emit('ready', S.battle);
        let left = k.tickLeft(k.now());
        if (left < 5000) left += k.TICK;
        beginTurn(1, left, true);
        watch = k.setI(checkHost, 1000);   // после возврата роли можно снова стать участником
        beat = k.setI(heartbeat, HEARTBEAT);
        return S;
      }
      let tries = 0;
      sendHello();
      helloTimer = k.setI(() => { if (S.ready) return; if (++tries > 28) return abort('nohost'); sendHello(); }, 1000);
      watch = k.setI(checkHost, 1000);
      beat = k.setI(heartbeat, HEARTBEAT);
      return S;
    };

    S.receive = function (m) {
      if (S.stopped || !m) return;
      if (m.to && m.to !== k.uid) return;
      if (m.t === 'leave') { knownLeaves.add(m.uid); if (S.host) hostReceive(m); return; }
      if (m.ep != null) { if (m.h !== k.uid && gate(m)) peerReceive(m); return; }   // от хозяина
      if (S.host) hostReceive(m);                                                      // от участника: hello, act, catchup
    };

    // Моё действие в текущем ходу (умение) и зелье; повторно в том же ходу нельзя
    S.submit = function (skill) {
      const t = S.turn, me = S.battle && S.battle.player;
      if (!t || t.acted || S.ended || !me || me.hp <= 0) return false;
      t.acted = true; t.skill = skill;
      if (S.host) pend.actions[k.uid] = skill; else k.send({ t: 'act', n: t.n, uid: k.uid, skill });
      return true;
    };
    S.submitPotion = function (id) {
      const t = S.turn, me = S.battle && S.battle.player;
      if (!t || t.potted || S.ended || !me || me.hp <= 0 || !S.battle.canUseConsumable(me)) return false;
      t.potted = true; t.pot = id;
      if (S.host) pend.pots[k.uid] = id; else k.send({ t: 'act', n: t.n, uid: k.uid, pot: id });
      return true;
    };

    // Выйти из боя (герой уходит). Закрыть страницу — не выход: герой остаётся в бою AFK. Хозяин при выходе передаёт расчёт другим.
    S.leave = function () {
      if (S.stopped) return;
      k.send({ t: 'leave', uid: k.uid });
      if (S.host && !S.ended) hsend({ t: 'resign' });
      S.stop();
    };
    S.stop = function () {
      S.stopped = true;
      clearAll();
    };
    S.maxPlayers = MAX_PLAYERS;
    return S;
  }

  PC.lockstep = { create, checksum, MAX_PLAYERS, HOST_SILENCE, TAKEOVER_STEP };
  if (typeof module !== 'undefined') module.exports = PC;
})(typeof window !== 'undefined' ? window : globalThis);
