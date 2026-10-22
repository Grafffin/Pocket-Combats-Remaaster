// Экран боя в реальном времени тика (как в оригинале). Один ход = один глобальный тик мира (10 с).
// Игрок должен успеть нажать удар или умение за тик; противник действует в свой момент, который зависит
// от соотношения скоростей (быстрее игрок — позже бьёт противник). С автобоем игрок действует в свой момент.
// PC.battleUI.start({ player, monster, settings, onEnd(battle, { fled }), onSettings(settings) })
(function () {
  'use strict';
  const { Battle, data, world: W } = PC;
  const { $, art, avatar, openModal, closeModal, closeSheet } = PC.kit;
  const fmt = PC.fmtBig;

  const MIN_FIRST_TURN = 5000;  // если до границы тика меньше — первый ход длится до следующей
  const STEP_MS = 220;          // показ одной строки лога

  const ui = {
    battle: null, opts: null, shown: 0, finished: false,
    turn: null,            // { start, end, monsterAt, autoAt, playerActed, monsterActed }
    timers: [], barTimer: null, pumping: false,
  };

  function start(opts) {
    stop();
    ui.opts = opts;
    ui.battle = new Battle({ player: opts.player, monster: opts.monster, data });
    ui.shown = 0;
    ui.finished = false;
    $('#log').innerHTML = '';
    $('#turn-title').textContent = 'Ход 1';
    const b = ui.battle;
    $('#f-p').innerHTML = fighterHtml(b.player);
    $('#f-m').innerHTML = fighterHtml(b.monster);
    $('#f-m').classList.toggle('boss', b.monster.boss);
    renderToggles();
    ui.barTimer = setInterval(updateBar, 100);
    const now = Date.now();
    let end = now + W.msToNextTick(now);
    if (end - now < MIN_FIRST_TURN) end += W.TICK_MS;
    beginTurn(now, end);
    pump();
  }

  function clearTimers() { ui.timers.forEach(clearTimeout); ui.timers = []; }
  function later(fn, ms) { ui.timers.push(setTimeout(fn, Math.max(0, ms))); }

  function stop() {
    ui.finished = true;
    clearTimers();
    clearInterval(ui.barTimer);
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
    const hp = pick('hp_potion');
    if (hp && p.hp / p.maxHp < at) { b.useConsumable(p, hp.id); return; }
    const mp = pick('mp_potion');
    const costs = p.skills.map((s) => b.skillCost(p, s.id)).filter((x) => x > 0);
    if (mp && p.resource === 'mana' && costs.length && p.res < Math.min(...costs)) b.useConsumable(p, mp.id);
  }

  // ---------- Отрисовка ----------

  function fighterHtml(f) {
    const res = f.resource ? data.resources[f.resource] : null;
    return `<div class="head">${avatar(f)}<div style="min-width:0">
        <div class="name">${f.name}</div><div class="lvl">${f.diff ? `<span style="color:${data.difficulties[f.diff].color}">${data.difficulties[f.diff].name}</span> · ` : ''}${f.boss ? 'Босс · ' : ''}${f.level} ур. · скорость ${Math.round(f.s.speed)}</div></div></div>
      <div class="meter hp"><div class="track"><div class="fill"></div><div class="shield-fill"></div></div><div class="num"><span>HP</span><span class="v"></span></div></div>
      ${res ? `<div class="meter res"><div class="track"><div class="fill" style="background:${res.color}"></div></div><div class="num"><span>${res.name}</span><span class="v"></span></div></div>` : ''}
      <div class="effects"></div>`;
  }

  function applySnapshot(snap) {
    for (const f of ui.battle.fighters) {
      const s = snap[f.id];
      const el = $(`#f-${f.id}`);
      const pct = s.hp / f.maxHp;
      const fill = el.querySelector('.hp .fill');
      fill.style.width = `${pct * 100}%`;
      fill.style.backgroundColor = pct > 0.5 ? 'var(--hp)' : pct > 0.25 ? 'var(--hp-mid)' : 'var(--hp-low)';
      el.querySelector('.hp .shield-fill').style.width = `${Math.min(1, s.shield / f.maxHp) * 100}%`;
      el.querySelector('.hp .v').textContent = `${fmt(s.hp)}${s.shield ? ` +${fmt(s.shield)}` : ''} / ${fmt(f.maxHp)}`;
      const res = el.querySelector('.res');
      if (res) {
        res.querySelector('.fill').style.width = `${(s.res / f.resMax) * 100}%`;
        res.querySelector('.v').textContent = `${Math.round(s.res)} / ${f.resMax}`;
      }
      el.querySelector('.effects').innerHTML = s.effects.filter((e) => e.id !== 'shield').map((e) =>
        `<span class="chip ${e.kind}">${e.name}${e.disable || e.turns > 50 ? '' : ' ' + e.turns}</span>`).join('');
      el.classList.toggle('dead', s.hp <= 0);
    }
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

  function animateEvent(ev) {
    if (!ev) return;
    const el = $(`#f-${ev.target}`);
    if (ev.type === 'damage') { el.classList.remove('hit'); void el.offsetWidth; el.classList.add('hit'); }
    const fl = document.createElement('div');
    fl.className = 'float';
    if (ev.type === 'miss') { fl.textContent = 'мимо'; fl.style.color = '#8b93a7'; fl.style.fontSize = '15px'; }
    else if (ev.type === 'heal') { fl.textContent = `+${fmt(ev.amount)}`; fl.style.color = '#6fe28f'; }
    else if (ev.type === 'mana') { fl.textContent = `+${ev.amount}`; fl.style.color = '#7fb0ff'; }
    else if (ev.type === 'shield') { fl.textContent = `⛨ ${fmt(ev.amount)}`; fl.style.color = '#8fd3ff'; }
    else { fl.textContent = `-${fmt(ev.amount)}`; fl.style.color = FLOAT[ev.kind] || '#fff'; }
    el.appendChild(fl);
    setTimeout(() => fl.remove(), 900);
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
        if (battle.ended && !ui.finished) setTimeout(() => finish(false), 700);
        return;
      }
      const entry = battle.log[ui.shown++];
      addEntry(entry);
      applySnapshot(entry.snap);
      animateEvent(entry.ev);
      setTimeout(next, entry.type === 'poetry' ? 500 : STEP_MS);
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

  function finish(fled) {
    if (ui.finished) return;
    stop();
    closeSheet();
    closeModal();
    $('#tick-label').textContent = '';
    ui.opts.onEnd(ui.battle, { fled });
  }

  // ---------- Панель умений ----------

  function renderSkillbar() {
    const b = ui.battle;
    const p = b.player;
    const lock = b.ended || (ui.turn && ui.turn.playerActed);
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
      buttons.push(`<button class="sk" data-act="potions" ${b.ended || !b.canUseConsumable(p) ? 'disabled' : ''} title="Зелья">
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
    if (patch.autoBattle && ui.turn && !ui.turn.playerActed && Date.now() >= ui.turn.autoAt) autoAct();
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
    if (!ui.battle.ended && !confirm('Сбежать из боя? Это засчитается как поражение.')) return;
    changeSettings({ autoHunt: false });
    finish(!ui.battle.ended);
  });

  // Подсказки по бойцам
  $('#arena').addEventListener('click', (e) => {
    const card = e.target.closest('.fighter');
    if (!card) return;
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

  PC.battleUI = { start, stop, openAutoSettings };
})();
