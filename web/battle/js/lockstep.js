// Общий бой: один источник правды — хозяин боя. Бой идёт в реальном времени тика, как одиночный: игрок бьёт, как только
// нажал умение, монстр — в свой момент хода. Хозяин применяет каждое действие сразу и рассылает его событием
// (см. Battle.applyEvent); у всех участников своя копия боя, которая применяет те же события в том же порядке и
// получается идентичной: одно здоровье монстра, один лог, одна смерть. Без DOM и без сети: транспорт подставляется снаружи.
//
// Бой не зависит от одной страницы. Закрыл страницу любой участник, в том числе хозяин, — его герой остаётся в бою и
// просто пропускает ходы (AFK) до конца боя. Хозяин замолчал — расчёт берёт на себя следующий участник по порядку
// вступления (миграция хозяина): у всех есть полная история боя (список событий), по ней бой восстанавливается.
//
// Сообщения (все в один канал боя, объекты). Сообщения хозяина несут ep (эпоха), h (кто хозяин), len (сколько у него событий):
//   хозяин → все:   { t:'ev', n, g, e, cs, next? } событие номер g хода n; cs — отпечаток боя после него; next:{ left } — у конца хода
//                   { t:'ts', n, left }            идёт ход n, до его конца left мс (после смены хозяина)
//                   { t:'sync', to, hist, cur, v, cs } вся история для вступившего, вернувшегося или отставшего
//                   { t:'host', g }                я новый хозяин, у меня g событий
//                   { t:'resign' }                 хозяин вышел из боя, пусть выберут нового
//                   { t:'full', to, why? }         мест нет, вернуться нельзя или why:'version' — другая версия игры
//                   { t:'hb', n, g }               «я жив» каждые HEARTBEAT мс: одна потерянная посылка не вызывает смену хозяина
//   участник → хозяин: { t:'hello', uid, tpl, v }  хочу в бой / догнать;  { t:'act', n, uid, skill?, pot? } нажал умение / зелье
//                      { t:'catchup', to, from, evs } события, которых не хватает новому хозяину
//                      { t:'ahead', to, len }  тому, кто ведёт отставшую ветку боя: у меня событий больше, уступи
//   любой → все:       { t:'leave', uid }           я выхожу из боя (герой уходит, а не стоит AFK)
// Версия игры (v) едет в hello и sync: клиенты с разным кодом боя считают по-разному, поэтому в один бой их не пускаем.
(function (root) {
  'use strict';
  const PC = root.PC || (root.PC = {});

  const MAX_PLAYERS = 10;
  const HOST_SILENCE = 15000;   // хозяин молчит дольше — выбираем нового
  const TAKEOVER_STEP = 5000;   // каждый следующий кандидат ждёт ещё столько (на случай, что предыдущий тоже закрыл страницу)
  const CATCHUP_WAIT = 1500;    // новый хозяин ждёт события, которые видел кто-то из остальных, но не он
  const HEARTBEAT = 3000;       // хозяин подаёт голос, даже когда ничего не происходит
  const GAP_WAIT = 1500;        // событие потерялось (пришли следующие, а его всё нет) — просим историю заново
  const MAX_DESYNC = 3;         // столько раз подряд не сошёлся отпечаток после новой истории — бой обрываем
  const RESUME_WAIT = 5000;     // вернулся после обновления, а никто не отвечает — продолжаю бой сам по сохранённой истории
  const RESUME_FRESH = 60000;   // …если она свежая: старая могла давно разойтись с боем (бой мог и закончиться без меня)

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

  // o: { host, uid, tpl, monster (только хозяин), seed (только хозяин), data, send(msg), version,
  //      save({ hist, epoch }) — сохранить историю (на случай обновления страницы), saved — сохранённое ранее } + необязательно часы для тестов
  function create(o) {
    const k = { ...defaults, version: PC.BUILD || 'dev', ...o };
    const S = { host: !!k.host, uid: k.uid, battle: null, turn: null, ready: false, ended: false, aborted: null, stopped: false, epoch: 0, hostUid: k.host ? k.uid : null };
    const subs = {};
    const emit = (ev, arg) => { for (const fn of subs[ev] || []) fn(arg); };
    S.on = (ev, fn) => { (subs[ev] = subs[ev] || []).push(fn); return S; };

    let resumeTimer = null, timer = null, monTimer = null, helloTimer = null, watch = null, catchTimer = null, beat = null;
    let lastHeard = k.now(), lastResync = 0, gapSince = 0, desyncs = 0;
    let hist = null;                        // у всех: seed, монстр, первый состав и все события — по ним можно восстановить бой
    let hostLen = 0;                        // сколько событий было у текущего хозяина в его последнем сообщении
    let stale = false;                      // мой бой не продолжение боя хозяина: жду от него всю историю
    const buffer = new Map();               // пришедшие вперёд события
    const knownLeaves = new Set();          // кто сказал, что выходит (нужно, если хозяин успел сказать это только остальным)
    // новый хозяин собирает недостающие события: вступления, действия и запросы истории за это время откладываются
    let waiting = false, waiters = new Set(), pendJoins = [], waitActs = [];
    const aheadSent = new Map();

    const count = () => hist.ev.length;
    const hsend = (m) => k.send({ ...m, ep: S.epoch, h: k.uid, len: hist ? hist.ev.length : 0 });
    const nextLeft = () => {
      let left = k.tickLeft(k.now());
      if (left < 4000) left += k.TICK;
      return left;
    };
    const clearAll = () => { k.clearT(resumeTimer); k.clearT(timer); k.clearT(monTimer); k.clearT(catchTimer); k.clearI(helloTimer); k.clearI(watch); k.clearI(beat); };
    const resync = () => { if (k.now() - lastResync > 1500) { lastResync = k.now(); sendHello(); } };
    // Мой бой больше не продолжение боя хозяина (сменился хозяин, не сошёлся отпечаток): события не применяю, пока не придёт история
    const goStale = () => { stale = true; buffer.clear(); gapSince = 0; lastResync = 0; resync(); };

    function persist() {
      if (!k.save || !hist) return;
      try { k.save({ hist, epoch: S.epoch, at: k.now() }); } catch (e) { /* не критично */ }
    }

    function setTurn(n, left, carry) {
      const same = carry && carry.n === n;
      S.turn = { n, start: k.now(), end: k.now() + left, acted: !!(same && carry.acted), potted: !!(same && carry.potted), skill: same ? carry.skill : undefined, pot: same ? carry.pot : undefined };
      emit('turn', S.turn);
    }

    function finish() {
      if (S.ended) return;
      S.ended = true;
      clearAll();
      emit('end', S.battle);
    }

    // Бой из истории: seed, монстр, первый состав и все события по порядку
    function build(h) {
      const b = new PC.Battle({ players: h.roster, monster: h.monster, seed: h.seed, data: k.data, localKey: k.uid });
      for (const e of h.ev) b.applyEvent(e);
      return b;
    }

    // ---------------- хозяин ----------------

    // Событие применяется у хозяина сразу и сразу уходит остальным
    function push(e, extra) {
      const b = S.battle, n = b.turn;
      b.applyEvent(e);
      hist.ev.push(e);
      persist();
      hsend({ t: 'ev', n, g: hist.ev.length - 1, e, cs: checksum(b), ...extra });
      emit('update', e);
      if (b.ended) {
        for (const uid of waiters) hsend({ t: 'full', to: uid });
        waiters.clear();
        finish();
      }
    }

    // Ход: монстр бьёт в свой момент (чем он быстрее, тем раньше), игроки — когда нажмут; в конце хода — итог
    function beginTurn(left, announce, carry) {
      const b = S.battle;
      setTurn(b.turn, left, carry);
      if (announce) hsend({ t: 'ts', n: b.turn, left });
      k.clearT(monTimer); k.clearT(timer);
      if (!b.monsterActed) monTimer = k.setT(() => { if (S.host && !waiting && !S.stopped && !S.ended) push({ k: 'm' }); }, left * b.actionMoment(b.monster));
      timer = k.setT(endTurn, left + k.grace);
    }

    function endTurn() {
      if (S.stopped || S.ended || !S.host || waiting) return;
      const left = nextLeft();
      push({ k: 'e' }, { next: { left } });
      if (!S.ended) beginTurn(left, false);
    }

    function sendSync(uid) {
      hsend({ t: 'sync', to: uid, hist, cur: { left: Math.max(0, S.turn ? S.turn.end - k.now() : 0) }, v: k.version, cs: checksum(S.battle) });
    }

    function hostReceive(m) {
      const b = S.battle;
      if (m.t === 'act') {
        if (waiting) return void waitActs.push(m);
        const f = b.playerByKey(m.uid);
        if (!f || b.ended || m.n !== b.turn) return;   // опоздавшее нажатие (ход уже закончился) не переносим в следующий
        if (m.pot && b.canUseConsumable(f)) push({ k: 'p', key: m.uid, id: m.pot });
        if (m.skill != null && !b.ended && !b.hasActed(m.uid)) push({ k: 'a', key: m.uid, s: m.skill });
      } else if (m.t === 'hello') {
        if (m.v !== k.version) return hsend({ t: 'full', to: m.uid, why: 'version' });
        const f = b.playerByKey(m.uid);
        if (f) { if (f.left) hsend({ t: 'full', to: m.uid }); else if (waiting) waiters.add(m.uid); else sendSync(m.uid); return; }
        if (pendJoins.some((j) => j.key === m.uid)) return void waiters.add(m.uid);
        if (b.ended || b.players.length + pendJoins.length >= MAX_PLAYERS) return hsend({ t: 'full', to: m.uid });
        if (waiting) { pendJoins.push({ key: m.uid, tpl: m.tpl }); waiters.add(m.uid); return; }
        push({ k: 'j', key: m.uid, tpl: m.tpl });   // вступивший в бою сразу и может бить в этом же ходу
        if (!S.ended) sendSync(m.uid);
      } else if (m.t === 'leave') {
        const f = b.playerByKey(m.uid);
        if (f && !f.left && !waiting) push({ k: 'l', key: m.uid });
      } else if (m.t === 'catchup' && waiting) {
        applyCatchup(m.from, m.evs);
      } else if (m.t === 'ahead' && m.len > count()) {
        demote();   // у кого-то из участников бой ушёл дальше моего: я вёл отставшую ветку
      }
    }

    // ---------------- участник ----------------

    function sendHello() { k.send({ t: 'hello', uid: k.uid, tpl: k.tpl, v: k.version }); }

    function drain() {
      while (buffer.has(count()) && !S.ended) {
        const m = buffer.get(count());
        buffer.delete(count());
        S.battle.applyEvent(m.e);
        hist.ev.push(m.e);
        persist();
        emit('update', m.e);
        if (m.cs && m.cs !== checksum(S.battle)) {   // мой бой разошёлся с боем хозяина: дальше не считаем, берём историю заново
          emit('desync', count());
          if (++desyncs > MAX_DESYNC) return abort('desync');
          return goStale();
        }
        if (m.cs) desyncs = 0;
        if (S.battle.ended) return finish();
        if (m.e.k === 'e') setTurn(S.battle.turn, m.next ? m.next.left : nextLeft());
      }
      gapSince = buffer.size ? gapSince || k.now() : 0;
    }

    const rosterIndex = (uid) => S.battle.players.findIndex((f) => f.key === uid);

    // Хозяин потерял роль: мой бой мог разойтись с настоящим, поэтому берём историю заново
    function demote() {
      S.host = false;
      waiters.clear(); pendJoins = []; waitActs = []; waiting = false;
      k.clearT(timer); k.clearT(monTimer); k.clearT(catchTimer);
      lastHeard = k.now();
      goStale();
    }

    // Два хозяина (связь пропадала, и кто-то взял расчёт на себя): остаётся тот, у кого больше событий,
    // при равенстве — более поздняя эпоха, затем вступивший раньше. Порядок одинаков у всех, поэтому все сходятся на одном.
    function better(m) {
      const myLen = S.host ? hist.ev.length : hostLen, mine = S.host ? k.uid : S.hostUid;
      if (m.len !== myLen) return m.len > myLen;
      if (m.ep !== S.epoch) return m.ep > S.epoch;
      const a = S.battle ? rosterIndex(m.h) : -1, b = S.battle ? rosterIndex(mine) : -1;
      return a >= 0 && (b < 0 || a < b);
    }

    // Сообщение хозяина: от текущего — принимаем; от другого — только если он «лучше», тогда переходим к нему
    function gate(m) {
      const len = m.len || 0;
      if (S.hostUid == null || m.h === S.hostUid) {
        S.hostUid = m.h; S.epoch = m.ep; hostLen = Math.max(len, hostLen); lastHeard = k.now();
        return true;
      }
      // мой хозяин замолчал: новый по более поздней эпохе принимаем, если у него не меньше событий, чем у меня.
      // У кого меньше (вернулся со старой сохранённой историей, отставал) — того не слушаем: расчёт возьмёт кто-то с полной историей.
      const silent = !S.host && k.now() - lastHeard > HOST_SILENCE && len >= (hist ? count() : 0);
      if (!(silent && m.ep > S.epoch) && !better({ ...m, len })) {
        // отставший взял расчёт на себя (вернулся со старой историей): не слушаем его, но отдаём ему недостающие события — догонит
        if (m.t === 'host' && S.ready && hist && count() > m.g) k.send({ t: 'catchup', to: m.h, from: m.g, evs: hist.ev.slice(m.g) });
        // отставший уже ведёт свой бой: подсказываем, что у нас история длиннее, — он уступит и возьмёт её
        else if (S.ready && hist && count() > len && k.now() - (aheadSent.get(m.h) || 0) > 3000) { aheadSent.set(m.h, k.now()); k.send({ t: 'ahead', to: m.h, len: count() }); }
        return false;
      }
      const wasHost = S.host;
      S.hostUid = m.h; S.epoch = m.ep; hostLen = len; lastHeard = k.now();
      if (wasHost) demote();
      // новый хозяин продолжает мой бой, только если он объявил смену и у него не больше событий, чем у меня; иначе беру его историю
      else if (S.ready && m.t !== 'sync' && !(m.t === 'host' && m.g <= count())) goStale();
      return true;
    }

    function peerReceive(m) {
      if (m.t === 'sync') {
        if (m.v !== k.version) return abort('version');
        stale = false;
        buffer.clear(); gapSince = 0;
        S.battle = build(m.hist);
        hist = { seed: m.hist.seed, monster: m.hist.monster, roster: m.hist.roster, ev: m.hist.ev.slice() };
        persist();
        const first = !S.ready;
        S.ready = true;
        k.clearI(helloTimer); k.clearT(resumeTimer);
        if (m.cs && m.cs !== checksum(S.battle)) { emit('desync', count()); if (++desyncs > MAX_DESYNC) return abort('desync'); }
        else desyncs = 0;
        if (S.battle.ended) { emit(first ? 'ready' : 'reset', S.battle); return finish(); }
        const b = S.battle, mine = S.turn && S.turn.n === b.turn ? S.turn : null;
        setTurn(b.turn, m.cur.left, { n: b.turn, acted: b.hasActed(k.uid) || !!(mine && mine.acted), potted: !!(mine && mine.potted), skill: mine && mine.skill, pot: mine && mine.pot });
        emit(first ? 'ready' : 'reset', S.battle);
      } else if (m.t === 'full') {
        abort(m.why === 'version' ? 'version' : 'full');
      } else if (!S.ready || stale) {
        if (m.t === 'host' && stale) lastResync = 0;
        if (stale) resync();   // ждём историю
      } else if (m.t === 'ev') {
        if (m.g < count()) return;
        buffer.set(m.g, m);
        drain();
      } else if (m.t === 'ts') {
        if (m.n === S.battle.turn) setTurn(m.n, m.left, S.turn);
      } else if (m.t === 'hb') {
        if (m.g > count()) gapSince = gapSince || k.now();   // событие потерялось по дороге
      } else if (m.t === 'host') {
        // новый хозяин собирает события: если мы видели больше, отдаём недостающие; своё действие в этом ходу присылаем заново
        if (count() > m.g) k.send({ t: 'catchup', to: m.h, from: m.g, evs: hist.ev.slice(m.g) });
        resendMine();
      } else if (m.t === 'resign') {
        lastHeard = k.now() - HOST_SILENCE;   // хозяин вышел: выборы начинаются сразу
      }
    }

    function resendMine() {
      const t = S.turn, b = S.battle;
      if (!t || t.n !== b.turn) return;
      if ((t.acted && t.skill != null && !b.hasActed(k.uid)) || t.potted) k.send({ t: 'act', n: t.n, uid: k.uid, skill: b.hasActed(k.uid) ? null : t.skill, pot: t.pot });
    }

    // Следующий по порядку вступления кандидат (кроме прежнего хозяина и вышедших) берёт расчёт на себя
    function checkHost() {
      if (gapSince && !S.host && k.now() - gapSince > GAP_WAIT) { gapSince = k.now(); resync(); }
      if (stale) resync();   // всё ещё жду историю: напоминаю о себе (ответить может и участник, у которого бой уже кончился)
      if (S.host || !S.ready || S.ended || S.stopped) return;
      const cand = S.battle.players.filter((f) => !f.left && f.key !== S.hostUid).map((f) => f.key);
      const rank = cand.indexOf(k.uid);
      if (rank < 0) return;
      if (k.now() - lastHeard > HOST_SILENCE + rank * TAKEOVER_STEP) takeover();
    }

    function takeover() {
      stale = false;
      S.epoch++;
      S.host = true;
      S.hostUid = k.uid;
      buffer.clear(); gapSince = 0;
      waiters = new Set(); pendJoins = []; waitActs = [];
      waiting = true;
      const carry = S.turn;
      hsend({ t: 'host', g: count() });
      emit('host', S.epoch);
      // даём остальным время прислать события, которых нам не хватает, и свои действия за текущий ход
      catchTimer = k.setT(() => {
        waiting = false;
        if (S.stopped || S.ended) return;
        const b = S.battle;
        for (const key of knownLeaves) { const f = b.playerByKey(key); if (f && !f.left && !S.ended) push({ k: 'l', key }); }
        for (const j of pendJoins) if (!S.ended && !b.playerByKey(j.key)) push({ k: 'j', key: j.key, tpl: j.tpl });
        pendJoins = [];
        if (S.ended) return;
        beginTurn(nextLeft(), true, carry);   // текущий ход продолжается с новым временем
        const t = S.turn;
        if (t.potted && t.pot && b.canUseConsumable(b.player)) push({ k: 'p', key: k.uid, id: t.pot });
        if (!S.ended && t.acted && t.skill != null && !b.hasActed(k.uid)) push({ k: 'a', key: k.uid, s: t.skill });
        for (const m of waitActs) if (!S.ended) hostReceive(m);
        waitActs = [];
        for (const uid of waiters) if (!S.ended) sendSync(uid);
        waiters.clear();
      }, CATCHUP_WAIT);
    }

    function applyCatchup(from, evs) {
      (evs || []).forEach((e, i) => {
        if (S.ended || from + i !== count()) return;
        push(e);
      });
      if (S.ended) { waiting = false; k.clearT(catchTimer); }
    }

    function abort(reason) {
      if (S.ended || S.aborted) return;
      S.aborted = reason;
      clearAll();
      emit('abort', reason);
    }

    // Страницу обновили, а хозяина нет (это был я, или все ушли): поднимаю бой из сохранённой истории и веду его сам.
    // Если настоящий хозяин всё-таки есть, у него больше событий — уступлю ему и возьму его историю.
    function restore() {
      const h = k.saved && k.saved.hist;
      if (S.ready || S.stopped || !h || !h.roster || !h.ev || !(k.now() - (k.saved.at || 0) < RESUME_FRESH)) return;
      const b = build(h);
      if (b.ended || !b.player || b.player.left) return;
      S.battle = b;
      hist = { seed: h.seed, monster: h.monster, roster: h.roster, ev: h.ev.slice() };
      S.ready = true;
      k.clearI(helloTimer);
      S.epoch = k.saved.epoch || 0; S.hostUid = null;
      emit('ready', S.battle);
      takeover();
    }

    function heartbeat() {
      if (S.host && !waiting && !S.stopped && !S.ended && S.battle) hsend({ t: 'hb', n: S.battle.turn, g: count() });
    }

    // ---------------- общее ----------------

    S.start = function () {
      if (S.host) {
        S.battle = new PC.Battle({ players: [{ key: k.uid, tpl: k.tpl }], monster: k.monster, seed: k.seed, data: k.data, localKey: k.uid });
        hist = { seed: k.seed, monster: k.monster, roster: [{ key: k.uid, tpl: k.tpl }], ev: [] };
        S.ready = true;
        persist();
        emit('ready', S.battle);
        let left = k.tickLeft(k.now());
        if (left < 5000) left += k.TICK;
        beginTurn(left, true);
        watch = k.setI(checkHost, 1000);   // после возврата роли можно снова стать участником
        beat = k.setI(heartbeat, HEARTBEAT);
        return S;
      }
      let tries = 0;
      sendHello();
      if (k.saved && k.now() - (k.saved.at || 0) < RESUME_FRESH) resumeTimer = k.setT(restore, RESUME_WAIT);
      helloTimer = k.setI(() => { if (S.ready) return; if (++tries > 28) return abort('nohost'); sendHello(); }, 1000);
      watch = k.setI(checkHost, 1000);
      beat = k.setI(heartbeat, HEARTBEAT);
      return S;
    };

    S.receive = function (m) {
      if (S.stopped || !m) return;
      if (m.to && m.to !== k.uid) return;
      if (m.t === 'leave') { knownLeaves.add(m.uid); if (S.host) hostReceive(m); return; }
      // бой у меня уже закончился: отставшему (или вернувшемуся) отдаю итог, даже если я не хозяин
      if (m.t === 'hello' && S.ended && !S.host && hist && m.v === k.version && S.battle.playerByKey(m.uid)) return sendSync(m.uid);
      if (m.ep != null) { if (m.h !== k.uid && gate(m)) peerReceive(m); return; }   // от хозяина
      if (S.host) hostReceive(m);                                                      // от участника: hello, act, catchup
    };

    // Моё действие в текущем ходу (умение) — срабатывает сразу; повторно в том же ходу нельзя
    S.submit = function (skill) {
      const t = S.turn, b = S.battle, me = b && b.player;
      if (!t || t.acted || S.ended || stale || !me || me.hp <= 0 || me.left || b.hasActed(k.uid)) return false;
      t.acted = true; t.skill = skill;
      const m = { t: 'act', n: t.n, uid: k.uid, skill };
      if (S.host) hostReceive(m); else k.send(m);
      return true;
    };
    // Зелье — тоже сразу и не тратит ход
    S.submitPotion = function (id) {
      const t = S.turn, b = S.battle, me = b && b.player;
      if (!t || t.potted || S.ended || stale || !me || me.hp <= 0 || !b.canUseConsumable(me)) return false;
      t.potted = true; t.pot = id;
      const m = { t: 'act', n: t.n, uid: k.uid, pot: id };
      if (S.host) hostReceive(m); else k.send(m);
      return true;
    };

    // Выйти из боя (герой уходит). Закрыть страницу — не выход: герой остаётся в бою AFK. Хозяин при выходе передаёт расчёт другим.
    S.leave = function () {
      if (S.stopped) return;
      if (S.host && !S.ended && !waiting) { const f = S.battle.playerByKey(k.uid); if (f && !f.left) push({ k: 'l', key: k.uid }); }
      k.send({ t: 'leave', uid: k.uid });
      if (S.host && !S.ended) hsend({ t: 'resign' });
      S.stop();
    };
    S.stop = function () {
      S.stopped = true;
      clearAll();
    };
    S.maxPlayers = MAX_PLAYERS;
    Object.defineProperty(S, 'stale', { get: () => stale });   // бой разошёлся с хозяином, ждём его историю
    Object.defineProperty(S, 'evCount', { get: () => (hist ? hist.ev.length : 0) });   // сколько событий боя применено
    return S;
  }

  PC.lockstep = { create, checksum, MAX_PLAYERS, HOST_SILENCE, TAKEOVER_STEP };
  if (typeof module !== 'undefined') module.exports = PC;
})(typeof window !== 'undefined' ? window : globalThis);
