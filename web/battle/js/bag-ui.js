// Вкладка «Сумка» (кукла + сетка с перетаскиванием), скупщик (сетка с отметками) и личный сундук на 300 ячеек.
// Перетаскивание — Pointer Events: мышью сразу, пальцем после удержания, чтобы свайп прокручивал страницу.
// В окнах скупщика и сундука перетаскивания нет: тап — отметить/переложить, долгое нажатие (или ПКМ) — окно вещи.
(function () {
  'use strict';
  const { data, items: I, economy: E } = PC;
  const { $, $$, art, openModal, closeModal, toast, plural, fmtNum, storage } = PC.kit;
  const { tile, emptyTile, nameHtml, openItem, isUpgrade } = PC.itemUI;
  const app = PC.app;

  const SORT_KIND = { weapon: 0, offhand: 1, head: 2, body: 3, hands: 4, feet: 5, belt: 6, amulet: 7, ring: 8 };
  const MATS = ['hp_potion_1', 'hp_potion_2', 'hp_potion_3', 'mp_potion_1', 'mp_potion_2', 'mp_potion_3', 'elixir_power', 'elixir_fortune',
    'stone1', 'stone2', 'stone3', 'protect', 'reroll', 'ore', 'leather', 'essence'];

  // ---------- Сундук: общий для всех героев аккаунта ----------
  const STASH_SIZE = 300;
  const STASH_PAGE = 60;
  const stashStore = storage('pc-stash', null);
  const stash = stashStore.load() || { items: new Array(STASH_SIZE).fill(null) };
  const saveStash = () => stashStore.save(stash);

  // ---------- Вкладка «Сумка» ----------

  function render(root) {
    const c = app.state.char;
    const total = Object.values(c.equipment).filter(Boolean).reduce((s, it) => s + I.power(data, it), 0);
    const doll = Object.keys(data.slots).map((slot) => {
      const it = c.equipment[slot];
      const w = c.equipment.weapon && data.types[c.equipment.weapon.type];
      const blocked = slot === 'offhand' && w && w.twoHanded;
      const inner = it
        ? tile(it, { attrs: `data-drag="slot:${slot}" data-drop="slot:${slot}"` })
        : emptyTile(slot, `data-drop="slot:${slot}"`);
      return `<div class="slot-cell" style="grid-area:${slot}">${inner}<small>${blocked ? 'двуручное' : data.slots[slot].name}</small></div>`;
    }).join('');

    const cells = c.bag.map((it, i) => (it
      ? tile(it, { attrs: `data-drag="bag:${i}" data-drop="bag:${i}"`, cls: `${it.fresh ? 'new' : ''} ${isUpgrade(c, it) ? 'up' : ''}`, can: I.canEquip(data, c, it).ok })
      : `<div class="tile empty" data-drop="bag:${i}"></div>`)).join('');

    const free = I.bagFree(c);
    const mats = MATS.filter((id) => c.materials[id] || ['hp_potion_1', 'stone1', 'essence'].includes(id))
      .map((id) => `<div class="mat info-link" data-info="${id}" title="${data.materials[id].name}">${art(data.materials[id].art, '•')}${fmtNum(c.materials[id] || 0)}</div>`).join('');
    const herbs = Object.entries(data.materials).filter(([id, m]) => m.kind === 'herb' && c.materials[id])
      .map(([id, m]) => `<div class="mat info-link" data-info="${id}" title="${m.name}">${art(m.art, '•')}${fmtNum(c.materials[id])}</div>`).join('');

    root.innerHTML = `
      <div class="card" style="margin:12px">
        <div class="doll">${doll}
          <div class="portrait">${art(`classes/${c.job}`, '')}<span class="power">Сила снаряжения ${fmtNum(total)}</span></div>
        </div>
      </div>
      <div class="bag-tools">
        <b>Сумка</b><span class="meta grow">${c.bag.length - free} / ${c.bag.length}</span>
        <button class="chip-btn" data-act="sort">Сортировать</button>
        <button class="chip-btn" data-act="mass">Разобрать…</button>
        <div class="trash" data-drop="trash">♻ Разобрать</div>
      </div>
      <div class="bag-grid">${cells}</div>
      <div class="card section"><h3>Расходники</h3><div class="materials">${mats}</div></div>
      ${herbs ? `<div class="card section"><h3>Материалы алхимии</h3><div class="materials">${herbs}</div></div>` : ''}
      <p class="hint" style="padding:0 16px 16px">Зелёная стрелка — вещь лучше надетой. Перетащите вещь на слот куклы, чтобы надеть, или в корзину, чтобы разобрать (на телефоне — удерживайте). Нажмите на вещь — откроется её окно.</p>`;
  }
  app.tabs.bag = render;

  // ---------- Перетаскивание (сумка и кукла) ----------

  const drag = { pending: false, active: false, from: null, ghost: null, startX: 0, startY: 0, timer: null, srcEl: null, hover: null };

  function parse(ref) {
    const [kind, v] = ref.split(':');
    return kind === 'bag' || kind === 'stash' ? { kind, index: Number(v) } : kind === 'slot' ? { kind, slot: v } : { kind };
  }

  function itemAt(ref) {
    const c = app.state.char;
    const r = parse(ref);
    if (r.kind === 'bag') return c.bag[r.index];
    if (r.kind === 'stash') return stash.items[r.index];
    if (r.kind === 'slot') return c.equipment[r.slot];
    return null;
  }

  function canDrop(fromRef, toRef) {
    const c = app.state.char;
    const from = parse(fromRef), to = parse(toRef);
    const item = itemAt(fromRef);
    if (!item || fromRef === toRef) return false;
    if (to.kind === 'trash') return from.kind === 'bag' && !item.locked;
    if (to.kind === 'bag') {
      if (from.kind === 'bag') return true;
      const target = c.bag[to.index];
      return !target || I.canEquip(data, c, target, from.slot).ok;
    }
    if (to.kind === 'slot') return I.canEquip(data, c, item, to.slot).ok;
    return false;
  }

  function startDrag(e) {
    const src = drag.srcEl;
    drag.active = true;
    src.classList.add('dragging');
    const g = document.createElement('div');
    g.className = `drag-ghost tile r${itemAt(drag.from).rarity}`;
    g.innerHTML = src.innerHTML;
    document.body.appendChild(g);
    drag.ghost = g;
    moveGhost(e);
    for (const el of $$('#tab-bag [data-drop]')) if (canDrop(drag.from, el.dataset.drop)) el.classList.add('drop-ok');
    if (navigator.vibrate && e.pointerType === 'touch') navigator.vibrate(15);
  }

  function moveGhost(e) {
    drag.ghost.style.left = `${e.clientX}px`;
    drag.ghost.style.top = `${e.clientY}px`;
    const under = document.elementFromPoint(e.clientX, e.clientY);
    const target = under && under.closest('[data-drop]');
    if (drag.hover && drag.hover !== target) drag.hover.classList.remove('drop-hover');
    drag.hover = target && target.classList.contains('drop-ok') ? target : null;
    if (drag.hover) drag.hover.classList.add('drop-hover');
  }

  function endDrag() {
    clearTimeout(drag.timer);
    if (drag.ghost) drag.ghost.remove();
    for (const el of $$('.drop-ok, .drop-hover, .dragging')) el.classList.remove('drop-ok', 'drop-hover', 'dragging');
    const res = { wasActive: drag.active, target: drag.hover };
    Object.assign(drag, { pending: false, active: false, ghost: null, hover: null, srcEl: null, timer: null });
    return res;
  }

  $('#tab-bag').addEventListener('pointerdown', (e) => {
    const src = e.target.closest('[data-drag]');
    if (!src || e.button > 0) return;
    drag.pending = true;
    drag.srcEl = src;
    drag.startX = e.clientX; drag.startY = e.clientY;
    drag.from = src.dataset.drag;
    if (e.pointerType === 'touch') drag.timer = setTimeout(() => { if (drag.pending) startDrag(e); }, 280);
  });

  document.addEventListener('pointermove', (e) => {
    if (!drag.pending) return;
    if (drag.active) { moveGhost(e); return; }
    const moved = Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY);
    if (e.pointerType === 'touch') { if (moved > 10) endDrag(); return; } // палец поехал — это прокрутка
    if (moved > 5) startDrag(e);
  });
  document.addEventListener('touchmove', (e) => { if (drag.active) e.preventDefault(); }, { passive: false });
  document.addEventListener('pointerup', () => {
    if (!drag.pending) return;
    const from = drag.from;
    const { wasActive, target } = endDrag();
    if (!wasActive) { openFromBag(from); return; }
    if (target) drop(from, target.dataset.drop);
  });
  document.addEventListener('pointercancel', () => { if (drag.pending) endDrag(); });

  function drop(fromRef, toRef) {
    const c = app.state.char;
    const from = parse(fromRef), to = parse(toRef);
    let res = { ok: true };
    if (to.kind === 'trash') return salvageAsk(c.bag[from.index]);
    if (from.kind === 'bag' && to.kind === 'bag') I.moveInBag(c, from.index, to.index);
    else if (from.kind === 'bag' && to.kind === 'slot') res = I.equip(data, c, from.index, to.slot);
    else if (from.kind === 'slot' && to.kind === 'bag') res = c.bag[to.index] ? I.equip(data, c, to.index, from.slot) : I.unequip(c, from.slot, to.index);
    else if (from.kind === 'slot' && to.kind === 'slot') [c.equipment[from.slot], c.equipment[to.slot]] = [c.equipment[to.slot], c.equipment[from.slot]];
    if (!res.ok) return toast(res.reason || 'Не получилось', 'bad');
    app.save();
    app.render();
  }

  // ---------- Окно вещи из сумки ----------

  function openFromBag(ref) {
    const c = app.state.char;
    const item = itemAt(ref);
    if (!item) return;
    if (item.fresh) { delete item.fresh; app.save(); app.render(); }
    const r = parse(ref);
    const where = r.kind === 'slot' ? 'equipped' : 'bag';
    const village = app.inVillage();
    const actions = () => (where === 'equipped'
      ? `<button class="btn" data-act="unequip">Снять</button>${village ? '<button class="btn" data-act="forge">В кузницу</button>' : ''}`
      : `<button class="btn danger" data-act="salvage" ${item.locked ? 'disabled' : ''}>Разобрать</button>${village ? '<button class="btn" data-act="forge">В кузницу</button>' : ''}
         <button class="btn primary" data-act="equip" ${I.canEquip(data, c, item).ok ? '' : 'disabled'}>Надеть</button>`);
    openItem(c, item, where, actions(), (act) => {
      let res = { ok: true };
      if (act === 'equip') res = I.equip(data, c, r.index);
      if (act === 'unequip') res = I.unequip(c, r.slot);
      if (act === 'forge') { closeModal(); app.setTab('forge', { uid: item.uid }); return; }
      if (act === 'salvage') { salvageAsk(item); return; }
      if (!res.ok) return toast(res.reason || 'Не получилось', 'bad');
      app.save();
      closeModal();
      app.render();
    });
  }

  function yieldText(item) {
    const y = I.salvageYield(data, item);
    const sure = Object.entries(y.sure).map(([k, n]) => `${data.materials[k].name} ×${n}`).join(', ');
    const maybe = y.chance.map(([k, p]) => `${data.materials[k].name} (${p}%)`).join(', ');
    return `${sure}${maybe ? `; возможно: ${maybe}` : ''}`;
  }

  function salvageAsk(item) {
    const c = app.state.char;
    if (item.locked) return toast('Вещь под замком', 'bad');
    const risky = item.rarity >= 3 || item.enhance || item.rank;
    openModal('Разобрать вещь?', `<p>${nameHtml(item)}</p><p class="meta">Получите: ${yieldText(item)}</p>
      ${risky ? '<p class="req">Это ценная вещь — точно разобрать?</p>' : ''}
      <div class="row-actions"><button class="btn" data-mclose>Отмена</button><button class="btn danger" data-act="yes">Разобрать</button></div>`, (e) => {
      if (!e.target.closest('[data-act="yes"]')) return;
      const res = I.salvage(data, c, item.uid, app.rng);
      closeModal();
      if (!res.ok) return toast(res.reason, 'bad');
      toast(`Получено: ${Object.entries(res.got).map(([k, n]) => `${data.materials[k].name} ×${n}`).join(', ')}`, 'good');
      app.save();
      app.render();
    });
  }

  function massSalvage() {
    const c = app.state.char;
    const pick = (i) => c.bag.filter((it) => it && it.rarity <= i && !it.enhance && !it.rank && !it.locked);
    const opts = data.rarities.slice(0, 5).map((r, i) => {
      const n = pick(i).length;
      return `<button class="btn" data-mass="${i}" ${n ? '' : 'disabled'}><span class="rc${i}">до «${r.name}»</span> — ${n} ${plural(n, 'вещь', 'вещи', 'вещей')}</button>`;
    }).join('');
    openModal('Разобрать оптом', `<p class="meta">Заточенные, со звёздами и запертые вещи не трогаются.</p><div class="list">${opts}</div>`, (e) => {
      const b = e.target.closest('[data-mass]');
      if (!b || b.disabled) return;
      const got = {};
      const list = pick(Number(b.dataset.mass));
      for (const it of list) {
        const r = I.salvage(data, c, it.uid, app.rng);
        for (const [k, v] of Object.entries(r.got || {})) got[k] = (got[k] || 0) + v;
      }
      closeModal();
      toast(`Разобрано ${list.length}: ${Object.entries(got).map(([k, v]) => `${data.materials[k].name} ×${v}`).join(', ')}`, 'good');
      app.save();
      app.render();
    });
  }

  $('#tab-bag').addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const c = app.state.char;
    if (b.dataset.act === 'sort') {
      const list = c.bag.filter(Boolean).sort((x, y) =>
        (SORT_KIND[data.types[x.type].kind] - SORT_KIND[data.types[y.type].kind]) || (y.rarity - x.rarity) || (I.power(data, y) - I.power(data, x)));
      c.bag = [...list, ...new Array(c.bag.length - list.length).fill(null)];
      app.save();
      app.render();
    }
    if (b.dataset.act === 'mass') massSalvage();
  });

  // ---------- Тап и долгое нажатие в окнах (скупщик, сундук) ----------
  // data-press="<ref>": тап → onTap(ref), удержание 450 мс или ПКМ → окно вещи
  let press = null;
  let pressTap = null;
  $('#modal').addEventListener('pointerdown', (e) => {
    const el = e.target.closest('[data-press]');
    if (!el) return;
    press = { ref: el.dataset.press, x: e.clientX, y: e.clientY, long: false };
    press.timer = setTimeout(() => { press.long = true; showPressed(press.ref); }, 450);
  });
  $('#modal').addEventListener('pointermove', (e) => {
    if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 10) { clearTimeout(press.timer); press = null; }
  });
  $('#modal').addEventListener('pointerup', () => {
    if (!press) return;
    clearTimeout(press.timer);
    const p = press;
    press = null;
    if (!p.long && pressTap) pressTap(p.ref);
  });
  $('#modal').addEventListener('contextmenu', (e) => {
    const el = e.target.closest('[data-press]');
    if (!el) return;
    e.preventDefault();
    if (press) { clearTimeout(press.timer); press = null; }
    showPressed(el.dataset.press);
  });

  // Просмотр вещи поверх окна: после закрытия возвращаемся в то же окно
  let reopen = null;
  function showPressed(ref) {
    const item = itemAt(ref);
    if (!item) return;
    const back = reopen;
    openItem(app.state.char, item, 'bag', '<button class="btn wide" data-act="back">Назад</button>', (act) => { if (act === 'back' && back) back(); });
  }

  // ---------- Скупщик ----------

  const sell = { marked: new Set() };

  function openBuyer(msg) {
    const c = app.state.char;
    for (const uid of [...sell.marked]) { const f = I.findItem(c, uid); if (!f || f.slot || f.item.locked) sell.marked.delete(uid); }
    const cells = c.bag.map((it, i) => (it
      ? tile(it, { attrs: `data-press="bag:${i}"`, checked: sell.marked.has(it.uid), cls: it.locked ? 'locked' : '' })
      : '<div class="tile empty"></div>')).join('');
    const total = [...sell.marked].reduce((s, uid) => s + I.sellPrice(data, I.findItem(c, uid).item), 0);
    const filters = `<select data-mark>
        <option value="">Отметить…</option>
        ${data.rarities.slice(0, 4).map((r, i) => `<option value="r${i}">всё до «${r.name}» включительно</option>`).join('')}
        <option value="other">не для моего класса</option>
        <option value="worse">хуже надетого</option>
        <option value="none">снять все отметки</option></select>`;
    reopen = () => openBuyer();
    pressTap = (ref) => {
      const it = itemAt(ref);
      if (!it) return;
      if (it.locked) return toast('Вещь под замком', 'bad');
      if (sell.marked.has(it.uid)) sell.marked.delete(it.uid); else sell.marked.add(it.uid);
      openBuyer();
    };
    openModal(data.npcs.buyer.name, `<div class="row npc-head">${PC.kit.avatar(data.npcs.buyer, 48)}<p>«${data.npcs.buyer.greeting}»</p></div>
      ${msg ? `<div class="flash good">${msg}</div>` : ''}
      <div class="bag-tools" style="padding:0">${filters}<span class="meta grow">Тап — отметить, удержание — осмотреть</span></div>
      <div class="bag-grid modal-grid">${cells}</div>
      <div class="row-actions"><button class="btn primary" data-act="sell" ${sell.marked.size ? '' : 'disabled'}>Продать отмеченные: ${sell.marked.size} шт · ${fmtNum(total)} 💰</button></div>`, (e) => {
      if (e.type === 'change' && e.target.matches('[data-mark]')) {
        const v = e.target.value;
        const list = c.bag.filter((it) => it && !it.locked);
        if (v === 'none') sell.marked.clear();
        else if (v.startsWith('r')) list.filter((it) => it.rarity <= Number(v.slice(1)) && !it.enhance && !it.rank).forEach((it) => sell.marked.add(it.uid));
        else if (v === 'other') list.filter((it) => { const t = data.types[it.type]; return (t.cls && !t.cls.includes(c.job)) || (t.armor && t.armor !== data.classes[c.job].armor); }).forEach((it) => sell.marked.add(it.uid));
        else if (v === 'worse') list.filter((it) => I.canEquip(data, c, it).ok && !isUpgrade(c, it)).forEach((it) => sell.marked.add(it.uid));
        return openBuyer();
      }
      if (e.target.closest('[data-act="sell"]')) {
        const r = E.sellMany(data, c, [...sell.marked]);
        sell.marked.clear();
        app.save(); app.render();
        openBuyer(`Продано ${r.count} шт за ${fmtNum(r.total)} 💰`);
      }
    }, { onClose: () => { pressTap = null; reopen = null; } });
  }

  // ---------- Сундук ----------

  let stashPage = 0;
  function openStash(msg) {
    const c = app.state.char;
    const used = stash.items.filter(Boolean).length;
    const pages = Math.ceil(STASH_SIZE / STASH_PAGE);
    const from = stashPage * STASH_PAGE;
    const sCells = stash.items.slice(from, from + STASH_PAGE).map((it, i) => (it
      ? tile(it, { attrs: `data-press="stash:${from + i}"` }) : '<div class="tile empty"></div>')).join('');
    const bCells = c.bag.map((it, i) => (it ? tile(it, { attrs: `data-press="bag:${i}"` }) : '<div class="tile empty"></div>')).join('');
    const tabs = Array.from({ length: pages }, (_, p) => `<button class="${p === stashPage ? 'on' : ''}" data-page="${p}">${p + 1}</button>`).join('');
    reopen = () => openStash();
    pressTap = (ref) => {
      const r = parse(ref);
      if (r.kind === 'stash') {
        const it = stash.items[r.index];
        if (!it) return;
        if (I.bagAdd(c, it) < 0) return toast('Сумка полна', 'bad');
        stash.items[r.index] = null;
      } else {
        const it = c.bag[r.index];
        if (!it) return;
        const pageFree = stash.items.findIndex((x, i) => !x && i >= from && i < from + STASH_PAGE);
        const j = pageFree >= 0 ? pageFree : stash.items.indexOf(null);
        if (j < 0) return toast('Сундук полон', 'bad');
        stash.items[j] = it;
        c.bag[r.index] = null;
      }
      saveStash(); app.save(); app.render();
      openStash();
    };
    openModal(data.npcs.stash.name, `${msg ? `<div class="flash good">${msg}</div>` : ''}
      <div class="bag-tools" style="padding:0"><b>Сундук</b><span class="meta grow">${used} / ${STASH_SIZE} · общий для всех героев</span>
        <button class="chip-btn" data-act="sort-stash">Сортировать</button></div>
      <div class="forge-tabs" style="padding:6px 0">${tabs}</div>
      <div class="bag-grid modal-grid">${sCells}</div>
      <div class="bag-tools" style="padding:8px 0 0"><b>Сумка</b><span class="meta grow">${c.bag.filter(Boolean).length} / ${c.bag.length}</span></div>
      <div class="bag-grid modal-grid">${bCells}</div>
      <p class="hint">Тап — переложить между сундуком и сумкой, удержание — осмотреть.</p>`, (e) => {
      const pg = e.target.closest('[data-page]');
      if (pg) { stashPage = Number(pg.dataset.page); return openStash(); }
      if (e.target.closest('[data-act="sort-stash"]')) {
        const list = stash.items.filter(Boolean).sort((x, y) =>
          (SORT_KIND[data.types[x.type].kind] - SORT_KIND[data.types[y.type].kind]) || (y.rarity - x.rarity) || (I.power(data, y) - I.power(data, x)));
        stash.items = [...list, ...new Array(STASH_SIZE - list.length).fill(null)];
        saveStash();
        openStash();
      }
    }, { onClose: () => { pressTap = null; reopen = null; } });
  }

  PC.bagUI = { openBuyer, openStash, stash };
})();
