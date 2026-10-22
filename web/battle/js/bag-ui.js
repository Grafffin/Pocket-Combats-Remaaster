// Вкладка «Сумка»: кукла персонажа с 10 слотами и сетка сумки с перетаскиванием (Pointer Events).
// Мышью — сразу, пальцем — после долгого нажатия, чтобы обычный свайп прокручивал страницу.
// Перетаскивания: сумка ↔ слот (надеть/снять/поменять), сумка ↔ сумка (переложить), в корзину — разобрать.
(function () {
  'use strict';
  const { data, items: I } = PC;
  const { $, $$, art, openSheet, closeSheet, toast, plural, fmtNum } = PC.kit;
  const { tile, emptyTile, cardHtml, nameHtml } = PC.itemUI;
  const app = PC.app;

  const SORT_KIND = { weapon: 0, offhand: 1, head: 2, body: 3, hands: 4, feet: 5, belt: 6, amulet: 7, ring: 8 };
  const MATS = ['hp_potion', 'mp_potion', 'stone1', 'stone2', 'stone3', 'protect', 'reroll', 'ore', 'leather', 'essence'];

  function render(root) {
    const c = app.state.char;
    const total = Object.values(c.equipment).filter(Boolean).reduce((s, it) => s + I.power(data, it), 0);
    const doll = Object.keys(data.slots).map((slot) => {
      const it = c.equipment[slot];
      const w = c.equipment.weapon && data.types[c.equipment.weapon.type];
      const blocked = slot === 'offhand' && w && w.twoHanded;
      const inner = it
        ? tile(it, { attrs: `data-drag="slot:${slot}" data-drop="slot:${slot}"` })
        : emptyTile(slot, `data-drop="slot:${slot}" ${blocked ? 'title="Занято двуручным оружием"' : ''}`);
      return `<div class="slot-cell" style="grid-area:${slot}">${inner}<small>${blocked ? 'двуручное' : data.slots[slot].name}</small></div>`;
    }).join('');

    const cells = c.bag.map((it, i) => (it
      ? tile(it, { attrs: `data-drag="bag:${i}" data-drop="bag:${i}"`, cls: it.fresh ? 'new' : '', can: I.canEquip(data, c, it).ok })
      : `<div class="tile empty" data-drop="bag:${i}"></div>`)).join('');

    const free = I.bagFree(c);
    const mats = MATS.map((id) => `<div class="mat" title="${data.materials[id].name}">${art(data.materials[id].art, '•')}${fmtNum(c.materials[id] || 0)}</div>`).join('');

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
      <div class="card section"><h3>Материалы и расходники</h3><div class="materials">${mats}</div></div>
      <p class="hint" style="padding:0 16px 16px">Перетащите вещь на слот куклы, чтобы надеть, или в корзину, чтобы разобрать. На телефоне — удерживайте вещь. Нажмите на вещь, чтобы увидеть свойства.</p>`;
  }
  app.tabs.bag = render;

  // ---------- Перетаскивание ----------

  const drag = { pending: null, active: false, from: null, ghost: null, startX: 0, startY: 0, timer: null, srcEl: null, hover: null };

  function parse(ref) {
    const [kind, v] = ref.split(':');
    return kind === 'bag' ? { kind, index: Number(v) } : kind === 'slot' ? { kind, slot: v } : { kind };
  }

  function itemAt(ref) {
    const c = app.state.char;
    const r = parse(ref);
    return r.kind === 'bag' ? c.bag[r.index] : r.kind === 'slot' ? c.equipment[r.slot] : null;
  }

  function canDrop(fromRef, toRef) {
    const c = app.state.char;
    const from = parse(fromRef), to = parse(toRef);
    const item = itemAt(fromRef);
    if (!item || fromRef === toRef) return false;
    if (to.kind === 'trash') return from.kind === 'bag';
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
    drag.from = src.dataset.drag;
    src.classList.add('dragging');
    const g = document.createElement('div');
    g.className = `drag-ghost tile r${itemAt(drag.from).rarity}`;
    g.innerHTML = src.innerHTML;
    document.body.appendChild(g);
    drag.ghost = g;
    moveGhost(e);
    for (const el of $$('[data-drop]', $('#tab-bag'))) if (canDrop(drag.from, el.dataset.drop)) el.classList.add('drop-ok');
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
    const wasActive = drag.active;
    const target = drag.hover;
    Object.assign(drag, { pending: null, active: false, ghost: null, hover: null, srcEl: null, timer: null });
    return { wasActive, target };
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

  // Пока тащим пальцем, страница не должна прокручиваться
  document.addEventListener('touchmove', (e) => { if (drag.active) e.preventDefault(); }, { passive: false });

  document.addEventListener('pointerup', (e) => {
    if (!drag.pending) return;
    const from = drag.from;
    const { wasActive, target } = endDrag();
    if (!wasActive) { openItem(from); return; }
    if (target) drop(from, target.dataset.drop);
    void e;
  });
  document.addEventListener('pointercancel', () => { if (drag.pending) endDrag(); });

  function drop(fromRef, toRef) {
    const c = app.state.char;
    const from = parse(fromRef), to = parse(toRef);
    let res = { ok: true };
    if (to.kind === 'trash') return salvageAsk(c.bag[from.index]);
    if (from.kind === 'bag' && to.kind === 'bag') I.moveInBag(c, from.index, to.index);
    else if (from.kind === 'bag' && to.kind === 'slot') res = I.equip(data, c, from.index, to.slot);
    else if (from.kind === 'slot' && to.kind === 'bag') {
      res = c.bag[to.index] ? I.equip(data, c, to.index, from.slot) : I.unequip(c, from.slot, to.index);
    } else if (from.kind === 'slot' && to.kind === 'slot') {
      [c.equipment[from.slot], c.equipment[to.slot]] = [c.equipment[to.slot], c.equipment[from.slot]];
    }
    if (!res.ok) return toast(res.reason || 'Не получилось', 'bad');
    app.save();
    app.render();
  }

  // ---------- Карточка и действия ----------

  function openItem(ref) {
    const c = app.state.char;
    const item = itemAt(ref);
    if (!item) return;
    if (item.fresh) { delete item.fresh; app.save(); }
    const r = parse(ref);
    const where = r.kind === 'slot' ? 'equipped' : 'bag';
    const check = I.canEquip(data, c, item);
    const actions = where === 'equipped'
      ? '<button class="btn" data-act="unequip">Снять</button><button class="btn" data-act="forge">Кузница</button>'
      : `<button class="btn danger" data-act="salvage">Разобрать</button><button class="btn" data-act="forge">Кузница</button>
         <button class="btn primary" data-act="equip" ${check.ok ? '' : 'disabled'}>Надеть</button>`;
    openSheet(where === 'equipped' ? 'Надето' : 'Сумка', `${cardHtml(c, item, where)}<div class="row-actions">${actions}</div>`, (e) => {
      const b = e.target.closest('[data-act]');
      if (!b || b.disabled) return;
      let res = { ok: true };
      if (b.dataset.act === 'equip') res = I.equip(data, c, r.index);
      if (b.dataset.act === 'unequip') res = I.unequip(c, r.slot);
      if (b.dataset.act === 'forge') { closeSheet(); app.setTab('forge', { uid: item.uid }); return; }
      if (b.dataset.act === 'salvage') { closeSheet(); salvageAsk(item); return; }
      if (!res.ok) return toast(res.reason || 'Не получилось', 'bad');
      app.save();
      closeSheet();
      app.render();
    });
    if (where === 'bag') app.render();
  }

  function yieldText(item) {
    const y = I.salvageYield(data, item);
    const sure = Object.entries(y.sure).map(([k, n]) => `${data.materials[k].name} ×${n}`).join(', ');
    const maybe = y.chance.map(([k, p]) => `${data.materials[k].name} (${p}%)`).join(', ');
    return `${sure}${maybe ? `; возможно: ${maybe}` : ''}`;
  }

  function salvageAsk(item) {
    const c = app.state.char;
    const risky = item.rarity >= 3 || item.enhance || item.rank;
    openSheet('Разобрать вещь?', `<p>${nameHtml(item)}</p><p class="meta">Получите: ${yieldText(item)}</p>
      ${risky ? '<p class="req">Это ценная вещь — точно разобрать?</p>' : ''}
      <div class="row-actions"><button class="btn" data-close>Отмена</button><button class="btn danger" data-act="yes">Разобрать</button></div>`, (e) => {
      if (!e.target.closest('[data-act="yes"]')) return;
      const res = I.salvage(data, c, item.uid, app.rng);
      closeSheet();
      if (!res.ok) return toast(res.reason, 'bad');
      toast(`Получено: ${Object.entries(res.got).map(([k, n]) => `${data.materials[k].name} ×${n}`).join(', ')}`, 'good');
      app.save();
      app.render();
    });
  }

  function massSalvage() {
    const c = app.state.char;
    const opts = data.rarities.slice(0, 5).map((r, i) => {
      const list = c.bag.filter((it) => it && it.rarity <= i && !it.enhance && !it.rank);
      return `<button class="btn" data-mass="${i}" ${list.length ? '' : 'disabled'}><span class="rc${i}">до «${r.name}»</span> — ${list.length} ${plural(list.length, 'вещь', 'вещи', 'вещей')}</button>`;
    }).join('');
    openSheet('Разобрать оптом', `<p class="meta">Заточенные и вещи со звёздами не трогаются.</p><div class="list">${opts}</div>`, (e) => {
      const b = e.target.closest('[data-mass]');
      if (!b || b.disabled) return;
      const max = Number(b.dataset.mass);
      const got = {};
      let n = 0;
      for (const it of [...c.bag]) {
        if (!it || it.rarity > max || it.enhance || it.rank) continue;
        const r = I.salvage(data, c, it.uid, app.rng);
        for (const [k, v] of Object.entries(r.got)) got[k] = (got[k] || 0) + v;
        n++;
      }
      closeSheet();
      toast(`Разобрано ${n}: ${Object.entries(got).map(([k, v]) => `${data.materials[k].name} ×${v}`).join(', ')}`, 'good');
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
})();
