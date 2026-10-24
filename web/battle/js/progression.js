// Прогрессия персонажа: опыт и уровни, очки характеристик и умений, ячейки умений, добыча с монстров.
// Без DOM и без хранилища: персонаж — обычный JSON-объект, сохранением занимается UI (а позже сервер).
(function (root) {
  'use strict';
  const PC = root.PC || (root.PC = {});
  const I = () => PC.items;

  const CHAR_VERSION = 8;
  const STAT_POINTS_PER_LEVEL = 3;
  const SKILL_POINTS_PER_LEVEL = 1;
  const MAX_LEVEL = 40;

  // Опыт до следующего уровня: плавно до 20, дальше каждый уровень дороже предыдущего на 14% сверху
  const expToNext = (level) => Math.round((62 * Math.pow(level, 1.75) + 30) * Math.pow(1.14, Math.max(0, level - 19)));

  function newCharacter(data, { nick, gender, job }) {
    const cls = data.classes[job];
    const char = {
      version: CHAR_VERSION, nick, gender, job,
      level: 1, exp: 0, statPoints: 0, skillPoints: 1,
      stats: { ...cls.stats },
      skills: {}, slots: [], passives: {},
      equipment: {},
      bag: new Array(I().BAG_SIZE).fill(null),
      materials: {},
      gold: 50,
      location: data.HOME, transit: null,
      zoneKills: {}, maxTier: 1,
      world: {}, restTick: 0, buffs: {},
      settings: { autoSalvage: -1, autoBattle: false, autoHunt: false, potionAt: 35 },
      wins: 0, losses: 0,
    };
    I().matAdd(data, char, 'stone1', 3);
    I().matAdd(data, char, 'hp_potion_1', 5);
    I().matAdd(data, char, 'mp_potion_1', 2);
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

  // Версии до 3 несовместимы с системой предметов — начинаем заново. 3 → 4: зелья трёх размеров, тик мира.
  function migrate(data, char) {
    if (!char || (char.version || 1) < 3) return null;
    if (char.version === 3) {
      const m = char.materials;
      m.hp_potion_1 = (m.hp_potion_1 || 0) + (m.hp_potion || 0);
      m.mp_potion_1 = (m.mp_potion_1 || 0) + (m.mp_potion || 0);
      delete m.hp_potion; delete m.mp_potion;
      char.world = {}; char.restTick = 0; char.buffs = {};
      char.settings = { autoSalvage: char.settings.autoSalvage ?? -1, autoBattle: !!char.settings.autoBattle, autoHunt: false, potionAt: 35 };
      char.version = 4;
    }
    if (char.version === 4) {
      fixAffixLevels(char.bag);
      fixAffixLevels(Object.values(char.equipment));
      char.version = 5;
    }
    if (char.version === 5) {
      // Сложность стала общей: открытая — по последней зоне
      const fz = Object.keys(data.locations).find((id) => data.locations[id].final);
      char.diffUnlocked = (char.zoneDiff && char.zoneDiff[fz]) || 0;
      char.difficulty = 0;
      delete char.zoneDiff; delete char.diff;
      char.version = 6;
    }
    if (char.version === 6) {
      // Ресурсы, кроме кузнечных, переезжают стаками в сумку; что не влезло — остаётся в materials и тратится первым
      for (const id of Object.keys(char.materials)) {
        if (!data.materials[id] || !(char.materials[id] > 0)) continue;
        char.materials[id] -= I().matAdd(data, char, id, char.materials[id]);
        if (!char.materials[id]) delete char.materials[id];
      }
      char.version = 7;
    }
    if (char.version === 7) {
      // Теперь в сумку идут все ресурсы, включая кузнечные: остаток, не влезший, лежит в materials
      for (const id of Object.keys(char.materials)) {
        if (!data.materials[id] || !(char.materials[id] > 0)) continue;
        char.materials[id] -= I().matAdd(data, char, id, char.materials[id]);
        if (!char.materials[id]) delete char.materials[id];
      }
      char.version = 8;
    }
    return char;
  }

  // Свойства вещей, созданных до плавного роста чисел, получают уровень своей вещи
  function fixAffixLevels(list) {
    for (const it of list) if (it && it.affixes) for (const af of it.affixes) if (!af.lvl) af.lvl = it.ilvl;
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
      consumables: Object.keys(data.consumables).map((id) => ({ id, count: I().matCount(data, char, id) })).filter((c) => c.count > 0),
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
  const DROP = { item: 32, bossItems: 3, potion: 5, stone1: 8, stone2: 3, essence: 12, main: 35, zoneMat: 45 };

  // Трофеи и ресурсы ковки с монстров намного ниже героя падают редко: их фармят новички, а нужны всем.
  // До 3 уровней разницы — полностью, дальше ×0.7 за уровень, но не меньше 5%.
  const TROPHY = { free: 3, decay: 0.7, min: 0.05 };
  const trophyMult = (charLevel, monLevel) => {
    const diff = charLevel - monLevel - TROPHY.free;
    return diff <= 0 ? 1 : Math.max(TROPHY.min, Math.pow(TROPHY.decay, diff));
  };

  function rollDrops(data, char, monsterId, level, stats, rng, D = 0, k = 1) {
    const m = data.monsters[monsterId];
    const drops = { items: [], materials: {} };
    if (m.ai === 'idle') return drops;
    const addMat = (k, n) => { drops.materials[k] = (drops.materials[k] || 0) + n; };
    const dd = data.difficulties[D] || data.difficulties[0];
    const mf = (stats.mf || 0) + dd.mf;
    // k — доля награды в общем бою (вклад игрока): шансы выпадения растут и падают вместе с ней
    const ch = (p) => rng.chance(Math.min(100, p * k));
    const itemCount = m.boss ? Math.round(DROP.bossItems * k) : (ch(DROP.item * (1 + mf / 200)) ? 1 : 0);
    for (let i = 0; i < itemCount; i++) {
      const cls = rng.chance(80) ? char.job : rng.pick(Object.keys(data.classes));
      drops.items.push(I().generate(data, { ilvl: level + dd.ilvl, cls, mf, boss: m.boss, rarityFloor: m.boss ? 2 : 0 }, rng));
    }
    const tier = I().maxTierFor(data, level);
    // Ресурсы для ковки — только «свои» для монстра (с крысы не падает руда), тира монстра; босс даёт вдвое больше
    const tm = trophyMult(char.level, level);
    if (m.loot && ch(DROP.main * tm)) addMat(data.tierMat(rng.pick(m.loot), tier), rng.int(1, 1 + Math.floor(tier / 2)) * (m.boss ? 2 : 1));
    if (ch(DROP.essence)) addMat('essence', rng.int(1, tier));
    if (ch(DROP.stone1)) addMat('stone1', 1);
    if (tier >= 3 && ch(DROP.stone2)) addMat('stone2', 1);
    if (ch(DROP.potion)) addMat('hp_potion_1', 1);
    const zone = data.locations[char.location];
    if (zone && zone.mats && ch(DROP.zoneMat * tm)) addMat(rng.pick(zone.mats), rng.int(1, 2));
    // Уники: только с «своих» боссов и с нужной сложности; шанс растёт с находкой
    if (m.boss) {
      for (const u of Object.values(data.uniques)) {
        if (u.boss !== monsterId || u.minDiff > D) continue;
        if (ch(data.UNIQUE_CHANCE * (1 + mf / 300))) drops.items.push(I().generateUnique(data, u.id, { ilvl: level + dd.ilvl }, rng));
      }
    }
    if (D && ch(dd.stone3)) addMat('stone3', 1);
    if (D >= 2 && ch(10 + 3 * D)) addMat('protect', 1);
    if (m.boss) { addMat('stone2', 1 + D); if ((tier >= 5 || D) && ch(30 + 8 * D)) addMat('stone3', 1); addMat('reroll', 1 + Math.floor(D / 2)); }
    return drops;
  }

  // Итог боя: возвращает выпитые зелья, начисляет опыт, золото и добычу. Возвращает сводку для экрана результата.
  // Поражение (не бегство) отправляет персонажа в деревню и стоит части золота.
  function applyBattleResult(data, char, battle, fight, rng, { fled = false } = {}) {
    const { monsterId, level } = fight;
    const D = fight.diff || 0;
    const dd = data.difficulties[D] || data.difficulties[0];
    for (const c of battle.player.consumables) { const have = I().matCount(data, char, c.id); if (c.count < have) I().matTake(data, char, c.id, have - c.count); }
    const win = battle.winner === battle.player;
    const summary = { win, fled, exp: 0, gold: 0, goldLost: 0, sentHome: false, levelsUp: [], newSkills: [], items: [], salvaged: [], materials: {} };
    // Износ надетого: понемногу в каждом бою, при поражении (не бегстве) — гарантированно и сильно
    summary.defeatWear = !win && !fled;
    summary.broken = I().wear(data, char, rng, { defeat: summary.defeatWear }).map((it) => I().name(data, it));
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
    // Эликсиры действуют ограниченное число побед
    for (const id of Object.keys(char.buffs || {})) if (--char.buffs[id] <= 0) delete char.buffs[id];
    const m = data.monsters[monsterId];
    const loc = data.locations[char.location];
    if (!loc.safe) {
      char.zoneKills[char.location] = (char.zoneKills[char.location] || 0) + 1;
      if (m.boss) {
        char.zoneKills[char.location] = 0;
        // Победа над последним боссом мира открывает следующую сложность
        if (loc.final && D + 1 < data.difficulties.length && (char.diffUnlocked || 0) < D + 1) {
          char.diffUnlocked = D + 1;
          summary.unlocked = data.difficulties[D + 1].name;
        }
      }
      char.maxTier = Math.max(char.maxTier || 1, loc.tier);
    }

    const k = fight.lootMult == null ? 1 : fight.lootMult;   // доля награды в общем бою пропорциональна вкладу
    if (k <= 0) return summary;
    summary.exp = Math.max(1, Math.round(PC.monsters.rewards.exp(monsterId, level) * expMultiplier(char.level, level) * (1 + (stats.expPct || 0)) * dd.exp * k));
    Object.assign(summary, grantExp(data, char, summary.exp));
    const [g0, g1] = PC.monsters.rewards.gold(monsterId, level);
    summary.gold = Math.round(rng.int(g0, g1) * (1 + (stats.goldPct || 0)) * dd.gold * k);
    char.gold += summary.gold;

    const drops = rollDrops(data, char, monsterId, level, stats, rng, D, k);
    summary.lost = {};
    for (const [k, n] of Object.entries(drops.materials)) {
      const got = I().matAdd(data, char, k, n);
      if (got < n) summary.lost[k] = n - got;   // сумка полна
    }
    summary.materials = drops.materials;
    for (const item of drops.items) {
      const auto = item.rarity <= (char.settings.autoSalvage ?? -1);
      if (!auto && I().bagAdd(char, item) >= 0) { summary.items.push(item); continue; }
      // Автоматический разбор (или сумка полна): ничего не пропадает
      const y = I().salvageYield(data, item);
      for (const [mat, n] of Object.entries(y.sure)) { const d = I().matAdd(data, char, mat, n); if (d < n) summary.lost[mat] = (summary.lost[mat] || 0) + n - d; }
      summary.salvaged.push({ item, full: !auto });
    }
    return summary;
  }

  PC.progression = {
    CHAR_VERSION, STAT_POINTS_PER_LEVEL, SKILL_POINTS_PER_LEVEL, MAX_LEVEL,
    expToNext, expMultiplier, newCharacter, migrate, classSkills, classPassives,
    allocate, learnSkill, learnPassive, setSlots, toFighter, grantExp, rollDrops, applyBattleResult, DROP, TROPHY, trophyMult, fixAffixLevels,
  };
  if (typeof module !== 'undefined') module.exports = PC;
})(typeof window !== 'undefined' ? window : globalThis);
