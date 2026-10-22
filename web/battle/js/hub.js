// Приложение: состояние и сохранение, создание персонажа, шапка, вкладки «Мир» и «Герой», торговля, итог боя.
// Вкладки «Сумка» и «Кузница» — bag-ui.js и forge-ui.js, они регистрируются в PC.app.tabs.
(function () {
  'use strict';
  const { data, progression: P, economy: E, world: W, items: I, stats: S, monsters: M } = PC;
  const { $, $$, art, statIcon, avatar, escapeHtml, plural, fmtNum, openSheet, closeSheet, toast, storage } = PC.kit;
  const { tile, cardHtml, costHtml, matChip } = PC.itemUI;

  const charStore = storage('pc-character-v3', null);
  const rng = PC.makeRng(Date.now());

  const state = {
    char: P.migrate(data, charStore.load()),
    tab: 'world',
    pending: {},          // очки характеристик, расставленные, но ещё не сохранённые
    fight: null,          // текущий бой: { monsterId, entry, level }
    loopTimer: null,
    travelTimer: null,
    create: { nick: '', gender: 'm', job: 'warrior' },
  };

  const app = {
    state, rng,
    tabs: {},
    save: () => charStore.save(state.char),
    render,
    setTab,
    toast,
    startFight,
  };
  PC.app = app;

  function show(screen) {
    for (const id of ['create', 'hub', 'battle']) $(`#${id}`).hidden = id !== screen;
  }

  // ---------- Создание персонажа ----------

  function renderCreate() {
    const c = state.create;
    $('#nick').value = c.nick;
    for (const b of $$('#gender button')) b.classList.toggle('on', b.dataset.g === c.gender);
    $('#jobs').innerHTML = Object.entries(data.classes).map(([id, cl]) => {
      const res = data.resources[cl.resource];
      return `<button class="class-card${id === c.job ? ' on' : ''}" data-job="${id}">
        <div class="art">${art(`classes/${id}`, cl.title.charAt(0))}</div>
        <b>${cl.title}</b><span class="res" style="color:${res.color}">${res.name}</span><span class="desc">${cl.desc}</span></button>`;
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
    app.save();
    setTab('world');
  }

  // ---------- Каркас ----------

  function setTab(tab, arg) {
    state.tab = tab;
    state.tabArg = arg;
    show('hub');
    render();
    $('#hub-body').scrollTop = 0;
    watchTravel();
  }

  function render() {
    const c = state.char;
    if (!c) return;
    renderHeroBar();
    for (const b of $$('#tabs button')) b.classList.toggle('on', b.dataset.tab === state.tab);
    $('#badge-hero').hidden = !(c.statPoints || c.skillPoints);
    $('#badge-bag').hidden = !c.bag.some((x) => x && x.fresh);
    for (const id of ['world', 'hero', 'bag', 'forge']) $(`#tab-${id}`).hidden = id !== state.tab;
    const fn = { world: renderWorld, hero: renderHero }[state.tab] || app.tabs[state.tab];
    if (fn) fn($(`#tab-${state.tab}`), state.tabArg);
  }

  function renderHeroBar() {
    const c = state.char;
    const need = P.expToNext(c.level);
    $('#hero-bar').innerHTML = `
      <div class="portrait">${art(`classes/${c.job}`, data.classes[c.job].title.charAt(0))}</div>
      <div class="who"><b>${escapeHtml(c.nick)}</b>
        <div class="bar-line"><span class="meta">${data.classes[c.job].title} · ${c.level} ур.</span>
          <div class="progress thin" style="flex:1"><div style="width:${c.level >= P.MAX_LEVEL ? 100 : (c.exp / need) * 100}%"></div></div></div></div>
      <div class="wallet"><span>${art('materials/gold', '💰')}${fmtNum(c.gold)}</span><span class="meta">${fmtNum(c.exp)} / ${fmtNum(need)}</span></div>`;
  }

  $('#tabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-tab]');
    if (b) setTab(b.dataset.tab);
  });

  // ---------- Мир ----------

  function levelClass(diff) {
    if (diff <= -4) return 'trivial';
    if (diff <= 0) return 'easy';
    if (diff <= 2) return 'fair';
    if (diff <= 4) return 'hard';
    return 'deadly';
  }
  const KIND_NAME = { beast: 'зверь', undead: 'нежить', goblin: 'гоблин', human: 'человек', construct: 'конструкт' };

  function renderWorld(root) {
    const c = state.char;
    const t = W.travelProgress(c, Date.now());
    if (t) {
      const from = data.locations[t.from], to = data.locations[t.to];
      root.innerHTML = `
        <div class="banner">${art(to.art, '')}<div class="title"><b>${to.name}</b><span>В пути из «${from.name}»</span></div></div>
        <div class="card section">
          <div class="progress"><div id="travel-fill" style="width:${t.progress * 100}%"></div></div>
          <p class="meta" id="travel-left">Осталось ${Math.ceil(t.left / 1000)} с</p>
          <p class="loc-desc">${to.desc}</p>
          <div class="row-actions"><button class="btn" data-act="cancel-travel">Вернуться</button></div>
        </div>`;
      return;
    }
    const loc = W.here(data, c);
    const s = c.settings;

    const mobs = loc.monsters.map((entry) => mobRow(entry, false)).join('');
    let boss = '';
    if (loc.boss) {
      const ready = W.bossReady(data, c);
      const kills = c.zoneKills[c.location] || 0;
      boss = ready ? mobRow([loc.boss[0], loc.boss[1], loc.boss[1]], true)
        : `<div class="mob boss" style="opacity:.6"><div class="ava" style="width:52px;height:52px">${art(data.monsters[loc.boss[0]].art, '👑')}</div>
            <div class="txt"><b>${data.monsters[loc.boss[0]].name}</b><span class="tag boss">босс</span>
            <div class="meta">Появится после ${data.BOSS_KILLS} побед в зоне</div>
            <div class="progress thin" style="margin-top:6px"><div style="width:${(kills / data.BOSS_KILLS) * 100}%"></div></div></div>
            <span class="lvl-badge ${levelClass(loc.boss[1] - c.level)}">${loc.boss[1]}</span></div>`;
    }

    const npcs = (loc.npcs || []).map((id) => {
      const n = data.npcs[id];
      return `<button class="npc" data-npc="${id}">${avatar(n, 44)}<div><b>${n.name}</b><span>${n.desc}</span></div></button>`;
    }).join('');

    const routes = Object.entries(loc.routes).map(([id, sec]) => {
      const to = data.locations[id];
      const cls = to.levels ? levelClass(to.levels[0] - c.level) : 'easy';
      return `<button class="route" data-route="${id}"><span class="route-name">→ ${to.name}</span>
        <span class="route-meta"><span class="dot ${cls}"></span>${to.levels ? `${to.levels[0]}–${to.levels[1]} ур.` : 'безопасно'} · ${sec} с</span></button>`;
    }).join('');

    const salvageOpts = [-1, 0, 1, 2, 3].map((r) => `<option value="${r}" ${s.autoSalvage === r ? 'selected' : ''}>${r < 0 ? 'выключен' : `до «${data.rarities[r].name}» включительно`}</option>`).join('');

    root.innerHTML = `
      <div class="banner">${art(loc.art, '')}<div class="title"><b>${loc.name}</b><span>${loc.levels ? `${loc.levels[0]}–${loc.levels[1]} уровень · тир вещей ${loc.tier}` : 'Безопасная зона'}</span></div></div>
      <div class="card section"><p class="loc-desc">${loc.desc}</p></div>
      ${npcs ? `<div class="card section"><h3>Жители</h3><div class="npc-grid">${npcs}</div></div>` : ''}
      <div class="card section"><h3>${loc.safe ? 'Тренировка' : 'Охота'}<span class="note">${loc.safe ? '' : `побед: ${c.zoneKills[c.location] || 0}`}</span></h3>
        <div class="list">${mobs}${boss}</div></div>
      <div class="card section"><h3>Настройки охоты</h3>
        <div class="toggle"><span>Автобой</span><button class="chip-btn ${s.autoBattle ? 'on' : ''}" data-set="autoBattle">${s.autoBattle ? 'вкл' : 'выкл'}</button></div>
        <div class="toggle"><span>Охота без остановки</span><button class="chip-btn ${s.loop ? 'on' : ''}" data-set="loop">${s.loop ? 'вкл' : 'выкл'}</button></div>
        <div class="toggle"><span>Скорость боя</span><button class="chip-btn ${s.speed > 1 ? 'on' : ''}" data-set="speed">×${s.speed || 1}</button></div>
        <div class="toggle"><span>Авторазбор добычи</span><select id="auto-salvage">${salvageOpts}</select></div>
        <p class="hint">Зелья: здоровья ×${c.materials.hp_potion || 0}, ресурса ×${c.materials.mp_potion || 0}. Здоровье восстанавливается после каждого боя.
          Поражение возвращает в ${data.locations[data.HOME].name} и стоит ${Math.round(data.DEATH_GOLD_LOSS * 100)}% золота.</p>
      </div>
      <div class="card section"><h3>Переходы</h3>${routes}</div>`;
  }

  function mobRow([id, lo, hi], isBoss) {
    const c = state.char;
    const m = data.monsters[id];
    const mid = Math.round((lo + hi) / 2);
    const exp = Math.round(M.rewards.exp(id, mid) * P.expMultiplier(c.level, mid));
    return `<button class="mob ${isBoss ? 'boss' : ''}" data-mon="${id}" data-lo="${lo}" data-hi="${hi}">
      <div class="ava" style="width:52px;height:52px">${art(m.art, m.emoji)}</div>
      <div class="txt"><b>${m.name}</b>${isBoss ? '<span class="tag boss">босс</span>' : ''}<span class="tag kind">${KIND_NAME[m.kind] || ''}</span>
        <div class="meta">${m.blurb}</div>${m.ai === 'idle' ? '' : `<div class="meta">≈${exp} опыта</div>`}</div>
      <span class="lvl-badge ${levelClass(mid - c.level)}">${lo === hi ? lo : `${lo}–${hi}`}</span></button>`;
  }

  $('#tab-world').addEventListener('click', (e) => {
    const c = state.char;
    const m = e.target.closest('[data-mon]');
    if (m) return startFight(m.dataset.mon, [m.dataset.mon, +m.dataset.lo, +m.dataset.hi]);
    const n = e.target.closest('[data-npc]');
    if (n) return openNpc(n.dataset.npc);
    const r = e.target.closest('[data-route]');
    if (r) {
      const res = W.startTravel(data, c, r.dataset.route, Date.now());
      if (!res.ok) return toast(res.reason, 'bad');
      app.save();
      render();
      watchTravel();
      return;
    }
    const set = e.target.closest('[data-set]');
    if (set) {
      const k = set.dataset.set;
      if (k === 'speed') c.settings.speed = { 1: 2, 2: 4, 4: 1 }[c.settings.speed || 1];
      else c.settings[k] = !c.settings[k];
      if (k === 'loop' && c.settings.loop) c.settings.autoBattle = true;
      app.save();
      render();
      return;
    }
    if (e.target.closest('[data-act="cancel-travel"]')) { W.cancelTravel(c); app.save(); render(); }
  });
  $('#tab-world').addEventListener('change', (e) => {
    if (e.target.id === 'auto-salvage') { state.char.settings.autoSalvage = Number(e.target.value); app.save(); }
  });

  function watchTravel() {
    clearInterval(state.travelTimer);
    if (!state.char || !state.char.transit) return;
    const tick = () => {
      const c = state.char;
      if (!c || !c.transit) { clearInterval(state.travelTimer); return; }
      const done = W.completeTravel(data, c, Date.now(), rng);
      if (!done) {
        const t = W.travelProgress(c, Date.now());
        const fill = $('#travel-fill');
        if (fill) { fill.style.width = `${t.progress * 100}%`; $('#travel-left').textContent = `Осталось ${Math.ceil(t.left / 1000)} с`; }
        return;
      }
      clearInterval(state.travelTimer);
      app.save();
      toast(`Вы пришли: ${data.locations[c.location].name}`);
      if (!$('#hub').hidden) render();
    };
    tick();
    state.travelTimer = setInterval(tick, 250);
  }

  // ---------- Бой ----------

  function startFight(monsterId, entry) {
    const c = state.char;
    clearTimeout(state.loopTimer);
    const level = W.monsterLevel(entry, rng);
    state.fight = { monsterId, entry, level };
    $('#result').hidden = true;
    closeSheet();
    show('battle');
    PC.battleUI.start({
      player: P.toFighter(data, c),
      monster: M.monsterAt(monsterId, level),
      settings: { auto: !!c.settings.autoBattle, speed: c.settings.speed || 1, loop: !!c.settings.loop },
      onSettings: (s) => { c.settings.autoBattle = s.auto; c.settings.speed = s.speed; c.settings.loop = s.loop; app.save(); },
      onEnd: (battle, { fled }) => {
        const summary = P.applyBattleResult(data, c, battle, state.fight, rng, { fled });
        for (const it of summary.items) it.fresh = true;
        app.save();
        showResult(summary, battle);
      },
    });
  }

  function showResult(sum, battle) {
    const c = state.char;
    const banner = $('#result-banner');
    banner.textContent = sum.win ? 'Победа!' : sum.fled ? 'Бегство' : 'Поражение';
    banner.classList.toggle('loss', !sum.win);
    let html = '';
    if (sum.win) {
      const need = P.expToNext(c.level);
      html += `<p>+${fmtNum(sum.exp)} опыта · +${fmtNum(sum.gold)} 💰 · ${battle.turn} ${plural(battle.turn, 'ход', 'хода', 'ходов')}</p>
        <div class="progress"><div style="width:${c.level >= P.MAX_LEVEL ? 100 : (c.exp / need) * 100}%"></div></div>
        <p class="meta">${c.level} уровень · ${fmtNum(c.exp)} / ${fmtNum(need)}</p>`;
      if (sum.levelsUp.length) html += `<p class="levelup">Новый уровень: ${c.level}! Очки характеристик и умений ждут во вкладке «Герой».</p>`;
      for (const id of sum.newSkills) html += `<p class="levelup">Открыто умение «${data.skills[id].name}»</p>`;
      if (sum.items.length) html += `<div class="loot-grid">${sum.items.map((it) => tile(it, { attrs: `data-loot="${it.uid}"`, can: I.canEquip(data, c, it).ok })).join('')}</div>`;
      const mats = Object.entries(sum.materials);
      if (mats.length) html += `<div class="cost" style="justify-content:center">${mats.map(([k, n]) => `<span>${art(data.materials[k].art, '•')}+${n}</span>`).join('')}</div>`;
      if (sum.salvaged.length) {
        const full = sum.salvaged.some((x) => x.full);
        html += `<p class="meta">${full ? 'Сумка полна — ' : 'Авторазбор: '}разобрано ${sum.salvaged.length} ${plural(sum.salvaged.length, 'вещь', 'вещи', 'вещей')}.</p>`;
      }
      if (!sum.items.length && !sum.salvaged.length) html += '<p class="meta">Вещей не выпало.</p>';
    } else if (sum.fled) {
      html += '<p>Вы сбежали с поля боя. Опыт не получен.</p>';
    } else {
      html += `<p>${escapeHtml(data.monsters[state.fight.monsterId].name)} оказался сильнее.</p>`;
      if (sum.sentHome) html += `<p>Вы пришли в себя в деревне ${data.locations[data.HOME].name}.</p>`;
      if (sum.goldLost) html += `<p class="req">Потеряно золота: ${sum.goldLost}.</p>`;
    }
    const looping = sum.win && c.settings.loop;
    if (looping) html += '<p class="meta" id="loop-note">Следующий бой через 2 с…</p>';
    $('#result-body').innerHTML = html;
    $('#again').hidden = !sum.win && sum.sentHome;
    $('#to-camp').textContent = looping ? 'Остановить охоту' : 'К локации';
    $('#result').hidden = false;
    if (looping) state.loopTimer = setTimeout(() => startFight(state.fight.monsterId, state.fight.entry), 2000 / Math.max(1, (c.settings.speed || 1) / 2));
  }

  $('#result-body').addEventListener('click', (e) => {
    const t = e.target.closest('[data-loot]');
    if (!t) return;
    clearTimeout(state.loopTimer);
    const note = $('#loop-note');
    if (note) note.textContent = 'Охота на паузе, пока открыта вещь.';
    const found = I.findItem(state.char, t.dataset.loot);
    if (found) openSheet('Добыча', cardHtml(state.char, found.item, 'loot'));
  });
  $('#again').addEventListener('click', () => startFight(state.fight.monsterId, state.fight.entry));
  $('#to-camp').addEventListener('click', () => {
    clearTimeout(state.loopTimer);
    if (state.char.settings.loop) { state.char.settings.loop = false; app.save(); }
    $('#result').hidden = true;
    setTab(state.char.statPoints || state.char.skillPoints ? 'hero' : 'world');
  });

  // ---------- NPC: лавка и скупщик ----------

  function openNpc(id) {
    if (id === 'smith') return setTab('forge', 'enhance');
    if (id === 'enchanter') return setTab('forge', 'reroll');
    if (id === 'shop') return openShop();
    if (id === 'buyer') return openBuyer();
  }

  function npcHead(id) {
    const n = data.npcs[id];
    return `<div class="row" style="margin-bottom:10px">${avatar(n, 56)}<p style="margin:0;font-style:italic;color:#e6d2b0">«${n.greeting}»</p></div>`;
  }

  function openShop(msg) {
    const c = state.char;
    const rows = data.shopStock.map((id) => {
      const m = data.materials[id];
      return `<div class="kv" style="align-items:center"><span>${art(m.art, '•', 'stat-ico')}<span><b style="color:var(--text)">${m.name}</b><br><small>${m.desc || ''} есть: ${c.materials[id] || 0}</small></span></span>
        <span class="row"><button class="btn small" data-buy="${id}" data-n="1" ${c.gold < m.price ? 'disabled' : ''}>${fmtNum(m.price)} 💰</button>
        <button class="btn small" data-buy="${id}" data-n="5" ${c.gold < m.price * 5 ? 'disabled' : ''}>×5</button></span></div>`;
    }).join('');
    openSheet(data.npcs.shop.name, `${npcHead('shop')}${msg ? `<div class="flash good">${msg}</div>` : ''}<p class="meta">У вас ${fmtNum(c.gold)} 💰</p>${rows}`, (e) => {
      const b = e.target.closest('[data-buy]');
      if (!b || b.disabled) return;
      const res = E.buy(data, c, b.dataset.buy, Number(b.dataset.n));
      if (!res.ok) return toast(res.reason, 'bad');
      app.save(); render();
      openShop(`Куплено: ${data.materials[b.dataset.buy].name} ×${b.dataset.n}`);
    });
  }

  function openBuyer(msg) {
    const c = state.char;
    const items = c.bag.filter(Boolean);
    const byRarity = data.rarities.slice(0, 4).map((r, i) => {
      const list = items.filter((it) => it.rarity <= i && !it.enhance && !it.rank);
      const sum = list.reduce((s, it) => s + I.sellPrice(data, it), 0);
      return `<button class="btn small" data-sellbelow="${i}" ${list.length ? '' : 'disabled'}>до «${r.name}»: ${list.length} шт · ${fmtNum(sum)} 💰</button>`;
    }).join('');
    const rows = items.map((it) => `<div class="kv" style="align-items:center"><span>${PC.itemUI.nameHtml(it)}</span>
      <button class="btn small" data-sell="${it.uid}">${fmtNum(I.sellPrice(data, it))} 💰</button></div>`).join('');
    openSheet(data.npcs.buyer.name, `${npcHead('buyer')}${msg ? `<div class="flash good">${msg}</div>` : ''}
      <p class="meta">Продать оптом (заточенные и вещи со звёздами не трогаю):</p><div class="row-actions" style="margin:0 0 10px">${byRarity}</div>
      ${rows || '<p class="empty-note">Сумка пуста.</p>'}`, (e) => {
      const s = e.target.closest('[data-sell]');
      if (s) { const r = E.sell(data, c, s.dataset.sell); app.save(); render(); return openBuyer(`Продано за ${r.price} 💰`); }
      const b = e.target.closest('[data-sellbelow]');
      if (b && !b.disabled) { const r = E.sellBelow(data, c, Number(b.dataset.sellbelow)); app.save(); render(); openBuyer(`Продано ${r.count} шт за ${r.total} 💰`); }
    });
  }

  // ---------- Герой ----------

  function renderHero(root) {
    const c = state.char;
    const tmp = { ...c, stats: { ...c.stats } };
    for (const [k, v] of Object.entries(state.pending)) tmp.stats[k] += v;
    const s = S.compute(data, tmp);
    const bonus = S.gather(data, c);
    const pend = Object.values(state.pending).reduce((a, b) => a + b, 0);
    const free = c.statPoints - pend;
    const res = data.resources[s.resource];

    const prim = S.PRIMARY.map((k) => {
      const d = data.statDefs[k];
      const extra = (bonus[k] || 0) + (bonus.allPrimary || 0);
      return `<div class="stat-row">${statIcon(k)}<div class="txt"><b>${d.name}</b><div class="meta">${PRIMARY_DESC[k]}</div></div>
        <div class="val">${c.stats[k] + (state.pending[k] || 0)}${extra ? `<span class="bonus">+${extra}</span>` : ''}${state.pending[k] ? `<span class="pend">(+${state.pending[k]})</span>` : ''}</div>
        <button class="plus" data-stat="${k}" ${free > 0 ? '' : 'disabled'} aria-label="Добавить: ${d.name}">+</button></div>`;
    }).join('');

    const combat = [
      ['hp', 'Здоровье', Math.round(s.maxHp)],
      ['mp', res.name, s.resMax],
      ...(s.caster ? [['matk', 'Магическая атака', s.matk]] : [['atk', 'Атака', `${s.atk} + ${s.weaponMin}–${s.weaponMax}`]]),
      ['def', 'Защита', `${s.def} (−${Math.round(100 - 10000 / (100 + s.def))}%)`],
      ['mdef', 'Маг. защита', `${s.mdef} (−${Math.round(100 - 10000 / (100 + s.mdef))}%)`],
      ['crit', 'Крит', `${Math.round(s.crit)}% · ×${Math.round(s.critDmg)}%`],
      ['accuracy', 'Точность / уклонение', `${s.acc} / ${s.eva}`],
      ['speed', 'Скорость', s.speed],
      ...(s.block ? [['block', 'Блок', `${Math.round(s.block)}%`]] : []),
      ...(s.lifesteal ? [['lifesteal', 'Вампиризм', `${Math.round(s.lifesteal)}%`]] : []),
      ...(s.dmgReduce ? [['def', 'Снижение урона', `${Math.round(s.dmgReduce)}%`]] : []),
      ...(s.mpRegen ? [['mp', 'Мана за ход', Math.round(s.mpRegen)]] : []),
      ['mdef', 'Сопротивления', `🔥${bonus.fireRes || 0}% ❄${bonus.coldRes || 0}% ☠${bonus.poisonRes || 0}%`],
      ['luk', 'Находка / золото / опыт', `${Math.round(s.mf)}% / +${Math.round((s.goldPct || 0) * 100)}% / +${Math.round((s.expPct || 0) * 100)}%`],
    ].map(([ic, k, v]) => `<div class="kv"><span>${art(`stats/${ic}`, '', 'stat-ico')}${k}</span><b>${v}</b></div>`).join('');

    // Знаки-добродетели
    const vcount = {};
    for (const it of Object.values(c.equipment)) if (it && it.virtue) vcount[it.virtue] = (vcount[it.virtue] || 0) + 1;
    const virtues = Object.entries(vcount).map(([id, n]) => {
      const v = data.virtues[id];
      const parts = Object.entries(v.sets).map(([k, mods]) => `<span style="opacity:${n >= k ? 1 : 0.45}">${k}: ${Object.entries(mods).map(([sk, sv]) => `${data.statDefs[sk].name.toLowerCase()} +${data.statDefs[sk].fmt(sv)}`).join(', ')}</span>`).join('<br>');
      return `<div class="kv"><span class="virtue-chip" style="color:${v.color}"><i></i>${v.name} ×${n}</span><span class="meta" style="text-align:right">${parts}</span></div>`;
    }).join('');

    const skills = P.classSkills(data, c.job).map((sk) => {
      const lvl = c.skills[sk.id] || 0;
      const open = sk.unlock <= c.level;
      const eff = S.skillLevel(s, c, sk.id);
      const inSlot = c.slots.indexOf(sk.id);
      return `<div class="skill-card ${open ? '' : 'locked'}"><div class="skill-ico">${art(`stats/${sk.icon}`, sk.name.charAt(0))}</div>
        <div class="txt"><b>${sk.name}</b> <span class="lvl">${lvl ? `ур. ${eff}${eff > lvl ? ` (${lvl}+${eff - lvl})` : ''}` : open ? 'не изучено' : `с ${sk.unlock} уровня`}</span>
          <div class="desc">${sk.desc(sk.v(Math.max(1, eff)))}</div>
          <div class="meta">${sk.cost ? `${sk.cost} ${res.name.toLowerCase()}` : 'бесплатно'} · перезарядка ${sk.cd} ${plural(sk.cd, 'ход', 'хода', 'ходов')}</div>
          ${lvl ? `<div class="row" style="margin-top:6px"><button class="btn small" data-slot-toggle="${sk.id}">${inSlot >= 0 ? `В ячейке ${inSlot + 1} · убрать` : 'В ячейку'}</button></div>` : ''}</div>
        <button class="plus" data-learn="${sk.id}" ${open && c.skillPoints > 0 && lvl < data.SKILL_MAX ? '' : 'disabled'}>+</button></div>`;
    }).join('');

    const passives = P.classPassives(data, c.job).map((p) => {
      const r = c.passives[p.id] || 0;
      return `<div class="skill-card"><div class="skill-ico">${r}/${p.max}</div><div class="txt"><b>${p.name}</b>
        <div class="desc">${p.desc(Math.max(1, r))}${r ? '' : ' (за 1 очко)'}</div></div>
        <button class="plus" data-passive="${p.id}" ${c.skillPoints > 0 && r < p.max ? '' : 'disabled'}>+</button></div>`;
    }).join('');

    const slots = Array.from({ length: data.SKILL_SLOTS }, (_, i) => {
      const id = c.slots[i];
      if (!id) return `<div class="slot-skill"><span class="n">${i + 1}</span><span class="meta">пусто</span></div>`;
      const sk = data.skills[id];
      return `<div class="slot-skill filled"><span class="n">${i + 1}</span>${art(`stats/${sk.icon}`, '', 'stat-ico')}<span>${sk.name}</span>
        ${i ? `<button class="chip-btn" data-slot-left="${i}">◀</button>` : ''}</div>`;
    }).join('');

    root.innerHTML = `
      <div class="card section"><h3>Характеристики <span class="points-pill">${free} ${plural(free, 'очко', 'очка', 'очков')}</span></h3>
        ${prim}
        ${pend ? '<div class="row-actions"><button class="btn" data-act="stats-reset">Сбросить</button><button class="btn primary" data-act="stats-save">Сохранить</button></div>' : ''}
        <p class="hint">${P.STAT_POINTS_PER_LEVEL} очка за уровень. Сохранённые очки вернуть нельзя.</p></div>
      <div class="card section"><h3>Боевые качества</h3>${combat}</div>
      ${virtues ? `<div class="card section"><h3>Знаки-добродетели</h3><div class="virtue-sets">${virtues}</div></div>` : ''}
      <div class="card section"><h3>Ячейки умений<span class="note">порядок = приоритет автобоя</span></h3><div class="slots-bar">${slots}</div></div>
      <div class="card section"><h3>Умения <span class="points-pill">${c.skillPoints} ${plural(c.skillPoints, 'очко', 'очка', 'очков')}</span></h3>${skills}</div>
      <div class="card section"><h3>Пассивки</h3>${passives}</div>
      <div class="section"><button class="btn danger wide" data-act="reset">Удалить героя и начать заново</button></div>`;
  }

  const PRIMARY_DESC = {
    str: 'Атака мечами и топорами, крит. урон',
    agi: 'Атака луками, точность, уклонение, скорость',
    int: 'Магическая атака, мана, маг. защита',
    vit: 'Здоровье, защита, блок со щитом',
    luk: 'Шанс крита, находка предметов',
  };

  $('#tab-hero').addEventListener('click', (e) => {
    const c = state.char;
    const st = e.target.closest('[data-stat]');
    if (st && !st.disabled) { state.pending[st.dataset.stat] = (state.pending[st.dataset.stat] || 0) + 1; return render(); }
    const act = e.target.closest('[data-act]');
    if (act) {
      if (act.dataset.act === 'stats-reset') { state.pending = {}; return render(); }
      if (act.dataset.act === 'stats-save') { P.allocate(c, state.pending); state.pending = {}; app.save(); return render(); }
      if (act.dataset.act === 'reset') {
        if (!confirm(`Удалить ${c.nick} навсегда? Уровень, вещи и золото пропадут.`)) return;
        clearInterval(state.travelTimer);
        charStore.clear();
        state.char = null;
        state.pending = {};
        state.create = { nick: '', gender: 'm', job: 'warrior' };
        renderCreate();
        show('create');
        return;
      }
    }
    const learn = e.target.closest('[data-learn]');
    if (learn && !learn.disabled) { const r = P.learnSkill(data, c, learn.dataset.learn); if (!r.ok) toast(r.reason, 'bad'); app.save(); return render(); }
    const pas = e.target.closest('[data-passive]');
    if (pas && !pas.disabled) { const r = P.learnPassive(data, c, pas.dataset.passive); if (!r.ok) toast(r.reason, 'bad'); app.save(); return render(); }
    const tog = e.target.closest('[data-slot-toggle]');
    if (tog) {
      const id = tog.dataset.slotToggle;
      if (c.slots.includes(id)) c.slots = c.slots.filter((x) => x !== id);
      else if (c.slots.length < data.SKILL_SLOTS) c.slots.push(id);
      else return toast(`Все ${data.SKILL_SLOTS} ячейки заняты — сначала уберите умение`, 'bad');
      app.save(); return render();
    }
    const left = e.target.closest('[data-slot-left]');
    if (left) {
      const i = Number(left.dataset.slotLeft);
      [c.slots[i - 1], c.slots[i]] = [c.slots[i], c.slots[i - 1]];
      app.save(); render();
    }
  });

  // ---------- Старт ----------

  window.addEventListener('DOMContentLoaded', () => {
    if (state.char) setTab('world');
    else {
      if (charStore.load() == null) {
        try { if (localStorage.getItem('pc-character-v1')) toast('Новая версия: старый персонаж несовместим, создайте героя заново.'); } catch (e) { /* нет хранилища */ }
      }
      renderCreate();
      show('create');
    }
  });
})();
