// Общий бой: один источник правды — хозяин боя. Бой детерминирован (PC.Battle + seed), поэтому у каждого участника
// своя копия боя, которая получает от хозяина только список действий за ход и получается идентичной у всех:
// одно здоровье монстра, один лог, одна смерть. Без DOM и без сети: транспорт (broadcast) подставляется снаружи.
//
// Сообщения (все в один канал боя, объекты):
//   хозяин → все:   { t:'ts', n, left }                  начался ход n, до его конца left мс
//                   { t:'turn', rec, next:{ left }|null } итог хода: rec = { n, joins, leaves, pots, actions }
//                   { t:'sync', to, hist, cur }            вся история для вступившего или вернувшегося
//                   { t:'abort', reason }                  хозяин закрыл бой
//                   { t:'full', to }                       мест нет или вернуться нельзя
//   участник → хозяин: { t:'hello', uid, tpl }  хочу в бой / догнать;  { t:'act', n, uid, skill, pot };  { t:'leave', uid }
(function (root) {
  'use strict';
  const PC = root.PC || (root.PC = {});

  const MAX_PLAYERS = 10;
  const IDLE_KICK = 6;          // участник без действий столько ходов подряд считается ушедшим
  const HOST_SILENCE = 30000;   // хозяин молчит дольше — бой считаем брошенным

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

  // o: { host, uid, tpl, monster (только хозяин), seed (только хозяин), data, send(msg) } + необязательно часы для тестов
  function create(o) {
    const k = { ...defaults, ...o };
    const S = { host: !!k.host, uid: k.uid, battle: null, turn: null, ready: false, ended: false, aborted: null, stopped: false };
    const subs = {};
    const emit = (ev, arg) => { for (const fn of subs[ev] || []) fn(arg); };
    S.on = (ev, fn) => { (subs[ev] = subs[ev] || []).push(fn); return S; };

    let timer = null, helloTimer = null, watch = null, lastHeard = k.now();
    let expected = 1;                       // участник: номер хода, который ждём
    const buffer = new Map();               // участник: пришедшие вперёд ходы
    let lastResync = 0;
    // хозяин
    let hist = null, pend = null, pj = [], pl = [], waiters = new Set(), idle = {};

    const nextLeft = () => {
      let left = k.tickLeft(k.now());
      if (left < 4000) left += k.TICK;
      return left;
    };

    function setTurn(n, left) {
      S.turn = { n, start: k.now(), end: k.now() + left, acted: false, potted: false };
      emit('turn', S.turn);
    }

    function finish() {
      if (S.ended) return;
      S.ended = true;
      k.clearT(timer); k.clearI(helloTimer); k.clearI(watch);
      emit('end', S.battle);
    }

    // ---------------- хозяин ----------------

    function beginTurn(n, left, announce) {
      pend = { actions: {}, pots: {} };
      setTurn(n, left);
      if (announce) k.send({ t: 'ts', n, left });
      k.clearT(timer);
      timer = k.setT(resolve, left + k.grace);
    }

    function resolve() {
      if (S.stopped || S.ended) return;
      const n = S.turn.n, b = S.battle;
      // молчуны: участник без действий IDLE_KICK ходов подряд выбывает
      for (const f of b.alivePlayers()) {
        if (f.key === k.uid) continue;
        idle[f.key] = pend.actions[f.key] == null && !pend.pots[f.key] ? (idle[f.key] || 0) + 1 : 0;
        if (idle[f.key] >= IDLE_KICK && !pl.includes(f.key)) pl.push(f.key);
      }
      const rec = { n, joins: pj, leaves: pl, pots: pend.pots, actions: pend.actions };
      pj = []; pl = [];
      hist.turns.push(rec);
      b.applyTurn(rec);
      emit('update', rec);
      if (b.ended) {
        k.send({ t: 'turn', rec, next: null });
        for (const uid of waiters) k.send({ t: 'full', to: uid });
        waiters.clear();
        return finish();
      }
      const left = nextLeft();
      k.send({ t: 'turn', rec, next: { left } });
      beginTurn(n + 1, left, false);
      for (const uid of waiters) sendSync(uid);
      waiters.clear();
    }

    function sendSync(uid) {
      k.send({ t: 'sync', to: uid, hist, cur: { n: S.turn.n, left: Math.max(0, S.turn.end - k.now()) } });
    }

    function hostReceive(m) {
      const b = S.battle;
      if (m.t === 'act') {
        if (!S.turn || m.n !== S.turn.n || !b.playerByKey(m.uid)) return;
        if (m.skill != null) pend.actions[m.uid] = m.skill;
        if (m.pot) pend.pots[m.uid] = m.pot;
      } else if (m.t === 'hello') {
        const f = b.playerByKey(m.uid);
        if (f) { if (f.left) k.send({ t: 'full', to: m.uid }); else sendSync(m.uid); return; }
        if (pj.some((j) => j.key === m.uid)) { waiters.add(m.uid); return; }
        if (b.ended || b.players.length + pj.length >= MAX_PLAYERS) return k.send({ t: 'full', to: m.uid });
        pj.push({ key: m.uid, tpl: m.tpl });
        waiters.add(m.uid);
      } else if (m.t === 'leave') {
        if (b.playerByKey(m.uid) && !pl.includes(m.uid)) pl.push(m.uid);
      }
    }

    // ---------------- участник ----------------

    function applyRec(rec) {
      S.battle.applyTurn(rec);
      expected = rec.n + 1;
      emit('update', rec);
    }

    function drain() {
      while (buffer.has(expected) && !S.ended) {
        const m = buffer.get(expected);
        buffer.delete(expected);
        applyRec(m.rec);
        if (S.battle.ended) return finish();
        if (m.next) setTurn(expected, m.next.left);
      }
    }

    function sendHello() { k.send({ t: 'hello', uid: k.uid, tpl: k.tpl }); }

    function peerReceive(m) {
      if (m.to && m.to !== k.uid) return;
      lastHeard = k.now();
      if (m.t === 'sync') {
        buffer.clear();
        S.battle = new PC.Battle({ players: m.hist.roster, monster: m.hist.monster, seed: m.hist.seed, data: k.data, localKey: k.uid });
        for (const rec of m.hist.turns) S.battle.applyTurn(rec);
        expected = m.hist.turns.length + 1;
        const first = !S.ready;
        S.ready = true;
        k.clearI(helloTimer);
        emit('update', null);
        if (S.battle.ended) { if (first) emit('ready', S.battle); return finish(); }
        setTurn(expected, m.cur.left);
        if (first) emit('ready', S.battle);
      } else if (m.t === 'full') {
        abort('full');
      } else if (m.t === 'abort') {
        abort(m.reason || 'host_left');
      } else if (!S.ready) {
        // ждём sync
      } else if (m.t === 'ts') {
        if (m.n === expected) setTurn(m.n, m.left);
      } else if (m.t === 'turn') {
        if (m.rec.n < expected) return;
        buffer.set(m.rec.n, m);
        if (m.rec.n > expected && k.now() - lastResync > 1500) { lastResync = k.now(); sendHello(); }   // потеряли ход: просим историю заново
        drain();
      }
    }

    function abort(reason) {
      if (S.ended || S.aborted) return;
      S.aborted = reason;
      k.clearT(timer); k.clearI(helloTimer); k.clearI(watch);
      emit('abort', reason);
    }

    // ---------------- общее ----------------

    S.start = function () {
      if (S.host) {
        S.battle = new PC.Battle({ players: [{ key: k.uid, tpl: k.tpl }], monster: k.monster, seed: k.seed, data: k.data, localKey: k.uid });
        hist = { seed: k.seed, monster: k.monster, roster: [{ key: k.uid, tpl: k.tpl }], turns: [] };
        S.ready = true;
        emit('ready', S.battle);
        let left = k.tickLeft(k.now());
        if (left < 5000) left += k.TICK;
        beginTurn(1, left, true);
        return S;
      }
      let tries = 0;
      sendHello();
      helloTimer = k.setI(() => { if (S.ready) return; if (++tries > 8) return abort('nohost'); sendHello(); }, 2000);
      watch = k.setI(() => { if (S.ready && !S.ended && k.now() - lastHeard > HOST_SILENCE) abort('host_timeout'); }, 5000);
      return S;
    };

    S.receive = function (m) {
      if (S.stopped || !m) return;
      if (S.host) hostReceive(m); else peerReceive(m);
    };

    // Моё действие в текущем ходу (умение) и зелье; повторно в том же ходу нельзя
    S.submit = function (skill) {
      const t = S.turn, me = S.battle && S.battle.player;
      if (!t || t.acted || S.ended || !me || me.hp <= 0) return false;
      t.acted = true;
      if (S.host) pend.actions[k.uid] = skill; else k.send({ t: 'act', n: t.n, uid: k.uid, skill });
      return true;
    };
    S.submitPotion = function (id) {
      const t = S.turn, me = S.battle && S.battle.player;
      if (!t || t.potted || S.ended || !me || me.hp <= 0 || !S.battle.canUseConsumable(me)) return false;
      t.potted = true;
      if (S.host) pend.pots[k.uid] = id; else k.send({ t: 'act', n: t.n, uid: k.uid, pot: id });
      return true;
    };

    // Выйти из боя. Хозяин закрывает бой для всех, остальные просто выбывают.
    S.leave = function () {
      if (S.stopped) return;
      if (S.host) { if (!S.ended) k.send({ t: 'abort', reason: 'host_left' }); } else k.send({ t: 'leave', uid: k.uid });
      S.stop();
    };
    S.stop = function () {
      S.stopped = true;
      k.clearT(timer); k.clearI(helloTimer); k.clearI(watch);
    };
    // Хозяин остаётся «движком» боя, даже когда его герой погиб: интерфейс можно закрыть, а сессию — нет
    S.maxPlayers = MAX_PLAYERS;
    return S;
  }

  PC.lockstep = { create, MAX_PLAYERS, IDLE_KICK, HOST_SILENCE };
  if (typeof module !== 'undefined') module.exports = PC;
})(typeof window !== 'undefined' ? window : globalThis);
