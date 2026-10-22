// Лагерь: создание персонажа, охота, характеристики, снаряжение, итог боя. Персонаж хранится в localStorage.
(function () {
  'use strict';
  const { data, progression: P, formulas: F, TACTICS } = PC;
  const { $, icon, avatar, escapeHtml, plural, openSheet, closeSheet, storage } = PC.kit;

  const charStore = storage('pc-character-v1', null);
  const settingsStore = storage('pc-settings', { timer: true });

  const state = {
    char: charStore.load(),
    settings: settingsStore.load(),
    tab: 'hunt',
    pending: {},        // очки характеристик, расставленные, но ещё не сохранённые
    lastMonster: null,
    create: { nick: '', gender: 'm', job: 'warrior' },
  };

  const save = () => charStore.save(state.char);
  const pendingTotal = () => Object.values(state.pending).reduce((a, b) => a + b, 0);

  function show(screen) {
    for (const id of ['create', 'hub', 'battle']) $(`#${id}`).hidden = id !== screen;
  }

  const itemName = (item) => {
    const p = data.items[item.id];
    return `<span class="r${item.rarity}">${p.emoji} ${p.name}</span>`;
  };

  // ---------- Создание персонажа ----------

  function renderCreate() {
    const c = state.create;
    $('#nick').value = c.nick;
    for (const b of document.querySelectorAll('#gender button')) b.classList.toggle('on', b.dataset.g === c.gender);
    $('#jobs').innerHTML = Object.entries(data.jobs).map(([id, j]) => {
      const st = j.stats;
      return `<button class="card${id === c.job ? ' on' : ''}" data-job="${id}"><b>${j.title}</b><span>${j.desc}</span>
        <span class="mini">СИЛ ${st.str} · ЛОВ ${st.agi} · ЖИВ ${st.vit} · МДР ${st.wis} · ИНТ ${st.dex} · УДЧ ${st.luk}</span></button>`;
    }).join('');
  }

  $('#jobs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-job]');
    if (b) { state.create.job = b.dataset.job; renderCreate(); }
  });
  $('#gender').addEventListener('click', (e) => {
    const b = e.target.closest('[data-g]');
    if (b) { state.create.gender = b.dataset.g; renderCreate(); }
  });
  $('#nick').addEventListener('input', (e) => { state.create.nick = e.target.value; });
  $('#nick').addEventListener('keydown', (e) => { if (e.key === 'Enter') createCharacter(); });
  $('#create-btn').addEventListener('click', createCharacter);

  function createCharacter() {
    const nick = $('#nick').value.trim().slice(0, 16);
    if (!nick) { $('#nick').focus(); $('#nick').classList.add('err'); return; }
    state.char = P.newCharacter(data, { nick, gender: state.create.gender, job: state.create.job });
    save();
    state.tab = 'hunt';
    openHub();
  }

  // ---------- Лагерь ----------

  function openHub(tab) {
    if (tab) state.tab = tab;
    show('hub');
    renderHub();
  }

  function renderHub() {
    const c = state.char;
    const need = P.expToNext(c.level);
    const atMax = c.level >= P.MAX_LEVEL;
    $('#hub-name').textContent = c.nick;
    $('#hub-sub').textContent = `${data.jobs[c.job].title}, ${c.level} уровень`;
    $('#hub-exp-fill').style.width = atMax ? '100%' : `${(c.exp / need) * 100}%`;
    $('#hub-exp-text').textContent = atMax ? 'максимум' : `${c.exp} / ${need} опыта`;

    for (const b of document.querySelectorAll('.tabs button')) b.classList.toggle('on', b.dataset.tab === state.tab);
    $('#tab-char-badge').hidden = !c.statPoints;
    $('#tab-char-badge').textContent = c.statPoints;
    for (const id of ['hunt', 'char', 'gear']) $(`#tab-${id}`).hidden = id !== state.tab;
    ({ hunt: renderHunt, char: renderChar, gear: renderGear })[state.tab]();
  }

  document.querySelector('.tabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-tab]');
    if (b) { state.tab = b.dataset.tab; renderHub(); $('#hub-body').scrollTop = 0; }
  });

  // ---------- Охота ----------

  function levelClass(diff) {
    if (diff <= -3) return 'trivial';
    if (diff <= 0) return 'easy';
    if (diff === 1) return 'fair';
    if (diff === 2) return 'hard';
    return 'deadly';
  }

  function renderHunt() {
    const c = state.char;
    const pot = c.potions;
    const potions = [`здоровья ×${pot.hp_potion || 0}`];
    if (c.job === 'mage') potions.push(`маны ×${pot.mp_potion || 0}`);
    const rows = Object.entries(data.monsters).map(([id, m]) => {
      const exp = Math.max(1, Math.round(m.exp * P.expMultiplier(c.level, m.level)));
      const loot = [...new Set((m.drops || []).map(([d]) => (data.items[d] ? data.items[d].emoji : '🧪')))].join(' ');
      return `<button class="mon" data-mon="${id}">
        ${avatar(m)}
        <div class="txt">
          <b>${m.name}</b>${m.boss ? '<span class="boss">босс</span>' : ''}
          <div class="meta">${m.blurb}</div>
          <div class="meta">Опыт ${exp}${loot ? ` · добыча ${loot}` : ''}</div>
        </div>
        <span class="lvl-badge ${levelClass(m.level - c.level)}">${m.level}</span>
      </button>`;
    }).join('');
    $('#tab-hunt').innerHTML = `
      <p class="hint">Зелья: ${potions.join(', ')}. Здоровье восстанавливается после каждого боя.</p>
      <div class="list">${rows}</div>
      <label class="check"><input type="checkbox" id="timer-on" ${state.settings.timer ? 'checked' : ''}> Таймер хода, 30 секунд</label>`;
  }

  $('#tab-hunt').addEventListener('click', (e) => {
    const b = e.target.closest('[data-mon]');
    if (b) startBattle(b.dataset.mon);
  });
  $('#tab-hunt').addEventListener('change', (e) => {
    if (e.target.id === 'timer-on') { state.settings.timer = e.target.checked; settingsStore.save(state.settings); }
  });

  function startBattle(monsterId) {
    state.lastMonster = monsterId;
    $('#result').hidden = true;
    show('battle');
    PC.battleUI.start({
      player: P.toFighter(data, state.char),
      monster: data.monsters[monsterId],
      timer: state.settings.timer,
      onEnd: (battle, { fled }) => {
        const summary = P.applyBattleResult(data, state.char, battle, monsterId, PC.makeRng(Date.now()));
        summary.fled = fled;
        save();
        showResult(summary, battle);
      },
    });
  }

  // ---------- Персонаж ----------

  // Боец, собранный из персонажа с учётом нераспределённых очков — для предпросмотра характеристик
  function previewFighter() {
    const c = state.char;
    const tmp = { ...c, stats: { ...c.stats } };
    for (const [k, v] of Object.entries(state.pending)) tmp.stats[k] += v;
    return { fighter: PC.createFighter(P.toFighter(data, tmp), 'p', 1), derived: P.derived(data, tmp) };
  }

  function renderChar() {
    const c = state.char;
    const { fighter: f, derived: d } = previewFighter();
    const bonus = P.bonusStats(data, c);
    const free = c.statPoints - pendingTotal();
    const wb = F.weaponBonus(f);

    const summary = [
      ['Здоровье', d.maxHp],
      ...(d.maxMana ? [['Мана', d.maxMana]] : []),
      ['Урон', `${f.weapon.min + wb}–${f.weapon.max + wb}`],
      ['Защита', `${f.softDef} + ${f.hardDef}%`],
      ['Магическая защита', `${f.softMdef} + ${f.hardMdef}%`],
      ['Шанс крита', `${Math.round(F.critChance(f))}%`],
      ['Шанс блока', `${Math.round(F.blockChance(f))}%`],
      ['Победы / поражения', `${c.wins} / ${c.losses}`],
    ].map(([k, v]) => `<div class="kv"><span>${k}</span><b>${v}</b></div>`).join('');

    const stats = P.STAT_KEYS.map((k) => {
      const pend = state.pending[k] || 0;
      return `<div class="stat-row">
        <div class="txt"><b>${data.stats[k].name}</b><div class="meta">${data.stats[k].desc}</div></div>
        <div class="val">${c.stats[k] + pend}${bonus[k] ? `<span class="bonus">+${bonus[k]}</span>` : ''}${pend ? `<span class="pend">(+${pend})</span>` : ''}</div>
        <button class="plus" data-stat="${k}" ${free > 0 ? '' : 'disabled'} aria-label="Добавить: ${data.stats[k].name}">+</button>
      </div>`;
    }).join('');

    const unlocks = data.jobs[c.job].unlocks;
    const skills = Object.keys(unlocks).sort((a, b) => unlocks[a] - unlocks[b]).map((id) => {
      const s = data.skills[id];
      const open = unlocks[id] <= c.level;
      const cost = [...TACTICS, 'mana'].filter((t) => (s.cost || {})[t])
        .map((t) => `<span class="${t}">${icon(t)}${s.cost[t]}</span>`).join('');
      return `<div class="skill-row${open ? '' : ' locked'}">
        <div class="txt"><b>${s.name}</b>${open ? '' : `<span class="lock">с ${unlocks[id]} уровня</span>`}
          <div class="meta">${s.desc}</div><div class="cost">${cost}</div></div></div>`;
    }).join('');

    $('#tab-char').innerHTML = `
      <section class="panel"><h3>Боевые качества</h3><div class="kv-grid">${summary}</div></section>
      <section class="panel">
        <h3>Характеристики <span class="points${free ? ' has' : ''}">свободных очков: ${free}</span></h3>
        ${stats}
        ${pendingTotal() ? `<div class="row-actions">
          <button class="btn" id="stats-reset">Сбросить</button>
          <button class="btn primary" id="stats-save">Сохранить</button></div>` : ''}
        <p class="hint">Каждый уровень даёт ${P.STAT_POINTS_PER_LEVEL} очка. Сохранённые очки вернуть нельзя.</p>
      </section>
      <section class="panel"><h3>Приёмы</h3>${skills}</section>
      <button class="link-btn" id="char-reset">Удалить персонажа и начать заново</button>`;
  }

  $('#tab-char').addEventListener('click', (e) => {
    const plus = e.target.closest('[data-stat]');
    if (plus && !plus.disabled) {
      state.pending[plus.dataset.stat] = (state.pending[plus.dataset.stat] || 0) + 1;
      return renderHub();
    }
    if (e.target.id === 'stats-reset') { state.pending = {}; return renderHub(); }
    if (e.target.id === 'stats-save') {
      P.allocate(state.char, state.pending);
      state.pending = {};
      save();
      return renderHub();
    }
    if (e.target.id === 'char-reset') {
      if (!confirm(`Удалить ${state.char.nick} навсегда? Уровень, вещи и зелья пропадут.`)) return;
      charStore.clear();
      state.char = null;
      state.pending = {};
      state.create = { nick: '', gender: 'm', job: 'warrior' };
      renderCreate();
      show('create');
    }
  });

  // ---------- Снаряжение ----------

  function renderGear() {
    const c = state.char;
    const slots = Object.entries(data.slots).map(([slot, title]) => {
      const it = c.equipment[slot];
      const w = c.equipment.weapon && data.items[c.equipment.weapon.id];
      const blocked = slot === 'shield' && w && w.twoHanded;
      return `<button class="slot" data-slot="${slot}" ${it ? '' : 'disabled'}>
        <span class="slot-name">${title}</span>
        <span class="slot-item">${it ? itemName(it) : `<span class="empty">${blocked ? 'занято двуручным оружием' : 'пусто'}</span>`}</span>
      </button>`;
    }).join('');

    const pack = c.backpack.map((it) => {
      const ok = P.canEquip(data, c, it);
      const p = data.items[it.id];
      return `<button class="slot" data-uid="${it.uid}">
        <span class="slot-name">${data.slots[p.slot]}</span>
        <span class="slot-item">${itemName(it)}${ok.ok ? '' : `<span class="req">${ok.reason}</span>`}</span>
      </button>`;
    }).join('');

    $('#tab-gear').innerHTML = `
      <section class="panel"><h3>Надето</h3>${slots}</section>
      <section class="panel"><h3>Рюкзак <span class="points">${c.backpack.length} / ${P.BACKPACK_SIZE}</span></h3>
        ${pack || '<p class="hint">Пусто. Вещи выпадают с монстров.</p>'}</section>`;
  }

  function itemSheet(item, where) {
    const c = state.char;
    const p = data.items[item.id];
    const lines = P.itemLines(data, item).map((l) => `<li>${l}</li>`).join('');
    const req = [`${p.level} уровень`];
    if (p.jobs) req.push(p.jobs.map((j) => data.jobs[j].title.toLowerCase()).join(', '));
    let html = `<p class="item-head">${itemName(item)}<span class="meta">${data.slots[p.slot]} · ${data.rarities[item.rarity].name}</span></p>
      <ul class="props">${lines}</ul><p class="meta">Требования: ${req.join(', ')}</p>`;

    let actions = '';
    if (where === 'equipped') {
      actions = '<button class="btn" data-act="unequip">Снять</button>';
    } else {
      const cur = c.equipment[p.slot];
      if (cur) {
        html += `<div class="compare"><p class="meta">Сейчас надето:</p><p>${itemName(cur)}</p>
          <ul class="props">${P.itemLines(data, cur).map((l) => `<li>${l}</li>`).join('')}</ul></div>`;
      }
      const ok = P.canEquip(data, c, item);
      if (!ok.ok) html += `<p class="req">${ok.reason}</p>`;
      actions = `<button class="btn" data-act="discard">Выбросить</button>
        <button class="btn primary" data-act="equip" ${ok.ok ? '' : 'disabled'}>Надеть</button>`;
    }
    html += `<div class="row-actions">${actions}</div>`;

    openSheet(where === 'equipped' ? 'Надетый предмет' : 'Предмет из рюкзака', html, (e) => {
      const b = e.target.closest('[data-act]');
      if (!b || b.disabled) return;
      let res = { ok: true };
      if (b.dataset.act === 'equip') res = P.equip(data, c, item.uid);
      if (b.dataset.act === 'unequip') res = P.unequip(c, p.slot);
      if (b.dataset.act === 'discard') {
        if (!confirm(`Выбросить «${p.name}»?`)) return;
        P.discard(c, item.uid);
      }
      if (!res.ok) { alert(res.reason || 'Не получилось'); return; }
      save();
      closeSheet();
      renderHub();
    });
  }

  $('#tab-gear').addEventListener('click', (e) => {
    const s = e.target.closest('[data-slot]');
    if (s && !s.disabled) return itemSheet(state.char.equipment[s.dataset.slot], 'equipped');
    const u = e.target.closest('[data-uid]');
    if (u) itemSheet(state.char.backpack.find((it) => it.uid === u.dataset.uid), 'backpack');
  });

  // ---------- Итог боя ----------

  function showResult(sum, battle) {
    const c = state.char;
    const banner = $('#result-banner');
    banner.textContent = sum.win ? 'Победа!' : sum.fled ? 'Бегство.' : 'Поражение.';
    banner.classList.toggle('loss', !sum.win);

    let html = '';
    if (sum.win) {
      const need = P.expToNext(c.level);
      html += `<p>Получено опыта: <b>${sum.exp}</b>. Бой длился ${battle.turn} ${plural(battle.turn, 'ход', 'хода', 'ходов')}.</p>
        <div class="exp-bar big"><div style="width:${c.level >= P.MAX_LEVEL ? 100 : (c.exp / need) * 100}%"></div></div>
        <p class="meta">${c.level} уровень · ${c.exp} / ${need}</p>`;
      if (sum.levelsUp.length) {
        const pts = sum.levelsUp.length * P.STAT_POINTS_PER_LEVEL;
        html += `<p class="levelup">Новый уровень: ${c.level}! +${pts} ${plural(pts, 'очко', 'очка', 'очков')} характеристик.</p>`;
      }
      for (const id of sum.newSkills) html += `<p class="levelup">Новый приём: «${data.skills[id].name}»</p>`;
      const loot = sum.loot.map((d) => d.kind === 'potion'
        ? `<li>🧪 ${data.consumables[d.id].name}</li>`
        : `<li>${itemName(d.item)}</li>`).join('');
      html += loot ? `<p class="meta">Добыча:</p><ul class="loot">${loot}</ul>` : '<p class="meta">Ничего не выпало.</p>';
      if (sum.lost.length) html += `<p class="req">Рюкзак полон — ${sum.lost.length} ${plural(sum.lost.length, 'вещь осталась', 'вещи остались', 'вещей осталось')} на земле.</p>`;
    } else {
      const m = data.monsters[state.lastMonster];
      html += sum.fled
        ? '<p>Вы сбежали с поля боя. Опыт не получен.</p>'
        : `<p>${escapeHtml(m.name)} ${m.gender === 'f' ? 'оказалась' : 'оказался'} сильнее. Опыт не получен, вещи остались при вас.</p>`;
    }
    $('#result-body').innerHTML = html;
    $('#to-camp').textContent = c.statPoints ? 'Распределить очки' : 'В лагерь';
    $('#result').hidden = false;
  }

  $('#again').addEventListener('click', () => startBattle(state.lastMonster));
  $('#to-camp').addEventListener('click', () => {
    $('#result').hidden = true;
    openHub(state.char.statPoints ? 'char' : undefined);
  });

  // ---------- Старт ----------

  if (state.char) openHub();
  else { renderCreate(); show('create'); }
})();
