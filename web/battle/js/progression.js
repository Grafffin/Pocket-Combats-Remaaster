// Прогрессия персонажа: опыт и уровни, очки характеристик, экипировка, добыча с монстров.
// Без DOM и без хранилища: персонаж — обычный JSON-объект, сохранением занимается UI (а позже сервер).
(function (root) {
  'use strict';
  const PC = root.PC || (root.PC = {});

  const STAT_KEYS = ['str', 'agi', 'vit', 'wis', 'dex', 'luk'];
  const STAT_POINTS_PER_LEVEL = 3;
  const MAX_LEVEL = 20;
  const BACKPACK_SIZE = 30;
  const FISTS = { name: 'Кулаки', type: 'melee', min: 1, max: 2 };
  const CHAR_VERSION = 2;

  const expToNext = (level) => Math.floor(25 * Math.pow(level, 1.5));

  const newUid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const makeItem = (id, rarity = 0, bonus = {}) => ({ uid: newUid(), id, rarity, bonus });

  function addBonus(into, bonus) {
    for (const [k, v] of Object.entries(bonus || {})) into[k] = (into[k] || 0) + v;
    return into;
  }

  function newCharacter(data, { nick, gender, job }) {
    const j = data.jobs[job];
    const char = {
      version: CHAR_VERSION, nick, gender, job,
      level: 1, exp: 0, statPoints: 0,
      stats: { ...j.stats },
      equipment: {},
      backpack: [],
      potions: { hp_potion: 0, mp_potion: 0, ...j.potions },
      gold: 20,
      location: data.HOME, transit: null,
      wins: 0, losses: 0,
    };
    for (const id of j.gear) char.equipment[data.items[id].slot] = makeItem(id);
    return char;
  }

  // Сохранения старых версий прототипа дополняются недостающими полями
  function migrate(data, char) {
    if (!char) return char;
    if ((char.version || 1) < 2) {
      char.gold = char.gold || 0;
      char.location = data.HOME;
      char.transit = null;
    }
    char.version = CHAR_VERSION;
    return char;
  }

  // Базовые свойства предмета + случайные прибавки + заточка конкретного экземпляра.
  // Заточка: оружию +1 к урону (посоху и к силе заклинаний), остальному +1% защиты за уровень.
  function itemProps(data, item) {
    const base = data.items[item.id];
    const p = { ...base, bonus: addBonus(addBonus({}, base.bonus), item.bonus) };
    const up = item.upgrade || 0;
    if (up) {
      if (p.slot === 'weapon') {
        p.min += up; p.max += up;
        if (p.wtype === 'staff') p.mdmg = (p.mdmg || 0) + up;
      } else {
        p.def = (p.def || 0) + up;
      }
    }
    return p;
  }

  function equipped(data, char) {
    return Object.values(char.equipment).filter(Boolean).map((it) => itemProps(data, it));
  }

  function bonusStats(data, char) {
    const sum = {};
    for (const p of equipped(data, char)) addBonus(sum, p.bonus);
    return sum;
  }

  function totalStats(data, char) {
    const bonus = bonusStats(data, char);
    const st = {};
    for (const k of STAT_KEYS) st[k] = char.stats[k] + (bonus[k] || 0);
    return st;
  }

  const usesMana = (char) => char.job === 'mage';

  // Всё, что нужно бою: итоговые статы, оружие, защита. Мягкая защита — от живучести, твёрдая (в %) — от вещей.
  function derived(data, char) {
    const st = totalStats(data, char);
    const items = equipped(data, char);
    const sum = (k) => items.reduce((s, p) => s + (p[k] || 0), 0);
    const w = char.equipment.weapon && itemProps(data, char.equipment.weapon);
    const sh = char.equipment.shield && itemProps(data, char.equipment.shield);
    return {
      stats: st,
      weapon: w ? { name: w.name, type: w.wtype, min: w.min, max: w.max } : { ...FISTS },
      shield: !!sh,
      block: sh ? sh.block + st.vit : undefined, // без щита движок берёт базовые 6%, с луком — 0
      softDef: Math.floor(st.vit / 2) + sum('soft'),
      hardDef: sum('def'),
      softMdef: Math.floor(st.wis / 2),
      hardMdef: sum('mdef'),
      mdmg: sum('mdmg'),
      maxHp: 20 + char.level * 3 + st.vit * 3,
      maxMana: usesMana(char) ? 5 + st.wis * 3 : 0,
    };
  }

  function unlockedSkills(data, char) {
    return Object.entries(data.jobs[char.job].unlocks)
      .filter(([, lvl]) => lvl <= char.level)
      .sort((a, b) => a[1] - b[1])
      .map(([id]) => id);
  }

  // Шаблон бойца для движка боя
  function toFighter(data, char) {
    const d = derived(data, char);
    return {
      name: char.nick, gender: char.gender, level: char.level,
      stats: d.stats, weapon: d.weapon, shield: d.shield, block: d.block,
      softDef: d.softDef, hardDef: d.hardDef, softMdef: d.softMdef, hardMdef: d.hardMdef, mdmg: d.mdmg,
      hp: d.maxHp, mana: d.maxMana,
      skills: unlockedSkills(data, char),
      consumables: Object.entries(char.potions)
        .filter(([id]) => usesMana(char) || !data.consumables[id].mana)
        .map(([id, count]) => ({ id, count })),
    };
  }

  // ---------- Характеристики ----------

  function allocate(char, alloc) {
    const total = STAT_KEYS.reduce((s, k) => s + (alloc[k] || 0), 0);
    if (total <= 0 || total > char.statPoints) return false;
    for (const k of STAT_KEYS) char.stats[k] += alloc[k] || 0;
    char.statPoints -= total;
    return true;
  }

  // ---------- Экипировка ----------

  function canEquip(data, char, item) {
    const p = data.items[item.id];
    if (p.level > char.level) return { ok: false, reason: `Нужен ${p.level} уровень` };
    if (p.jobs && !p.jobs.includes(char.job)) {
      return { ok: false, reason: `Только для: ${p.jobs.map((j) => data.jobs[j].title.toLowerCase()).join(', ')}` };
    }
    const w = char.equipment.weapon && data.items[char.equipment.weapon.id];
    if (p.slot === 'shield' && w && w.twoHanded) return { ok: false, reason: 'Нельзя со двуручным оружием' };
    return { ok: true };
  }

  function equip(data, char, uid) {
    const idx = char.backpack.findIndex((it) => it.uid === uid);
    if (idx < 0) return { ok: false, reason: 'Предмета нет в рюкзаке' };
    const item = char.backpack[idx];
    const check = canEquip(data, char, item);
    if (!check.ok) return check;
    const p = data.items[item.id];
    char.backpack.splice(idx, 1);
    if (char.equipment[p.slot]) char.backpack.push(char.equipment[p.slot]);
    if (p.twoHanded && char.equipment.shield) {
      char.backpack.push(char.equipment.shield);
      delete char.equipment.shield;
    }
    char.equipment[p.slot] = item;
    return { ok: true };
  }

  function unequip(char, slot) {
    if (!char.equipment[slot]) return { ok: false };
    if (char.backpack.length >= BACKPACK_SIZE) return { ok: false, reason: 'Рюкзак полон' };
    char.backpack.push(char.equipment[slot]);
    delete char.equipment[slot];
    return { ok: true };
  }

  function discard(char, uid) {
    const idx = char.backpack.findIndex((it) => it.uid === uid);
    if (idx >= 0) char.backpack.splice(idx, 1);
    return idx >= 0;
  }

  // Строки описания предмета для интерфейса
  function itemLines(data, item) {
    const p = itemProps(data, item);
    const lines = [];
    if (p.slot === 'weapon') lines.push(`Урон ${p.min}–${p.max}`);
    if (p.block) lines.push(`Шанс блока +${p.block}%`);
    if (p.def) lines.push(`Защита +${p.def}%`);
    if (p.soft) lines.push(`Защита +${p.soft}`);
    if (p.mdef) lines.push(`Магическая защита +${p.mdef}%`);
    if (p.mdmg) lines.push(`Сила заклинаний +${p.mdmg}`);
    for (const k of STAT_KEYS) if (p.bonus[k]) lines.push(`${data.stats[k].name} +${p.bonus[k]}`);
    if (p.twoHanded) lines.push('Двуручное');
    return lines;
  }

  // ---------- Опыт ----------

  // Монстры сильно ниже уровня почти не дают опыта, выше — дают больше
  function expMultiplier(charLevel, monLevel) {
    const diff = charLevel - monLevel;
    if (diff <= 0) return Math.min(1.5, 1 + 0.1 * -diff);
    if (diff <= 2) return 1;
    return Math.max(0.1, 1 - 0.3 * (diff - 2));
  }

  function grantExp(data, char, amount) {
    const levelsUp = [];
    char.exp += amount;
    while (char.level < MAX_LEVEL && char.exp >= expToNext(char.level)) {
      char.exp -= expToNext(char.level);
      char.level++;
      char.statPoints += STAT_POINTS_PER_LEVEL;
      levelsUp.push(char.level);
    }
    if (char.level >= MAX_LEVEL) char.exp = 0;
    const unlocks = data.jobs[char.job].unlocks;
    const newSkills = Object.keys(unlocks).filter((id) => levelsUp.includes(unlocks[id]));
    return { levelsUp, newSkills };
  }

  // ---------- Добыча ----------

  function rollItem(data, id, rng) {
    let roll = rng.next() * 100;
    let rarity = 0;
    for (let i = 0; i < data.rarities.length; i++) {
      roll -= data.rarities[i].chance;
      if (roll < 0) { rarity = i; break; }
    }
    const bonus = {};
    const pool = [...STAT_KEYS];
    for (let i = 0; i < data.rarities[rarity].bonuses; i++) {
      const k = pool.splice(Math.floor(rng.next() * pool.length), 1)[0];
      bonus[k] = rng.int(1, 2);
    }
    return makeItem(id, rarity, bonus);
  }

  function rollLoot(data, monster, rng) {
    const drops = [];
    for (const [id, chance] of monster.drops || []) {
      if (!rng.chance(chance)) continue;
      if (data.consumables[id]) drops.push({ kind: 'potion', id, count: 1 });
      else drops.push({ kind: 'item', item: rollItem(data, id, rng) });
    }
    return drops;
  }

  // Итог боя: возвращает выпитые зелья, начисляет опыт, золото и добычу. Возвращает сводку для экрана результата.
  // Поражение (не бегство) отправляет персонажа в деревню и стоит части золота.
  function applyBattleResult(data, char, battle, monsterId, rng, { fled = false } = {}) {
    for (const c of battle.player.consumables) char.potions[c.id] = c.count;
    const win = battle.winner === battle.player;
    const summary = { win, fled, exp: 0, gold: 0, goldLost: 0, sentHome: false, levelsUp: [], newSkills: [], loot: [], lost: [] };
    if (!win) {
      char.losses++;
      if (!fled) {
        summary.goldLost = Math.floor((char.gold || 0) * (data.DEATH_GOLD_LOSS || 0));
        char.gold -= summary.goldLost;
        if (data.HOME && char.location !== data.HOME) {
          char.location = data.HOME;
          char.transit = null;
          summary.sentHome = true;
        }
      }
      return summary;
    }
    char.wins++;

    const monster = data.monsters[monsterId];
    summary.exp = Math.max(1, Math.round(monster.exp * expMultiplier(char.level, monster.level)));
    Object.assign(summary, grantExp(data, char, summary.exp));
    if (monster.gold) {
      summary.gold = rng.int(monster.gold[0], monster.gold[1]);
      char.gold = (char.gold || 0) + summary.gold;
    }

    for (const d of rollLoot(data, monster, rng)) {
      if (d.kind === 'potion') {
        char.potions[d.id] = (char.potions[d.id] || 0) + d.count;
        summary.loot.push(d);
      } else if (char.backpack.length < BACKPACK_SIZE) {
        char.backpack.push(d.item);
        summary.loot.push(d);
      } else {
        summary.lost.push(d);
      }
    }
    return summary;
  }

  PC.progression = {
    STAT_KEYS, STAT_POINTS_PER_LEVEL, MAX_LEVEL, BACKPACK_SIZE, CHAR_VERSION,
    expToNext, expMultiplier, newCharacter, migrate, makeItem, itemProps, itemLines,
    bonusStats, totalStats, derived, unlockedSkills, toFighter,
    allocate, canEquip, equip, unequip, discard,
    grantExp, rollLoot, applyBattleResult,
  };
  if (typeof module !== 'undefined') module.exports = PC;
})(typeof window !== 'undefined' ? window : globalThis);
