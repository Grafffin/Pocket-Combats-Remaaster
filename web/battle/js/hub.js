// Лагерь: создание персонажа, локации и переходы, NPC, характеристики, снаряжение, итог боя.
// Персонаж хранится в localStorage.
(function () {
  'use strict';
  const { data, progression: P, economy: E, world: W, formulas: F, TACTICS } = PC;
  const { $, icon, avatar, escapeHtml, plural, openSheet, closeSheet, storage } = PC.kit;

  const charStore = storage('pc-character-v1', null);
  const settingsStore = storage('pc-settings', { timer: true });
  const rng = PC.makeRng(Date.now());

  const state = {
    char: P.migrate(data, charStore.load()),
    settings: settingsStore.load(),
    tab: 'loc',
    pending: {},        // очки характеристик, расставленные, но ещё не сохранённые
    lastMonster: null,
    travelTimer: null,
    create: { nick: '', gender: 'm', job: 'warrior' },
  };

  const save = () => charStore.save(state.char);
  const pendingTotal = () => Object.values(state.pending).reduce((a, b) => a + b, 0);
  const gold = (n) => `<span class="gold">💰 ${n}</span>`;

  function show(screen) {
    for (const id of ['create', 'hub', 'battle']) $(`#${id}`).hidden = id !== screen;
  }

  const itemName = (item) => {
    const p = data.items[item.id];
    return `<span class="r${item.rarity}">${p.emoji} ${p.name}${item.upgrade ? ` +${item.upgrade}` : ''}</span>`;
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
    state.tab = 'loc';
    openHub();
  }

  // ---------- Лагерь ----------

  function openHub(tab) {
    if (tab) state.tab = tab;
    show('hub');
    renderHub();
    watchTravel();
  }

  function renderHub() {
    const c = state.char;
    const need = P.expToNext(c.level);
    const atMax = c.level >= P.MAX_LEVEL;
    $('#hub-name').textContent = c.nick;
    $('#hub-sub').innerHTML = `${data.jobs[c.job].title}, ${c.level} уровень · ${gold(c.gold)}`;
    $('#hub-exp-fill').style.width = atMax ? '100%' : `${(c.exp / need) * 100}%`;
    $('#hub-exp-text').textContent = atMax ? 'максимум' : `${c.exp} / ${need} опыта`;

    for (const b of document.querySelectorAll('.tabs button')) b.classList.toggle('on', b.dataset.tab === state.tab);
    $('#tab-char-badge').hidden = !c.statPoints;
    $('#tab-char-badge').textContent = c.statPoints;
    for (const id of ['loc', 'char', 'gear']) $(`#tab-${id}`).hidden = id !== state.tab;
    ({ loc: renderLocation, char: renderChar, gear: renderGear })[state.tab]();
  }

  document.querySelector('.tabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-tab]');
    if (b) { state.tab = b.dataset.tab; renderHub(); $('#hub-body').scrollTop = 0; }
  });

  // ---------- Локация ----------

  function levelClass(diff) {
    if (diff <= -3) return 'trivial';
    if (diff <= 0) return 'easy';
    if (diff === 1) return 'fair';
    if (diff === 2) return 'hard';
    return 'deadly';
  }

  const levelsText = (loc) => (loc.levels ? `${loc.levels[0]}–${loc.levels[1]} ур.` : 'безопасно');

  function renderLocation() {
    const c = state.char;
    const t = W.travelProgress(c, Date.now());
    if (t) {
      const from = data.locations[t.from], to = data.locations[t.to];
      $('#tab-loc').innerHTML = `
        <section class="panel travel">
          <h3>В пути</h3>
          <p class="travel-route">${from.name} → <b>${to.name}</b></p>
          <div class="exp-bar big travel-bar"><div id="travel-fill" style="width:${t.progress * 100}%"></div></div>
          <p class="meta" id="travel-left">Осталось ${Math.ceil(t.left / 1000)} с</p>
          <p class="hint">${to.desc}</p>
          <button class="btn" id="travel-cancel">Вернуться в «${from.name}»</button>
        </section>`;
      return;
    }

    const loc = W.here(data, c);
    const monsters = loc.monsters.map((id) => {
      const m = data.monsters[id];
      const exp = Math.max(1, Math.round(m.exp * P.expMultiplier(c.level, m.level)));
      const tags = [m.boss ? '<span class="boss">босс</span>' : '', m.aggressive ? '<span class="aggr">нападает первым</span>' : ''].join('');
      return `<button class="mon" data-mon="${id}">
        ${avatar(m)}
        <div class="txt"><b>${m.name}</b>${tags}
          <div class="meta">${m.blurb}</div>
          <div class="meta">Опыт ${exp}${m.gold && m.gold[1] ? ` · ${gold(`${m.gold[0]}–${m.gold[1]}`)}` : ''}</div>
        </div>
        <span class="lvl-badge ${levelClass(m.level - c.level)}">${m.level}</span>
      </button>`;
    }).join('');

    const npcs = (loc.npcs || []).map((id) => {
      const n = data.npcs[id];
      return `<button class="mon" data-npc="${id}"><div class="ava">${n.emoji}</div>
        <div class="txt"><b>${n.name}</b><div class="meta">${n.desc}</div></div></button>`;
    }).join('');

    const routes = Object.entries(loc.routes).map(([id, sec]) => {
      const to = data.locations[id];
      const cls = to.levels ? levelClass(to.levels[0] - c.level) : 'easy';
      return `<button class="route" data-route="${id}">
        <span class="route-name">→ ${to.name}</span>
        <span class="route-meta"><span class="dot ${cls}"></span>${levelsText(to)} · ${sec} с</span>
      </button>`;
    }).join('');

    const pot = c.potions;
    const potions = [`здоровья ×${pot.hp_potion || 0}`];
    if (c.job === 'mage') potions.push(`маны ×${pot.mp_potion || 0}`);

    $('#tab-loc').innerHTML = `
      <section class="panel">
        <h3>${loc.name}<span class="points">${levelsText(loc)}</span></h3>
        <p class="loc-desc">${loc.desc}</p>
      </section>
      ${npcs ? `<section class="panel"><h3>Жители</h3><div class="list">${npcs}</div></section>` : ''}
      <section class="panel"><h3>${loc.safe ? 'Тренировка' : 'Монстры'}</h3><div class="list">${monsters}</div></section>
      <section class="panel"><h3>Переходы</h3>${routes}</section>
      <p class="hint">Зелья: ${potions.join(', ')}. Здоровье восстанавливается после каждого боя.
        Поражение отправляет в ${data.locations[data.HOME].name} и стоит ${Math.round(data.DEATH_GOLD_LOSS * 100)}% золота.</p>
      <label class="check"><input type="checkbox" id="timer-on" ${state.settings.timer ? 'checked' : ''}> Таймер хода, 30 секунд</label>`;
  }

  $('#tab-loc').addEventListener('click', (e) => {
    const m = e.target.closest('[data-mon]');
    if (m) return startBattle(m.dataset.mon);
    const n = e.target.closest('[data-npc]');
    if (n) return openNpc(n.dataset.npc);
    const r = e.target.closest('[data-route]');
    if (r) {
      const res = W.startTravel(data, state.char, r.dataset.route, Date.now());
      if (!res.ok) return alert(res.reason);
      save();
      renderHub();
      watchTravel();
      return;
    }
    if (e.target.id === 'travel-cancel') {
      W.cancelTravel(state.char);
      save();
      renderHub();
    }
  });
  $('#tab-loc').addEventListener('change', (e) => {
    if (e.target.id === 'timer-on') { state.settings.timer = e.target.checked; settingsStore.save(state.settings); }
  });

  // Тикает, пока персонаж в пути; по прибытии может случиться засада
  function watchTravel() {
    clearInterval(state.travelTimer);
    if (!state.char || !state.char.transit) return;
    const tick = () => {
      const c = state.char;
      if (!c.transit) { clearInterval(state.travelTimer); return; }
      const done = W.completeTravel(data, c, Date.now(), rng);
      if (!done) {
        const t = W.travelProgress(c, Date.now());
        const fill = $('#travel-fill');
        if (fill) {
          fill.style.width = `${t.progress * 100}%`;
          $('#travel-left').textContent = `Осталось ${Math.ceil(t.left / 1000)} с`;
        }
        return;
      }
      clearInterval(state.travelTimer);
      save();
      if (!$('#hub').hidden) renderHub();
      if (done.ambush) ambush(done.ambush);
    };
    tick();
    state.travelTimer = setInterval(tick, 250);
  }

  function ambush(monsterId) {
    const m = data.monsters[monsterId];
    openSheet('Засада!', `<div class="ambush">${avatar(m)}
        <p><b>${m.name}</b> ${m.gender === 'f' ? 'заметила' : 'заметил'} вас и ${m.gender === 'f' ? 'бросилась' : 'бросился'} в атаку.</p></div>
      <div class="row-actions"><button class="btn primary" data-act="fight">К бою!</button></div>`, (e) => {
      if (e.target.closest('[data-act="fight"]')) { closeSheet(); startBattle(monsterId); }
    }, { modal: true });
  }

  function startBattle(monsterId) {
    state.lastMonster = monsterId;
    $('#result').hidden = true;
    show('battle');
    PC.battleUI.start({
      player: P.toFighter(data, state.char),
      monster: data.monsters[monsterId],
      timer: state.settings.timer,
      onEnd: (battle, { fled }) => {
        const summary = P.applyBattleResult(data, state.char, battle, monsterId, rng, { fled });
        save();
        showResult(summary, battle);
      },
    });
  }

  // ---------- NPC ----------

  function openNpc(id) {
    ({ shop: openShop, buyer: openBuyer, smith: openSmith })[id]();
  }

  function npcHead(id) {
    const n = data.npcs[id];
    return `<p class="npc-greet">«${n.greeting}»</p><p class="meta">У вас ${gold(state.char.gold)}</p>`;
  }

  function flash(msg) {
    const el = $('#sheet-body .flash');
    if (el) { el.textContent = msg; el.hidden = false; }
  }

  function openShop(msg) {
    const c = state.char;
    // Вещи чужих классов не показываем — купить их можно было бы только на продажу в убыток
    const stock = data.npcs.shop.stock.filter((id) => !data.items[id] || !data.items[id].jobs || data.items[id].jobs.includes(c.job));
    const rows = stock.map((id) => {
      const price = E.priceOf(data, id);
      const afford = c.gold >= price;
      if (data.consumables[id]) {
        const d = data.consumables[id];
        return `<div class="trade-row"><div class="txt"><b>🧪 ${d.name}</b><div class="meta">${d.desc} · у вас ${c.potions[id] || 0}</div></div>
          <button class="btn small" data-buy="${id}" ${afford ? '' : 'disabled'}>${gold(price)}</button></div>`;
      }
      const it = data.items[id];
      const ok = P.canEquip(data, c, { id });
      return `<div class="trade-row"><div class="txt"><b>${it.emoji} ${it.name}</b>
          <div class="meta">${data.slots[it.slot]} · ${P.itemLines(data, { id, bonus: {} }).join(', ')}</div>
          ${ok.ok ? '' : `<div class="req">${ok.reason}</div>`}</div>
        <button class="btn small" data-buy="${id}" ${afford ? '' : 'disabled'}>${gold(price)}</button></div>`;
    }).join('');
    openSheet(data.npcs.shop.name, `${npcHead('shop')}<p class="flash" ${msg ? '' : 'hidden'}>${msg || ''}</p>${rows}`, (e) => {
      const b = e.target.closest('[data-buy]');
      if (!b || b.disabled) return;
      const res = E.buy(data, c, b.dataset.buy);
      if (!res.ok) return flash(res.reason);
      save();
      renderHub();
      const name = data.consumables[b.dataset.buy] ? data.consumables[b.dataset.buy].name : data.items[b.dataset.buy].name;
      openShop(`Куплено: ${name} за ${res.price} золота.`);
    });
  }

  function openBuyer(msg) {
    const c = state.char;
    const rows = c.backpack.map((it) => `<div class="trade-row"><div class="txt">${itemName(it)}
        <div class="meta">${data.slots[data.items[it.id].slot]}</div></div>
      <button class="btn small" data-sell="${it.uid}">${gold(E.sellPrice(data, it))}</button></div>`).join('');
    const junk = c.backpack.filter((it) => !(it.rarity || it.upgrade));
    const junkTotal = junk.reduce((s, it) => s + E.sellPrice(data, it), 0);
    openSheet(data.npcs.buyer.name, `${npcHead('buyer')}<p class="flash" ${msg ? '' : 'hidden'}>${msg || ''}</p>
      ${rows || '<p class="hint">Рюкзак пуст. Надетые вещи сначала нужно снять.</p>'}
      ${junk.length ? `<div class="row-actions"><button class="btn" data-junk>Продать всё обычное (${junk.length}) за ${gold(junkTotal)}</button></div>` : ''}`, (e) => {
      const s = e.target.closest('[data-sell]');
      if (s) {
        const it = c.backpack.find((x) => x.uid === s.dataset.sell);
        const name = data.items[it.id].name;
        const res = E.sell(data, c, s.dataset.sell);
        save();
        renderHub();
        return openBuyer(`Продано: ${name} за ${res.price} золота.`);
      }
      if (e.target.closest('[data-junk]')) {
        const res = E.sellJunk(data, c);
        save();
        renderHub();
        openBuyer(`Продано вещей: ${res.count}, выручка ${res.total} золота.`);
      }
    });
  }

  function openSmith(msg, selected) {
    const c = state.char;
    const all = [
      ...Object.values(c.equipment).filter(Boolean).map((it) => ({ it, worn: true })),
      ...c.backpack.map((it) => ({ it, worn: false })),
    ];
    let body;
    const sel = selected && E.findItem(c, selected);
    if (sel) {
      const info = E.refineInfo(data, sel.item);
      const next = { ...sel.item, upgrade: (sel.item.upgrade || 0) + 1 };
      body = `<p class="item-head">${itemName(sel.item)}</p>
        <ul class="props">${P.itemLines(data, sel.item).map((l) => `<li>${l}</li>`).join('')}</ul>
        ${info.maxed ? '<p class="hint">Заточено до предела.</p>' : `
          <div class="compare"><p class="meta">После заточки до +${info.target}:</p>
            <ul class="props">${P.itemLines(data, next).map((l) => `<li>${l}</li>`).join('')}</ul></div>
          <p>Шанс успеха: <b>${info.chance}%</b> · цена ${gold(info.cost)}</p>
          <p class="${info.risky ? 'req' : 'meta'}">${info.risky ? 'При неудаче предмет сломается!' : 'При неудаче пропадут только деньги.'}</p>`}
        <div class="row-actions">
          <button class="btn" data-back>К списку</button>
          ${info.maxed ? '' : `<button class="btn primary" data-refine="${sel.item.uid}" ${c.gold >= info.cost ? '' : 'disabled'}>Заточить</button>`}
        </div>`;
    } else {
      body = all.map(({ it, worn }) => {
        const info = E.refineInfo(data, it);
        return `<button class="slot" data-pick="${it.uid}">
          <span class="slot-name">${worn ? 'надето' : 'рюкзак'}</span>
          <span class="slot-item">${itemName(it)}<span class="meta"> ${info.maxed ? '· предел' : `· до +${info.target}: ${info.chance}%, ${info.cost} з.`}</span></span>
        </button>`;
      }).join('') || '<p class="hint">Нечего точить.</p>';
    }
    openSheet(data.npcs.smith.name, `${npcHead('smith')}<p class="flash" ${msg ? '' : 'hidden'}>${msg || ''}</p>${body}`, (e) => {
      const pick = e.target.closest('[data-pick]');
      if (pick) return openSmith(null, pick.dataset.pick);
      if (e.target.closest('[data-back]')) return openSmith();
      const r = e.target.closest('[data-refine]');
      if (!r || r.disabled) return;
      const uid = r.dataset.refine;
      if (E.refineInfo(data, E.findItem(c, uid).item).risky &&
          !confirm('Заточка выше +4 может сломать предмет. Рискнуть?')) return;
      const res = E.refine(data, c, uid, rng);
      if (!res.ok) return flash(res.reason);
      save();
      renderHub();
      if (res.outcome === 'success') return openSmith(`Успех! Предмет заточен до +${res.info.target}.`, uid);
      if (res.outcome === 'failed') return openSmith('Не вышло. Металл не поддался, деньги потрачены.', uid);
      openSmith('Раздался треск — предмет сломан.');
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
      ...(d.mdmg ? [['Сила заклинаний', `+${d.mdmg}`]] : []),
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
      if (!confirm(`Удалить ${state.char.nick} навсегда? Уровень, вещи и золото пропадут.`)) return;
      clearInterval(state.travelTimer);
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
        ${pack || '<p class="hint">Пусто. Вещи выпадают с монстров и продаются в лавке.</p>'}</section>`;
  }

  function itemSheet(item, where) {
    const c = state.char;
    const p = data.items[item.id];
    const lines = P.itemLines(data, item).map((l) => `<li>${l}</li>`).join('');
    const req = [`${p.level} уровень`];
    if (p.jobs) req.push(p.jobs.map((j) => data.jobs[j].title.toLowerCase()).join(', '));
    let html = `<p class="item-head">${itemName(item)}<span class="meta">${data.slots[p.slot]} · ${data.rarities[item.rarity].name}</span></p>
      <ul class="props">${lines}</ul><p class="meta">Требования: ${req.join(', ')} · скупщик даст ${gold(E.sellPrice(data, item))}</p>`;

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
        if (!confirm(`Выбросить «${p.name}»? Скупщик в деревне дал бы за него ${E.sellPrice(data, item)} золота.`)) return;
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
      html += `<p>Получено опыта: <b>${sum.exp}</b>${sum.gold ? `, золота: <b>${gold(sum.gold)}</b>` : ''}.
          Бой длился ${battle.turn} ${plural(battle.turn, 'ход', 'хода', 'ходов')}.</p>
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
      html += loot ? `<p class="meta">Добыча:</p><ul class="loot">${loot}</ul>` : '<p class="meta">Вещей не выпало.</p>';
      if (sum.lost.length) html += `<p class="req">Рюкзак полон — ${sum.lost.length} ${plural(sum.lost.length, 'вещь осталась', 'вещи остались', 'вещей осталось')} на земле.</p>`;
    } else if (sum.fled) {
      html += '<p>Вы сбежали с поля боя. Опыт не получен.</p>';
    } else {
      const m = data.monsters[state.lastMonster];
      html += `<p>${escapeHtml(m.name)} ${m.gender === 'f' ? 'оказалась' : 'оказался'} сильнее.</p>`;
      if (sum.sentHome) html += `<p>Вы пришли в себя в деревне ${data.locations[data.HOME].name}.</p>`;
      if (sum.goldLost) html += `<p class="req">Потеряно золота: ${sum.goldLost}.</p>`;
    }
    $('#result-body').innerHTML = html;
    $('#again').hidden = !sum.win && !sum.fled && sum.sentHome; // монстр остался на другой локации
    $('#to-camp').textContent = c.statPoints ? 'Распределить очки' : 'К локации';
    $('#result').hidden = false;
  }

  $('#again').addEventListener('click', () => startBattle(state.lastMonster));
  $('#to-camp').addEventListener('click', () => {
    $('#result').hidden = true;
    openHub(state.char.statPoints ? 'char' : 'loc');
  });

  // ---------- Старт ----------

  if (state.char) { save(); openHub(); }
  else { renderCreate(); show('create'); }
})();
