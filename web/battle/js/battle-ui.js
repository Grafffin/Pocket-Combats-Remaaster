// Экран боя в реальном времени тика (как в оригинале). Один ход = один глобальный тик мира (10 с).
// Игрок должен успеть нажать удар или умение за тик; противник действует в свой момент, который зависит
// от соотношения скоростей (быстрее игрок — позже бьёт противник). С автобоем игрок действует в свой момент.
// PC.battleUI.start({ player, monster, settings, onEnd(battle, { fled }), onSettings(settings) })
(function () {
  'use strict';
  const { Battle, data, world: W } = PC;
  const { $, art, avatar, escapeHtml, openModal, closeModal, closeSheet, toast } = PC.kit;
  const fmt = PC.fmtBig;

  const MIN_FIRST_TURN = 5000;  // если до границы тика меньше — первый ход длится до следующей
  const STEP_MS = 220;          // показ одной строки лога

  const ui = {
    battle: null, opts: null, shown: 0, finished: false,
    turn: null,            // { start, end, monsterAt, autoAt, playerActed, monsterActed }
    timers: [], barTimer: null, pumping: false,
    joinedAt: new Map(),   // id участника → когда он вступил (для анимации строки в плашке союзников)
  };

  // opts.session — общий бой (PC.lockstep): мир, здоровье монстра и лог общие для всех участников, ходы приходят от хозяина.
  // Без session бой одиночный и считается здесь же в реальном времени тика.
  function start(opts) {
    stop();
    ui.opts = opts;
    const sess = ui.session = opts.session || null;
    ui.battle = sess ? sess.battle : new Battle({ player: opts.player, monster: opts.monster, data });
    const rs = opts.resume;   // вернулись в бой после обновления страницы: берём сохранённые здоровье и ресурс
    if (!sess && rs && rs.hp > 0) {
      const p = ui.battle.player;
      p.hp = Math.max(1, Math.min(p.maxHp, rs.hp));
      if (rs.res != null && p.resMax) p.res = Math.max(0, Math.min(p.resMax, rs.res));
    }
    ui.shown = 0;
    ui.finished = false;
    ui.joinedAt.clear();
    $('#log').innerHTML = '';
    $('#turn-title').textContent = 'Ход 1';
    const b = ui.battle;
    $('#f-p').innerHTML = fighterHtml(b.player);
    $('#f-m').innerHTML = fighterHtml(b.monster);
    $('#f-m').classList.toggle('boss', b.monster.boss);
    renderToggles();
    ui.barTimer = setInterval(updateBar, 100);
    if (sess) return startShared(sess);
    const now = Date.now();
    let end = now + W.msToNextTick(now);
    if (end - now < MIN_FIRST_TURN) end += W.TICK_MS;
    beginTurn(now, end);
    pump();
  }

  // ---------- Общий бой ----------

  function startShared(sess) {
    const b = ui.battle;
    // вступили в уже идущий бой: прошлое показываем сразу, без задержек
    const from = Math.max(0, b.log.length - 40);
    ui.shown = b.log.length;
    for (let i = from; i < b.log.length; i++) addEntry(b.log[i]);
    if (b.log.length) applySnapshot(finalSnap());
    const live = () => ui.session === sess && !ui.finished;
    sess.on('update', () => {
      if (!live()) return;
      if (ui.turn) { ui.turn.monsterActed = !!ui.battle.monsterActed; if (ui.battle.hasActed(ui.battle.player.key)) ui.turn.playerActed = true; }
      renderSkillbar(); pump();
    });
    sess.on('turn', (t) => { if (live()) onSharedTurn(t); });
    sess.on('end', () => { if (live()) pump(); });
    sess.on('abort', (reason) => { if (live()) finish(false, reason); });
    // История получена заново (потеряли ход, сменился хозяин): бой — новый объект, показываем его с чистого листа
    sess.on('reset', () => {
      if (!live()) return;
      ui.battle = sess.battle;
      $('#log').innerHTML = '';
      const bb = ui.battle;
      ui.shown = bb.log.length;
      for (let i = Math.max(0, bb.log.length - 40); i < bb.log.length; i++) addEntry(bb.log[i]);
      $('#f-p').innerHTML = fighterHtml(bb.player);
      $('#f-m').innerHTML = fighterHtml(bb.monster);
      applySnapshot(finalSnap());
      if (sess.turn) onSharedTurn(sess.turn);
      if (bb.ended || bb.player.hp <= 0) pump();
    });
    if (sess.turn) onSharedTurn(sess.turn);
    if (b.ended || b.player.hp <= 0) pump();
  }

  // Состояние всех бойцов прямо сейчас (последняя запись лога могла быть до вступления кого-то)
  function finalSnap() {
    const b = ui.battle, snap = {};
    for (const f of b.fighters) snap[f.id] = { hp: f.hp, res: f.res, shield: b.shieldOf(f), effects: f.effects.map((e) => ({ id: e.id, name: e.name, kind: e.kind, turns: e.turns, disable: e.disable })) };
    snap.$tank = b.tank ? b.tank.id : null;
    return snap;
  }

  // Ход общего боя идёт как в одиночном: удар срабатывает в момент нажатия, монстр бьёт в свой момент хода
  function onSharedTurn(t) {
    const b = ui.battle, dur = t.end - t.start;
    clearTimers();
    ui.turn = { n: t.n, start: t.start, end: t.end, monsterAt: t.start + dur * b.actionMoment(b.monster), autoAt: t.start + dur * b.actionMoment(b.player), playerActed: !!t.acted, monsterActed: !!b.monsterActed };
    renderSkillbar();
    updateBar();
    if (b.ended || b.player.hp <= 0) return;
    later(() => { if (ui.turn && ui.turn.n === t.n && ui.opts.settings.autoBattle) sharedAuto(); }, ui.turn.autoAt - Date.now());
  }

  // Автобой в общем бою: в свой момент хода, если сам не успел раньше
  function sharedAuto() {
    const b = ui.battle, sess = ui.session, p = b.player;
    if (!sess.turn || sess.turn.acted || b.ended || p.hp <= 0) return;
    autoPotions();
    sess.submit(b.autoAction(p));
    ui.turn.playerActed = true;
    renderSkillbar();
  }

  function clearTimers() { ui.timers.forEach(clearTimeout); ui.timers = []; }
  function later(fn, ms) { ui.timers.push(setTimeout(fn, Math.max(0, ms))); }

  function stop() {
    ui.finished = true;
    clearTimers();
    clearInterval(ui.barTimer);
  }

  // Разметка карточек союзников из состояния бойцов (hp берём из снимка записи лога, чтобы цифры совпадали с логом)
  function renderParty(snap) {
    const el = $('#party');
    const b = ui.battle;
    if (!el || !ui.session) return;
    const mates = b.players.filter((f) => f !== b.player);
    el.hidden = !mates.length;
    const now = Date.now();
    const tank = tankOf(snap);
    let fresh = false;
    el.innerHTML = mates.map((f) => {
      // строка перерисовывается на каждой записи лога: отрицательная задержка продолжает анимацию, а не запускает её заново
      const ago = now - (ui.joinedAt.get(f.id) || 0);
      const join = ago < 1400 ? ` joining" style="animation-delay:-${ago}ms` : '';
      if (join) fresh = true;
      const s = snap[f.id] || { hp: f.hp, res: f.res };
      const pct = Math.max(0, Math.min(1, s.hp / f.maxHp));
      const rp = f.resMax ? Math.max(0, Math.min(1, s.res / f.resMax)) : null;
      const col = f.resource ? (data.resources[f.resource] || {}).color : '';
      const fx = chipsHtml(f, s.effects, false);
      return `<div class="pmate${s.hp <= 0 ? ' dead' : ''}${tank === f.id ? ' aggro' : ''}${join}">${avatar(f, 28)}<div class="who"><div class="name">${f.name}</div><div class="lvl">${f.level} ур.</div></div><div class="vit"><div class="meter hp"><div class="track"><div class="fill" style="width:${pct * 100}%;background-color:${pct > 0.5 ? 'var(--hp)' : pct > 0.25 ? 'var(--hp-mid)' : 'var(--hp-low)'}"></div><span class="v">${fmt(s.hp)}</span></div></div>
        ${rp != null ? `<div class="meter res"><div class="track"><div class="fill" style="width:${rp * 100}%;background:${col || '#c9a227'}"></div></div></div>` : ''}</div><div class="effects">${fx}</div></div>`;
    }).join('');
    if (fresh) el.scrollTop = el.scrollHeight;
  }

  // ---------- Ход ----------

  function beginTurn(startAt, endAt) {
    const b = ui.battle;
    const dur = endAt - startAt;
    const t = ui.turn = {
      start: startAt, end: endAt,
      monsterAt: startAt + dur * b.actionMoment(b.monster),
      autoAt: startAt + dur * b.actionMoment(b.player),
      playerActed: false, monsterActed: false,
    };
    const now = Date.now();
    later(monsterAct, t.monsterAt - now);
    later(autoAct, t.autoAt - now);
    later(endTurn, endAt - now);
    renderSkillbar();
    updateBar();
  }

  function monsterAct() {
    const b = ui.battle, t = ui.turn;
    if (ui.finished || b.ended || t.monsterActed) return;
    t.monsterActed = true;
    b.act(b.monster, b.autoAction(b.monster));
    afterAction();
  }

  // Автобой: игрок действует в свой момент тика, если сам не успел раньше
  function autoAct() {
    const b = ui.battle, t = ui.turn;
    if (ui.finished || b.ended || t.playerActed || !ui.opts.settings.autoBattle) return;
    autoPotions();
    playerAct(b.autoAction(b.player));
  }

  function playerAct(skillId) {
    const b = ui.battle, t = ui.turn;
    if (ui.finished || b.ended || t.playerActed) return;
    if (ui.session) {
      if (ui.session.submit(skillId)) { t.playerActed = true; renderSkillbar(); updateBar(); }
      return;
    }
    t.playerActed = true;
    b.act(b.player, skillId);
    afterAction();
  }

  function endTurn() {
    const b = ui.battle, t = ui.turn;
    if (ui.finished || b.ended) return;
    if (!t.monsterActed) { t.monsterActed = true; b.act(b.monster, b.autoAction(b.monster)); }
    if (!b.ended && !t.playerActed) { t.playerActed = true; b.skip(b.player); }
    if (!b.ended) b.endTurn();
    afterAction();
    if (!b.ended) beginTurn(t.end, t.end + W.TICK_MS);
  }

  function afterAction() {
    renderSkillbar();
    pump();
  }

  function autoPotions() {
    const b = ui.battle;
    const p = b.player;
    if (!b.canUseConsumable(p)) return;
    const pick = (prefix) => ['3', '2', '1'].map((n) => p.consumables.find((c) => c.id === `${prefix}_${n}` && c.count > 0)).find(Boolean);
    const at = (ui.opts.settings.potionAt ?? 35) / 100;
    // в общем бою зелье пьётся через хозяина, как и удар: свой бой напрямую не трогаем, иначе он разойдётся с остальными
    const use = (id) => (ui.session ? ui.session.submitPotion(id) : b.useConsumable(p, id));
    const hp = pick('hp_potion');
    if (hp && p.hp / p.maxHp < at) { use(hp.id); return; }
    const mp = pick('mp_potion');
    const costs = p.skills.map((s) => b.skillCost(p, s.id)).filter((x) => x > 0);
    if (mp && p.resource === 'mana' && costs.length && p.res < Math.min(...costs)) use(mp.id);
  }

  // ---------- Отрисовка ----------

  function fighterHtml(f) {
    const res = f.resource ? data.resources[f.resource] : null;
    // Имя и уровень слева, справа полоски здоровья и ресурса (скорость не показываем)
    return `<div class="head">${avatar(f)}
        <div class="who"><div class="name">${f.name}</div><div class="lvl">${f.diff ? `<span style="color:${data.difficulties[f.diff].color}">${data.difficulties[f.diff].name}</span> · ` : ''}${f.boss ? 'Босс · ' : ''}${f.level} ур.</div></div>
        <div class="vit"><div class="meter hp"><div class="track"><div class="lag"></div><div class="fill"></div><div class="shield-fill"></div><span class="v"></span></div></div>
        ${res ? `<div class="meter res" title="${res.name}"><div class="track"><div class="fill" style="background:${res.color}"></div></div></div>` : ''}</div>
        <div class="effects"></div></div>${f.isPlayer ? '<div class="party" id="party" hidden></div>' : ''}`;
  }

  // Карточка бойца на экране: свой герой и монстр; остальные участники показываются строками в плашке героя
  function elOf(id) {
    const b = ui.battle;
    if (b.player && id === b.player.id) return $('#f-p');
    if (id === b.monster.id) return $('#f-m');
    return null;
  }

  // Кого бьёт монстр — подсвечиваем, только когда живых участников больше одного
  function tankOf(snap) {
    const b = ui.battle;
    if (!ui.session || !snap.$tank) return null;
    const alive = b.players.filter((f) => !f.left && (snap[f.id] ? snap[f.id].hp : f.hp) > 0);
    return alive.length > 1 && alive.some((f) => f.id === snap.$tank) ? snap.$tank : null;
  }

  function applySnapshot(snap) {
    ui.snap = snap;
    renderParty(snap);
    const me = $('#f-p > .head');
    if (me) me.classList.toggle('aggro', !!ui.battle.player && tankOf(snap) === ui.battle.player.id);
    for (const f of ui.battle.fighters) {
      const s = snap[f.id];
      const el = elOf(f.id);
      if (!s || !el) continue;
      const pct = s.hp / f.maxHp;
      const fill = el.querySelector('.hp .fill');
      fill.style.width = `${pct * 100}%`;
      el.querySelector('.hp .lag').style.width = `${pct * 100}%`;   // светлый «след» догоняет полоску с задержкой
      fill.style.backgroundColor = pct > 0.5 ? 'var(--hp)' : pct > 0.25 ? 'var(--hp-mid)' : 'var(--hp-low)';
      el.querySelector('.hp .shield-fill').style.width = `${Math.min(1, s.shield / f.maxHp) * 100}%`;
      el.querySelector('.hp .v').textContent = `${fmt(s.hp)}${s.shield ? ` +${fmt(s.shield)}` : ''}`;
      el.querySelector('.hp').title = `${fmt(s.hp)} / ${fmt(f.maxHp)}`;
      const res = el.querySelector('.res');
      if (res) {
        res.querySelector('.fill').style.width = `${(s.res / f.resMax) * 100}%`;
        res.title = `${f.resName}: ${Math.round(s.res)} / ${f.resMax}`;
      }
      el.querySelector('.effects').innerHTML = chipsHtml(f, s.effects, true);
      el.classList.toggle('dead', s.hp <= 0);
    }
  }

  // Значки эффектов: в колонке помещаются два, при большем числе — первый и «+N», по нажатию открывается список всех
  const FX_SLOTS = 2;
  function chipsHtml(f, effects, turns) {
    const list = (effects || []).filter((e) => e.id !== 'shield');
    const shown = list.length > FX_SLOTS ? list.slice(0, FX_SLOTS - 1) : list;
    const more = list.length - shown.length;
    return shown.map((e) => `<span class="chip ${e.kind}" data-fx="${f.id}|${e.id}" title="${e.name}">${e.name.slice(0, 2)}${!turns || e.disable || e.turns > 50 ? '' : e.turns}</span>`).join('') +
      (more ? `<span class="chip more" data-fx-all="${f.id}" title="Все эффекты">+${more}</span>` : '');
  }

  // Разметка лога в духе оригинала → HTML. Имена уже экранированы движком.
  function renderText(text) {
    return text
      .replace(/<ch t="(\d)">(.*?)<\/ch>/g, '<span class="ch t$1">$2</span>')
      .replace(/<dmg k="(\w+)">(.*?)<\/dmg>/g, '<span class="dmg k-$1">$2</span>')
      .replace(/<hp>(.*?)<\/hp>/g, '<span class="hp">$1</span>')
      .replace(/<skill>(.*?)<\/skill>/g, '<span class="skill-name">«$1»</span>');
  }

  function addEntry(entry) {
    const div = document.createElement('div');
    div.className = `entry ${entry.type}`;
    div.innerHTML = entry.type === 'turn' ? `Ход ${entry.text}` : renderText(entry.text);
    const log = $('#log');
    log.appendChild(div);
    while (log.children.length > 150) log.firstChild.remove();
    log.scrollTop = log.scrollHeight;
    if (entry.type === 'turn') $('#turn-title').textContent = `Ход ${entry.text}`;
  }

  const FLOAT = { normal: '#f2f4f8', crit: '#ff6b5e', block: '#b9a3ff', critblock: '#ffb347', poison: '#9fd34c', bleed: '#ff5d6c', burn: '#ff9a4d', fire: '#ff9a4d', cold: '#8fd3ff', lightning: '#f7e26b', magic: '#c39bff', arcane: '#c39bff' };

  const CRIT = { crit: 1, critblock: 1 };

  // Короткий класс-вспышка на карточке: снимаем и ставим заново, чтобы анимация проигралась ещё раз
  function flash(el, cls, color) {
    if (color) el.style.setProperty('--fx', color);
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
  }

  function animateEvent(ev) {
    if (!ev) return;
    if (ev.type === 'join') return animateJoin(ev);
    const el = elOf(ev.target);
    if (!el) return;
    const fl = document.createElement('div');
    fl.className = 'float';
    if (ev.type === 'damage') {
      const crit = CRIT[ev.kind];
      el.classList.remove('hit', 'hit-crit');
      flash(el, crit ? 'hit-crit' : 'hit', FLOAT[ev.kind] || '#fff');
      if (crit) fl.classList.add('crit');
    }
    if (ev.type === 'miss') { flash(el, 'dodged'); fl.textContent = 'мимо'; fl.style.color = '#8b93a7'; fl.style.fontSize = '15px'; }
    else if (ev.type === 'heal') { flash(el, 'glow', '#6fe28f'); fl.textContent = `+${fmt(ev.amount)}`; fl.style.color = '#6fe28f'; }
    else if (ev.type === 'mana') { flash(el, 'glow', '#7fb0ff'); fl.textContent = `+${ev.amount}`; fl.style.color = '#7fb0ff'; }
    else if (ev.type === 'shield') { flash(el, 'glow', '#8fd3ff'); fl.textContent = `⛨ ${fmt(ev.amount)}`; fl.style.color = '#8fd3ff'; }
    else { fl.textContent = `-${fmt(ev.amount)}`; fl.style.color = FLOAT[ev.kind] || '#fff'; }
    el.appendChild(fl);
    setTimeout(() => fl.remove(), 1000);
  }

  // Кто-то вступил в общий бой: плашка над ареной, новая строка в списке союзников, враг набирает силу
  function animateJoin(ev) {
    const b = ui.battle;
    const f = b.fighters.find((x) => x.id === ev.target);
    if (!f || f === b.player) return;
    flash($('#f-p'), 'ally-join');
    const m = $('#f-m');
    if (ev.amount) {
      flash(m, 'glow', '#e0a060');
      const fl = document.createElement('div');
      fl.className = 'float grow';
      fl.textContent = `+${fmt(ev.amount)}`;
      fl.style.color = '#e0a060';
      m.appendChild(fl);
      setTimeout(() => fl.remove(), 1000);
    }
    const arena = $('#arena');
    arena.querySelectorAll('.join-banner').forEach((x) => x.remove());
    const ban = document.createElement('div');
    ban.className = 'join-banner';
    ban.innerHTML = `${avatar(f, 22)}<span><b>${f.name}</b> вступает в бой!</span>`;
    arena.appendChild(ban);
    setTimeout(() => ban.remove(), 2200);
  }

  // Показывает новые записи лога по одной. Действия не ждут показа — показ лишь догоняет события.
  function pump() {
    if (ui.pumping) return;
    ui.pumping = true;
    const battle = ui.battle;
    const next = () => {
      if (battle !== ui.battle) { ui.pumping = false; return; }
      if (ui.shown >= battle.log.length) {
        ui.pumping = false;
        // бой окончен или в общем бою погиб мой герой (остальные дерутся дальше)
        if ((battle.ended || (ui.session && battle.player.hp <= 0)) && !ui.finished) setTimeout(() => finish(false), 700);
        return;
      }
      const entry = battle.log[ui.shown++];
      if (entry.ev && entry.ev.type === 'join') ui.joinedAt.set(entry.ev.target, Date.now());
      addEntry(entry);
      applySnapshot(entry.snap);
      animateEvent(entry.ev);
      // в большом бою лога много: ускоряем показ, чтобы он не отставал от тиков
      const backlog = battle.log.length - ui.shown;
      setTimeout(next, entry.type === 'poetry' ? 500 : Math.max(40, Math.min(STEP_MS, 6000 / (backlog + 1))));
    };
    next();
  }

  function updateBar() {
    const t = ui.turn;
    if (!t || ui.battle.ended) { $('#turn-fill').style.width = '0'; $('#turn-txt').textContent = ''; $('#tick-label').textContent = ''; return; }
    const now = Date.now();
    const dur = t.end - t.start;
    const left = Math.max(0, t.end - now);
    $('#turn-fill').style.width = `${Math.min(1, (now - t.start) / dur) * 100}%`;
    $('#turn-fill').classList.toggle('low', left < 2500 && !t.playerActed);
    const mark = $('#turn-mark');
    mark.style.left = `${((t.monsterAt - t.start) / dur) * 100}%`;
    mark.classList.toggle('done', t.monsterActed);
    $('#turn-txt').textContent = t.playerActed ? `Ход сделан · следующий через ${Math.ceil(left / 1000)} с`
      : `Ваш ход: ${Math.ceil(left / 1000)} с${ui.opts.settings.autoBattle ? ' · автобой' : ''}`;
    $('#tick-label').textContent = `${Math.ceil(left / 1000)} с`;
  }

  // aborted: общий бой оборвался (хозяин ушёл, не нашли бой) — без потерь и наград
  function finish(fled, aborted) {
    if (ui.finished) return;
    stop();
    closeSheet();
    closeModal();
    $('#tick-label').textContent = '';
    const b = ui.battle, me = b.player;
    const share = ui.session && me ? { my: me.dealt, total: b.totalDealt } : null;
    const rejoin = aborted === 'version' || aborted === 'desync';   // страница перезагрузится и вернётся в бой: героя из боя не выводим
    if (ui.session && rejoin) ui.session.stop();
    else if (ui.session && (fled || aborted || !ui.session.host)) ui.session.leave();   // хозяин при победе/гибели остаётся движком боя
    ui.opts.onEnd(b, { fled, share, aborted: aborted || null });
  }

  // ---------- Панель умений ----------

  function renderSkillbar() {
    const b = ui.battle;
    const p = b.player;
    const lock = b.ended || p.hp <= 0 || (ui.turn && ui.turn.playerActed);
    const buttons = [`<button class="sk basic" data-skill="basic" ${lock ? 'disabled' : ''}>${art('stats/atk', '⚔')}<span>Удар</span></button>`];
    for (const sk of p.skills) {
      const st = b.skillState(p, sk.id);
      const s = st.def;
      buttons.push(`<button class="sk ${st.usable && !lock ? 'ready' : ''}" data-skill="${sk.id}" ${lock || !st.usable ? 'disabled' : ''} title="${s.name} (ур. ${sk.lvl})">
        ${art(`stats/${s.icon || 'atk'}`, s.name.charAt(0))}<span>${s.name}</span><span class="cost">${st.cost ? `${st.cost} ${p.resName.toLowerCase()}` : 'бесплатно'}</span>
        ${st.cd ? `<span class="cd">${st.cd}</span>` : ''}</button>`);
    }
    const potCd = b.potionCooldown(p);
    const potions = p.consumables.filter((c) => c.count > 0);
    if (potions.length) {
      const total = potions.reduce((s, c) => s + c.count, 0);
      buttons.push(`<button class="sk" data-act="potions" ${b.ended || p.hp <= 0 || !b.canUseConsumable(p) || (ui.session && ui.session.turn && ui.session.turn.potted) ? 'disabled' : ''} title="Зелья">
        ${art('materials/potion_hp_1', '🧪')}<span>Зелья</span><span class="count">${total}</span>${potCd ? `<span class="cd">${potCd}</span>` : ''}</button>`);
    }
    const bar = $('#skillbar');
    bar.style.gridTemplateColumns = `repeat(${buttons.length}, 1fr)`;
    bar.innerHTML = buttons.join('');
  }

  function openPotions() {
    const b = ui.battle;
    const p = b.player;
    const list = p.consumables.filter((c) => c.count > 0).map((c) => {
      const d = data.consumables[c.id];
      return `<button class="mob" data-potion="${c.id}"><div class="ava" style="width:44px;height:44px">${art(d.art, '🧪')}</div>
        <div class="txt"><b>${d.name}</b><div class="meta">${d.desc} · есть ${c.count}</div></div></button>`;
    }).join('');
    openModal('Зелья', `<p class="meta">Зелье не тратит ход. После него — откат ${data.POTION_CD} хода.</p><div class="list">${list}</div>`, (e) => {
      const btn = e.target.closest('[data-potion]');
      if (!btn) return;
      closeModal();
      if (ui.session) { if (ui.session.submitPotion(btn.dataset.potion)) afterAction(); return; }
      if (b.useConsumable(p, btn.dataset.potion)) afterAction();
    });
  }

  $('#skillbar').addEventListener('click', (e) => {
    const s = e.target.closest('[data-skill]');
    if (s && !s.disabled) return playerAct(s.dataset.skill);
    if (e.target.closest('[data-act="potions"]')) openPotions();
  });

  // ---------- Автобой и настройки охоты ----------

  function renderToggles() {
    $('#auto-btn').classList.toggle('on', !!ui.opts.settings.autoBattle);
    $('#auto-btn').textContent = ui.opts.settings.autoHunt ? 'Автоохота' : 'Автобой';
    $('#auto-btn').classList.toggle('hunt', !!ui.opts.settings.autoHunt);
  }

  function changeSettings(patch) {
    Object.assign(ui.opts.settings, patch);
    renderToggles();
    if (ui.opts.onSettings) ui.opts.onSettings(ui.opts.settings);
    // Включили автобой посреди хода — он сработает сразу, если его момент уже прошёл
    if (patch.autoBattle && ui.turn && !ui.turn.playerActed && ui.session) sharedAuto();
    else if (patch.autoBattle && ui.turn && !ui.turn.playerActed && Date.now() >= ui.turn.autoAt) autoAct();
  }

  $('#auto-btn').addEventListener('click', () => changeSettings({ autoBattle: !ui.opts.settings.autoBattle, autoHunt: ui.opts.settings.autoBattle ? false : ui.opts.settings.autoHunt }));
  $('#auto-settings').addEventListener('click', () => openAutoSettings(ui.opts.settings, changeSettings));

  // Окно настроек: используется и в бою, и на экране локации
  function openAutoSettings(settings, apply) {
    const render = () => {
      const s = settings;
      const salv = [-1, 0, 1, 2, 3].map((r) => `<option value="${r}" ${s.autoSalvage === r ? 'selected' : ''}>${r < 0 ? 'выключен' : `до «${data.rarities[r].name}» включительно`}</option>`).join('');
      const pot = [0, 25, 35, 50, 65].map((v) => `<option value="${v}" ${(s.potionAt ?? 35) === v ? 'selected' : ''}>${v ? `здоровье ниже ${v}%` : 'не пить'}</option>`).join('');
      openModal('Автобой и охота', `
        <div class="toggle"><span><b>Автобой</b><br><small class="meta">В свой момент тика — первое готовое умение по порядку ячеек</small></span>
          <button class="chip-btn ${s.autoBattle ? 'on' : ''}" data-set="autoBattle">${s.autoBattle ? 'вкл' : 'выкл'}</button></div>
        <div class="toggle"><span><b>Автоохота</b><br><small class="meta">После передышки сам нападает на монстров локации. Боссов не трогает</small></span>
          <button class="chip-btn ${s.autoHunt ? 'on' : ''}" data-set="autoHunt">${s.autoHunt ? 'вкл' : 'выкл'}</button></div>
        <div class="toggle"><span><b>Зелье здоровья</b></span><select data-sel="potionAt">${pot}</select></div>
        <div class="toggle"><span><b>Авторазбор добычи</b></span><select data-sel="autoSalvage">${salv}</select></div>`, (e) => {
        const b = e.target.closest('[data-set]');
        if (b) {
          const k = b.dataset.set;
          const patch = { [k]: !s[k] };
          if (k === 'autoHunt' && patch.autoHunt) patch.autoBattle = true;
          if (k === 'autoBattle' && !patch.autoBattle) patch.autoHunt = false;
          apply(patch);
          return render();
        }
        const sel = e.target.closest('[data-sel]');
        if (sel && e.type === 'change') apply({ [sel.dataset.sel]: Number(sel.value) });
      });
    };
    render();
  }

  $('#leave').addEventListener('click', () => {
    if (ui.opts && ui.opts.preview) { if (ui.opts.onCancel) ui.opts.onCancel(); return; }
    if (!ui.battle.ended && !confirm('Сбежать из боя? Это засчитается как поражение. Остальные продолжат бой.')) return;
    changeSettings({ autoHunt: false });
    finish(!ui.battle.ended && ui.battle.player.hp > 0);
  });

  // Подсказки по бойцам
  $('#arena').addEventListener('click', (e) => {
    const chip = e.target.closest('[data-fx]');
    if (chip) { openEffect(...chip.dataset.fx.split('|')); return; }
    const all = e.target.closest('[data-fx-all]');
    if (all) { openEffects(all.dataset.fxAll); return; }
    const card = e.target.closest('.fighter');
    if (!card) return;
    if (card.id === 'f-m' && ui.opts && ui.opts.onMonsterInfo) { ui.opts.onMonsterInfo(); return; }
    const f = card.id === 'f-p' ? ui.battle.player : ui.battle.monster;
    const s = f.s;
    const rows = [
      ['Атака', s.caster ? fmt(s.matk) : `${fmt(s.atk)} + ${fmt(s.weaponMin)}–${fmt(s.weaponMax)}`],
      ['Защита / маг.', `${fmt(s.def)} / ${fmt(s.mdef)}`],
      ['Крит', `${Math.round(s.crit)}% ×${Math.round(s.critDmg)}%`],
      ['Точность / уклонение', `${Math.round(s.acc)} / ${Math.round(s.eva)}`],
      ['Скорость', Math.round(s.speed)],
      ['Блок', `${Math.round(s.block || 0)}%`],
    ];
    openModal(f.name, rows.map(([k, v]) => `<div class="kv"><span>${k}</span><b>${v}</b></div>`).join('') +
      (f.effects.length ? `<p class="hint">${f.effects.map((x) => x.name).join(', ')}</p>` : ''));
  });

  // Подробности эффекта: что он делает и сколько ему осталось. Только чтение — состояние боя не меняется.
  const MOD_NAMES = {
    atkPct: 'Атака', matkPct: 'Магическая атака', defPct: 'Защита', mdefPct: 'Магическая защита', speedPct: 'Скорость',
    dmgPct: 'Наносимый урон', dmgTakenPct: 'Получаемый урон', lifesteal: 'Вампиризм', crit: 'Шанс крита',
  };
  const DOT_NAMES = { poison: 'ядом', bleed: 'кровотечением', burn: 'огнём' };
  const signed = (n) => `${n > 0 ? '+' : '−'}${Math.abs(n)}%`;

  function describeEffect(e) {
    const lines = [];
    if (e.disable) lines.push(e.id === 'freeze' ? 'Скован льдом и пропускает ход.' : 'Оглушён и пропускает ход.');
    if (e.dot) lines.push(`Каждый ход получает ${fmt(e.dot.per)} урона ${DOT_NAMES[e.dot.kind] || ''}.`.replace(' .', '.'));
    for (const [k, v] of Object.entries(e.mods || {})) {
      if (!v || !MOD_NAMES[k]) continue;
      lines.push(`${MOD_NAMES[k]} ${signed(Math.round(k === 'crit' ? v : v * 100))}.`);
    }
    if (e.dodge) lines.push(`Шанс уклониться от удара +${Math.round(e.dodge * 100)}%.`);
    if (e.nextCrit) lines.push('Следующий удар — критический.');
    if (e.nextSpell) lines.push(`Следующее заклинание +${Math.round(e.nextSpell * 100)}% урона.`);
    if (e.counter) lines.push(`Отвечает на каждый удар контратакой на ${Math.round(e.counter * 100)}% атаки.`);
    if (e.shieldHp) lines.push(`Поглощает ${fmt(e.shieldHp)} урона.`);
    return lines.length ? lines : [e.kind === 'debuff' ? 'Ослабляющий эффект.' : 'Усиливающий эффект.'];
  }

  function openEffect(fid, eid) {
    const b = ui.battle;
    const f = b && b.fighters.find((x) => String(x.id) === fid);
    if (!f) return;
    const shown = ui.snap && ui.snap[f.id] && (ui.snap[f.id].effects || []).find((x) => x.id === eid);
    const live = f.effects.find((x) => x.id === eid);
    const e = live || shown;
    if (!e) return;
    const left = effectLeft(e, shown);
    const src = e.source != null && e.source !== f.id ? b.fighters.find((x) => x.id === e.source) : null;
    openModal(e.name, `
      <div class="row" style="gap:8px;margin-bottom:8px"><span class="tag ${e.kind === 'debuff' ? 'boss' : 'kind'}">${e.kind === 'debuff' ? 'Ослабление' : 'Усиление'}</span><span class="meta">${f.name}</span></div>
      ${describeEffect(e).map((t) => `<p class="meta" style="margin:4px 0">${t}</p>`).join('')}
      <div class="kv"><span>Осталось</span><b>${left}</b></div>
      ${src ? `<div class="kv"><span>Наложил</span><b>${src.name}</b></div>` : ''}`);
  }

  // длительность — как на экране (по проигранной строке лога), а не «из будущего»
  function effectLeft(e, shown) {
    const turns = shown ? shown.turns : e.turns;
    return e.disable ? 'До конца хода' : turns > 50 ? 'До конца боя' : `${turns} ${plural(turns, 'ход', 'хода', 'ходов')}`;
  }

  // Все эффекты бойца списком: что делает и сколько осталось; нажатие на строку — подробности с тем, кто наложил
  function openEffects(fid) {
    const b = ui.battle;
    const f = b && b.fighters.find((x) => String(x.id) === fid);
    if (!f) return;
    const shown = ((ui.snap && ui.snap[f.id] && ui.snap[f.id].effects) || f.effects).filter((x) => x.id !== 'shield');
    if (!shown.length) return;
    const rows = shown.map((s) => {
      const e = f.effects.find((x) => x.id === s.id) || s;
      return `<button class="fx-row" data-fx="${f.id}|${s.id}"><span class="chip ${s.kind}">${s.name.slice(0, 2)}</span>
        <div class="txt"><div class="fx-head"><b>${s.name}</b><span class="meta">${effectLeft(e, s)}</span></div>
        ${describeEffect(e).map((t) => `<div class="meta">${t}</div>`).join('')}</div></button>`;
    }).join('');
    openModal(`Эффекты · ${f.name}`, `<div class="list">${rows}</div>`, (ev) => {
      const row = ev.target.closest('[data-fx]');
      if (row) openEffect(...row.dataset.fx.split('|'));
    });
  }

  function plural(n, one, few, many) {
    const m10 = n % 10, m100 = n % 100;
    return m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many;
  }

  // Окно боя сразу по «Вступить»: монстр и герой из строки списка боёв, пока хозяин не прислал историю
  function preview(o) {
    stop();
    ui.opts = { settings: o.settings || {}, onSettings: o.onSettings, preview: true, onCancel: o.onCancel, onMonsterInfo: o.onMonsterInfo };
    ui.session = null;
    ui.turn = null;
    ui.battle = new Battle({ player: o.player, monster: o.monster, data });
    const m = ui.battle.monster;
    if (o.maxHp > 0) { m.maxHp = o.maxHp; m.hp = Math.max(1, Math.min(o.maxHp, o.hp || o.maxHp)); }
    ui.shown = 0;
    ui.joinedAt.clear();
    $('#log').innerHTML = '<div class="entry passed">Подключаемся к бою…</div>';
    $('#turn-title').textContent = 'Вступаем в бой';
    $('#f-p').innerHTML = fighterHtml(ui.battle.player);
    $('#f-m').innerHTML = fighterHtml(m);
    $('#f-m').classList.toggle('boss', !!m.boss);
    renderToggles();
    renderSkillbar();
    for (const btn of document.querySelectorAll('#skillbar button')) btn.disabled = true;
    $('#turn-fill').style.width = '0';
    $('#turn-txt').textContent = 'Подключаемся к бою…';
    $('#tick-label').textContent = '';
  }

  PC.battleUI = { start, stop, preview, openAutoSettings };
})();
