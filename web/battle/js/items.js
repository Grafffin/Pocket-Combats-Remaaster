// Предметы (GDD §4): генерация, расчёт характеристик, надевание, заточка, ранги, перековка, разбор, ковка.
// Без DOM: меняет объект персонажа. Сумка — массив фиксированной длины, null — пустая ячейка.
(function (root) {
  'use strict';
  const PC = root.PC || (root.PC = {});

  const BAG_SIZE = 48;
  const newUid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  // Характеристики, которые растут от качества, заточки и ранга (шансы и скорость — нет)
  const SCALING = new Set(['atk', 'matk', 'def', 'mdef', 'hp', 'mp', 'eva', 'acc']);

  function weightedPick(rng, entries) {
    const total = entries.reduce((s, [, w]) => s + w, 0);
    let r = rng.next() * total;
    for (const [v, w] of entries) { r -= w; if (r < 0) return v; }
    return entries.length ? entries[entries.length - 1][0] : null;
  }

  const maxTierFor = (data, ilvl) => {
    let t = 1;
    for (let i = 1; i <= data.MAX_TIER; i++) if (data.TIER_LEVEL[i] <= ilvl) t = i;
    return t;
  };

  const qualityMult = (q) => 0.8 + 0.4 * q / 100;
  // Вещь, выпавшая выше уровня своего тира (поздние уровни зоны, сложности), сильнее: +4% базы за уровень
  const ilvlBonus = (data, item) => 1 + 0.04 * Math.max(0, (item.ilvl || 0) - data.TIER_LEVEL[item.tier]);
  const qualityName = (data, q) => data.qualities.filter((x) => q >= x.min).pop().name;

  // ---------- Генерация ----------

  // Вид слота с весами: оружие и броня падают чаще, украшения реже
  const KIND_WEIGHTS = { weapon: 16, offhand: 7, head: 11, body: 11, hands: 10, feet: 10, belt: 8, amulet: 6, ring: 9 };

  // Броню любого материала носит любой класс; ограничение по классу — только у оружия и левой руки
  function typesFor(data, kind, cls) {
    return Object.values(data.types).filter((t) => t.kind === kind && (!t.cls || t.cls.includes(cls)));
  }

  // Броня «своего» материала класса падает вдвое чаще любого другого
  function pickType(data, cls, rng) {
    const kinds = Object.entries(KIND_WEIGHTS).filter(([k]) => typesFor(data, k, cls).length);
    const kind = weightedPick(rng, kinds);
    const own = data.classes[cls] && data.classes[cls].armor;
    return weightedPick(rng, typesFor(data, kind, cls).map((t) => [t, t.armor && t.armor === own ? 2 : 1])).id;
  }

  function rollRarity(data, { mf = 0, boss = false, floor = 0, boost = 1 }, rng) {
    const entries = data.rarities.map((r, i) => {
      if (i < floor) return [i, 0];
      let w = r.weight;
      if (i >= 2) w *= (1 + mf / 100) * (boss ? 3 : 1) * boost;
      return [i, w];
    });
    return weightedPick(rng, entries);
  }

  function rollQuality(rng) {
    // Среднее двух бросков: чаще середина, края редки
    return Math.round(((rng.next() + rng.next()) / 2) * 100);
  }

  function affixPool(data, type, cls, taken, maxTier) {
    return Object.values(data.affixes).filter((a) =>
      a.slots.includes(type.kind) &&
      (!a.cls || a.cls.includes(cls)) &&
      !taken.has(a.id) &&
      (a.minTier || 1) <= maxTier);
  }

  function rollAffix(data, a, maxTier, rar, cls, rng) {
    const lo = Math.max(a.minTier || 1, rar.floor ? maxTier - rar.floor : 1);
    const tiers = [];
    for (let t = lo; t <= maxTier; t++) tiers.push([t, data.TIER_FALLOFF[maxTier - t] || 1]);
    const tier = weightedPick(rng, tiers);
    const roll = rar.high ? 0.5 + rng.next() * 0.5 : rng.next();
    const af = { id: a.id, tier, roll, lvl: 0 };
    const N = data.NEGATIVE;
    const rarIndex = data.rarities.indexOf(rar);
    if (!a.param && a.id !== 'allSkills' && N.rarities.includes(rarIndex) && rng.chance(N.chance)) af.neg = true;
    if (a.param === 'skill') {
      const pool = Object.values(data.skills).filter((s) => s.cls === cls);
      af.param = rng.pick(pool).id;
    }
    return af;
  }

  function addRandomAffix(data, item, rng, rar) {
    const type = data.types[item.type];
    const maxTier = maxTierFor(data, item.ilvl);
    const taken = new Set(item.affixes.map((a) => a.id));
    const pool = affixPool(data, type, item.cls, taken, maxTier);
    if (!pool.length) return null;
    const a = weightedPick(rng, pool.map((x) => [x, x.w]));
    const af = rollAffix(data, a, maxTier, rar || data.rarities[item.rarity], item.cls, rng);
    af.lvl = item.ilvl;
    item.affixes.push(af);
    return af;
  }

  // opts: { ilvl, cls, mf, boss, rarityFloor, rarityBoost, type, tier }
  function generate(data, opts, rng) {
    const cls = opts.cls;
    const typeId = opts.type || pickType(data, cls, rng);
    const type = data.types[typeId];
    const tier = opts.tier || maxTierFor(data, opts.ilvl);
    const ilvl = Math.max(opts.ilvl || 1, data.TIER_LEVEL[tier]);
    const rarity = rollRarity(data, { mf: opts.mf, boss: opts.boss, floor: opts.rarityFloor || 0, boost: opts.rarityBoost || 1 }, rng);
    const rar = data.rarities[rarity];
    const item = {
      uid: newUid(), type: typeId, tier, ilvl, rarity,
      quality: rollQuality(rng),
      cls: type.cls ? type.cls[0] : cls, // для аксессуаров — класс, под который вещь «настроена»
      affixes: [], legendary: [], enhance: 0, rank: 0,
    };
    for (let i = 0; i < rar.affixes; i++) addRandomAffix(data, item, rng, rar);
    const legs = Object.keys(data.legendaries);
    for (let i = 0; i < rar.legendary && legs.length; i++) item.legendary.push(legs.splice(Math.floor(rng.next() * legs.length), 1)[0]);
    return item;
  }

  // Уникальная вещь: фиксированные база, тир и свойства; уровень предмета и качество — как у обычной добычи
  function generateUnique(data, id, { ilvl }, rng) {
    const u = data.uniques[id];
    const type = data.types[u.type];
    const rarity = data.rarities.findIndex((r) => r.id === 'unique');
    // Тир уника растёт с уровнем предмета: ранний босс на высокой сложности даёт поздний уник
    const lv = Math.max(ilvl || 1, data.TIER_LEVEL[u.tier]);
    const item = {
      uid: newUid(), type: u.type, tier: Math.max(u.tier, maxTierFor(data, lv)), ilvl: lv,
      rarity, quality: rollQuality(rng), cls: type.cls ? type.cls[0] : null,
      affixes: [], legendary: [], enhance: 0, rank: 0, unique: id,
    };
    // К фиксированным свойствам уника — случайные (3, как у героической вещи), не повторяющие фиксированные
    if (!item.cls) item.cls = rng.pick(Object.keys(data.classes));
    for (let i = 0; i < data.rarities[rarity].affixes; i++) addRandomAffix(data, item, rng, data.rarities[3]);
    item.affixes = item.affixes.filter((af) => !(u.mods && data.affixes[af.id].stat in u.mods));
    return item;
  }

  // ---------- Характеристики вещи ----------

  function affixValue(data, af) {
    const a = data.affixes[af.id];
    const [lo, hi] = a.t[af.tier - 1];
    const k = a.stat && PC.stats.SCALED.has(a.stat) ? PC.stats.flatGrowth(af.lvl || 1) : 1;
    const v = Math.round((lo + (hi - lo) * af.roll) * k);
    return af.neg ? -Math.max(1, Math.round(v * data.NEGATIVE.scale)) : v;
  }

  function affixText(data, af) {
    const a = data.affixes[af.id];
    const v = affixValue(data, af);
    if (af.id === 'skillLvl') return `+${v} к умению «${data.skills[af.param].name}»`;
    if (af.id === 'skillDmg') return `+${v}% урона умения «${data.skills[af.param].name}»`;
    const def = data.statDefs[a.stat];
    const unit = a.pct || def.fmt(1).endsWith('%') ? '%' : '';
    return `${v < 0 ? '−' : '+'}${unit ? Math.abs(v) : PC.fmtBig(Math.abs(v))}${unit} ${def.name.toLowerCase()}`;
  }

  // Неотъемлемые характеристики с учётом качества, заточки и ранга
  function baseStats(data, item) {
    const type = data.types[item.type];
    const raw = type.base(item.tier);
    const mult = qualityMult(item.quality) * (1 + item.enhance * data.enhance.perLevel) * (1 + item.rank * data.rank.perRank);
    const S = PC.stats.growth(data.TIER_LEVEL[item.tier]) * ilvlBonus(data, item) * (item.unique ? data.UNIQUE_BASE : 1);
    const sc = (k) => (PC.stats.SCALED.has(k) ? S : 1);
    const out = {};
    for (const [k, v] of Object.entries(raw)) {
      if (k === 'dmg') out.dmg = [Math.max(1, Math.round(v[0] * mult * S)), Math.max(1, Math.round(v[1] * mult * S))];
      // Минусы материала (скорость, уклонение) не растут ни от качества, ни от заточки
      else out[k] = SCALING.has(k) && v > 0 ? Math.round(v * mult * sc(k)) : v * sc(k);
    }
    return out;
  }

  // Вклад вещи в характеристики персонажа (stats.js складывает)
  function totals(data, item) {
    const out = {};
    const add = (k, v) => { out[k] = (out[k] || 0) + v; };
    const base = baseStats(data, item);
    for (const [k, v] of Object.entries(base)) if (k !== 'dmg') add(k, v);
    for (const af of item.affixes) {
      const a = data.affixes[af.id];
      const v = affixValue(data, af);
      if (af.id === 'skillLvl') { out.skillLvl = out.skillLvl || {}; out.skillLvl[af.param] = (out.skillLvl[af.param] || 0) + v; continue; }
      if (af.id === 'skillDmg') { out.skillDmg = out.skillDmg || {}; out.skillDmg[af.param] = (out.skillDmg[af.param] || 0) + v / 100; continue; }
      add(a.stat, a.pct ? v / 100 : v);
    }
    if (item.unique) {
      const u = data.uniques[item.unique];
      for (const [k, v] of Object.entries(u.mods || {})) add(k, v);
      for (const e of u.effects || []) { out.legendary = out.legendary || {}; out.legendary[e] = 1; }
    }
    for (const id of item.legendary) {
      out.legendary = out.legendary || {};
      out.legendary[id] = 1;
      for (const [k, v] of Object.entries(data.legendaries[id].mods || {})) add(k, v);
    }
    return out;
  }

  function weaponDamage(data, item) {
    const b = baseStats(data, item);
    return b.dmg ? { min: b.dmg[0], max: b.dmg[1] } : null;
  }

  const isShield = (data, item) => !!(item && data.types[item.type].isShield);
  const reqLevel = (data, item) => data.TIER_LEVEL[item.tier];

  function name(data, item) {
    if (item.unique) return data.uniques[item.unique].name;
    const type = data.types[item.type];
    const a = data.adjectives[type.mat][item.tier - 1][type.g];
    return `${a} ${type.name}`;
  }

  // Строки неотъемлемых характеристик для карточки
  function baseLines(data, item) {
    const b = baseStats(data, item);
    const lines = [];
    if (b.dmg) lines.push({ key: 'atk', text: `Урон ${PC.fmtBig(b.dmg[0])}–${PC.fmtBig(b.dmg[1])}` });
    for (const [k, v] of Object.entries(b)) {
      if (k === 'dmg') continue;
      const def = data.statDefs[k];
      const val = v < 0 ? `−${def.fmt(-v)}` : `+${def.fmt(v)}`;
      lines.push({ key: k, text: `${def.name} ${val}`, neg: v < 0 });
    }
    return lines;
  }

  // Грубая оценка силы вещи — для сортировки, сравнения и автоматического разбора
  function power(data, item) {
    const t = totals(data, item);
    const dmg = weaponDamage(data, item);
    const S = PC.stats.growth(data.TIER_LEVEL[item.tier]);
    let p = 0;
    if (dmg) p += (dmg.min + dmg.max) * 1.2 / S;
    const w = { atk: 2 / S, matk: 2 / S, def: 1.2 / S, mdef: 0.8 / S, hp: 0.25 / S, mp: 0.3, eva: 0.6, acc: 0.4, crit: 6, critDmg: 1.5, speed: 3, block: 4, lifesteal: 6, hpRegen: 2 / S, dmgReduce: 8, thorns: 1.5 / S, fireDmg: 1.5 / S, coldDmg: 1.5 / S, poisonDmg: 1.5 / S };
    for (const [k, v] of Object.entries(t)) {
      if (typeof v !== 'number') continue;
      if (w[k]) p += v * w[k];
      else if (k.endsWith('Pct')) p += v * 700;
      else p += v * 1.5;
    }
    p += Object.keys(t.skillLvl || {}).length * 40 + Object.keys(t.skillDmg || {}).length * 25 + item.legendary.length * 80;
    return Math.round(p);
  }

  // ---------- Сумка и надевание ----------

  function bagAdd(char, item) {
    const i = char.bag.indexOf(null);
    if (i < 0) return -1;
    char.bag[i] = item;
    return i;
  }
  const bagFree = (char) => char.bag.filter((x) => !x).length;

  // Расширение сумки: сколько уже куплено и сколько стоит следующее (null — максимум)
  const bagExpansions = (data, char) => Math.max(0, Math.round((char.bag.length - BAG_SIZE) / data.bagExpand.step));
  const bagExpandCost = (data, char) => (char.bag.length >= data.bagExpand.max ? null : data.bagExpand.cost(bagExpansions(data, char)));

  function expandBag(data, char) {
    const cost = bagExpandCost(data, char);
    if (cost == null) return { ok: false, reason: `Сумка уже максимального размера: ${data.bagExpand.max}` };
    if ((char.gold || 0) < cost) return { ok: false, reason: 'Не хватает золота' };
    char.gold -= cost;
    const add = Math.min(data.bagExpand.step, data.bagExpand.max - char.bag.length);
    char.bag.push(...new Array(add).fill(null));
    return { ok: true, size: char.bag.length, cost };
  }

  // ---------- Ресурсы: все стаками в сумке ----------
  // В char.materials может лежать остаток старого сохранения, не влезший в сумку: он считается и тратится первым.

  function matCount(data, char, id) {
    let n = char.materials[id] || 0;
    for (const it of char.bag) if (it && it.stack === id) n += it.count;
    return n;
  }

  // Сколько ещё влезет: добить стаки + свободные ячейки
  function matRoom(data, char, id) {
    let room = 0;
    for (const it of char.bag) room += !it ? data.STACK_MAX : it.stack === id ? data.STACK_MAX - it.count : 0;
    return room;
  }

  // Кладёт ресурс; возвращает, сколько реально положено (остальное не влезло)
  function matAdd(data, char, id, n) {
    let left = n;
    for (const it of char.bag) {
      if (left <= 0) break;
      if (it && it.stack === id && it.count < data.STACK_MAX) { const d = Math.min(left, data.STACK_MAX - it.count); it.count += d; left -= d; }
    }
    for (let i = 0; i < char.bag.length && left > 0; i++) {
      if (char.bag[i]) continue;
      const d = Math.min(left, data.STACK_MAX);
      char.bag[i] = { stack: id, count: d };
      left -= d;
    }
    return n - left;
  }

  // Забирает n штук (проверка наличия — на вызывающем); сначала остаток из char.materials, затем самые маленькие стаки
  function matTake(data, char, id, n) {
    let left = n;
    const legacy = Math.min(char.materials[id] || 0, left);
    if (legacy) { char.materials[id] -= legacy; left -= legacy; }
    const idx = char.bag.map((it, i) => (it && it.stack === id ? i : -1)).filter((i) => i >= 0).sort((a, b) => char.bag[a].count - char.bag[b].count);
    for (const i of idx) {
      if (left <= 0) break;
      const d = Math.min(left, char.bag[i].count);
      char.bag[i].count -= d; left -= d;
      if (!char.bag[i].count) char.bag[i] = null;
    }
  }

  function findItem(char, uid) {
    for (const [slot, it] of Object.entries(char.equipment)) if (it && it.uid === uid) return { item: it, slot, index: -1 };
    const index = char.bag.findIndex((x) => x && x.uid === uid);
    return index >= 0 ? { item: char.bag[index], slot: null, index } : null;
  }

  function slotsFor(data, item) {
    const kind = data.types[item.type].kind;
    return Object.keys(data.slots).filter((s) => data.slots[s].kind === kind);
  }

  function canEquip(data, char, item, slot) {
    const type = data.types[item.type];
    if (slot && data.slots[slot].kind !== type.kind) return { ok: false, reason: 'Не подходит в этот слот' };
    if (reqLevel(data, item) > char.level) return { ok: false, reason: `Нужен ${reqLevel(data, item)} уровень` };
    if (type.cls && !type.cls.includes(char.job)) {
      return { ok: false, reason: `Только для: ${type.cls.map((c) => data.classes[c].title.toLowerCase()).join(', ')}` };
    }
    const w = char.equipment.weapon && data.types[char.equipment.weapon.type];
    if (type.kind === 'offhand' && w && w.twoHanded) return { ok: false, reason: 'Нельзя с двуручным оружием' };
    return { ok: true };
  }

  // Надеть вещь из сумки (index) в слот (или в подходящий свободный). Снятая вещь встаёт на её место в сумке.
  function equip(data, char, index, slot) {
    const item = char.bag[index];
    if (!item) return { ok: false, reason: 'Пустая ячейка' };
    if (item.stack) return { ok: false, reason: 'Это ресурс, а не снаряжение' };
    if (!slot) {
      const options = slotsFor(data, item);
      slot = options.find((s) => !char.equipment[s]) || options[0];
    }
    const check = canEquip(data, char, item, slot);
    if (!check.ok) return check;
    const type = data.types[item.type];
    if (type.twoHanded && char.equipment.offhand && bagFree(char) < 1) return { ok: false, reason: 'Нет места в сумке для вещи из левой руки' };
    char.bag[index] = char.equipment[slot] || null;
    char.equipment[slot] = item;
    if (type.twoHanded && char.equipment.offhand) {
      bagAdd(char, char.equipment.offhand);
      delete char.equipment.offhand;
    }
    return { ok: true, slot };
  }

  function unequip(char, slot, index) {
    const item = char.equipment[slot];
    if (!item) return { ok: false };
    if (index != null && char.bag[index]) return { ok: false, reason: 'Ячейка занята' };
    const i = index != null ? index : char.bag.indexOf(null);
    if (i < 0) return { ok: false, reason: 'Сумка полна' };
    char.bag[i] = item;
    delete char.equipment[slot];
    return { ok: true, index: i };
  }

  // Два стака одного ресурса сливаются в ячейке «to» (остаток остаётся в «from»), иначе ячейки меняются местами
  function moveInBag(char, from, to, data) {
    const a = char.bag[from], b = char.bag[to];
    if (a && b && a.stack && a.stack === b.stack && data) {
      const d = Math.min(a.count, data.STACK_MAX - b.count);
      b.count += d; a.count -= d;
      if (!a.count) char.bag[from] = null;
      return;
    }
    const tmp = char.bag[to];
    char.bag[to] = char.bag[from];
    char.bag[from] = tmp;
  }

  // Слить неполные стаки одного ресурса (перед сортировкой сумки)
  function compactStacks(data, char) {
    const ids = [...new Set(char.bag.filter((x) => x && x.stack).map((x) => x.stack))];
    for (const id of ids) {
      const n = char.bag.filter((x) => x && x.stack === id).reduce((t, x) => t + x.count, 0);
      char.bag = char.bag.map((x) => (x && x.stack === id ? null : x));
      matAdd(data, char, id, n);
    }
  }

  // ---------- Цена, разбор ----------

  function sellPrice(data, item) {
    return Math.max(1, Math.round(5 * Math.pow(item.tier, 1.5) * data.rarities[item.rarity].value * (1 + 0.2 * item.enhance) * (1 + 0.3 * item.rank)));
  }

  // Ожидаемый выход разбора: гарантированное и шансы
  function salvageYield(data, item) {
    const type = data.types[item.type];
    const sure = {};
    const main = data.tierMat(type.salvage, item.tier);   // ресурс тира вещи
    sure[main] = (sure[main] || 0) + 1 + Math.floor(item.tier / 2) + item.rarity;
    if (item.rarity >= 2) sure.essence = (sure.essence || 0) + (item.rarity - 1) * item.tier;
    const chance = [];
    if (item.rarity >= 1) chance.push(['stone1', 25 + 10 * item.rarity]);
    if (item.rarity >= 3 && item.tier >= 3) chance.push(['stone2', 10 + 5 * item.rarity]);
    if (item.rarity >= 5) chance.push(['stone3', 25]);
    if (item.rarity >= 4) chance.push(['reroll', 50]);
    return { sure, chance };
  }

  function salvage(data, char, uid, rng) {
    const found = findItem(char, uid);
    if (!found || found.slot) return { ok: false, reason: 'Сначала снимите вещь' };
    if (found.item.locked) return { ok: false, reason: 'Вещь под замком' };
    const y = salvageYield(data, found.item);
    const got = { ...y.sure };
    for (const [m, pct] of y.chance) if (rng.chance(pct)) got[m] = (got[m] || 0) + 1;
    char.bag[found.index] = null;   // ячейка освобождается раньше, чем кладём добычу
    const lost = {};
    for (const [m, n] of Object.entries(got)) { const d = matAdd(data, char, m, n); if (d < n) lost[m] = n - d; }
    return { ok: true, got, lost };
  }

  // ---------- Заточка ----------

  function enhanceInfo(data, item) {
    const E = data.enhance;
    const cap = E.capByRank[item.rank];
    if (item.enhance >= E.max) return { maxed: true };
    if (item.enhance >= cap) return { capped: true, cap };
    const next = item.enhance + 1;
    return {
      next, cap,
      chance: E.chance[next],
      stone: E.stone(next),
      gold: E.gold(item, next),
      fail: E.fail(next),
      milestone: E.milestones[next] || null,
    };
  }

  function upgradeAffixTier(item, af) {
    if (af.tier < 7) af.tier++;
    void item;
  }

  function enhance(data, char, uid, { protect = false } = {}, rng) {
    const found = findItem(char, uid);
    if (!found) return { ok: false, reason: 'Вещь не найдена' };
    const item = found.item;
    const info = enhanceInfo(data, item);
    if (info.maxed) return { ok: false, reason: 'Заточка на максимуме' };
    if (info.capped) return { ok: false, reason: `Потолок заточки для ★${item.rank} — +${info.cap}. Повысьте ранг.` };
    if (matCount(data, char, info.stone) < 1) return { ok: false, reason: `Нужен ${data.materials[info.stone].name}` };
    if (char.gold < info.gold) return { ok: false, reason: 'Не хватает золота' };
    const useProtect = protect && info.fail === 'break' && matCount(data, char, 'protect') > 0;
    matTake(data, char, info.stone, 1);
    char.gold -= info.gold;
    if (useProtect) matTake(data, char, 'protect', 1);

    if (rng.chance(info.chance)) {
      item.enhance = info.next;
      let milestone = null;
      if (info.next === 5 && item.affixes.length) {
        const af = rng.pick(item.affixes);
        upgradeAffixTier(item, af);
        milestone = `«${affixText(data, af)}» — тир повышен до T${af.tier}.`;
      }
      if (info.next === 10) {
        const af = addRandomAffix(data, item, rng);
        milestone = af ? `Новое свойство: «${affixText(data, af)}».` : null;
      }
      if (info.next === 15) {
        item.affixes.forEach((af) => upgradeAffixTier(item, af));
        milestone = 'Все свойства повышены на тир.';
      }
      return { ok: true, outcome: 'success', level: item.enhance, milestone };
    }
    if (info.fail === 'none') return { ok: true, outcome: 'fail' };
    if (info.fail === 'down') { item.enhance = Math.max(0, item.enhance - 1); return { ok: true, outcome: 'down', level: item.enhance }; }
    if (useProtect) return { ok: true, outcome: 'protected' };
    if (found.slot) delete char.equipment[found.slot];
    else char.bag[found.index] = null;
    return { ok: true, outcome: 'break' };
  }

  // ---------- Ранги ----------

  // Копия для ранга: та же база и тир, редкость не ниже, ранг не ниже (текущий − 1), не под замком
  const isFodder = (item, x) => x && x.uid !== item.uid && !x.locked && x.type === item.type && x.tier === item.tier &&
    x.rarity >= item.rarity && x.rank >= item.rank - 1;

  function rankInfo(data, char, item) {
    if (item.rank >= data.rank.max) return { maxed: true };
    const fodder = char.bag.filter((x) => isFodder(item, x));
    return { essence: data.rank.essence(item), gold: data.rank.gold(item), fodder };
  }

  function rankUp(data, char, uid, fodderUid) {
    const found = findItem(char, uid);
    if (!found) return { ok: false, reason: 'Вещь не найдена' };
    const item = found.item;
    const info = rankInfo(data, char, item);
    if (info.maxed) return { ok: false, reason: 'Ранг максимальный' };
    const f = info.fodder.find((x) => x.uid === fodderUid);
    if (!f) return { ok: false, reason: 'Нужна копия: та же база и тир, редкость не ниже, ранг не ниже ★' + Math.max(0, item.rank - 1) };
    if (matCount(data, char, 'essence') < info.essence) return { ok: false, reason: 'Не хватает эссенции' };
    if (char.gold < info.gold) return { ok: false, reason: 'Не хватает золота' };
    matTake(data, char, 'essence', info.essence);
    char.gold -= info.gold;
    char.bag[char.bag.indexOf(f)] = null;
    item.rank++;
    let virtue = null;
    if (item.rank >= data.VIRTUE_RANK && !item.virtue) {
      const ids = Object.keys(data.virtues);
      item.virtue = virtue = ids[Math.floor(Math.random() * ids.length)];
    }
    return { ok: true, rank: item.rank, virtue };
  }

  // ---------- Перековка ----------

  function rerollValueCost(data, item) { return { reroll: data.reroll.value.scrolls, gold: data.reroll.value.gold(item) }; }

  function rerollAffixesCost(data, item, locks) {
    const r = data.reroll.affixes;
    const m = 1 + r.lockMult * locks;
    return { reroll: Math.ceil(r.scrolls * m), essence: Math.ceil(r.essence(item) * m), gold: Math.ceil(r.gold(item) * m) };
  }

  function pay(data, char, cost) {
    for (const [k, v] of Object.entries(cost)) {
      const have = k === 'gold' ? char.gold : matCount(data, char, k);
      if (have < v) return false;
    }
    for (const [k, v] of Object.entries(cost)) {
      if (k === 'gold') char.gold -= v;
      else matTake(data, char, k, v);
    }
    return true;
  }

  function rerollValue(data, char, uid, idx, rng) {
    const found = findItem(char, uid);
    const af = found && found.item.affixes[idx];
    if (!af) return { ok: false, reason: 'Нет такого свойства' };
    if (!pay(data, char, rerollValueCost(data, found.item))) return { ok: false, reason: 'Не хватает материалов или золота' };
    const before = affixValue(data, af);
    af.roll = data.rarities[found.item.rarity].high ? 0.5 + rng.next() * 0.5 : rng.next();
    return { ok: true, before, after: affixValue(data, af) };
  }

  // Заменить все незамкнутые свойства новыми случайными (как «смена опций» в EHT)
  function rerollAffixes(data, char, uid, locks, rng) {
    const found = findItem(char, uid);
    if (!found) return { ok: false, reason: 'Вещь не найдена' };
    const item = found.item;
    const locked = new Set(locks || []);
    if (locked.size >= item.affixes.length) return { ok: false, reason: 'Все свойства замкнуты' };
    if (!pay(data, char, rerollAffixesCost(data, item, locked.size))) return { ok: false, reason: 'Не хватает материалов или золота' };
    const keep = item.affixes.filter((_, i) => locked.has(i));
    const count = item.affixes.length;
    item.affixes = keep;
    while (item.affixes.length < count) if (!addRandomAffix(data, item, rng)) break;
    // Замкнутые остаются на своих местах сверху — так проще следить
    return { ok: true };
  }

  // Перековка качества: новое случайное значение
  function requalityCost(data, item) { return { gold: data.requality.gold(item), essence: data.requality.essence(item) }; }

  function requality(data, char, uid, rng) {
    const found = findItem(char, uid);
    if (!found) return { ok: false, reason: 'Вещь не найдена' };
    if (!pay(data, char, requalityCost(data, found.item))) return { ok: false, reason: 'Не хватает материалов или золота' };
    const before = found.item.quality;
    found.item.quality = rollQuality(rng);
    return { ok: true, before, after: found.item.quality };
  }

  // ---------- Перековка знака (у кузнеца, с VIRTUE_REROLL_LEVEL уровня) ----------

  const VIRTUE_REROLL_LEVEL = 30;
  const virtueRerollCost = (data, item) => ({ reroll: 3, essence: 15 * item.tier, gold: 1500 * item.tier });

  function rerollVirtue(data, char, uid, rng) {
    if (char.level < VIRTUE_REROLL_LEVEL) return { ok: false, reason: `Откроется на ${VIRTUE_REROLL_LEVEL} уровне` };
    const found = findItem(char, uid);
    if (!found || !found.item.virtue) return { ok: false, reason: 'У вещи нет знака' };
    if (!pay(data, char, virtueRerollCost(data, found.item))) return { ok: false, reason: 'Не хватает материалов или золота' };
    const before = found.item.virtue;
    const others = Object.keys(data.virtues).filter((v) => v !== before);
    found.item.virtue = rng.pick(others);
    return { ok: true, before, after: found.item.virtue };
  }

  // ---------- Наследование ----------

  function inheritCost(data, target) { return { gold: data.inherit.gold(target), essence: data.inherit.essence(target) }; }

  // Можно ли перенести вложения донора на цель: вещь того же вида слота, донор из сумки, есть что переносить
  function inheritCheck(data, char, targetUid, donorUid) {
    const t = findItem(char, targetUid), d = findItem(char, donorUid);
    if (!t || !d) return { ok: false, reason: 'Вещь не найдена' };
    if (d.slot) return { ok: false, reason: 'Донор должен лежать в сумке' };
    if (t.item.uid === d.item.uid) return { ok: false, reason: 'Нужны две разные вещи' };
    if (data.types[t.item.type].kind !== data.types[d.item.type].kind) return { ok: false, reason: 'Только между вещами одного вида' };
    if (!d.item.enhance && !d.item.rank && !d.item.virtue) return { ok: false, reason: 'Донору нечего передать' };
    return { ok: true, t, d };
  }

  function inherit(data, char, targetUid, donorUid) {
    const c = inheritCheck(data, char, targetUid, donorUid);
    if (!c.ok) return c;
    const target = c.t.item, donor = c.d.item;
    if (!pay(data, char, inheritCost(data, target))) return { ok: false, reason: 'Не хватает материалов или золота' };
    target.rank = Math.max(target.rank, donor.rank);
    target.enhance = Math.min(Math.max(target.enhance, donor.enhance), data.enhance.capByRank[target.rank]);
    if (!target.virtue && donor.virtue) target.virtue = donor.virtue;
    char.bag[c.d.index] = null;
    return { ok: true };
  }

  // ---------- Ковка ----------

  function craftCost(data, typeId, tier) {
    const c = data.craft.cost(tier);
    const main = data.tierMat(data.types[typeId].salvage, tier);   // вещь тира T куётся из ресурса тира T
    const cost = { gold: c.gold, essence: c.essence };
    cost[main] = (cost[main] || 0) + c.main;
    return cost;
  }

  function craft(data, char, typeId, tier, rng) {
    if (bagFree(char) < 1) return { ok: false, reason: 'Сумка полна' };
    if (tier > (char.maxTier || 1)) return { ok: false, reason: 'Этот тир ещё не открыт — дойдите до его зоны' };
    if (!pay(data, char, craftCost(data, typeId, tier))) return { ok: false, reason: 'Не хватает материалов или золота' };
    const item = generate(data, {
      ilvl: data.TIER_LEVEL[tier] + 2, tier, type: typeId, cls: char.job,
      rarityFloor: data.craft.rarityFloor, rarityBoost: data.craft.rarityBoost, mf: 0,
    }, rng);
    bagAdd(char, item);
    return { ok: true, item };
  }

  PC.items = {
    BAG_SIZE, compactStacks, matCount, matRoom, matAdd, matTake, newUid, generate, generateUnique, maxTierFor, qualityMult, qualityName,
    affixValue, affixText, baseStats, baseLines, totals, weaponDamage, isShield, reqLevel, name, power,
    bagAdd, bagFree, bagExpandCost, expandBag, findItem, slotsFor, canEquip, equip, unequip, moveInBag,
    sellPrice, salvageYield, salvage,
    enhanceInfo, enhance, rankInfo, rankUp,
    rerollValueCost, rerollAffixesCost, rerollValue, rerollAffixes,
    craftCost, craft, typesFor, requalityCost, requality, inheritCost, inheritCheck, inherit,
    VIRTUE_REROLL_LEVEL, virtueRerollCost, rerollVirtue, isFodder,
  };
  if (typeof module !== 'undefined') module.exports = PC;
})(typeof window !== 'undefined' ? window : globalThis);
