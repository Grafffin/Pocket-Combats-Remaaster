// Экран боя: проигрывание лога по строчкам, приёмы, зелья, таймер хода.
// PC.battleUI.start({ player, monster, timer, onEnd(battle, { fled }) })
(function () {
  'use strict';
  const { Battle, data, TACTICS } = PC;
  const { $, icon, avatar, openSheet, closeSheet } = PC.kit;
  const TURN_SECONDS = 30;

  const ui = {
    battle: null,
    opts: null,
    shown: 0,      // сколько записей лога уже показано
    busy: false,   // идёт проигрывание — действия заблокированы
    deadline: 0,
    timerId: null,
    finished: false,
  };

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
    const shown = b.player.maxMana > 0 ? [...TACTICS, 'mana'] : TACTICS;
    $('#tactics').innerHTML = shown.map((t) =>
      `<button class="tactic ${t}" data-tactic="${t}" title="${data.tactics[t].name}">${icon(t)}<span>0</span></button>`).join('');
    play();
  }

  function fighterHtml(f) {
    return `<div class="head">${avatar(f)}<div style="min-width:0">
        <div class="name">${f.name}</div><div class="lvl">Уровень ${f.level}</div></div></div>
      <div class="meter hp"><div class="track"><div class="fill"></div></div><div class="num"><span>HP</span><span class="v"></span></div></div>
      ${f.maxMana > 0 ? '<div class="meter mana"><div class="track"><div class="fill"></div></div><div class="num"><span>Мана</span><span class="v"></span></div></div>' : ''}
      <div class="effects"></div>`;
  }

  function applySnapshot(snap) {
    for (const f of ui.battle.fighters) {
      const s = snap[f.id];
      const el = $(`#f-${f.id}`);
      const pct = s.hp / f.maxHp;
      const hpFill = el.querySelector('.hp .fill');
      hpFill.style.width = `${pct * 100}%`;
      hpFill.style.backgroundColor = pct > 0.5 ? 'var(--hp-full)' : pct > 0.25 ? 'var(--hp-mid)' : 'var(--hp-low)';
      el.querySelector('.hp .v').textContent = `${s.hp} / ${f.maxHp}`;
      const mana = el.querySelector('.mana');
      if (mana) {
        mana.querySelector('.fill').style.width = `${(s.mana / f.maxMana) * 100}%`;
        mana.querySelector('.v').textContent = `${s.mana} / ${f.maxMana}`;
      }
      el.querySelector('.effects').innerHTML = s.effects.map((e) =>
        `<button class="chip ${e.kind}" data-effect="${e.id}">${e.name}${e.disable ? '' : ' ' + e.turns}</button>`).join('');
      el.classList.toggle('dead', s.hp <= 0);
    }
    const p = snap.p;
    for (const t of [...TACTICS, 'mana']) {
      const btn = document.querySelector(`.tactic.${t}`);
      if (!btn) continue;
      const v = t === 'mana' ? p.mana : p.tactics[t];
      const span = btn.querySelector('span');
      if (t !== 'mana' && v > Number(span.textContent)) {
        btn.classList.remove('bump'); void btn.offsetWidth; btn.classList.add('bump');
      }
      span.textContent = v;
      btn.classList.toggle('zero', v === 0);
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
    log.scrollTop = log.scrollHeight;
    if (entry.type === 'turn') $('#turn-title').textContent = `Ход ${entry.text}`;
  }

  const floatColor = { normal: 'dmg', dot: 'dmg', poison: 'poison', bleed: 'crit', block: 'block', crit: 'crit', critblock: 'critblock' };

  function animateEvent(ev) {
    if (!ev) return;
    const el = $(`#f-${ev.target}`);
    if (ev.type === 'damage') { el.classList.remove('hit'); void el.offsetWidth; el.classList.add('hit'); }
    const fl = document.createElement('div');
    fl.className = 'float';
    if (ev.type === 'miss') { fl.textContent = 'мимо'; fl.style.color = 'var(--t-dodge)'; fl.style.fontSize = '15px'; }
    else if (ev.type === 'heal') { fl.textContent = `+${ev.amount}`; fl.style.color = 'var(--heal)'; }
    else if (ev.type === 'mana') { fl.textContent = `+${ev.amount}`; fl.style.color = 'var(--mana)'; }
    else { fl.textContent = `-${ev.amount}`; fl.style.color = `var(--${floatColor[ev.kind] || 'dmg'})`; }
    el.appendChild(fl);
    setTimeout(() => fl.remove(), 1000);
  }

  // Показывает новые записи лога по одной, синхронно обновляя полоски и тактики
  function play() {
    stopTimer();
    ui.busy = true;
    updateActions();
    const battle = ui.battle;
    const step = () => {
      if (battle !== ui.battle) return; // бой уже закрыли
      const log = battle.log;
      if (ui.shown >= log.length) { ui.busy = false; afterPlayback(); return; }
      const entry = log[ui.shown++];
      addEntry(entry);
      applySnapshot(entry.snap);
      animateEvent(entry.ev);
      const delay = ui.shown === 1 ? 600 : entry.type === 'turn' ? 200 : entry.type === 'poetry' ? 900 : 520;
      setTimeout(step, delay);
    };
    step();
  }

  function afterPlayback() {
    updateActions();
    if (ui.battle.ended) {
      $('#timer-text').textContent = '';
      $('#timer-fill').style.width = '0';
      setTimeout(() => finish(false), 700);
      return;
    }
    startTimer();
  }

  function finish(fled) {
    if (ui.finished) return;
    ui.finished = true;
    stopTimer();
    $('#timer-text').textContent = '';
    $('#timer-fill').style.width = '0';
    closeSheet();
    ui.opts.onEnd(ui.battle, { fled });
  }

  function updateActions() {
    const b = ui.battle;
    const lock = ui.busy || b.ended;
    $('#act-basic').disabled = lock;
    $('#act-skills').disabled = lock;
    const hasItems = b.player.consumables.some((c) => c.count > 0);
    $('#act-items').disabled = lock || !hasItems || !b.canUseConsumable(b.player);
    const n = b.usableSkillCount(b.player);
    const badge = $('#skills-badge');
    badge.hidden = !n || lock;
    badge.textContent = n;
  }

  function act(skillId) {
    if (ui.busy || ui.battle.ended) return;
    closeSheet();
    if (ui.battle.submit(skillId)) play();
  }

  $('#act-basic').addEventListener('click', () => act('basic'));
  $('#act-skills').addEventListener('click', openSkills);
  $('#act-items').addEventListener('click', openItems);
  $('#leave').addEventListener('click', () => {
    if (!ui.battle.ended && !confirm('Сбежать из боя? Это засчитается как поражение.')) return;
    finish(!ui.battle.ended);
  });

  // ---------- Таймер хода ----------

  function startTimer() {
    stopTimer();
    if (!ui.opts.timer) { $('#timer-text').textContent = ''; $('#timer-fill').style.width = '0'; return; }
    ui.deadline = Date.now() + TURN_SECONDS * 1000;
    const tick = () => {
      const left = Math.max(0, ui.deadline - Date.now());
      const sec = Math.ceil(left / 1000);
      $('#timer-text').textContent = `${sec} c`;
      const fill = $('#timer-fill');
      fill.style.width = `${(left / (TURN_SECONDS * 1000)) * 100}%`;
      fill.classList.toggle('low', sec <= 5);
      if (left <= 0) {
        stopTimer();
        closeSheet();
        if (ui.battle.timeout()) play();
      }
    };
    tick();
    ui.timerId = setInterval(tick, 250);
  }

  function stopTimer() {
    clearInterval(ui.timerId);
    ui.timerId = null;
  }

  // ---------- Приёмы и зелья ----------

  function costHtml(f, cost) {
    const parts = [...TACTICS, 'mana'].filter((t) => cost[t]).map((t) => {
      const have = t === 'mana' ? f.mana : f.tactics[t];
      return `<span class="${t}${have < cost[t] ? ' short' : ''}" title="${data.tactics[t].name}">${icon(t)}${cost[t]}</span>`;
    });
    return parts.length ? `<div class="cost">${parts.join('')}</div>` : '';
  }

  function skillIcon(s) {
    return s.icon
      ? `<img src="${s.icon}" alt="" onerror="this.replaceWith(document.createTextNode('${s.name.charAt(0)}'))">`
      : s.name.charAt(0);
  }

  function openSkills() {
    const b = ui.battle;
    const p = b.player;
    const ids = p.skills.filter((id) => id !== 'basic');
    const html = ids.length ? ids.map((id) => {
      const st = b.skillState(p, id);
      const s = st.skill;
      return `<button class="opt" data-skill="${id}" ${st.usable ? '' : 'disabled'}>
        <div class="ico">${skillIcon(s)}</div>
        <div class="body">
          <div class="title"><span>${s.name}</span>${st.cooldown ? `<span class="cd">перезарядка ${st.cooldown}</span>` : ''}</div>
          <div class="desc">${s.desc}</div>
          ${costHtml(p, s.cost || {})}
        </div></button>`;
    }).join('') : '<p>Приёмов пока нет — они открываются с уровнем.</p>';
    openSheet('Приёмы', html, (e) => {
      const s = e.target.closest('[data-skill]');
      if (s && !s.disabled) act(s.dataset.skill);
    });
  }

  function openItems() {
    const p = ui.battle.player;
    const html = p.consumables.map((c) => {
      const d = data.consumables[c.id];
      return `<button class="opt" data-item="${c.id}" ${c.count > 0 ? '' : 'disabled'}>
        <div class="ico">${c.count}</div>
        <div class="body"><div class="title"><span>${d.name}</span></div><div class="desc">${d.desc}. Не тратит ход, но не чаще раза за ход.</div></div>
      </button>`;
    }).join('');
    openSheet('Зелья', html, (e) => {
      const it = e.target.closest('[data-item]');
      if (!it || it.disabled) return;
      closeSheet();
      if (ui.battle.useConsumable(ui.battle.player, it.dataset.item)) play();
    });
  }

  // Подсказки по тактикам, эффектам и бойцам
  $('#tactics').addEventListener('click', (e) => {
    const t = e.target.closest('[data-tactic]');
    if (t) openSheet(data.tactics[t.dataset.tactic].name, `<p>${data.tactics[t.dataset.tactic].desc}</p>`);
  });
  $('.fighters').addEventListener('click', (e) => {
    const c = e.target.closest('[data-effect]');
    if (c) {
      const ef = data.effects[c.dataset.effect];
      openSheet(ef.name, `<p>${ef.desc}</p>`);
      return;
    }
    const card = e.target.closest('.fighter');
    if (card) openSheet('Характеристики', statsHtml(card.id === 'f-p' ? ui.battle.player : ui.battle.monster));
  });

  function statsHtml(f) {
    const foe = ui.battle.opponentOf(f);
    const F = PC.formulas;
    const st = f.stats;
    const rows = [
      ['Сила / Ловкость / Живучесть', `${st.str} / ${st.agi} / ${st.vit}`],
      ['Мудрость / Интуиция / Удача', `${st.wis} / ${st.dex} / ${st.luk}`],
      ['Урон оружием', f.weapon.max ? `${f.weapon.min + F.weaponBonus(f)}–${f.weapon.max + F.weaponBonus(f)}` : '—'],
      ['Защита', `${f.softDef} + ${F.hardDef(f)}%`],
      ['Магическая защита', `${f.softMdef} + ${f.hardMdef}%`],
      ['Шанс крита', `${Math.round(F.critChance(f))}%`],
      ['Шанс блока', `${Math.round(F.blockChance(f))}%`],
      [`Уклонение от ${foe.forms.gen}`, `${Math.round(F.dodgeChance(foe, f))}%`],
    ];
    return `<p><b>${f.name}</b>, уровень ${f.level}</p>` +
      rows.map(([k, v]) => `<p class="kv"><span>${k}</span><b>${v}</b></p>`).join('');
  }

  PC.battleUI = { start };
})();
