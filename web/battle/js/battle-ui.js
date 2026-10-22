// Экран боя: проигрывание лога по строчкам, панель умений и зелий, автобой и ускорение.
// PC.battleUI.start({ player, monster, settings: { auto, speed, loop }, onEnd(battle, { fled }), onSettings(settings) })
(function () {
  'use strict';
  const { Battle, data } = PC;
  const { $, art, avatar, openSheet, closeSheet } = PC.kit;

  const ui = { battle: null, opts: null, shown: 0, busy: false, finished: false, autoTimer: null };
  const speed = () => (ui.opts && ui.opts.settings.speed) || 1;

  function start(opts) {
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
    play();
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
    while (log.children.length > 120) log.firstChild.remove();
    log.scrollTop = log.scrollHeight;
    if (entry.type === 'turn') $('#turn-title').textContent = `Ход ${entry.text}`;
  }

  const FLOAT = { normal: '#f2f4f8', crit: '#ff6b5e', block: '#b9a3ff', critblock: '#ffb347', poison: '#9fd34c', bleed: '#ff5d6c', burn: '#ff9a4d', fire: '#ff9a4d', cold: '#8fd3ff', lightning: '#f7e26b', magic: '#c39bff', arcane: '#c39bff' };

  function animateEvent(ev) {
    if (!ev || speed() >= 4) return;
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

  // Показывает новые записи лога по одной, синхронно обновляя полоски
  function play() {
    ui.busy = true;
    renderSkillbar();
    const battle = ui.battle;
    const step = () => {
      if (battle !== ui.battle || ui.finished) return;
      const log = battle.log;
      if (ui.shown >= log.length) { ui.busy = false; afterPlayback(); return; }
      const entry = log[ui.shown++];
      addEntry(entry);
      applySnapshot(entry.snap);
      animateEvent(entry.ev);
      const base = ui.shown === 1 ? 500 : entry.type === 'turn' ? 160 : entry.type === 'poetry' ? 700 : 420;
      setTimeout(step, base / speed());
    };
    step();
  }

  function afterPlayback() {
    renderSkillbar();
    if (ui.battle.ended) { setTimeout(() => finish(false), 500 / speed()); return; }
    if (ui.opts.settings.auto) ui.autoTimer = setTimeout(autoTurn, 200 / speed());
  }

  function autoTurn() {
    const b = ui.battle;
    if (ui.busy || b.ended || ui.finished) return;
    const p = b.player;
    const has = (id) => p.consumables.find((c) => c.id === id && c.count > 0);
    if (b.canUseConsumable(p)) {
      if (has('hp_potion') && p.hp / p.maxHp < 0.35) b.useConsumable(p, 'hp_potion');
      else if (has('mp_potion') && p.resource === 'mana' && p.res < 15) b.useConsumable(p, 'mp_potion');
    }
    act(b.autoAction(p));
  }

  function finish(fled) {
    if (ui.finished) return;
    ui.finished = true;
    clearTimeout(ui.autoTimer);
    closeSheet();
    ui.opts.onEnd(ui.battle, { fled });
  }

  function act(skillId) {
    if (ui.busy || ui.battle.ended) return;
    clearTimeout(ui.autoTimer);
    if (ui.battle.submit(skillId)) play();
  }

  // ---------- Панель умений ----------

  function renderSkillbar() {
    const b = ui.battle;
    const p = b.player;
    const lock = ui.busy || b.ended;
    const buttons = [`<button class="sk basic" data-skill="basic" ${lock ? 'disabled' : ''}>${art('stats/atk', '⚔')}<span>Удар</span></button>`];
    for (const sk of p.skills) {
      const st = b.skillState(p, sk.id);
      const s = st.def;
      buttons.push(`<button class="sk ${st.usable ? 'ready' : ''}" data-skill="${sk.id}" ${lock || !st.usable ? 'disabled' : ''} title="${s.name} (ур. ${sk.lvl})">
        ${art(`stats/${s.icon || 'atk'}`, s.name.charAt(0))}<span>${s.name}</span><span class="cost">${st.cost ? `${st.cost} ${p.resName.toLowerCase()}` : 'бесплатно'}</span>
        ${st.cd ? `<span class="cd">${st.cd}</span>` : ''}</button>`);
    }
    for (const c of p.consumables) {
      if (c.id === 'mp_potion' && !c.count) continue;
      const d = data.consumables[c.id];
      buttons.push(`<button class="sk" data-potion="${c.id}" ${lock || !c.count || !b.canUseConsumable(p) ? 'disabled' : ''} title="${d.name}: ${d.desc}">
        ${art(d.art, '🧪')}<span>${c.id === 'hp_potion' ? 'Лечение' : 'Ресурс'}</span><span class="count">${c.count}</span></button>`);
    }
    const bar = $('#skillbar');
    bar.style.gridTemplateColumns = `repeat(${buttons.length}, 1fr)`;
    bar.innerHTML = buttons.join('');
  }

  $('#skillbar').addEventListener('click', (e) => {
    const s = e.target.closest('[data-skill]');
    if (s && !s.disabled) return act(s.dataset.skill);
    const p = e.target.closest('[data-potion]');
    if (p && !p.disabled && ui.battle.useConsumable(ui.battle.player, p.dataset.potion)) play();
  });

  // ---------- Переключатели ----------

  function renderToggles() {
    const s = ui.opts.settings;
    $('#auto-btn').classList.toggle('on', !!s.auto);
    $('#speed-btn').textContent = `×${s.speed || 1}`;
    $('#speed-btn').classList.toggle('on', (s.speed || 1) > 1);
    $('#loop-btn').classList.toggle('on', !!s.loop);
  }

  function changeSettings(patch) {
    Object.assign(ui.opts.settings, patch);
    renderToggles();
    if (ui.opts.onSettings) ui.opts.onSettings(ui.opts.settings);
  }

  $('#auto-btn').addEventListener('click', () => {
    changeSettings({ auto: !ui.opts.settings.auto });
    if (ui.opts.settings.auto && !ui.busy) autoTurn();
    else clearTimeout(ui.autoTimer);
  });
  $('#speed-btn').addEventListener('click', () => {
    const order = [1, 2, 4];
    changeSettings({ speed: order[(order.indexOf(ui.opts.settings.speed || 1) + 1) % order.length] });
  });
  $('#loop-btn').addEventListener('click', () => {
    changeSettings({ loop: !ui.opts.settings.loop, auto: !ui.opts.settings.loop ? true : ui.opts.settings.auto });
    if (ui.opts.settings.auto && !ui.busy) autoTurn();
  });
  $('#leave').addEventListener('click', () => {
    if (!ui.battle.ended && !confirm('Сбежать из боя? Это засчитается как поражение.')) return;
    changeSettings({ loop: false });
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
    openSheet(f.name, rows.map(([k, v]) => `<div class="kv"><span>${k}</span><b>${v}</b></div>`).join('') +
      (f.effects.length ? `<p class="hint">${f.effects.map((x) => x.name).join(', ')}</p>` : ''));
  });

  PC.battleUI = { start, stop: () => { ui.finished = true; clearTimeout(ui.autoTimer); } };
})();
