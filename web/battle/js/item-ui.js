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

  // Стак ресурса в сумке: значок и количество
  function stackTile(it, { attrs = '', cls = '', checked = false } = {}) {
    const m = data.materials[it.stack];
    return `<div class="tile stack ${checked ? 'checked' : ''} ${cls}" ${attrs} title="${m.name}">${art(m.art, '•')}<span class="count">${it.count}</span>${checked ? '<span class="check-badge">✓</span>' : ''}</div>`;
  }

  function emptyTile(slot, attrs = '') {
    return `<div class="tile empty" ${attrs}>${art(data.slots[slot].art, '')}</div>`;
  }

  const nameHtml = (item) => `<span class="rc${item.rarity}">${item.enhance ? `+${item.enhance} ` : ''}${I.name(data, item)}</span>`;

  // Кликабельные «ресурсы» вещи — каждый открывает справку
  function subline(item) {
    const r = data.rarities[item.rarity];
    const q = item.quality;
    const mat = data.types[item.type].armor;
    return `${mat ? `<span class="info-link mat-chip" data-info="armor_${mat}">${data.armorMaterials[mat].name}</span> · ` : ''}<span class="info-link rc${item.rarity}" data-info="rarity">${r.name}</span> ·
      <span class="info-link" data-info="tier">T${item.tier}</span> ·
      <span class="info-link" data-info="ilvl">ур. ${item.ilvl}</span><br>
      <span class="info-link" data-info="quality">Качество ${I.qualityName(data, q).toLowerCase()} ${q}%</span>
      · <span class="info-link" data-info="enhance">+${item.enhance}</span>
      · <span class="info-link" data-info="rank" style="color:var(--accent-2)">${item.rank ? '★'.repeat(item.rank) : '★0'}</span>`;
  }

  function propsHtml(item) {
    const lens = prefs.lens;
    const base = I.baseLines(data, item).map((l) => `<li class="${l.neg ? 'neg' : 'base'}">${statIcon(l.key)}<span class="txt">${l.text}</span></li>`).join('');
    const aff = item.affixes.map((af) => {
      const a = data.affixes[af.id];
      const [lo, hi] = a.t[af.tier - 1];
      const pct = hi > lo ? Math.round(af.roll * 100) : 100;
      const unit = a.pct || (data.statDefs[a.stat] && data.statDefs[a.stat].fmt(1).endsWith('%')) ? '%' : '';
      const k = a.stat && PC.stats.SCALED.has(a.stat) ? PC.stats.flatGrowth(af.lvl || 1) : 1;
      const f = (v) => (unit ? v : PC.fmtBig(v * k));
      const range = lens ? ` <span class="range">[${af.neg ? `−${f(Math.round(hi * data.NEGATIVE.scale))}–${f(Math.max(1, Math.round(lo * data.NEGATIVE.scale)))}` : `${f(lo)}–${f(hi)}`}${unit}]</span>` : '';
      return `<li class="${af.neg ? 'neg' : 'affix'}"><span class="t t${af.tier}" data-info="affixTier">T${af.tier}</span><span class="txt">${I.affixText(data, af)}${range}</span>
        <span class="roll" title="${pct}% от максимума тира"><div style="width:${pct}%"></div></span></li>`;
    }).join('');
    return `<ul class="props">${base}</ul>${aff ? `<div class="props-label">Свойства</div><ul class="props">${aff}</ul>` : ''}`;
  }

  function uniqueHtml(item) {
    if (!item.unique) return '';
    const u = data.uniques[item.unique];
    const mods = Object.entries(u.mods || {}).map(([k, v]) => {
      const d = data.statDefs[k];
      const neg = v < 0;
      const val = k.endsWith('Pct') ? `${Math.round(Math.abs(v) * 100)}%` : d.fmt(Math.abs(v));
      return `<li class="${neg ? 'neg' : 'uniq'}">${statIcon(k)}<span class="txt">${neg ? '−' : '+'}${val} ${d.name.toLowerCase()}</span></li>`;
    }).join('');
    const boss = data.monsters[u.boss];
    return `<div class="props-label">Свойства уника</div><ul class="props">${mods}</ul>
      <div class="uniq-block"><b>✦ ${u.effect}</b><span>${u.role}</span></div>
      <p class="flavor">«${u.flavor}»</p>
      <p class="meta">Падает: ${boss.name}${u.minDiff ? `, с «${data.difficulties[u.minDiff].name}»` : ''}</p>`;
  }

  // Образец уника без случайных свойств — для справки (иконка, база при заданном качестве)
  function uniqueSample(id, ilvl, quality) {
    const u = data.uniques[id];
    const type = data.types[u.type];
    const lv = Math.max(ilvl || 1, data.TIER_LEVEL[u.tier]);
    return {
      uid: `preview-${id}`, type: u.type, tier: Math.max(u.tier, I.maxTierFor(data, lv)), ilvl: lv,
      rarity: data.rarities.findIndex((r) => r.id === 'unique'), quality, cls: type.cls ? type.cls[0] : null,
      affixes: [], legendary: [], enhance: 0, rank: 0, unique: id,
    };
  }

  // Справка по унику: база с разбросом от худшего до лучшего качества, фиксированные свойства, эффект
  function openUnique(id, ilvl, onBack) {
    const lo = uniqueSample(id, ilvl, 0), hi = uniqueSample(id, ilvl, 100);
    const a = I.baseStats(data, lo), b = I.baseStats(data, hi);
    const f = PC.fmtBig;
    const base = Object.keys(a).map((k) => {
      if (k === 'dmg') return `<li class="base">${statIcon('atk')}<span class="txt">Урон ${f(a.dmg[0])}–${f(a.dmg[1])} <span class="range">… ${f(b.dmg[0])}–${f(b.dmg[1])}</span></span></li>`;
      const d = data.statDefs[k];
      const same = a[k] === b[k];
      return `<li class="base">${statIcon(k)}<span class="txt">${d.name} +${d.fmt(a[k])}${same ? '' : `<span class="range"> – ${d.fmt(b[k])}</span>`}</span></li>`;
    }).join('');
    openModal(nameHtml(lo), `<div class="item-card">
      <div class="item-head">${tile(lo).replace('</div>', '<span class="sparks"><i></i><i></i><i></i><i></i></span></div>')}<div><div class="item-name">${nameHtml(lo)}</div>
        <div class="item-sub"><span class="rc7">Уникальный</span> · T${lo.tier} · ур. ${lo.ilvl}<br>Нужен ${I.reqLevel(data, lo)} уровень</div></div></div>
      ${uniqueHtml(lo)}
      <div class="props-label">База (качество 0% … 100%)</div><ul class="props">${base}</ul>
      <div class="props-label">Случайные свойства</div>
      <p class="meta">+${data.rarities[lo.rarity].affixes} случайных свойства, как у героической вещи, без повтора свойств уника. Тиры свойств зависят от уровня предмета. Заточка и ранги — как у обычных вещей.</p>
      <p class="meta">Тир и уровень показаны для текущей сложности: на более высокой уник падает сильнее.</p>
    </div>`, null, { cls: 'rar-7', onClose: onBack ? () => setTimeout(onBack) : null });
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
    const d = (S.combatScore(after) / S.combatScore(before) - 1) * 100;
    const total = Math.abs(d) < 0.05 ? '' : `<span class="${d > 0 ? 'up' : 'down'}"><b>Боевая сила ${d > 0 ? '+' : '−'}${Math.abs(d).toFixed(1)}%</b></span>`;
    return `<div class="compare"><h4>${cur ? `Вместо: ${nameHtml(cur)}` : 'Слот пуст'}</h4>
      <div class="diff">${total}${parts.join('') || (total ? '' : '<span class="muted">Без изменений</span>')}</div></div>`;
  }

  // Сильнее надетого? Сравниваем боевую оценку героя с этой вещью и без неё (кэш до следующего изменения)
  const upgradeCache = new Map();
  function isUpgrade(char, item) {
    if (!I.canEquip(data, char, item).ok) return false;
    const key = `${item.uid}|${JSON.stringify(char.equipment)}|${JSON.stringify(char.stats)}|${char.level}`;
    if (upgradeCache.has(key)) return upgradeCache.get(key);
    const slots = I.slotsFor(data, item);
    const slot = slots.find((s) => !char.equipment[s]) || slots.reduce((a, b) => (I.power(data, char.equipment[a]) <= I.power(data, char.equipment[b]) ? a : b));
    const before = S.combatScore(S.compute(data, char));
    const clone = { ...char, equipment: { ...char.equipment, [slot]: item } };
    if (data.types[item.type].twoHanded) delete clone.equipment.offhand;
    const res = S.combatScore(S.compute(data, clone)) > before * 1.001;
    if (upgradeCache.size > 2000) upgradeCache.clear();
    upgradeCache.set(key, res);
    return res;
  }

  function cardHtml(char, item, where) {
    const check = I.canEquip(data, char, item);
    const virtue = item.virtue ? `<span class="virtue-chip info-link" data-info="virtue" style="color:${data.virtues[item.virtue].color}"><i></i>Знак: ${data.virtues[item.virtue].name}</span>` : '';
    return `<div class="item-card">
      <div class="item-head">${tile(item).replace('</div>', item.rarity >= 4 ? '<span class="sparks"><i></i><i></i><i></i><i></i></span></div>' : '</div>')}<div><div class="item-name">${nameHtml(item)}</div><div class="item-sub">${subline(item)}</div></div></div>
      ${uniqueHtml(item)}
      ${propsHtml(item)}
      ${legendHtml(item)}
      ${virtue}
      ${where !== 'equipped' ? diffHtml(char, item) : ''}
      ${check.ok ? '' : `<div class="req">${check.reason}</div>`}
      <div class="meta">Нужен ${I.reqLevel(data, item)} уровень · скупщик даст ${fmtNum(I.sellPrice(data, item))} 💰</div>
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
        if (t.dataset.tool === 'lock') {
          PC.app.act('lock', { uid: item.uid }).then((r) => {
            if (!r.ok) return r.shown || toast(r.reason || 'Не получилось', 'bad');
            item.locked = r.locked;   // карточка показывает свой объект вещи, герой уже обновлён
            PC.app.render(); render();
            toast(item.locked ? 'Вещь заперта: не продаётся и не разбирается' : 'Замок снят');
          });
          return;
        }
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
  // Справки по материалам брони: сильные стороны, минус и вариации баз
  for (const [id, m] of Object.entries(data.armorMaterials)) {
    const variants = Object.values(data.types).filter((t) => t.armor === id && t.kind === 'body').map((t) => `${t.name} — ${t.note}`);
    INFO[`armor_${id}`] = { title: `Материал: ${m.name}`, text: `${m.desc} Носить может любой класс. Вариации (на примере доспеха): ${variants.join('; ')}.` };
  }
  const MAT_USE = {
    stone1: 'Заточка у кузнеца до +5.', stone2: 'Заточка с +6 до +10.', stone3: 'Заточка с +11 до +15.',
    protect: 'При заточке выше +10 спасает вещь от поломки.', reroll: 'Перековка свойств у чародейки.',
    essence: 'Ранги, перековка, перенос и ковка.', ore: 'Ковка лат и металлического оружия.', leather: 'Ковка кожаной брони, поясов и луков.',
    cloth: 'Ковка тканевой брони и кушаков.', chitin: 'Ковка хитиновой брони.',
  };
  const MAT_SOURCE = {
    stone1: 'Падает с монстров, продаётся в лавке, выпадает при разборе.', stone2: 'Падает с монстров с Гоблинской стоянки и боссов, продаётся в лавке.',
    stone3: 'Боссы поздних зон, разбор мифических вещей.', protect: 'Лавка.', reroll: 'Лавка, боссы, разбор легендарных вещей.',
    essence: 'Монстры и разбор редких вещей.', ore: 'Монстры и разбор металлических вещей.', leather: 'Монстры и разбор кожаных вещей.',
    cloth: 'Монстры и разбор тканевых вещей.', chitin: 'Монстры и разбор хитиновых вещей.',
  };

  function openInfo(id) {
    const c = PC.app.state.char;
    let title, text, img, have = null;
    if (INFO[id]) ({ title, text, art: img } = INFO[id]);
    if (id === 'gold') have = c.gold;
    const m = data.materials[id];
    if (m) {
      title = m.name; img = m.art; have = I.matCount(data, c, id);
      const kind = { potion: 'Зелье: пьётся в бою (одно за ход, затем откат 3 хода).', elixir: 'Эликсир: выпить вне боя, действует несколько побед.', herb: 'Материал для алхимии.' }[m.kind] || '';
      const recipe = data.recipes.filter((r) => r.need[id]).map((r) => data.materials[r.out].name);
      text = [m.desc, kind, MAT_USE[id], recipe.length ? `Нужен для: ${recipe.join(', ')}.` : '', MAT_SOURCE[id] ? `Где взять: ${MAT_SOURCE[id]}` : '']
        .filter(Boolean).join(' ');
    }
    if (!title) return;
    const canDrink = m && m.kind === 'elixir' && have > 0;
    const sellable = m && m.price > 0 && have > 0 && PC.app.inVillage();
    const sellGold = sellable ? Math.max(1, Math.floor(m.price / 2)) * have : 0;
    const buff = c.buffs && c.buffs[id] ? `<p class="meta">Действует ещё ${c.buffs[id]} побед.</p>` : '';
    openSheet(title, `<div class="info-sheet">${img ? `<div class="ava" style="width:64px;height:64px">${art(img, '•')}</div>` : ''}
      <div><p>${text}</p>${have != null ? `<p class="meta">У вас: <b>${fmtNum(have)}</b></p>` : ''}${buff}</div></div>
      ${canDrink ? '<div class="row-actions"><button class="btn primary" data-act="drink">Выпить</button></div>' : ''}
      ${sellable ? `<div class="row-actions"><button class="btn" data-act="sell-all">Продать всё скупщику · ${fmtNum(sellGold)} 💰</button></div>` : ''}`, (e) => {
      if (e.target.closest('[data-act="sell-all"]')) {
        PC.app.act('sellMaterial', { id, n: have }).then((r) => {
          if (!r.ok) return r.shown || toast(r.reason, 'bad');
          PC.app.render();
          toast(`Продано: ${m.name} ×${have} за ${fmtNum(r.price)} 💰`, 'good');
          openInfo(id);
        });
        return;
      }
      if (!e.target.closest('[data-act="drink"]')) return;
      PC.app.act('drink', { id }).then((r) => {
        if (!r.ok) return r.shown || toast(r.reason, 'bad');
        PC.app.render();
        toast(`${m.name}: действует ${r.battles} побед`, 'good');
        openInfo(id);
      });
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
    const have = id === 'gold' ? c.gold : I.matCount(data, c, id);
    const short = need != null && have < need;
    const icon = id === 'gold' ? art('materials/gold', '💰') : art(m.art, '•');
    const label = need != null ? `${fmtNum(need)}` : fmtNum(have);
    return `<span class="${short ? 'short' : ''} info-link" data-info="${id}" title="${id === 'gold' ? 'Золото' : m.name}: есть ${fmtNum(have)}">${icon}${label}</span>`;
  }

  const costHtml = (cost) => `<div class="cost">${Object.entries(cost).map(([k, v]) => matChip(k, v)).join('')}</div>`;

  PC.itemUI = { KIND_EMOJI, tile, stackTile, emptyTile, nameHtml, cardHtml, uniqueSample, openUnique, diffHtml, isUpgrade, openItem, openInfo, matChip, costHtml };
  void closeModal;
})();
