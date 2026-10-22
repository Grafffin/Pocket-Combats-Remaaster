// Отрисовка предметов: плитка в рамке редкости, карточка со свойствами и сравнением с надетым, материалы.
(function () {
  'use strict';
  const { data, items: I, stats: S } = PC;
  const { art, statIcon, fmtNum } = PC.kit;

  const KIND_EMOJI = { weapon: '⚔️', offhand: '🛡️', head: '⛑️', body: '🦺', hands: '🧤', feet: '👢', belt: '🎗️', amulet: '📿', ring: '💍' };

  const rarityOf = (item) => data.rarities[item.rarity];

  function tile(item, { attrs = '', cls = '', can = true } = {}) {
    const type = data.types[item.type];
    const virtue = item.virtue ? `<i class="virtue" style="color:${data.virtues[item.virtue].color}"></i>` : '';
    return `<div class="tile r${item.rarity} ${can ? '' : 'cant'} ${cls}" ${attrs} title="${I.name(data, item)}">
      ${art(type.art, KIND_EMOJI[type.kind])}
      ${item.enhance ? `<span class="enh">+${item.enhance}</span>` : ''}
      <span class="tier">T${item.tier}</span>
      ${item.rank ? `<span class="stars">${'★'.repeat(item.rank)}</span>` : ''}
      ${virtue}
    </div>`;
  }

  function emptyTile(slot, attrs = '') {
    return `<div class="tile empty" ${attrs}>${art(data.slots[slot].art, '')}</div>`;
  }

  const nameHtml = (item) => `<span class="rc${item.rarity}">${item.enhance ? `+${item.enhance} ` : ''}${I.name(data, item)}</span>`;

  function subline(item) {
    const r = rarityOf(item);
    const q = item.quality;
    return `<span class="rc${item.rarity}">${r.name}</span> · ${data.slots[I.slotsFor(data, item)[0]].name.toLowerCase()} · T${item.tier} · ур. предмета ${item.ilvl}
      <br>Качество: ${I.qualityName(data, q)} ${q}% (×${I.qualityMult(q).toFixed(2)})${item.rank ? ` · <span style="color:var(--accent-2)">${'★'.repeat(item.rank)}</span>` : ''}`;
  }

  function propsHtml(item) {
    const base = I.baseLines(data, item).map((l) => `<li class="base">${statIcon(l.key)}<span class="txt">${l.text}</span></li>`).join('');
    const aff = item.affixes.map((af) => {
      const a = data.affixes[af.id];
      const [lo, hi] = a.t[af.tier - 1];
      const pct = hi > lo ? Math.round(af.roll * 100) : 100;
      return `<li class="${af.neg ? 'neg' : 'affix'}"><span class="t t${af.tier}">T${af.tier}</span><span class="txt">${I.affixText(data, af)}</span>
        <span class="roll" title="${pct}% от максимума тира"><div style="width:${pct}%"></div></span></li>`;
    }).join('');
    return `<ul class="props">${base}${aff}</ul>`;
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
      return `<span class="${d > 0 ? 'up' : 'down'}">${label} ${d > 0 ? '+' : '−'}${Math.abs(d)}</span>`;
    }).filter(Boolean);
    const cur = char.equipment[slot];
    return `<div class="compare"><h4>${cur ? `Вместо: ${nameHtml(cur)}` : 'Слот пуст'}</h4>
      <div class="diff">${parts.join('') || '<span class="muted">Без изменений</span>'}</div></div>`;
  }

  // Карточка предмета. where: 'bag' | 'equipped' | 'loot'
  function cardHtml(char, item, where) {
    const check = I.canEquip(data, char, item);
    const virtue = item.virtue ? `<span class="virtue-chip" style="color:${data.virtues[item.virtue].color}"><i></i>Знак: ${data.virtues[item.virtue].name}</span>` : '';
    return `<div class="item-card">
      <div class="item-head">${tile(item)}<div><div class="item-name">${nameHtml(item)}</div><div class="item-sub">${subline(item)}</div></div></div>
      ${propsHtml(item)}
      ${legendHtml(item)}
      ${virtue}
      ${where !== 'equipped' ? diffHtml(char, item) : ''}
      ${check.ok ? '' : `<div class="req">${check.reason}</div>`}
      <div class="meta">Требуется уровень ${I.reqLevel(data, item)} · скупщик даст ${fmtNum(I.sellPrice(data, item))} 💰 · сила ${I.power(data, item)}</div>
    </div>`;
  }

  function matChip(id, need) {
    const m = data.materials[id];
    const have = id === 'gold' ? PC.app.state.char.gold : (PC.app.state.char.materials[id] || 0);
    const short = need != null && have < need;
    const icon = id === 'gold' ? art('materials/gold', '💰') : art(m.art, '•');
    const label = need != null ? `${fmtNum(need)}` : fmtNum(have);
    return `<span class="${short ? 'short' : ''}" title="${id === 'gold' ? 'Золото' : m.name}: есть ${fmtNum(have)}">${icon}${label}</span>`;
  }

  const costHtml = (cost) => `<div class="cost">${Object.entries(cost).map(([k, v]) => matChip(k, v)).join('')}</div>`;

  PC.itemUI = { KIND_EMOJI, tile, emptyTile, nameHtml, cardHtml, diffHtml, matChip, costHtml };
})();
