// Отрисовка предметов: плитка в рамке редкости, окно предмета по центру (с лупой и замком),
// справки по ресурсам, материалы.
(function () {
  'use strict';
  const { data, items: I, stats: S } = PC;
  const { $, art, statIcon, fmtNum, openModal, closeModal, openSheet, prefs, savePrefs, toast } = PC.kit;

  const KIND_EMOJI = { weapon: '⚔️', offhand: '🛡️', head: '⛑️', body: '🦺', hands: '🧤', feet: '👢', belt: '🎗️', amulet: '📿', ring: '💍' };

  function tile(item, { attrs = '', cls = '', can = true, checked = false } = {}) {
    const type = data.types[item.type];
    const virtue = item.virtue ? `<i class="virtue" style="color:${data.virtues[item.virtue].color}"></i>` : '';
    return `<div class="tile r${item.rarity} ${can ? '' : 'cant'} ${checked ? 'checked' : ''} ${cls}" ${attrs} title="${I.name(data, item)}">
      ${art(type.art, KIND_EMOJI[type.kind])}
      ${item.enhance ? `<span class="enh">+${item.enhance}</span>` : ''}
      <span class="tier">T${item.tier}</span>
      ${item.rank ? `<span class="stars">${'★'.repeat(item.rank)}</span>` : ''}
      ${item.locked ? '<span class="lock-badge">🔒</span>' : ''}
      ${checked ? '<span class="check-badge">✓</span>' : ''}
      ${virtue}
    </div>`;
  }

  function emptyTile(slot, attrs = '') {
    return `<div class="tile empty" ${attrs}>${art(data.slots[slot].art, '')}</div>`;
  }

  const nameHtml = (item) => `<span class="rc${item.rarity}">${item.enhance ? `+${item.enhance} ` : ''}${I.name(data, item)}</span>`;

  // Кликабельные «ресурсы» вещи — каждый открывает справку
  function subline(item) {
    const r = data.rarities[item.rarity];
    const q = item.quality;
    return `<span class="info-link rc${item.rarity}" data-info="rarity">${r.name}</span> ·
      <span class="info-link" data-info="tier">T${item.tier}</span> ·
      <span class="info-link" data-info="ilvl">ур. ${item.ilvl}</span><br>
      <span class="info-link" data-info="quality">Качество ${I.qualityName(data, q).toLowerCase()} ${q}%</span>
      · <span class="info-link" data-info="enhance">+${item.enhance}</span>
      · <span class="info-link" data-info="rank" style="color:var(--accent-2)">${item.rank ? '★'.repeat(item.rank) : '★0'}</span>`;
  }

  function propsHtml(item) {
    const lens = prefs.lens;
    const base = I.baseLines(data, item).map((l) => `<li class="base">${statIcon(l.key)}<span class="txt">${l.text}</span></li>`).join('');
    const aff = item.affixes.map((af) => {
      const a = data.affixes[af.id];
      const [lo, hi] = a.t[af.tier - 1];
      const pct = hi > lo ? Math.round(af.roll * 100) : 100;
      const unit = a.pct || (data.statDefs[a.stat] && data.statDefs[a.stat].fmt(1).endsWith('%')) ? '%' : '';
      const k = a.stat && PC.stats.SCALED.has(a.stat) ? PC.stats.SCALE : 1;
      const f = (v) => (unit ? v : PC.fmtBig(v * k));
      const range = lens ? ` <span class="range">[${af.neg ? `−${f(Math.round(hi * data.NEGATIVE.scale))}–${f(Math.max(1, Math.round(lo * data.NEGATIVE.scale)))}` : `${f(lo)}–${f(hi)}`}${unit}]</span>` : '';
      return `<li class="${af.neg ? 'neg' : 'affix'}"><span class="t t${af.tier}" data-info="affixTier">T${af.tier}</span><span class="txt">${I.affixText(data, af)}${range}</span>
        <span class="roll" title="${pct}% от максимума тира"><div style="width:${pct}%"></div></span></li>`;
    }).join('');
    return `<ul class="props">${base}</ul>${aff ? `<div class="props-label">Свойства</div><ul class="props">${aff}</ul>` : ''}`;
  }

  function legendHtml(item) {
    return item.legendary.map((id) => {
      const l = data.legendaries[id];
      return `<div class="legend"><b>✦ ${l.name}</b><span>${l.desc}</span></div>`;
    }).join('');
  }

  // Сравнение: как изменятся итоговые характеристики, если надеть эту вещь вместо надетой
  const DIFF_KEYS = [['maxHp', 'Здоровье'], ['atk', 'Атака'], ['matk', 'Маг. атака'], ['def', 'Защита'], ['mdef', 'Маг. защита'],
    ['crit', 'Крит'], ['critDmg', 'Крит. урон'], ['acc', 'Точность'], ['eva', 'Уклонение'], ['speed', 'Скорость'],
    ['block', 'Блок'], ['lifesteal', 'Вампиризм'], ['weaponMax', 'Урон оружия'], ['resMax', 'Ресурс']];

  function diffHtml(char, item) {
    const slots = I.slotsFor(data, item);
    const slot = slots.find((s) => !char.equipment[s]) || slots[0];
    const before = S.compute(data, char);
    const clone = { ...char, equipment: { ...char.equipment, [slot]: item } };
    if (data.types[item.type].twoHanded) delete clone.equipment.offhand;
    const after = S.compute(data, clone);
    const parts = DIFF_KEYS.map(([k, label]) => {
      const d = Math.round((after[k] || 0) - (before[k] || 0));
      if (!d) return '';
      return `<span class="${d > 0 ? 'up' : 'down'}">${label} ${d > 0 ? '+' : '−'}${PC.fmtBig(Math.abs(d))}</span>`;
    }).filter(Boolean);
    const cur = char.equipment[slot];
    return `<div class="compare"><h4>${cur ? `Вместо: ${nameHtml(cur)}` : 'Слот пуст'}</h4>
      <div class="diff">${parts.join('') || '<span class="muted">Без изменений</span>'}</div></div>`;
  }

  // Сильнее надетого? Для пометок в сумке
  function isUpgrade(char, item) {
    if (!I.canEquip(data, char, item).ok) return false;
    const slots = I.slotsFor(data, item);
    const cur = slots.map((s) => char.equipment[s]);
    if (cur.some((x) => !x)) return true;
    return I.power(data, item) > Math.min(...cur.map((x) => I.power(data, x)));
  }

  function cardHtml(char, item, where) {
    const check = I.canEquip(data, char, item);
    const virtue = item.virtue ? `<span class="virtue-chip info-link" data-info="virtue" style="color:${data.virtues[item.virtue].color}"><i></i>Знак: ${data.virtues[item.virtue].name}</span>` : '';
    return `<div class="item-card">
      <div class="item-head">${tile(item).replace('</div>', item.rarity >= 4 ? '<span class="sparks"><i></i><i></i><i></i><i></i></span></div>' : '</div>')}<div><div class="item-name">${nameHtml(item)}</div><div class="item-sub">${subline(item)}</div></div></div>
      ${propsHtml(item)}
      ${legendHtml(item)}
      ${virtue}
      ${where !== 'equipped' ? diffHtml(char, item) : ''}
      ${check.ok ? '' : `<div class="req">${check.reason}</div>`}
      <div class="meta">Нужен ${I.reqLevel(data, item)} уровень · скупщик даст ${fmtNum(I.sellPrice(data, item))} 💰 · сила ${I.power(data, item)}</div>
    </div>`;
  }

  // Окно предмета по центру. actions — html кнопок, onAction(act, e) — обработчик.
  // В шапке: лупа (диапазоны тиров) и замок (защита от продажи и разбора).
  function openItem(char, item, where, actions, onAction) {
    const tools = () => `
      <button class="icon-btn tool ${prefs.lens ? 'on' : ''}" data-tool="lens" title="Лупа: показать диапазоны значений">${art('ui/lens', '🔍')}</button>
      <button class="icon-btn tool ${item.locked ? 'on' : ''}" data-tool="lock" title="${item.locked ? 'Снять замок' : 'Запереть: не продавать и не разбирать'}">${art(item.locked ? 'ui/lock' : 'ui/unlock', item.locked ? '🔒' : '🔓')}</button>`;
    const render = () => openModal(nameHtml(item), `${cardHtml(char, item, where)}${actions ? `<div class="row-actions">${actions}</div>` : ''}`, handler, { tools: tools(), cls: item.rarity >= 3 ? `rar-${item.rarity}` : '' });
    const handler = (e) => {
      const t = e.target.closest('[data-tool]');
      if (t) {
        if (t.dataset.tool === 'lens') { prefs.lens = !prefs.lens; savePrefs(); }
        if (t.dataset.tool === 'lock') { item.locked = !item.locked; PC.app.save(); PC.app.render(); toast(item.locked ? 'Вещь заперта: не продаётся и не разбирается' : 'Замок снят'); }
        return render();
      }
      const a = e.target.closest('[data-act]');
      if (a && !a.disabled && onAction) onAction(a.dataset.act, e);
    };
    render();
  }

  // ---------- Справки по ресурсам ----------
  const INFO = {
    gold: { title: 'Золото', art: 'materials/gold', text: 'Основная валюта. Падает с монстров, выручается у скупщика. Тратится на заточку, ранги, перековку, ковку, зелья и камни.' },
    rarity: { title: 'Редкость', text: 'Сколько у вещи случайных свойств: обычная — 0, необычная — 1, редкая — 2, героическая — 3, легендарная — 3 и особое свойство, мифическая — 4 и особое, древняя — 4 и два особых, все в верхней половине диапазона. Находка предметов и боссы повышают шанс высокой редкости.' },
    tier: { title: 'Тир базы', text: 'Тир (T1–T7) соответствует зоне, где вещь упала, и задаёт базовые характеристики и требуемый уровень. Вещи высокого тира открывают и более сильные тиры свойств.' },
    ilvl: { title: 'Уровень предмета', text: 'Уровень монстра, с которого упала вещь. От него зависят максимальные тиры свойств и сила свойств, добавленных заточкой.' },
    quality: { title: 'Качество', text: 'Качество 0–100% умножает базовые характеристики вещи на ×0.80…×1.20. Не меняется само — только перековкой качества у чародейки (может выйти и хуже).' },
    enhance: { title: 'Заточка +N', text: 'Каждый +1 даёт +6% к базовым характеристикам. Точат у кузнеца камнями: I — до +5 (неудача ничего не стоит), II — до +10 (при неудаче −1), III — до +15 (вещь может сломаться, спасает свиток защиты). Вехи: +5 — тир случайного свойства, +10 — новое свойство, +15 — все свойства +1 тир. Потолок заточки зависит от ранга ★.' },
    rank: { title: 'Ранг ★', text: 'Звезда даёт +10% к базовым характеристикам и поднимает потолок заточки (★0 → +5 … ★5 → +15). Повышается у кузнеца за копию той же базы и тира с редкостью не ниже и рангом не ниже текущего минус один. На ★3 вещь получает знак-добродетель.' },
    virtue: { title: 'Знак-добродетель', text: 'Появляется на ★3. Надетые вещи с одинаковым знаком дают сетовые бонусы за 2, 4 и 6 вещей. С 30 уровня знак можно перековать у кузнеца — дорого.' },
    affixTier: { title: 'Тир свойства', text: 'T1…T7 — сила свойства. Чем выше уровень предмета, тем выше доступные тиры. Полоска справа — насколько значение близко к максимуму своего тира. Включите лупу, чтобы увидеть сам диапазон.' },
  };
  const MAT_USE = {
    stone1: 'Заточка у кузнеца до +5.', stone2: 'Заточка с +6 до +10.', stone3: 'Заточка с +11 до +15.',
    protect: 'При заточке выше +10 спасает вещь от поломки.', reroll: 'Перековка свойств у чародейки.',
    essence: 'Ранги, перековка, перенос и ковка.', ore: 'Ковка тяжёлых вещей и оружия.', leather: 'Ковка лёгких вещей и луков.',
  };
  const MAT_SOURCE = {
    stone1: 'Падает с монстров, продаётся в лавке, выпадает при разборе.', stone2: 'Падает с монстров с Гоблинской стоянки и боссов, продаётся в лавке.',
    stone3: 'Боссы поздних зон, разбор мифических вещей.', protect: 'Лавка.', reroll: 'Лавка, боссы, разбор легендарных вещей.',
    essence: 'Монстры и разбор редких вещей.', ore: 'Монстры и разбор металлических вещей.', leather: 'Монстры и разбор кожаных вещей.',
  };

  function openInfo(id) {
    const c = PC.app.state.char;
    let title, text, img, have = null;
    if (INFO[id]) ({ title, text, art: img } = INFO[id]);
    if (id === 'gold') have = c.gold;
    const m = data.materials[id];
    if (m) {
      title = m.name; img = m.art; have = c.materials[id] || 0;
      const kind = { potion: 'Зелье: пьётся в бою (одно за ход, затем откат 3 хода).', elixir: 'Эликсир: выпить вне боя, действует несколько побед.', herb: 'Материал для алхимии.' }[m.kind] || '';
      const recipe = data.recipes.filter((r) => r.need[id]).map((r) => data.materials[r.out].name);
      text = [m.desc, kind, MAT_USE[id], recipe.length ? `Нужен для: ${recipe.join(', ')}.` : '', MAT_SOURCE[id] ? `Где взять: ${MAT_SOURCE[id]}` : '']
        .filter(Boolean).join(' ');
    }
    if (!title) return;
    const canDrink = m && m.kind === 'elixir' && have > 0;
    const buff = c.buffs && c.buffs[id] ? `<p class="meta">Действует ещё ${c.buffs[id]} побед.</p>` : '';
    openSheet(title, `<div class="info-sheet">${img ? `<div class="ava" style="width:64px;height:64px">${art(img, '•')}</div>` : ''}
      <div><p>${text}</p>${have != null ? `<p class="meta">У вас: <b>${fmtNum(have)}</b></p>` : ''}${buff}</div></div>
      ${canDrink ? '<div class="row-actions"><button class="btn primary" data-act="drink">Выпить</button></div>' : ''}`, (e) => {
      if (!e.target.closest('[data-act="drink"]')) return;
      const r = PC.economy.drink(data, c, id);
      if (!r.ok) return toast(r.reason, 'bad');
      PC.app.save(); PC.app.render();
      toast(`${m.name}: действует ${r.battles} побед`, 'good');
      openInfo(id);
    });
    $('#sheet').classList.add('over-modal');
  }

  // Любой элемент с data-info открывает справку
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-info]');
    if (!el) return;
    e.stopPropagation();
    openInfo(el.dataset.info);
  }, true);

  function matChip(id, need) {
    const c = PC.app.state.char;
    const m = data.materials[id];
    const have = id === 'gold' ? c.gold : (c.materials[id] || 0);
    const short = need != null && have < need;
    const icon = id === 'gold' ? art('materials/gold', '💰') : art(m.art, '•');
    const label = need != null ? `${fmtNum(need)}` : fmtNum(have);
    return `<span class="${short ? 'short' : ''} info-link" data-info="${id}" title="${id === 'gold' ? 'Золото' : m.name}: есть ${fmtNum(have)}">${icon}${label}</span>`;
  }

  const costHtml = (cost) => `<div class="cost">${Object.entries(cost).map(([k, v]) => matChip(k, v)).join('')}</div>`;

  PC.itemUI = { KIND_EMOJI, tile, emptyTile, nameHtml, cardHtml, diffHtml, isUpgrade, openItem, openInfo, matChip, costHtml };
  void closeModal;
})();
