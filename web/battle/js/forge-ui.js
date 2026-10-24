// Вкладка «Кузница»: заточка, ранги ★, перенос вложений, перековка (чародейка), ковка новых вещей.
(function () {
  'use strict';
  const { data, items: I, progression: P } = PC;
  const { $, art, toast, plural, fmtNum, openModal } = PC.kit;
  const { tile, cardHtml, nameHtml, costHtml } = PC.itemUI;
  const app = PC.app;

  // Режимы: id, название, иконка, кто делает, что делает (одной строкой)
  const SUBS = [
    ['enhance', 'Заточка', 'stats/atk', 'Кузнец Тарас', 'Камнями поднимает +N: больше базовых характеристик, вехи на +5/+10/+15.'],
    ['rank', 'Ранг ★', 'stats/exp', 'Кузнец Тарас', 'Скармливает копию вещи: +10% базовых, выше потолок заточки, на ★3 — знак.'],
    ['inherit', 'Перенос', 'stats/speed', 'Кузнец Тарас', 'Переносит заточку, ранг и знак с одной вещи на другую того же вида.'],
    ['reroll', 'Перековка', 'stats/matk', 'Чародейка Велена', 'Меняет случайные свойства вещи: числа, строки, качество или знак.'],
    ['craft', 'Ковка', 'stats/def', 'Кузнец Тарас', 'Выковывает новую вещь нужной базы и тира.'],
  ];
  const f = { sub: 'enhance', mode: 'values', valueIdx: 0, uid: null, locks: new Set(), protect: false, fodder: null, donor: null, craftType: null, craftTier: 1, flash: null };

  function allItems(c) {
    return [...Object.values(c.equipment).filter(Boolean).map((it) => ({ it, worn: true })), ...c.bag.filter(Boolean).map((it) => ({ it, worn: false }))];
  }

  function render(root, arg) {
    const c = app.state.char;
    if (typeof arg === 'string') f.sub = arg;
    if (arg && arg.uid) f.uid = arg.uid;
    app.state.tabArg = null;
    if (f.uid && !I.findItem(c, f.uid)) f.uid = null;
    const items = allItems(c);
    if (!f.uid && items.length && f.sub !== 'craft') f.uid = (items.find((x) => x.worn && x.it.type === (c.equipment.weapon || {}).type) || items[0]).it.uid;

    // Кузница и чародейка работают только в деревне
    if (!app.inVillage()) {
      root.innerHTML = `<div class="card section"><h3>Кузница</h3>
        <p>Кузнец Тарас и чародейка Велена принимают только в деревне ${data.locations[data.HOME].name}.</p>
        <p class="meta">Вернитесь туда через переходы на экране «Мир».</p>
        <div class="row-actions"><button class="btn primary" data-act="to-world">К переходам</button></div></div>`;
      return;
    }
    const tabs = SUBS.map(([id, name]) => `<button class="${f.sub === id ? 'on' : ''}" data-sub="${id}">${name}</button>`).join('');
    const sub = SUBS.find((s) => s[0] === f.sub);
    const modeHead = `<div class="mode-head">${art(sub[2], '')}<div><b>${sub[1]}</b><span class="meta">${sub[3]} · ${sub[4]}</span></div></div>`;
    const picker = f.sub === 'craft' ? '' : `<div class="card section"><h3>Вещь <span class="note">${f.sub === 'reroll' ? 'чародейка Велена' : 'кузнец Тарас'}</span></h3>
      <div class="picker">${items.map(({ it, worn }) => tile(it, { attrs: `data-pick="${it.uid}" title="${worn ? 'надето' : 'в сумке'}"`, cls: it.uid === f.uid ? 'sel' : '' })).join('')}</div>
      <p class="meta" style="margin-top:6px">Сначала надетые, затем вещи из сумки.</p></div>`;
    const flash = f.flash ? `<div class="flash ${f.flash.kind}" style="margin:12px">${f.flash.text}</div>` : '';
    f.flash = null;

    const body = { enhance: enhancePanel, rank: rankPanel, inherit: inheritPanel, reroll: rerollPanel, craft: craftPanel }[f.sub](c);
    root.innerHTML = `<div class="forge-tabs">${tabs}</div>${modeHead}${flash}${body}${picker}
      <div class="card section"><h3>Запасы</h3><!-- без количества costHtml показывает, сколько есть -->${costHtml(Object.fromEntries(['stone1', 'stone2', 'stone3', 'protect', 'reroll', 'essence', 'ore', 'leather'].map((k) => [k, null])))}</div>`;
  }
  app.tabs.forge = render;

  const selected = (c) => (f.uid ? I.findItem(c, f.uid) : null);

  function head(item) {
    return `<div class="forge-target">${tile(item)}<div><div class="item-name">${nameHtml(item)}</div>
      <div class="item-sub">${item.rank ? `<span style="color:var(--accent-2)">${'★'.repeat(item.rank)}</span> · ` : ''}+${item.enhance} из +${data.enhance.capByRank[item.rank]} · качество ${item.quality}%</div>
      <button class="chip-btn" data-act="card" style="margin-top:6px">Свойства</button></div></div>`;
  }

  const none = '<div class="card section"><p class="empty-note">Выберите вещь ниже.</p></div>';

  // ---------- Заточка ----------
  function enhancePanel(c) {
    const s = selected(c);
    if (!s) return none;
    const item = s.item;
    const info = I.enhanceInfo(data, item);
    let body;
    if (info.maxed) body = '<p class="hint">Заточка на пределе: +15.</p>';
    else if (info.capped) body = `<p class="hint">Потолок заточки для ★${item.rank} — +${info.cap}. Повысьте ранг во вкладке «Ранг ★».</p>`;
    else {
      const fail = { none: 'При неудаче ничего не теряется.', down: 'При неудаче заточка упадёт на 1.', break: 'При неудаче вещь сломается!' }[info.fail];
      const canProtect = info.fail === 'break';
      body = `<div class="row" style="justify-content:space-between"><div><div class="meta">+${item.enhance} → +${info.next}</div><div class="chance">${info.chance}%</div></div>
          ${costHtml({ [info.stone]: 1, gold: info.gold })}</div>
        <p class="${info.fail === 'break' ? 'req' : 'meta'}">${fail}${info.milestone ? ` <b style="color:var(--accent-2)">Веха +${info.next}: ${info.milestone}.</b>` : ''}</p>
        ${canProtect ? `<label class="toggle"><span>Свиток защиты (есть ${c.materials.protect || 0})</span><input type="checkbox" data-protect ${f.protect ? 'checked' : ''} ${(c.materials.protect || 0) ? '' : 'disabled'}></label>` : ''}
        <div class="row-actions"><button class="btn primary" data-act="enhance">Заточить</button></div>`;
    }
    return `<div class="card section"><h3>Заточка</h3>${head(item)}
      <p class="meta" style="margin-top:10px">Каждый +1 даёт +${Math.round(data.enhance.perLevel * 100)}% к базовым характеристикам. Вехи: +5 — тир случайного свойства, +10 — новое свойство, +15 — все свойства +1 тир.</p>
      ${body}</div>`;
  }

  // ---------- Ранг ----------
  function rankPanel(c) {
    const s = selected(c);
    if (!s) return none;
    const item = s.item;
    const info = I.rankInfo(data, c, item);
    if (info.maxed) return `<div class="card section"><h3>Ранг</h3>${head(item)}<p class="hint">Максимальный ранг ★5.</p></div>`;
    if (f.fodder && !info.fodder.some((x) => x.uid === f.fodder)) f.fodder = null;
    const fodder = info.fodder.map((it) => tile(it, { attrs: `data-fodder="${it.uid}"`, cls: it.uid === f.fodder ? 'sel' : '' })).join('');
    return `<div class="card section"><h3>Ранг ★${item.rank} → ★${item.rank + 1}</h3>${head(item)}
      <p class="meta" style="margin-top:10px">Звезда даёт +${Math.round(data.rank.perRank * 100)}% к базовым характеристикам и поднимает потолок заточки до +${data.enhance.capByRank[item.rank + 1]}.
        ${item.rank + 1 === data.VIRTUE_RANK && !item.virtue ? '<b style="color:var(--accent-2)">На ★3 вещь получит знак-добродетель.</b>' : ''}</p>
      <p class="meta">Нужна копия: «${I.name(data, item)}» того же тира (любой редкости). Копия исчезнет.</p>
      ${fodder ? `<div class="picker">${fodder}</div>` : '<p class="empty-note">Копий в сумке нет — охотьтесь или выкуйте у кузнеца.</p>'}
      ${costHtml({ essence: info.essence, gold: info.gold })}
      <div class="row-actions"><button class="btn primary" data-act="rank" ${f.fodder ? '' : 'disabled'}>Повысить ранг</button></div></div>`;
  }

  // ---------- Перенос ----------
  function inheritPanel(c) {
    const s = selected(c);
    if (!s) return none;
    const item = s.item;
    const kind = data.types[item.type].kind;
    const donors = c.bag.filter((x) => x && x.uid !== item.uid && data.types[x.type].kind === kind && (x.enhance || x.rank || x.virtue));
    if (f.donor && !donors.some((x) => x.uid === f.donor)) f.donor = null;
    const d = f.donor && I.findItem(c, f.donor).item;
    return `<div class="card section"><h3>Перенос вложений</h3>${head(item)}
      <p class="meta" style="margin-top:10px">Заточка, ранг ★ и знак донора переходят на эту вещь (берётся лучшее), донор исчезает. Так вложения не сгорают при смене вещи на более высокий тир.</p>
      ${donors.length ? `<div class="picker">${donors.map((it) => tile(it, { attrs: `data-donor="${it.uid}"`, cls: it.uid === f.donor ? 'sel' : '' })).join('')}</div>`
        : '<p class="empty-note">В сумке нет вещей этого вида с заточкой, звёздами или знаком.</p>'}
      ${d ? `<p class="meta">После переноса: +${Math.min(Math.max(item.enhance, d.enhance), data.enhance.capByRank[Math.max(item.rank, d.rank)])} · ★${Math.max(item.rank, d.rank)}${!item.virtue && d.virtue ? ` · знак «${data.virtues[d.virtue].name}»` : ''}</p>` : ''}
      ${costHtml(I.inheritCost(data, item))}
      <div class="row-actions"><button class="btn primary" data-act="inherit" ${d ? '' : 'disabled'}>Перенести</button></div></div>`;
  }

  // ---------- Перековка ----------
  // Четыре явных режима: числа (значение одного свойства), строки (замена свойств), качество, знак
  const MODES = [['values', 'Числа'], ['lines', 'Строки'], ['quality', 'Качество'], ['virtue', 'Знак']];

  function rerollPanel(c) {
    const s = selected(c);
    if (!s) return none;
    const item = s.item;
    for (const i of [...f.locks]) if (i >= item.affixes.length) f.locks.delete(i);
    if (f.valueIdx >= item.affixes.length) f.valueIdx = 0;
    const modes = `<div class="seg mode-seg">${MODES.map(([id, name]) => `<button class="${f.mode === id ? 'on' : ''}" data-mode="${id}">${name}</button>`).join('')}</div>`;
    const noAffixes = '<p class="hint">У обычных вещей нет случайных свойств — перековывать нечего.</p>';
    let body = '';
    if (f.mode === 'values') {
      body = item.affixes.length ? `<p class="meta">Выберите свойство: его значение перебросится в пределах тира, само свойство останется.</p>
        <div>${item.affixes.map((af, i) => `<label class="lock-row ${f.valueIdx === i ? 'sel' : ''}"><input type="radio" name="val" data-val="${i}" ${f.valueIdx === i ? 'checked' : ''}>
          <span class="t t${af.tier}">T${af.tier}</span><span class="txt ${af.neg ? 'req' : ''}">${I.affixText(data, af)}</span></label>`).join('')}</div>
        ${costHtml(I.rerollValueCost(data, item))}
        <div class="row-actions"><button class="btn primary" data-act="value">Перебросить число</button></div>` : noAffixes;
    } else if (f.mode === 'lines') {
      body = item.affixes.length ? `<p class="meta">Отметьте замком свойства, которые нужно сохранить. Остальные заменятся случайными другими. Каждый замок удваивает цену.</p>
        <div>${item.affixes.map((af, i) => `<label class="lock-row"><input type="checkbox" data-lock="${i}" ${f.locks.has(i) ? 'checked' : ''}>
          <span class="t t${af.tier}">T${af.tier}</span><span class="txt ${af.neg ? 'req' : ''}">${I.affixText(data, af)}</span>${f.locks.has(i) ? '🔒' : ''}</label>`).join('')}</div>
        ${costHtml(I.rerollAffixesCost(data, item, f.locks.size))}
        <div class="row-actions"><button class="btn primary" data-act="reroll" ${f.locks.size >= item.affixes.length ? 'disabled' : ''}>Заменить незамкнутые строки</button></div>` : noAffixes;
    } else if (f.mode === 'quality') {
      body = `<p>Сейчас: <b>${item.quality}%</b> (×${I.qualityMult(item.quality).toFixed(2)} к базовым характеристикам)</p>
        <p class="meta">Новое случайное качество. Может выйти хуже!</p>
        ${costHtml(I.requalityCost(data, item))}
        <div class="row-actions"><button class="btn primary" data-act="requality">Перековать качество</button></div>`;
    } else {
      const open = c.level >= I.VIRTUE_REROLL_LEVEL;
      body = !item.virtue ? '<p class="hint">У вещи нет знака — он появляется на ранге ★3.</p>'
        : !open ? `<p class="hint">Перековка знака откроется на ${I.VIRTUE_REROLL_LEVEL} уровне.</p>`
          : `<p>Знак: <b style="color:${data.virtues[item.virtue].color}">${data.virtues[item.virtue].name}</b>. Перековка даст другой случайный знак.</p>
            ${costHtml(I.virtueRerollCost(data, item))}
            <div class="row-actions"><button class="btn primary" data-act="virtue">Перековать знак</button></div>`;
    }
    return `<div class="card section"><h3>Перековка</h3>${head(item)}${modes}${body}</div>`;
  }

  // ---------- Ковка ----------
  function craftPanel(c) {
    const kinds = ['weapon', 'offhand', 'head', 'body', 'hands', 'feet', 'belt', 'amulet', 'ring'];
    const types = kinds.flatMap((k) => I.typesFor(data, k, c.job));
    if (!f.craftType || !types.some((t) => t.id === f.craftType)) f.craftType = types[0].id;
    f.craftTier = Math.min(f.craftTier, c.maxTier || 1);
    const typeOpts = types.map((t) => `<option value="${t.id}" ${t.id === f.craftType ? 'selected' : ''}>${data.slots[I.slotsFor(data, { type: t.id })[0]].name}: ${t.name}</option>`).join('');
    const tierOpts = Array.from({ length: c.maxTier || 1 }, (_, i) => i + 1).map((t) => `<option value="${t}" ${t === f.craftTier ? 'selected' : ''}>T${t} · с ${data.TIER_LEVEL[t]} ур.</option>`).join('');
    const preview = `${data.adjectives[data.types[f.craftType].mat][f.craftTier - 1][data.types[f.craftType].g]} ${data.types[f.craftType].name}`;
    return `<div class="card section"><h3>Ковка</h3>
      <p class="meta">Кузнец выкует вещь выбранной базы. Редкость — не ниже «Необычной» и чаще высокая, чем у добычи. Тиры открываются по мере прохождения зон.</p>
      <div class="field"><label>База</label><select data-craft-type style="width:100%">${typeOpts}</select></div>
      <div class="field"><label>Тир</label><select data-craft-tier style="width:100%">${tierOpts}</select></div>
      <p>Получится: <b>${preview}</b></p>
      ${costHtml(I.craftCost(data, f.craftType, f.craftTier))}
      <div class="row-actions"><button class="btn primary" data-act="craft">Выковать</button></div></div>`;
  }

  // ---------- События ----------

  function done(res, okText, kind = 'good') {
    if (!res.ok) { f.flash = { kind: 'bad', text: res.reason }; app.render(); return false; }
    f.flash = { kind, text: okText };
    app.render();
    return true;
  }

  $('#tab-forge').addEventListener('click', (e) => {
    const c = app.state.char;
    const sub = e.target.closest('[data-sub]');
    if (sub) { f.sub = sub.dataset.sub; return app.render(); }
    const mode = e.target.closest('[data-mode]');
    if (mode) { f.mode = mode.dataset.mode; return app.render(); }
    const pick = e.target.closest('[data-pick]');
    if (pick) { f.uid = pick.dataset.pick; f.locks.clear(); f.fodder = null; f.donor = null; return app.render(); }
    const fod = e.target.closest('[data-fodder]');
    if (fod) { f.fodder = fod.dataset.fodder; return app.render(); }
    const don = e.target.closest('[data-donor]');
    if (don) { f.donor = don.dataset.donor; return app.render(); }
    const act = e.target.closest('[data-act]');
    if (!act || act.disabled) return;
    const a = act.dataset.act;
    const s = selected(c);
    if (a === 'card' && s) return PC.itemUI.openItem(c, s.item, s.slot ? 'equipped' : 'bag');
    if (a === 'to-world') return app.setTab('world');
    // Действие считает сервер (или actions.js без сервера); пока ответ не пришёл, кнопки не нажимаются повторно
    const go = (op, args, then) => {
      if (f.busy) return;
      f.busy = true;
      app.act(op, args).then((r) => { f.busy = false; if (r.shown) return app.render(); then(r); });
    };
    if (a === 'value') {
      return go('rerollValue', { uid: f.uid, idx: f.valueIdx }, (r) =>
        done(r, r.ok ? `Значение: ${r.before} → ${r.after}` : '', r.ok && r.after >= r.before ? 'good' : 'neutral'));
    }
    if (a === 'virtue') {
      return go('rerollVirtue', { uid: f.uid }, (r) => done(r, r.ok ? `Знак: ${data.virtues[r.before].name} → ${data.virtues[r.after].name}` : ''));
    }
    if (a === 'enhance') {
      const info = I.enhanceInfo(data, s.item);
      if (info.fail === 'break' && !f.protect && !confirm('Без свитка защиты вещь может сломаться. Точить?')) return;
      return go('enhance', { uid: f.uid, protect: !!f.protect }, (r) => enhanced(r));
    }
    if (a === 'rank') {
      const fodder = f.fodder;
      f.fodder = null;
      return go('rankUp', { uid: f.uid, fodder }, (r) =>
        done(r, r.ok ? `Ранг повышен до ★${r.rank}.${r.virtue ? ` Вещь получила знак «${data.virtues[r.virtue].name}»!` : ''}` : ''));
    }
    if (a === 'inherit') {
      const donor = f.donor;
      f.donor = null;
      return go('inherit', { uid: f.uid, donor }, (r) => done(r, 'Вложения перенесены.'));
    }
    if (a === 'reroll') {
      const locks = [...f.locks];
      return go('rerollAffixes', { uid: f.uid, locks }, (r) => {
        if (r.ok) f.locks = new Set(locks.map((_, i) => i)); // замкнутые теперь стоят первыми
        done(r, 'Свойства перекованы.');
      });
    }
    if (a === 'requality') {
      return go('requality', { uid: f.uid }, (r) =>
        done(r, r.ok ? `Качество: ${r.before}% → ${r.after}%` : '', r.ok && r.after >= r.before ? 'good' : 'neutral'));
    }
    if (a === 'craft') {
      return go('craft', { type: f.craftType, tier: f.craftTier }, (r) => {
        if (!r.ok) return done(r);
        const made = I.findItem(app.state.char, r.item.uid);
        const item = made ? made.item : r.item;
        item.fresh = true;
        done(r, `Выковано: ${nameHtml(item)}`);
        PC.itemUI.openItem(app.state.char, item, 'bag');
      });
    }
  });

  function enhanced(r) {
    if (!r.ok) return done(r);
    const text = {
      success: `Успех! Теперь +${r.level}.${r.milestone ? ` ${r.milestone}` : ''}`,
      fail: 'Неудача. Камень потрачен, вещь цела.',
      down: `Неудача — заточка упала до +${r.level}.`,
      protected: 'Неудача, но свиток защиты спас вещь.',
      break: 'Металл не выдержал — вещь сломалась.',
    }[r.outcome];
    if (r.outcome === 'break') f.uid = null;
    return done(r, text, r.outcome === 'success' ? 'good' : r.outcome === 'break' ? 'bad' : 'neutral');
  }

  $('#tab-forge').addEventListener('change', (e) => {
    if (e.target.matches('[data-lock]')) {
      const i = Number(e.target.dataset.lock);
      if (e.target.checked) f.locks.add(i); else f.locks.delete(i);
      return app.render();
    }
    if (e.target.matches('[data-protect]')) { f.protect = e.target.checked; return; }
    if (e.target.matches('[data-val]')) { f.valueIdx = Number(e.target.dataset.val); return app.render(); }
    if (e.target.matches('[data-craft-type]')) { f.craftType = e.target.value; return app.render(); }
    if (e.target.matches('[data-craft-tier]')) { f.craftTier = Number(e.target.value); return app.render(); }
  });

  void P; void fmtNum; void plural; void art;
})();
