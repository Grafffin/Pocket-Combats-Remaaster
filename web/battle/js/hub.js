// Приложение: состояние и сохранение, создание персонажа, шапка, вкладки «Мир» и «Герой», бой и автоохота,
// лавка и алхимик. «Сумка», скупщик и сундук — bag-ui.js, «Кузница» — forge-ui.js (регистрируются в PC.app.tabs).
(function () {
  'use strict';
  const { data, progression: P, economy: E, world: W, items: I, stats: S, monsters: M } = PC;
  const { $, $$, art, statIcon, avatar, escapeHtml, plural, fmtNum, openSheet, closeSheet, openModal, closeModal, prefs, savePrefs, toast, storage } = PC.kit;
  const { tile, costHtml } = PC.itemUI;

  const charStore = storage('pc-character-v3', null);
  const rng = PC.makeRng(Date.now());

  const state = {
    char: P.migrate(data, charStore.load()),
    tab: 'world',
    pending: {},          // очки характеристик, расставленные, но ещё не сохранённые
    fight: null,          // текущий бой: { uid, monsterId, level }
    huntTimer: null,
    worldTimer: null,
    create: { nick: '', gender: 'm', job: 'warrior' },
  };

  const app = {
    state, rng,
    tabs: {},
    save: () => { charStore.save(state.char); if (PC.cloud) PC.cloud.touch(); },
    // Облачная версия героя и сундука заменяет локальную (null — героя нет, нужен экран создания).
    applyRemote(remote, remoteStash) {
      clearTimeout(state.huntTimer);
      if (remote) charStore.save(remote); else charStore.clear();
      state.char = remote ? P.migrate(data, remote) : null;
      state.pending = {}; state.fight = null;
      if (app.stashApi) app.stashApi.set(remoteStash);
      start();
    },
    render,
    setTab,
    toast,
    inVillage: () => !!state.char && state.char.location === data.HOME && !state.char.transit,
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
  }

  function render() {
    const c = state.char;
    if (!c) return;
    W.update(data, c, Date.now(), rng);
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
    const buffs = Object.entries(c.buffs || {}).map(([id, n]) => `<span class="buff info-link" data-info="${id}" title="${data.materials[id].name}: ещё ${n} побед">${art(data.materials[id].art, '✦')}${n}</span>`).join('');
    $('#hero-bar').innerHTML = `
      <div class="portrait">${art(`classes/${c.job}`, data.classes[c.job].title.charAt(0))}</div>
      <div class="who"><b>${escapeHtml(c.nick)}</b>
        <div class="bar-line"><span class="meta">${data.classes[c.job].title} · ${c.level} ур.</span>
          <div class="progress thin" style="flex:1"><div style="width:${c.level >= P.MAX_LEVEL ? 100 : (c.exp / need) * 100}%"></div></div></div></div>
      ${diffBadge(c)}
      <div class="wallet"><span class="info-link" data-info="gold">${art('materials/gold', '💰')}${fmtNum(c.gold)}</span><span class="meta">${buffs || `${fmtNum(c.exp)} / ${fmtNum(need)}`}</span></div>`;
  }

  // Значок сложности мира: цвет и анимация зависят от ступени, тап — выбор сложности
  function diffBadge(c) {
    const d = data.difficulties[W.diffOf(c)];
    return `<button class="diff-badge anim-${d.anim}" style="--dc:${d.color}" data-act="difficulty" title="Сложность: ${d.name}">
      <span class="db-ring"></span><span class="db-num">${d.short}</span></button>`;
  }

  function openDifficulty() {
    const c = state.char;
    const cur = W.diffOf(c), open = W.diffUnlocked(c);
    const fz = data.locations[W.finalZone(data)];
    const bossName = data.monsters[fz.boss[0]].name;
    const rows = data.difficulties.map((d) => {
      const locked = d.id > open;
      return `<button class="diff-row-item ${d.id === cur ? 'on' : ''}" data-diff="${d.id}" ${locked ? 'disabled' : ''} style="--dc:${d.color}">
        <span class="diff-badge anim-${d.anim} small" style="--dc:${d.color}"><span class="db-ring"></span><span class="db-num">${d.short}</span></span>
        <span class="txt"><b>${d.name}</b>${locked ? ' 🔒' : ''}<small class="meta">${d.id ? `монстры ×${d.mult} · опыт и золото ×${d.exp} · находка +${d.mf}% · уровень вещей +${d.ilvl}${d.stone3 ? ` · камни III ${d.stone3}%` : ''}` : 'базовая сложность'}</small></span></button>`;
    }).join('');
    openModal('Сложность мира', `<p class="meta">Одна для всех зон. Следующая открывается победой над последним боссом мира — <b>${bossName}</b> (${fz.name}) — на текущей сложности. Цель — собрать вещи, которые вытянут каждую ступень.</p>
      <div class="list">${rows}</div>`, (e) => {
      const b = e.target.closest('[data-diff]');
      if (!b || b.disabled) return;
      if (state.fight && !$('#battle').hidden) return toast('Нельзя менять сложность в бою', 'bad');
      const r = W.setDiff(data, c, Number(b.dataset.diff));
      if (!r.ok) return toast(r.reason, 'bad');
      app.save();
      state.worldSig = null;
      closeModal();
      render();
      toast(`Сложность: ${data.difficulties[c.difficulty].name}`);
    });
  }

  $('#hero-bar').addEventListener('click', (e) => {
    if (e.target.closest('[data-act="difficulty"]')) openDifficulty();
  });

  $('#tabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-tab]');
    if (!b) return;
    if (b.dataset.tab === 'menu') return openMenu();
    setTab(b.dataset.tab);
  });

  function accNote() {
    const a = PC.auth;
    if (!a || !a.user) return 'Не выполнен вход';
    return `${escapeHtml(a.profile ? a.profile.nick : 'Игрок')}${a.user.is_anonymous ? ' · гость' : ''}`;
  }

  function openAccount() {
    const a = PC.auth;
    if (a && a.user) {
      openModal('Аккаунт', `<p>${accNote()}</p><button class="btn danger wide" data-out>Выйти</button>`,
        (e) => { if (e.target.closest('[data-out]')) { closeModal(); a.signOut(); } });
    } else if (a) a.open();
  }

  const RESULT = { win: ['Победа', 'good'], lose: ['Поражение', 'req'], fled: ['Бегство', 'meta'] };
  async function openHistory() {
    openModal('История боёв', '<p class="meta">Загрузка…</p>');
    const rows = await PC.battles.history();
    const body = rows == null ? '<p class="meta">История пока недоступна (нужна миграция 0008 на сервере).</p>'
      : !rows.length ? '<p class="meta">Пока нет завершённых боёв.</p>'
      : `<div class="menu-list">${rows.map((r) => {
        const m = data.monsters[r.monster_id], [label, cls] = RESULT[r.result] || ['?', 'meta'];
        const when = new Date(r.ended_at).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
        return `<button class="menu-item" data-hist="${r.id}"><span><b class="${cls}">${label}</b> · ${escapeHtml(m ? m.name : r.monster_id)} ${r.monster_level} ур.
          <small class="meta">${when} · ${r.turns} ход. · ${(r.members || []).map(escapeHtml).join(', ')}${r.total_damage ? ` · урон ${fmtNum(r.my_damage || 0)}/${fmtNum(r.total_damage)}` : ''}</small></span></button>`;
      }).join('')}</div>`;
    openModal('История боёв', body, (e) => {
      const b = e.target.closest('[data-hist]');
      const r = b && rows.find((x) => x.id === b.dataset.hist);
      if (r) openModal('Лог боя', `<div class="hist-log">${(r.log || []).map((l) => `<p class="${l.k === 'turn' ? 'meta' : ''}">${l.k === 'turn' ? `Ход ${escapeHtml(l.t)}` : escapeHtml(l.t)}</p>`).join('') || '<p class="meta">Лог не сохранён.</p>'}</div><button class="btn wide" data-back>Назад</button>`, (ev) => { if (ev.target.closest('[data-back]')) openHistory(); });
    });
  }

  // Дополнительное меню (☰): разделы, которым не нужно место на нижней панели
  function openMenu() {
    const village = app.inVillage();
    const item = (id, icon, title, note, on) => `<button class="menu-item" data-menu="${id}" ${on ? '' : 'disabled'}>
      <span class="menu-ico">${art(icon, '•')}</span><span><b>${title}</b><small class="meta">${note}</small></span></button>`;
    openModal('Меню', `<div class="menu-list">
      ${item('forge', 'npcs/blacksmith', 'Кузница', village ? 'Заточка, ранги, перенос, перековка, ковка' : 'Только в деревне', village)}
      ${item('alchemist', 'npcs/alchemist', 'Алхимик', village ? 'Зелья и эликсиры' : 'Только в деревне', village)}
      ${item('stash', 'npcs/chest', 'Сундук', village ? 'Хранилище на 300 вещей' : 'Только в деревне', village)}
      ${item('history', 'ui/gear', 'История боёв', PC.battles && PC.battles.history ? 'Последние 30 боёв' : 'Недоступно', !!(PC.battles && PC.battles.history))}
      ${item('quests', 'npcs/elder', 'Задания', 'Скоро', false)}
      ${item('account', 'ui/gear', 'Аккаунт', accNote(), true)}
      ${item('settings', 'ui/gear', 'Настройки', 'Скоро', false)}
    </div>`, (e) => {
      const b = e.target.closest('[data-menu]');
      if (!b || b.disabled) return;
      closeModal();
      if (b.dataset.menu === 'forge') setTab('forge');
      if (b.dataset.menu === 'alchemist') openAlchemist();
      if (b.dataset.menu === 'stash') PC.bagUI.openStash();
      if (b.dataset.menu === 'account') openAccount();
      if (b.dataset.menu === 'history') openHistory();
    });
  }

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
    const now = Date.now();
    const t = W.travelProgress(c, now);
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
    const st = W.update(data, c, now, rng);

    const routes = Object.entries(loc.routes).map(([id, sec]) => {
      const to = data.locations[id];
      const cls = to.levels ? levelClass(to.levels[0] - c.level) : 'easy';
      return `<button class="route" data-route="${id}"><span class="route-name">→ ${to.name}</span>
        <span class="route-meta"><span class="dot ${cls}"></span>${to.levels ? `${to.levels[0]}–${to.levels[1]} ур.` : 'безопасно'} · ${sec} с</span></button>`;
    }).join('');

    const npcs = (loc.npcs || []).map((id) => {
      const n = data.npcs[id];
      return `<button class="npc" data-npc="${id}">${avatar(n, 44)}<div><b>${n.name}</b><span>${n.desc}</span></div></button>`;
    }).join('');

    const rest = W.restLeft(c, now);
    const mobs = [st.boss, ...st.mobs].filter(Boolean).map((m) => mobRow(m, now, rest)).join('');
    const kills = c.zoneKills[c.location] || 0;
    const bossNote = loc.boss && !st.boss
      ? `<div class="boss-progress"><span class="meta">${data.monsters[loc.boss[0]].name} появится после ${data.BOSS_KILLS} побед</span>
          <div class="progress thin"><div style="width:${(kills / data.BOSS_KILLS) * 100}%"></div></div></div>` : '';

    root.innerHTML = `
      <div class="banner">${art(loc.art, '')}<div class="title"><b>${loc.name}</b><span>${loc.levels ? `${loc.levels[0]}–${loc.levels[1]} уровень · тир вещей ${loc.tier}${W.diffOf(c, c.location) ? ` · <i style="color:${data.difficulties[W.diffOf(c, c.location)].color};font-style:normal">${data.difficulties[W.diffOf(c, c.location)].name}</i>` : ''}` : 'Безопасная зона'}</span></div></div>
      <div class="card section"><h3>Переходы</h3>${routes}</div>
      ${npcs ? `<div class="card section"><h3>Жители</h3><div class="npc-grid">${npcs}</div></div>` : ''}
      <div class="card section"><h3>${loc.safe ? 'Тренировка' : 'Монстры'}
          <span class="note" id="rest-note">${rest ? `передышка ${Math.ceil(rest / 1000)} с` : `тик ${Math.ceil(W.msToNextTick(now) / 1000)} с`}</span></h3>
        <div class="list">${mobs}</div>${bossNote}
        ${loc.safe ? '' : `<p class="hint">Монстров на локации ${st.mobs.length} (в ММО их число будет расти с числом игроков). Убитые возрождаются на следующем тике, после боя — передышка до тика. Тик — ${W.TICK_MS / 1000} с. Нажмите на монстра — его характеристики и добыча.</p>`}
        ${loc.safe ? '' : `<div class="row-actions"><button class="btn ${c.settings.autoHunt ? 'primary' : ''}" data-act="hunt">${c.settings.autoHunt ? 'Автоохота включена' : 'Начать автоохоту'}</button>
          <button class="btn" data-act="auto-settings">Настройки</button></div>`}
      </div>
      ${loc.safe || !PC.battles ? '' : PC.battles.html()}
      <div class="card section"><p class="loc-desc">${loc.desc}</p></div>
      ${PC.presence ? PC.presence.html() : ''}`;
  }

  function mobRow(m, now, rest) {
    const c = state.char;
    const def = data.monsters[m.id];
    const dead = m.deadUntil != null;
    const dd = data.difficulties[W.diffOf(c, c.location)];
    const exp = Math.round(M.rewards.exp(m.id, m.level) * P.expMultiplier(c.level, m.level) * dd.exp);
    let status = '';
    if (dead) status = `<span class="mob-status">возродится через ${Math.ceil(Math.max(0, W.tickStart(m.deadUntil) - now) / 1000)} с</span>`;
    else if (m.busy) status = '<span class="mob-status">в бою</span>';
    return `<div class="mob ${m.boss ? 'boss' : ''} ${dead ? 'dead' : ''}" data-mob="${m.uid}" data-mobinfo="${m.uid}">
      <div class="ava mob-ava" style="width:52px;height:52px">${art(def.art, def.emoji)}<span class="lvl-badge ${levelClass(m.level - c.level)}">${m.level}</span></div>
      <div class="txt"><b>${def.name}</b>${m.boss ? '<span class="tag boss">босс</span>' : ''}<span class="tag kind">${KIND_NAME[def.kind] || ''}</span>
        ${def.ai === 'idle' ? '' : `<div class="meta">≈${fmtNum(exp)} опыта</div>`}${status}</div>
      <button class="attack-btn" data-attack="${m.uid}" ${dead || m.busy ? 'disabled' : ''} title="Напасть" aria-label="Напасть">${SWORDS}</button></div>`;
  }

  $('#tab-world').addEventListener('click', (e) => {
    const c = state.char;
    const atk = e.target.closest('[data-attack]');
    if (atk) { if (!atk.disabled) startFight(atk.dataset.attack); return; }
    const info = e.target.closest('[data-mobinfo]');
    if (info) return openMonsterInfo(info.dataset.mobinfo);
    const n = e.target.closest('[data-npc]');
    if (n) return openNpc(n.dataset.npc);
    const r = e.target.closest('[data-route]');
    if (r) {
      if (c.settings.autoHunt) { c.settings.autoHunt = false; }
      const res = W.startTravel(data, c, r.dataset.route, Date.now());
      if (!res.ok) return toast(res.reason, 'bad');
      app.save();
      render();
      return;
    }
    const act = e.target.closest('[data-act]');
    if (!act) return;
    if (act.dataset.act === 'join-battle') {
      if (act.disabled) return;
      act.disabled = true;
      PC.battles.join(c, act.dataset.battle).then((r) => {
        if (r.error) { act.disabled = false; return toast(r.error, 'bad'); }
        if (!startFight(null, r)) act.disabled = false;
      });
      return;
    }
    if (act.dataset.act === 'cancel-travel') { W.cancelTravel(c); app.save(); render(); }
    if (act.dataset.act === 'auto-settings') PC.battleUI.openAutoSettings(c.settings, (patch) => { Object.assign(c.settings, patch); app.save(); render(); });
    if (act.dataset.act === 'hunt') {
      c.settings.autoHunt = !c.settings.autoHunt;
      if (c.settings.autoHunt) c.settings.autoBattle = true;
      app.save();
      render();
      if (c.settings.autoHunt) scheduleHunt();
    }
  });

  // Скрещённые мечи для кнопки атаки
  const SWORDS = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 2l7.5 7.5-1.6 1.6L2.4 3.6V2zM20 2h1.6v1.6L9.6 15.6l1.9 1.9-1.4 1.4-1.6-1.6-3.1 3.1.5.5-1.4 1.4-2.8-2.8 1.4-1.4.5.5 3.1-3.1-1.6-1.6 1.4-1.4 1.9 1.9zM14.1 13.2l1.4-1.4 1.9 1.9 1.4-1.4 1.4 1.4-1.4 1.4 1.6 1.6 1.9-.4.4 2-2.8 2.8-2-.4.4-1.9-1.6-1.6-1.4 1.4-1.4-1.4 1.4-1.4z"/></svg>`;

  // Карточка монстра: характеристики на его уровне, умения, сопротивления, награда и возможная добыча
  function openMonsterInfo(uid) {
    const c = state.char;
    const m = W.findMob(data, c, uid);
    if (!m) return;
    const def = data.monsters[m.id];
    const D = W.diffOf(c, c.location);
    const dd = data.difficulties[D];
    const t = M.monsterAt(m.id, m.level, D);
    const s = t.stats;
    const fmt = PC.fmtBig;
    const loc = W.here(data, c);
    const tier = I.maxTierFor(data, m.level + dd.ilvl);
    const [g0, g1] = M.rewards.gold(m.id, m.level).map((g) => Math.round(g * dd.gold));
    const exp = Math.round(M.rewards.exp(m.id, m.level) * P.expMultiplier(c.level, m.level) * dd.exp);
    const res = [['fireRes', '🔥'], ['coldRes', '❄'], ['poisonRes', '☠']].filter(([k]) => s[k]).map(([k, i]) => `${i} ${s[k] > 0 ? '' : '−'}${Math.abs(s[k])}%`).join(' ');
    const skills = (def.skills || []).map((id) => data.monsterSkills[id].name).join(', ');
    const DR = P.DROP;
    const mats = (loc.mats || []).map((id) => `<span class="info-link" data-info="${id}">${art(data.materials[id].art, '•')}${data.materials[id].name}</span>`).join('');
    const rows = [
      ['hp', 'Здоровье', fmt(s.maxHp)],
      [def.caster ? 'matk' : 'atk', def.caster ? 'Магическая атака' : 'Атака', fmt(def.caster ? s.matk : s.atk)],
      ['def', 'Защита / маг.', `${fmt(s.def)} / ${fmt(s.mdef)}`],
      ['accuracy', 'Точность / уклонение', `${s.acc} / ${s.eva}`],
      ['speed', 'Скорость', `${s.speed} (у вас ${S.compute(data, c).speed})`],
      ...(s.block ? [['block', 'Блок', `${s.block}%`]] : []),
    ].map(([ic, k, v]) => `<div class="kv"><span>${art(`stats/${ic}`, '', 'stat-ico')}${k}</span><b>${v}</b></div>`).join('');
    openModal(`${def.name} · ${m.level} ур.${D ? ` · <span style="color:${dd.color}">${dd.name}</span>` : ''}`, `
      <div class="row" style="align-items:flex-start;gap:12px;margin-bottom:10px">${avatar(def, 72)}<div><span class="tag kind">${KIND_NAME[def.kind] || ''}</span>${def.boss ? '<span class="tag boss">босс</span>' : ''}
        <p class="meta" style="margin:6px 0 0">${def.blurb}</p></div></div>
      ${rows}
      ${skills ? `<div class="kv"><span>Умения</span><b>${skills}</b></div>` : ''}
      ${res ? `<div class="kv"><span>Сопротивления</span><b>${res}</b></div>` : ''}
      <div class="props-label">Награда</div>
      <div class="kv"><span>Опыт</span><b>≈${fmt(exp)}</b></div>
      <div class="kv"><span>Золото</span><b>${g0}–${g1}</b></div>
      ${def.ai === 'idle' ? '' : `<div class="props-label">Возможная добыча</div>
      <p class="meta">${def.boss ? `Гарантированно ${DR.bossItems} вещи не ниже «${data.rarities[2].name}»` : `Вещь — шанс ${DR.item}%`}, тир T${tier}, уровень предмета ${m.level + dd.ilvl}${D ? `, находка +${dd.mf}%` : ''}. 80% вещей — для вашего класса.</p>
      ${def.boss ? uniqueDrops(m.id, D, m.level + dd.ilvl) : ''}
      <div class="cost drops">${mats}${['essence', 'stone1', 'hp_potion_1'].map((id) => `<span class="info-link" data-info="${id}">${art(data.materials[id].art, '•')}${data.materials[id].name}</span>`).join('')}</div>`}
      ${m.deadUntil == null && def.ai !== 'idle' ? `<div class="row-actions"><button class="btn primary" data-act="attack" ${m.busy ? 'disabled' : ''}>Напасть</button></div>` : ''}`, (e) => {
      if (e.target.closest('[data-act="attack"]')) { closeModal(); startFight(uid); }
      const un = e.target.closest('[data-unique]');
      if (un) PC.itemUI.openUnique(un.dataset.unique, m.level + dd.ilvl, () => openMonsterInfo(uid));
    });
  }

  // Уники, которые может уронить босс (на текущей сложности и выше)
  function uniqueDrops(bossId, D, ilvl) {
    const list = Object.values(data.uniques).filter((u) => u.boss === bossId);
    if (!list.length) return '';
    return `<div class="props-label">Уникальные вещи</div><p class="meta">Шанс ${data.UNIQUE_CHANCE}% на каждую, растёт с находкой. Тап — характеристики с разбросом.</p><div class="list uniq-list">${list.map((u) => {
      const open = (u.minDiff || 0) <= D;
      return `<button class="uniq-row ${open ? '' : 'locked'}" data-unique="${u.id}">${PC.itemUI.tile(PC.itemUI.uniqueSample(u.id, ilvl, 50))}
        <span class="txt"><b class="rc7">${u.name}</b><small class="meta">${open ? u.role : `🔒 падает с «${data.difficulties[u.minDiff].name}»`}</small></span></button>`;
    }).join('')}</div>`;
  }

  // Часы мира на экране локации: переходы, возрождение, передышка
  function worldTick() {
    const c = state.char;
    if (!c || $('#hub').hidden) return;
    const now = Date.now();
    if (c.transit) {
      const done = W.completeTravel(data, c, now);
      if (done) { app.save(); toast(`Вы пришли: ${data.locations[c.location].name}`); if (state.tab === 'world') render(); return; }
      const t = W.travelProgress(c, now);
      const fill = $('#travel-fill');
      if (fill) { fill.style.width = `${t.progress * 100}%`; $('#travel-left').textContent = `Осталось ${Math.ceil(t.left / 1000)} с`; }
      return;
    }
    if (state.tab !== 'world') return;
    // Полная перерисовка — только когда изменился состав монстров или кончилась передышка
    // (иначе можно «съесть» клик), а таймеры обновляем точечно
    const st = W.update(data, c, now, rng);
    const sig = [st.boss && st.boss.uid, ...st.mobs.map((m) => `${m.uid}${m.deadUntil}${m.busy}`), W.restLeft(c, now) > 0, c.settings.autoHunt].join('|');
    if (sig !== state.worldSig) { state.worldSig = sig; renderWorld($('#tab-world')); return; }
    const rest = W.restLeft(c, now);
    const note = $('#rest-note');
    if (note) note.textContent = rest ? `передышка ${Math.ceil(rest / 1000)} с` : `тик ${Math.ceil(W.msToNextTick(now) / 1000)} с`;
    for (const m of st.mobs) {
      if (m.deadUntil == null) continue;
      const el = $(`[data-mob="${m.uid}"] .mob-status`);
      if (el) el.textContent = `возродится через ${Math.ceil(Math.max(0, W.tickStart(m.deadUntil) - now) / 1000)} с`;
    }
  }
  state.worldTimer = setInterval(worldTick, 1000);

  // ---------- Бой ----------

  // join — строка чужого боя (из PC.battles.join): тогда вступаем в бой, который считает его хозяин.
  // Онлайн каждый бой общий (PC.lockstep): хозяин — это тот, кто напал на монстра, остальные видят тот же бой.
  function startFight(uid, join) {
    const c = state.char;
    clearTimeout(state.huntTimer);
    if (state.session && state.session.host && !state.session.ended && !state.session.stopped) { toast('Вы ведёте бой, в котором уже погибли — дождитесь его конца', 'bad'); return false; }
    let mob, D;
    if (join) {
      if (!join.resume && !W.canAttack(c, Date.now())) { toast(`Передышка: ${Math.ceil(W.restLeft(c, Date.now()) / 1000)} с`, 'bad'); PC.battles.end(); return false; }
      mob = { id: join.monster_id, level: join.monster_level };
      D = join.diff || 0;
    } else {
      const res = W.engage(data, c, uid, Date.now());
      if (!res.ok) { toast(res.reason, 'bad'); return false; }
      mob = res.mob;
      D = W.diffOf(c, c.location);
    }
    state.fight = { uid, monsterId: mob.id, level: mob.level, diff: D };
    const monster = M.monsterAt(mob.id, mob.level, D);
    app.save();
    $('#result').hidden = true;
    closeSheet();
    closeModal();

    const B = PC.battles;
    const common = {
      settings: c.settings,
      onSettings: () => app.save(),
      onEnd: (battle, { fled, share, aborted }) => {
        const sess = state.session;
        if (aborted) {   // бой оборвался (хозяин ушёл, мест нет): без потерь и наград
          if (join) c.restTick = W.tickOf(Date.now()) + 1; else W.disengage(data, c, uid, false, Date.now());
          if (B) B.end();
          state.session = null; closeChannel();
          app.save();
          toast(aborted === 'full' ? 'В бою уже нет мест' : aborted === 'nohost' ? 'Бой уже закончился' : 'Хозяин боя ушёл — бой прерван', 'bad');
          show('hub'); render();
          return;
        }
        const won = battle.winner === battle.player;
        if (join) c.restTick = W.tickOf(Date.now()) + 1; else W.disengage(data, c, uid, won, Date.now());
        if (B) {
          B.record(c, { location: c.location, monsterId: mob.id, level: mob.level, diff: D, result: won ? 'win' : fled ? 'fled' : 'lose',
            turns: battle.turn, my: share && share.my, total: share && share.total, log: battle.log,
            members: battle.players.map((f) => String(f.name).replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')) });
          // погибший хозяин остаётся «движком» боя до его конца, потом сам закроет запись
          if (!(sess && sess.host && !sess.ended)) B.end();
        }
        // Награда за общий бой: нужен вклад не меньше 5% от всего урона по монстру
        if (share && share.total > 0 && share.my < share.total * 0.05) state.fight.noReward = true;
        const summary = P.applyBattleResult(data, c, battle, state.fight, rng, { fled });
        for (const it of summary.items) it.fresh = true;
        app.save();
        showResult(summary, battle);
      },
    };

    if (!B || !B.canCoop()) {   // офлайн (или без миграций): обычный одиночный бой
      show('battle');
      PC.battleUI.start({ ...common, player: P.toFighter(data, c), monster, resume: join && join.resume });
      return true;
    }
    runShared(c, mob, monster, D, join, common);
    return true;
  }

  // Общий бой: хозяин (напавший) считает и рассылает ходы, остальные получают их и видят то же самое
  function closeChannel() { if (state.channel) { state.channel.close(); state.channel = null; } }
  function runShared(c, mob, monster, D, join, common) {
    const B = PC.battles;
    const id = join ? join.id : (window.crypto && crypto.randomUUID ? crypto.randomUUID() : null);
    if (!id) { show('battle'); PC.battleUI.start({ ...common, player: P.toFighter(data, c), monster }); return; }
    const host = !join;
    if (host) B.start(c, mob, { hp: Math.max(1, Math.round(monster.stats.maxHp)), diff: D, id });
    closeChannel();
    let sess = null;
    const ch = state.channel = B.channel(id, (m) => { if (sess) sess.receive(m); });
    const tpl = JSON.parse(JSON.stringify(P.toFighter(data, c)));
    const uid = PC.auth.user.id;
    ch.ready.then(() => {
      if (state.channel !== ch) return;
      sess = state.session = PC.lockstep.create({
        host, uid, tpl, data, send: (m) => ch.send(m),
        monster: host ? JSON.parse(JSON.stringify(monster)) : undefined,
        seed: host ? Math.floor(Math.random() * 2147483647) : undefined,
      });
      let started = false;
      const launch = () => {
        if (started) return;
        started = true;
        show('battle');
        PC.battleUI.start({ ...common, session: sess });
      };
      sess.on('ready', launch);
      sess.on('abort', (reason) => { if (!started) { started = true; common.onEnd(null, { aborted: reason }); } });
      if (host) {
        // база знает состояние боя: список «Бои» и признак «бой жив»; по концу боя хозяин закрывает запись
        sess.on('update', () => B.state(id, sess.battle.monster.hp, sess.battle.monster.maxHp, sess.battle.ended));
        sess.on('end', () => { if (!sess.stopped) { closeChannelLater(ch); B.end(); } });
      } else {
        sess.on('end', () => closeChannelLater(ch));
      }
      if (!host) toast('Вступаем в бой…');
      sess.start();
    });
  }
  // сообщения о последнем ходе должны успеть уйти
  function closeChannelLater(ch) { setTimeout(() => { if (state.channel === ch) closeChannel(); else ch.close(); }, 2000); }

  // Возврат в бой после обновления страницы: row — строка боя из PC.battles.resume
  app.resumeFight = (row) => startFight(null, row);

  // Автоохота: после передышки — на живого монстра локации (боссов не трогает)
  function scheduleHunt() {
    clearTimeout(state.huntTimer);
    const c = state.char;
    if (!c.settings.autoHunt || c.transit || W.here(data, c).safe) return;
    const tick = () => {
      if (!c.settings.autoHunt) return;
      const now = Date.now();
      W.update(data, c, now, rng);
      const note = $('#hunt-note');
      const rest = W.restLeft(c, now);
      const mob = rest ? null : W.pickForAutoHunt(data, c, state.fight && state.fight.monsterId, rng);
      if (mob && startFight(mob.uid)) return;
      if (note) note.textContent = rest ? `Следующий бой через ${Math.ceil(rest / 1000)} с…` : 'Ждём возрождения монстров…';
      state.huntTimer = setTimeout(tick, 500);
    };
    tick();
  }

  function showResult(sum, battle) {
    const c = state.char;
    const banner = $('#result-banner');
    banner.textContent = sum.win ? 'Победа!' : sum.fled ? 'Бегство' : 'Поражение';
    banner.classList.toggle('loss', !sum.win);
    let html = '';
    if (sum.win) {
      const need = P.expToNext(c.level);
      if (state.fight.noReward) html += '<p class="meta">Вы почти не помогли в бою — награда не выдана.</p>';
      html += `<p>+${fmtNum(sum.exp)} опыта · +${fmtNum(sum.gold)} 💰 · ${battle.turn} ${plural(battle.turn, 'ход', 'хода', 'ходов')}</p>
        <div class="progress"><div style="width:${c.level >= P.MAX_LEVEL ? 100 : (c.exp / need) * 100}%"></div></div>
        <p class="meta">${c.level} уровень · ${fmtNum(c.exp)} / ${fmtNum(need)}</p>`;
      if (sum.levelsUp.length) html += `<p class="levelup">Новый уровень: ${c.level}! Очки ждут во вкладке «Герой».</p>`;
      for (const id of sum.newSkills) html += `<p class="levelup">Открыто умение «${data.skills[id].name}»</p>`;
      if (sum.unlocked) html += `<p class="levelup">Открыта сложность «${sum.unlocked}» для этой зоны!</p>`;
      if (sum.items.length) html += `<div class="loot-grid">${sum.items.map((it) => tile(it, { attrs: `data-loot="${it.uid}"`, can: I.canEquip(data, c, it).ok })).join('')}</div>`;
      const mats = Object.entries(sum.materials);
      if (mats.length) html += `<div class="cost" style="justify-content:center">${mats.map(([k, n]) => `<span class="info-link" data-info="${k}">${art(data.materials[k].art, '•')}+${n}</span>`).join('')}</div>`;
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
    const hunting = c.settings.autoHunt && !sum.sentHome && !sum.fled;
    if (!sum.win) c.settings.autoHunt = false;
    html += `<p class="meta" id="hunt-note">${hunting && sum.win ? 'Автоохота: ждём тик…' : ''}</p>`;
    $('#result-body').innerHTML = html;
    const fightAgain = sum.win && !data.monsters[state.fight.monsterId].boss && !W.here(data, c).safe;
    $('#again').hidden = !fightAgain || (hunting && sum.win);
    $('#again').textContent = 'Следующий бой';
    $('#to-camp').textContent = hunting && sum.win ? 'Остановить охоту' : 'К локации';
    $('#result').hidden = false;
    if (hunting && sum.win) scheduleHunt();
  }

  $('#result-body').addEventListener('click', (e) => {
    const t = e.target.closest('[data-loot]');
    if (!t) return;
    const found = I.findItem(state.char, t.dataset.loot);
    if (found) PC.itemUI.openItem(state.char, found.item, 'loot');
  });
  // «Следующий бой»: ещё один монстр того же вида (или любой), как только закончится передышка
  $('#again').addEventListener('click', () => {
    const c = state.char;
    const wait = () => {
      const now = Date.now();
      W.update(data, c, now, rng);
      const rest = W.restLeft(c, now);
      const mob = rest ? null : W.pickForAutoHunt(data, c, state.fight.monsterId, rng);
      if (mob) { startFight(mob.uid); return; }
      $('#hunt-note').textContent = rest ? `Передышка ${Math.ceil(rest / 1000)} с…` : 'Ждём возрождения монстров…';
      state.huntTimer = setTimeout(wait, 400);
    };
    wait();
  });
  $('#to-camp').addEventListener('click', () => {
    clearTimeout(state.huntTimer);
    const c = state.char;
    if (c.settings.autoHunt) { c.settings.autoHunt = false; app.save(); }
    $('#result').hidden = true;
    setTab(c.statPoints || c.skillPoints ? 'hero' : 'world');
  });

  // ---------- NPC: лавка и алхимик ----------

  function openNpc(id) {
    if (id === 'smith') return setTab('forge', 'enhance');
    if (id === 'enchanter') return setTab('forge', 'reroll');
    if (id === 'shop') return openShop();
    if (id === 'alchemist') return openAlchemist();
    if (id === 'buyer') return PC.bagUI.openBuyer();
    if (id === 'stash') return PC.bagUI.openStash();
  }

  function npcHead(id) {
    const n = data.npcs[id];
    return `<div class="row npc-head">${avatar(n, 56)}<p>«${n.greeting}»</p></div>`;
  }

  function openShop(msg) {
    const c = state.char;
    const rows = data.shopStock.map((id) => {
      const m = data.materials[id];
      return `<div class="trade-row"><span class="ava info-link" data-info="${id}" style="width:40px;height:40px">${art(m.art, '•')}</span>
        <div class="txt"><b>${m.name}</b><div class="meta">есть: ${c.materials[id] || 0}</div></div>
        <button class="btn small" data-buy="${id}" data-n="1" ${c.gold < m.price ? 'disabled' : ''}>${fmtNum(m.price)} 💰</button>
        <button class="btn small" data-buy="${id}" data-n="5" ${c.gold < m.price * 5 ? 'disabled' : ''}>×5</button></div>`;
    }).join('');
    openModal(data.npcs.shop.name, `${npcHead('shop')}${msg ? `<div class="flash good">${msg}</div>` : ''}<p class="meta">У вас ${fmtNum(c.gold)} 💰</p>${rows}`, (e) => {
      const b = e.target.closest('[data-buy]');
      if (!b || b.disabled) return;
      const res = E.buy(data, c, b.dataset.buy, Number(b.dataset.n));
      if (!res.ok) return toast(res.reason, 'bad');
      app.save(); render();
      openShop(`Куплено: ${data.materials[b.dataset.buy].name} ×${b.dataset.n}`);
    });
  }

  function openAlchemist(msg) {
    const c = state.char;
    const rows = data.recipes.map((r, i) => {
      const out = data.materials[r.out];
      const can = E.canBrew(data, c, r);
      const can5 = E.canBrew(data, c, r, 5);
      return `<div class="recipe ${can ? '' : 'off'}">
        <div class="row"><span class="ava info-link" data-info="${r.out}" style="width:44px;height:44px">${art(out.art, '🧪')}</span>
          <div class="txt"><b>${out.name}</b> ×${r.n}<div class="meta">есть: ${c.materials[r.out] || 0}</div></div>
          <button class="btn small" data-brew="${i}" data-n="1" ${can ? '' : 'disabled'}>Сварить</button>
          <button class="btn small" data-brew="${i}" data-n="5" ${can5 ? '' : 'disabled'}>×5</button></div>
        ${costHtml({ ...r.need, gold: r.gold })}</div>`;
    }).join('');
    openModal(data.npcs.alchemist.name, `${npcHead('alchemist')}${msg ? `<div class="flash good">${msg}</div>` : ''}
      <p class="meta">Материалы падают с монстров своих зон. Нажмите на материал, чтобы узнать, где его искать.</p>${rows}`, (e) => {
      const b = e.target.closest('[data-brew]');
      if (!b || b.disabled) return;
      const r = E.brew(data, c, Number(b.dataset.brew), Number(b.dataset.n));
      if (!r.ok) return toast(r.reason, 'bad');
      app.save(); render();
      openAlchemist(`Сварено: ${data.materials[r.out].name} ×${r.count}`);
    });
  }

  // ---------- Герой ----------

  // Сворачиваемый блок; состояние хранится на устройстве
  function block(id, title, note, body) {
    const open = !prefs.collapsed[id];
    return `<div class="card section collapsible ${open ? 'open' : ''}">
      <h3 data-toggle="${id}"><span>${open ? '▾' : '▸'} ${title}</span>${note || ''}</h3>${open ? body : ''}</div>`;
  }

  const PRIMARY_DESC = {
    str: 'Атака мечами и топорами, крит. урон',
    agi: 'Атака луками, точность, уклонение, скорость',
    int: 'Магическая атака, мана, маг. защита',
    vit: 'Здоровье, защита, блок со щитом',
    luk: 'Шанс крита, находка предметов',
  };

  // Справка по боевым качествам: что это, зачем, как считается (формулы те же, что в движке боя)
  function statHelp(id, s, c, bonus) {
    const L = c.level, G = S.growth(L), K = S.defK(L);
    const f = PC.fmtBig;
    const r1 = (v) => Math.round(v * 10) / 10;
    const b = (k) => bonus[k] || 0;
    const usesAgi = data.classes[c.job].primary === 'agi';
    const cut = (def) => Math.round(100 - 100 * K / (K + def));
    const hit = Math.round(Math.min(99, Math.max(30, 85 + (s.acc - s.eva) * 0.2)));
    const H = {
      hp: {
        what: 'Запас жизни. Упало до нуля — бой проигран.',
        why: 'Главная «подушка»: чем больше здоровья, тем больше ударов вы выдержите, пока бьёте сами. Растёт с уровнем и с живучестью.',
        f: ['Здоровье = ((40 + 8 × уровень + 12 × живучесть) × рост + здоровье вещей) × (1 + % здоровья)', 'рост = 1.12^(уровень − 1), считается не выше 40-го уровня'],
        now: `((40 + 8×${L} + 12×${s.vit}) × ${r1(G)} + ${f(b('hp'))}) × (1 + ${r1(b('hpPct') * 100)}%) = ${f(s.maxHp)}`,
      },
      resource: {
        what: s.caster ? 'Мана тратится на заклинания и восстанавливается каждый ход.' : s.resource === 'rage' ? 'Ярость копится от ударов и полученного урона; на неё тратятся сильные умения.' : 'Энергия тратится на умения и понемногу восстанавливается.',
        why: 'Определяет, сколько умений вы успеете применить. Умения — главный источник урона, поэтому ресурс ограничивает темп боя.',
        f: s.caster ? ['Мана = (20 + 4 × интеллект + мана вещей) × (1 + % маны)'] : ['Максимум задан классом и от характеристик не зависит. Накопление зависит от «ресурс за ход», «ярость за удар» и пассивок.'],
        now: s.caster ? `(20 + 4×${s.int} + ${b('mp')}) × (1 + ${r1(b('mpPct') * 100)}%) = ${s.resMax}` : `максимум ${s.resMax}`,
      },
      mpRegen: {
        what: 'Сколько маны возвращается в начале каждого хода.',
        why: 'Чем больше — тем чаще можно кастовать дорогие заклинания и не стоять с пустым запасом.',
        f: ['Мана за ход = 2 + 0.2 × интеллект + мана за ход с вещей'],
        now: `2 + 0.2×${s.int} + ${b('mpRegen')} = ${r1(s.mpRegen)}`,
      },
      atk: {
        what: 'Сила физических ударов. К ней прибавляется случайный урон оружия.',
        why: `Основа физического урона. Растёт от ${usesAgi ? 'ловкости' : 'силы'}, вещей и % атаки. Урон оружия — от минимума до максимума, поэтому удары разные.`,
        f: [`Атака = (атака вещей + ${usesAgi ? 'ловкость' : 'сила'} × 2 × рост) × (1 + % атаки)`, 'Удар = (урон оружия от мин до макс + атака) × множители урона', 'Через защиту цели: урон × K / (K + защита), K = 100 × рост уровня атакующего'],
        now: `(${f(b('atk'))} + ${usesAgi ? s.agi : s.str}×2×${r1(G)}) × (1 + ${r1(b('atkPct') * 100)}%) = ${f(s.atk)}; оружие ${f(s.weaponMin)}–${f(s.weaponMax)}`,
      },
      matk: {
        what: 'Сила заклинаний и магических ударов мага.',
        why: 'Маг бьёт магией: его удары не промахиваются и не блокируются, а урон режет магическая защита цели.',
        f: ['Маг. атака = (маг. атака вещей + интеллект × 2.5 × рост) × (1 + % маг. атаки)', 'Урон = маг. атака × множители × K / (K + маг. защита цели)'],
        now: `(${f(b('matk'))} + ${s.int}×2.5×${r1(G)}) × (1 + ${r1(b('matkPct') * 100)}%) = ${f(s.matk)}`,
      },
      def: {
        what: 'Гасит получаемый урон: защита — физический, маг. защита — магический.',
        why: 'Каждая единица защиты уменьшает урон, но с убывающей отдачей: вдвое больше защиты не вдвое меньше урона. «% от равного» — на сколько защита режет удар монстра вашего уровня.',
        f: ['Защита = (защита вещей + живучесть × рост) × (1 + % защиты)', 'Маг. защита = (маг. защита вещей + ((интеллект + живучесть) × 0.5 + уровень) × рост) × (1 + %)', 'Получаемый урон = урон × K / (K + защита), K = 100 × рост уровня атакующего'],
        now: `защита (${f(b('def'))} + ${s.vit}×${r1(G)}) × (1 + ${r1(b('defPct') * 100)}%) = ${f(s.def)}, режет ${cut(s.def)}%; маг. защита ${f(s.mdef)}, режет ${cut(s.mdef)}%`,
      },
      crit: {
        what: 'Шанс, что удар окажется критическим, и во сколько раз он сильнее обычного.',
        why: 'Критические удары — рывок урона. Шанс даёт удача, множитель — сила и вещи. Шанс не выше 75%.',
        f: ['Шанс = 3% + 0.3 × удача + шанс с вещей (макс. 75%)', 'Крит. урон = 150% + 0.5 × сила + крит. урон с вещей', 'При крите итоговый урон умножается на крит. урон / 100'],
        now: `шанс 3 + 0.3×${s.luk} + ${b('crit')} = ${r1(s.crit)}%; урон 150 + 0.5×${s.str} + ${b('critDmg')} = ${Math.round(s.critDmg)}%`,
      },
      acc: {
        what: 'Точность помогает попадать, уклонение — не получать удары.',
        why: 'Шанс попасть зависит от разницы вашей точности и уклонения цели. Низкая точность на высокой сложности превращает бой в череду промахов.',
        f: ['Точность = (80 + 2 × уровень + 3 × ловкость + удача + вещи) × (1 + %)', 'Уклонение = (20 + уровень + 3 × ловкость + вещи) × (1 + %)', 'Шанс попасть = 85% + (точность − уклонение цели) × 0.2%, от 30% до 99%'],
        now: `точность ${s.acc}, уклонение ${s.eva}; по цели с таким же уклонением попадёте в ${hit}%`,
      },
      speed: {
        what: 'Определяет, как рано в тике вы действуете, и шанс дополнительного действия.',
        why: 'Ход длится один тик. Монстр действует в момент, зависящий от соотношения скоростей: он быстрее — действует раньше. Если вы заметно быстрее, иногда получаете ещё одно действие.',
        f: ['Скорость = (100 + 0.5 × ловкость + вещи) × (1 + %)', 'Момент действия монстра = 0.35 × его скорость / ваша скорость (доля тика, от 12% до 85%)', 'Шанс доп. действия = (ваша − его) / его × 50%, не выше 35%'],
        now: `(100 + 0.5×${s.agi} + ${b('speed')}) × (1 + ${r1(b('speedPct') * 100)}%) = ${s.speed}`,
      },
      block: {
        what: 'Шанс принять удар на щит. Работает только со щитом.',
        why: 'Заблокированный удар наносит вполовину меньше урона. Хорош для танков против сильных одиночных ударов. Не выше 75%.',
        f: ['Блок = блок вещей + 0.2 × живучесть (только при надетом щите)', 'Заблокированный удар: урон × 0.5'],
        now: `${b('block')} + 0.2×${s.vit} = ${Math.round(s.block)}%`,
      },
      lifesteal: {
        what: 'Доля нанесённого урона, возвращающаяся вам здоровьем.',
        why: 'Лечит прямо в бою и тем сильнее, чем больше вы бьёте. Не срабатывает на ударах, которые ничего не нанесли. Не выше 50%.',
        f: ['Лечение = нанесённый урон × вампиризм / 100'],
        now: `вампиризм ${Math.round(s.lifesteal)}%`,
      },
      dmgReduce: {
        what: 'Снижение всего получаемого урона в процентах.',
        why: 'Работает после защиты и против физики, и против магии. Сильно влияет на эффективное здоровье: 40% снижения — это ×1.67 здоровья. Не выше 50%.',
        f: ['Получаемый урон × (1 − снижение / 100)'],
        now: `снижение ${Math.round(s.dmgReduce)}%`,
      },
      resist: {
        what: 'Сопротивления огню 🔥, холоду ❄ и яду ☠.',
        why: 'Уменьшают урон соответствующей стихии и урон от горения и яда. Нужны против монстров с огнём, холодом и ядом. Не выше 75%.',
        f: ['Урон стихии × (1 − сопротивление / 100)'],
        now: `огонь ${b('fireRes')}%, холод ${b('coldRes')}%, яд ${b('poisonRes')}%`,
      },
      find: {
        what: 'Влияют на добычу с монстров.',
        why: 'Находка повышает шанс выпадения вещей и их редкости, а у боссов — шанс уников. Золото и опыт умножают награду за победу. Высокая сложность добавляет находку сверху.',
        f: ['Находка = 0.5 × удача + находка с вещей (+ бонус сложности)', 'Шанс вещи = базовый × (1 + находка / 200)', 'Шанс уника = 4% × (1 + находка / 300)', 'Золото и опыт × (1 + бонус) × множитель сложности'],
        now: `находка 0.5×${s.luk} + ${b('mf')} = ${r1(s.mf)}%; золото +${Math.round((s.goldPct || 0) * 100)}%; опыт +${Math.round((s.expPct || 0) * 100)}%`,
      },
    };
    const h = H[id];
    if (!h) return null;
    return `<p><b>Что это.</b> ${h.what}</p><p><b>Зачем.</b> ${h.why}</p>
      <div class="props-label">Формула</div><ul class="formula">${h.f.map((x) => `<li>${x}</li>`).join('')}</ul>
      <div class="props-label">У вас сейчас</div><p class="calc">${h.now}</p>`;
  }

  function renderHero(root) {
    const c = state.char;
    const tmp = { ...c, stats: { ...c.stats } };
    for (const [k, v] of Object.entries(state.pending)) tmp.stats[k] += v;
    const s = S.compute(data, tmp);
    const bonus = S.gather(data, c);
    const pend = Object.values(state.pending).reduce((a, b) => a + b, 0);
    const free = c.statPoints - pend;
    const res = data.resources[s.resource];

    const combat = [
      ['hp', 'Здоровье', PC.fmtBig(s.maxHp), 'hp'],
      ['mp', res.name, s.resMax, 'resource'],
      ...(s.caster ? [['matk', 'Магическая атака', PC.fmtBig(s.matk), 'matk']] : [['atk', 'Атака', `${PC.fmtBig(s.atk)} + ${PC.fmtBig(s.weaponMin)}–${PC.fmtBig(s.weaponMax)}`, 'atk']]),
      ['def', 'Защита', `${PC.fmtBig(s.def)} (−${Math.round(100 - 100 * S.defK(c.level) / (S.defK(c.level) + s.def))}% от равного)`, 'def'],
      ['mdef', 'Маг. защита', `${PC.fmtBig(s.mdef)} (−${Math.round(100 - 100 * S.defK(c.level) / (S.defK(c.level) + s.mdef))}% от равного)`, 'def'],
      ['crit', 'Крит', `${Math.round(s.crit)}% · ×${Math.round(s.critDmg)}%`, 'crit'],
      ['accuracy', 'Точность / уклонение', `${s.acc} / ${s.eva}`, 'acc'],
      ['speed', 'Скорость', s.speed, 'speed'],
      ...(s.block ? [['block', 'Блок', `${Math.round(s.block)}%`, 'block']] : []),
      ...(s.lifesteal ? [['lifesteal', 'Вампиризм', `${Math.round(s.lifesteal)}%`, 'lifesteal']] : []),
      ...(s.dmgReduce ? [['def', 'Снижение урона', `${Math.round(s.dmgReduce)}%`, 'dmgReduce']] : []),
      ...(s.mpRegen ? [['mp', 'Мана за ход', Math.round(s.mpRegen), 'mpRegen']] : []),
      ['mdef', 'Сопротивления', `🔥${bonus.fireRes || 0}% ❄${bonus.coldRes || 0}% ☠${bonus.poisonRes || 0}%`, 'resist'],
      ['luk', 'Находка / золото / опыт', `${Math.round(s.mf)}% / +${Math.round((s.goldPct || 0) * 100)}% / +${Math.round((s.expPct || 0) * 100)}%`, 'find'],
    ].map(([ic, k, v, help]) => `<button class="kv help-row" data-help="${help}"><span>${art(`stats/${ic}`, '', 'stat-ico')}${k}</span><b>${v}<i class="chev">›</i></b></button>`).join('');

    const prim = S.PRIMARY.map((k) => {
      const d = data.statDefs[k];
      const extra = (bonus[k] || 0) + (bonus.allPrimary || 0);
      return `<div class="stat-row">${statIcon(k)}<div class="txt"><b>${d.name}</b><div class="meta">${PRIMARY_DESC[k]}</div></div>
        <div class="val">${c.stats[k] + (state.pending[k] || 0)}${extra ? `<span class="bonus">+${extra}</span>` : ''}${state.pending[k] ? `<span class="pend">(+${state.pending[k]})</span>` : ''}</div>
        <button class="plus" data-stat="${k}" ${free > 0 ? '' : 'disabled'} aria-label="Добавить: ${d.name}">+</button></div>`;
    }).join('');

    const vcount = {};
    for (const it of Object.values(c.equipment)) if (it && it.virtue) vcount[it.virtue] = (vcount[it.virtue] || 0) + 1;
    const virtues = Object.entries(vcount).map(([id, n]) => {
      const v = data.virtues[id];
      const parts = Object.entries(v.sets).map(([k, mods]) => `<span style="opacity:${n >= k ? 1 : 0.45}">${k}: ${Object.entries(mods).map(([sk, sv]) => `${data.statDefs[sk].name.toLowerCase()} +${data.statDefs[sk].fmt(sv)}`).join(', ')}</span>`).join('<br>');
      return `<div class="kv"><span class="virtue-chip" style="color:${v.color}"><i></i>${v.name} ×${n}</span><span class="meta" style="text-align:right">${parts}</span></div>`;
    }).join('');

    const slots = Array.from({ length: data.SKILL_SLOTS }, (_, i) => {
      const id = c.slots[i];
      if (!id) return `<div class="slot-skill"><span class="n">${i + 1}</span><span class="meta">пусто</span></div>`;
      const sk = data.skills[id];
      return `<div class="slot-skill filled"><span class="n">${i + 1}</span>${art(`stats/${sk.icon}`, '', 'stat-ico')}<span>${sk.name}</span>
        ${i ? `<button class="chip-btn" data-slot-left="${i}">◀</button>` : ''}</div>`;
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

    const pill = (n) => `<span class="points-pill">${n} ${plural(n, 'очко', 'очка', 'очков')}</span>`;
    root.innerHTML = [
      block('combat', 'Боевые качества', '', combat),
      block('stats', 'Характеристики', pill(free), `${prim}
        ${pend ? '<div class="row-actions"><button class="btn" data-act="stats-reset">Сбросить</button><button class="btn primary" data-act="stats-save">Сохранить</button></div>' : ''}
        <p class="hint">За каждый уровень дают ${P.STAT_POINTS_PER_LEVEL} очка характеристик и ${P.SKILL_POINTS_PER_LEVEL} очко умений. Каждое «+» тратит одно очко. Сохранённые очки вернуть нельзя.</p>`),
      virtues ? block('virtues', 'Знаки-добродетели', '', `<div class="virtue-sets">${virtues}</div>`) : '',
      block('slots', 'Ячейки умений', '<span class="note">порядок = приоритет автобоя</span>', `<div class="slots-bar">${slots}</div>`),
      block('skills', 'Умения', pill(c.skillPoints), skills),
      block('passives', 'Пассивки', pill(c.skillPoints), passives),
      '<div class="section"><button class="btn danger wide" data-act="reset">Удалить героя и начать заново</button></div>',
    ].join('');
  }

  $('#tab-hero').addEventListener('click', (e) => {
    const c = state.char;
    const hp = e.target.closest('[data-help]');
    if (hp) {
      const body = statHelp(hp.dataset.help, S.compute(data, c), c, S.gather(data, c));
      if (body) openModal(hp.querySelector('span').textContent, body);
      return;
    }
    const tog = e.target.closest('[data-toggle]');
    if (tog) { const id = tog.dataset.toggle; prefs.collapsed[id] = !prefs.collapsed[id]; savePrefs(); return render(); }
    const st = e.target.closest('[data-stat]');
    if (st && !st.disabled) { state.pending[st.dataset.stat] = (state.pending[st.dataset.stat] || 0) + 1; return render(); }
    const act = e.target.closest('[data-act]');
    if (act) {
      if (act.dataset.act === 'stats-reset') { state.pending = {}; return render(); }
      if (act.dataset.act === 'stats-save') { P.allocate(c, state.pending); state.pending = {}; app.save(); return render(); }
      if (act.dataset.act === 'reset') {
        if (!confirm(`Удалить ${c.nick} навсегда? Уровень, вещи и золото пропадут. Сундук сохранится.`)) return;
        charStore.clear();
        state.char = null;
        if (PC.cloud) PC.cloud.touch();
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
    const slotTog = e.target.closest('[data-slot-toggle]');
    if (slotTog) {
      const id = slotTog.dataset.slotToggle;
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

  function start() {
    if (state.char) {
      W.releaseAll(state.char);
      app.save();
      setTab('world');
      if (state.char.settings.autoHunt) scheduleHunt();
    } else {
      renderCreate();
      show('create');
    }
  }
  window.addEventListener('DOMContentLoaded', start);

  void openSheet;
})();
