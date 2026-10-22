// Прогрессия персонажа: опыт и уровни, очки характеристик и умений, ячейки умений, добыча с монстров.
// Без DOM и без хранилища: персонаж — обычный JSON-объект, сохранением занимается UI (а позже сервер).
(function (root) {
  'use strict';
  const PC = root.PC || (root.PC = {});
  const I = () => PC.items;

  const CHAR_VERSION = 3;
  const STAT_POINTS_PER_LEVEL = 3;
  const SKILL_POINTS_PER_LEVEL = 1;
  const MAX_LEVEL = 40;

  const expToNext = (level) => Math.round(40 * Math.pow(level, 1.7) + 20);

  function newCharacter(data, { nick, gender, job }) {
    const cls = data.classes[job];
    const char = {
      version: CHAR_VERSION, nick, gender, job,
      level: 1, exp: 0, statPoints: 0, skillPoints: 1,
      stats: { ...cls.stats },
      skills: {}, slots: [], passives: {},
      equipment: {},
      bag: new Array(I().BAG_SIZE).fill(null),
      materials: { hp_potion: 5, mp_potion: 2, stone1: 3 },
      gold: 50,
      location: data.HOME, transit: null,
      zoneKills: {}, maxTier: 1,
      settings: { autoSalvage: -1, timer: false, autoBattle: false, speed: 1 },
      wins: 0, losses: 0,
    };
    // Первое умение класса выучено сразу
    const first = classSkills(data, job).find((s) => s.unlock === 1);
    if (first) { char.skills[first.id] = 1; char.slots = [first.id]; char.skillPoints = 0; }
    // Стартовая экипировка: обычные вещи первого тира
    const rng = PC.makeRng(Date.now());
    for (const typeId of cls.startGear) {
      const item = I().generate(data, { ilvl: 1, tier: 1, type: typeId, cls: job, rarityFloor: 0 }, rng);
      item.rarity = 0; item.affixes = []; item.legendary = []; item.quality = 50;
      const slot = I().slotsFor(data, item)[0];
      char.equipment[slot] = item;
    }
    return char;
  }

  // Сохранения старых версий несовместимы с новой системой предметов — начинаем заново
  function migrate(data, char) {
    if (!char || (char.version || 1) < CHAR_VERSION) return null;
    return char;
  }

  const classSkills = (data, job) => Object.values(data.skills).filter((s) => s.cls === job).sort((a, b) => a.unlock - b.unlock);
  const classPassives = (data, job) => Object.values(data.passives).filter((p) => p.cls === job);

  // ---------- Характеристики, умения, пассивки ----------

  function allocate(char, alloc) {
    const keys = PC.stats.PRIMARY;
    const total = keys.reduce((s, k) => s + (alloc[k] || 0), 0);
    if (total <= 0 || total > char.statPoints) return false;
    for (const k of keys) char.stats[k] += alloc[k] || 0;
    char.statPoints -= total;
    return true;
  }

  function learnSkill(data, char, id) {
    const s = data.skills[id];
    if (!s || s.cls !== char.job) return { ok: false, reason: 'Чужое умение' };
    if (s.unlock > char.level) return { ok: false, reason: `Откроется на ${s.unlock} уровне` };
    if ((char.skills[id] || 0) >= data.SKILL_MAX) return { ok: false, reason: 'Умение на максимуме' };
    if (char.skillPoints < 1) return { ok: false, reason: 'Нет очков умений' };
    char.skillPoints--;
    char.skills[id] = (char.skills[id] || 0) + 1;
    if (char.skills[id] === 1 && char.slots.length < data.SKILL_SLOTS) char.slots.push(id);
    return { ok: true };
  }

  function learnPassive(data, char, id) {
    const p = data.passives[id];
    if (!p || p.cls !== char.job) return { ok: false, reason: 'Чужая пассивка' };
    if ((char.passives[id] || 0) >= p.max) return { ok: false, reason: 'Пассивка на максимуме' };
    if (char.skillPoints < 1) return { ok: false, reason: 'Нет очков умений' };
    char.skillPoints--;
    char.passives[id] = (char.passives[id] || 0) + 1;
    return { ok: true };
  }

  // Ячейки умений: порядок = приоритет автобоя
  function setSlots(data, char, ids) {
    char.slots = ids.filter((id) => char.skills[id]).slice(0, data.SKILL_SLOTS);
  }

  // ---------- Бой ----------

  function toFighter(data, char) {
    const s = PC.stats.compute(data, char);
    const weapon = char.equipment.weapon;
    return {
      name: char.nick, gender: char.gender, art: `classes/${char.job}`,
      stats: s,
      weaponType: weapon ? weapon.type : 'fist',
      skills: char.slots.map((id) => ({ id, lvl: PC.stats.skillLevel(s, char, id) })),
      consumables: ['hp_potion', 'mp_potion'].map((id) => ({ id, count: char.materials[id] || 0 })),
    };
  }

  // ---------- Опыт ----------

  function grantExp(data, char, amount) {
    const levelsUp = [];
    char.exp += amount;
    while (char.level < MAX_LEVEL && char.exp >= expToNext(char.level)) {
      char.exp -= expToNext(char.level);
      char.level++;
      char.statPoints += STAT_POINTS_PER_LEVEL;
      char.skillPoints += SKILL_POINTS_PER_LEVEL;
      levelsUp.push(char.level);
    }
    if (char.level >= MAX_LEVEL) char.exp = 0;
    const newSkills = classSkills(data, char.job).filter((s) => levelsUp.includes(s.unlock)).map((s) => s.id);
    return { levelsUp, newSkills };
  }

  // Монстры сильно ниже уровня почти не дают опыта, выше — дают больше
  function expMultiplier(charLevel, monLevel) {
    const diff = charLevel - monLevel;
    if (diff <= 0) return Math.min(1.5, 1 + 0.1 * -diff);
    if (diff <= 3) return 1;
    return Math.max(0.1, 1 - 0.2 * (diff - 3));
  }

  // ---------- Добыча ----------

  // Шансы выпадения за обычного монстра (босс — гарантированные вещи)
  const DROP = { item: 32, bossItems: 3, potion: 10, stone1: 8, stone2: 3, essence: 12, main: 40 };

  function rollDrops(data, char, monsterId, level, stats, rng) {
    const m = data.monsters[monsterId];
    const drops = { items: [], materials: {} };
    if (m.ai === 'idle') return drops;
    const addMat = (k, n) => { drops.materials[k] = (drops.materials[k] || 0) + n; };
    const mf = stats.mf || 0;
    const itemCount = m.boss ? DROP.bossItems : (rng.chance(DROP.item * (1 + mf / 200)) ? 1 : 0);
    for (let i = 0; i < itemCount; i++) {
      const cls = rng.chance(80) ? char.job : rng.pick(Object.keys(data.classes));
      drops.items.push(I().generate(data, { ilvl: level, cls, mf, boss: m.boss, rarityFloor: m.boss ? 2 : 0 }, rng));
    }
    const tier = I().maxTierFor(data, level);
    if (rng.chance(DROP.main)) addMat(rng.pick(['ore', 'leather']), rng.int(1, 1 + Math.floor(tier / 2)));
    if (rng.chance(DROP.essence)) addMat('essence', rng.int(1, tier));
    if (rng.chance(DROP.stone1)) addMat('stone1', 1);
    if (tier >= 3 && rng.chance(DROP.stone2)) addMat('stone2', 1);
    if (rng.chance(DROP.potion)) addMat('hp_potion', 1);
    if (m.boss) { addMat('stone2', 1); if (tier >= 5 && rng.chance(30)) addMat('stone3', 1); addMat('reroll', 1); }
    return drops;
  }

  // Итог боя: возвращает выпитые зелья, начисляет опыт, золото и добычу. Возвращает сводку для экрана результата.
  // Поражение (не бегство) отправляет персонажа в деревню и стоит части золота.
  function applyBattleResult(data, char, battle, fight, rng, { fled = false } = {}) {
    const { monsterId, level } = fight;
    for (const c of battle.player.consumables) char.materials[c.id] = c.count;
    const win = battle.winner === battle.player;
    const summary = { win, fled, exp: 0, gold: 0, goldLost: 0, sentHome: false, levelsUp: [], newSkills: [], items: [], salvaged: [], materials: {} };
    if (!win) {
      char.losses++;
      if (!fled) {
        summary.goldLost = Math.floor((char.gold || 0) * data.DEATH_GOLD_LOSS);
        char.gold -= summary.goldLost;
        if (char.location !== data.HOME) { char.location = data.HOME; char.transit = null; summary.sentHome = true; }
      }
      return summary;
    }
    char.wins++;
    const stats = PC.stats.compute(data, char);
    const m = data.monsters[monsterId];
    const loc = data.locations[char.location];
    if (!loc.safe) {
      char.zoneKills[char.location] = (char.zoneKills[char.location] || 0) + 1;
      if (m.boss) char.zoneKills[char.location] = 0;
      char.maxTier = Math.max(char.maxTier || 1, loc.tier);
    }

    summary.exp = Math.max(1, Math.round(PC.monsters.rewards.exp(monsterId, level) * expMultiplier(char.level, level) * (1 + (stats.expPct || 0))));
    Object.assign(summary, grantExp(data, char, summary.exp));
    const [g0, g1] = PC.monsters.rewards.gold(monsterId, level);
    summary.gold = Math.round(rng.int(g0, g1) * (1 + (stats.goldPct || 0)));
    char.gold += summary.gold;

    const drops = rollDrops(data, char, monsterId, level, stats, rng);
    for (const [k, n] of Object.entries(drops.materials)) char.materials[k] = (char.materials[k] || 0) + n;
    summary.materials = drops.materials;
    for (const item of drops.items) {
      const auto = item.rarity <= (char.settings.autoSalvage ?? -1);
      if (!auto && I().bagAdd(char, item) >= 0) { summary.items.push(item); continue; }
      // Автоматический разбор (или сумка полна): ничего не пропадает
      const y = I().salvageYield(data, item);
      for (const [mat, n] of Object.entries(y.sure)) char.materials[mat] = (char.materials[mat] || 0) + n;
      summary.salvaged.push({ item, full: !auto });
    }
    return summary;
  }

  PC.progression = {
    CHAR_VERSION, STAT_POINTS_PER_LEVEL, SKILL_POINTS_PER_LEVEL, MAX_LEVEL,
    expToNext, expMultiplier, newCharacter, migrate, classSkills, classPassives,
    allocate, learnSkill, learnPassive, setSlots, toFighter, grantExp, rollDrops, applyBattleResult,
  };
  if (typeof module !== 'undefined') module.exports = PC;
})(typeof window !== 'undefined' ? window : globalThis);
