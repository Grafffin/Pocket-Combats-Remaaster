// Экран боя на синхронном тике (как в оригинале): ходы разыгрываются на общих границах тика мира (5 с).
// До тика игрок выбирает действие (можно передумать); без выбора — автобой или обычный удар.
// PC.battleUI.start({ player, monster, settings, onEnd(battle, { fled }), onSettings(settings) })
(function () {
  'use strict';
  const { Battle, data, world: W } = PC;
  const { $, art, avatar, openModal, closeModal, closeSheet } = PC.kit;

  const MIN_LEAD = 1500;   // если до тика меньше — ход переносится на следующий тик
  const STEP_MS = 280;     // показ одной строки лога

  const ui = { battle: null, opts: null, shown: 0, busy: false, finished: false, pending: null, dueAt: 0, turnTimer: null, barTimer: null };

  function start(opts) {
    stop();
    ui.opts = opts;
    ui.battle = new Battle({ player: opts.player, monster: opts.monster, data });
    ui.shown = 0;
    ui.finished = false;
    ui.pending = null;
    $('#log').innerHTML = '';
    $('#turn-title').textContent = 'Ход 1';
    const b = ui.battle;
    $('#f-p').innerHTML = fighterHtml(b.player);
    $('#f-m').innerHTML = fighterHtml(b.monster);
    $('#f-m').classList.toggle('boss', b.monster.boss);
    renderToggles();
    ui.barTimer = setInterval(updateBar, 100);
    play(scheduleTurn);
  }

  function stop() {
    ui.finished = true;
    clearTimeout(ui.turnTimer);
    clearInterval(ui.barTimer);
  }

  function fighterHtml(f) {
    const res = f.resource ? data.resources[f.resource] : null;
    return `<div class="head">${avatar(f)}<div style="min-width:0">
        <div class="name">${f.name}</div><div class="lvl">${f.boss ? 'Босс · ' : ''}${f.level} ур.</div></div></div>
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
      el.querySelector('.hp .v').textContent = `${s.hp}${s.shield ? ` +${s.shield}` : ''} / ${f.maxHp}`;
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
    else if (ev.type === 'heal') { fl.textContent = `+${ev.amount}`; fl.style.color = '#6fe28f'; }
    else if (ev.type === 'mana') { fl.textContent = `+${ev.amount}`; fl.style.color = '#7fb0ff'; }
    else if (ev.type === 'shield') { fl.textContent = `⛨ ${ev.amount}`; fl.style.color = '#8fd3ff'; }
    else { fl.textContent = `-${ev.amount}`; fl.style.color = FLOAT[ev.kind] || '#fff'; }
    el.appendChild(fl);
    setTimeout(() => fl.remove(), 900);
  }

  // Показывает новые записи лога по одной, синхронно обновляя полоски; затем вызывает then()
  function play(then) {
    ui.busy = true;
    renderSkillbar();
    const battle = ui.battle;
    const pending = battle.log.length - ui.shown;
    const step = Math.min(STEP_MS, 3200 / Math.max(1, pending));
    const next = () => {
      if (battle !== ui.battle || ui.finished) return;
      if (ui.shown >= battle.log.length) { ui.busy = false; renderSkillbar(); if (then) then(); return; }
      const entry = battle.log[ui.shown++];
      addEntry(entry);
      applySnapshot(entry.snap);
      animateEvent(entry.ev);
      setTimeout(next, entry.type === 'poetry' ? 600 : step);
    };
    next();
  }

  // ---------- Тик ----------

  function scheduleTurn() {
    if (ui.battle.ended) { setTimeout(() => finish(false), 600); return; }
    const now = Date.now();
    let due = now + W.msToNextTick(now);
    if (due - now < MIN_LEAD) due += W.TICK_MS;
    ui.dueAt = due;
    clearTimeout(ui.turnTimer);
    ui.turnTimer = setTimeout(resolveTurn, due - now);
    updateBar();
  }

  function resolveTurn() {
    const b = ui.battle;
    if (ui.finished || b.ended) return;
    const p = b.player;
    let action = ui.pending;
    if (!action) {
      if (ui.opts.settings.autoBattle) { autoPotions(); action = b.autoAction(p); }
      else action = 'basic';
    }
    if (action !== 'basic' && !b.skillState(p, action).usable) action = 'basic';
    ui.pending = null;
    ui.dueAt = 0;
    b.submit(action);
    play(scheduleTurn);
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
    const minCost = Math.min(...p.skills.map((s) => b.skillCost(p, s.id)).filter((x) => x > 0), Infinity);
    if (mp && p.resource === 'mana' && p.res < minCost) b.useConsumable(p, mp.id);
  }

  function updateBar() {
    const fill = $('#timer-fill');
    const label = $('#tick-label');
    if (!ui.dueAt || ui.busy || ui.battle.ended) { fill.style.width = '0'; label.textContent = ui.busy ? '' : ''; return; }
    const left = Math.max(0, ui.dueAt - Date.now());
    fill.style.width = `${(1 - left / (W.TICK_MS + MIN_LEAD)) * 100}%`;
    fill.classList.toggle('low', left < 1500);
    label.textContent = `тик ${Math.ceil(left / 1000)} с`;
  }

  function finish(fled) {
    if (ui.finished) return;
    stop();
    closeSheet();
    closeModal();
    $('#timer-fill').style.width = '0';
    $('#tick-label').textContent = '';
    ui.opts.onEnd(ui.battle, { fled });
  }

  // ---------- Панель умений ----------

  function renderSkillbar() {
    const b = ui.battle;
    const p = b.player;
    const lock = b.ended;
    const sel = (id) => (ui.pending === id ? 'picked' : '');
    const buttons = [`<button class="sk basic ${sel('basic')}" data-skill="basic" ${lock ? 'disabled' : ''}>${art('stats/atk', '⚔')}<span>Удар</span></button>`];
    for (const sk of p.skills) {
      const st = b.skillState(p, sk.id);
      const s = st.def;
      buttons.push(`<button class="sk ${st.usable ? 'ready' : ''} ${sel(sk.id)}" data-skill="${sk.id}" ${lock || !st.usable ? 'disabled' : ''} title="${s.name} (ур. ${sk.lvl})">
        ${art(`stats/${s.icon || 'atk'}`, s.name.charAt(0))}<span>${s.name}</span><span class="cost">${st.cost ? `${st.cost} ${p.resName.toLowerCase()}` : 'бесплатно'}</span>
        ${st.cd ? `<span class="cd">${st.cd}</span>` : ''}</button>`);
    }
    const potCd = b.potionCooldown(p);
    const potions = p.consumables.filter((c) => c.count > 0);
    if (potions.length) {
      const total = potions.reduce((s, c) => s + c.count, 0);
      buttons.push(`<button class="sk" data-act="potions" ${lock || !b.canUseConsumable(p) ? 'disabled' : ''} title="Зелья">
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
      if (b.useConsumable(p, btn.dataset.potion)) play(() => { if (!ui.dueAt) scheduleTurn(); });
    });
  }

  $('#skillbar').addEventListener('click', (e) => {
    if (ui.battle.ended) return;
    const s = e.target.closest('[data-skill]');
    if (s && !s.disabled) {
      ui.pending = ui.pending === s.dataset.skill ? null : s.dataset.skill; // повторное нажатие снимает выбор
      renderSkillbar();
      return;
    }
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
  }

  $('#auto-btn').addEventListener('click', () => changeSettings({ autoBattle: !ui.opts.settings.autoBattle, autoHunt: ui.opts.settings.autoBattle ? false : ui.opts.settings.autoHunt }));
  $('#auto-settings').addEventListener('click', () => openAutoSettings(ui.opts.settings, changeSettings));

  // Окно настроек: используется и в бою, и на экране итога
  function openAutoSettings(settings, apply) {
    const render = () => {
      const s = settings;
      const salv = [-1, 0, 1, 2, 3].map((r) => `<option value="${r}" ${s.autoSalvage === r ? 'selected' : ''}>${r < 0 ? 'выключен' : `до «${data.rarities[r].name}» включительно`}</option>`).join('');
      const pot = [0, 25, 35, 50, 65].map((v) => `<option value="${v}" ${(s.potionAt ?? 35) === v ? 'selected' : ''}>${v ? `здоровье ниже ${v}%` : 'не пить'}</option>`).join('');
      openModal('Автобой и охота', `
        <div class="toggle"><span><b>Автобой</b><br><small class="meta">Каждый ход — первое готовое умение по порядку ячеек</small></span>
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
      ['Атака', s.caster ? Math.round(s.matk) : `${Math.round(s.atk)} + ${s.weaponMin}–${s.weaponMax}`],
      ['Защита / маг.', `${Math.round(s.def)} / ${Math.round(s.mdef)}`],
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
