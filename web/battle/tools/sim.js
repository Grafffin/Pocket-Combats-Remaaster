// Проверка баланса: node web/battle/tools/sim.js [боёв] [--career] [--rarity=2] [--enhance=3] [--armor=plate] [--log]
// По умолчанию — таблица: персонаж каждого класса на уровне монстра с типичной экипировкой зоны
// (редкость --rarity, заточка --enhance) против каждого монстра каждой зоны.
// --career — «прохождение» с нуля: бот охотится в подходящей зоне, надевает лучшее, точит, раскидывает очки.
// Бот в бою жмёт первое готовое умение по порядку ячеек и пьёт зелье при здоровье ниже 35%.
const path = require('path');
const js = (f) => require(path.join(__dirname, '../js', f));
['data.js', 'classes.js', 'stats.js', 'items-data.js', 'monsters.js', 'world-data.js',
  'engine.js', 'items.js', 'progression.js', 'economy.js', 'world.js'].forEach(js);
const PC = globalThis.PC;
const { data, Battle, progression: P, items: I, makeRng } = PC;

const args = process.argv.slice(2);
const N = Number(args.find((a) => /^\d+$/.test(a))) || 200;
const opt = (k, d) => { const a = args.find((x) => x.startsWith(`--${k}=`)); return a ? Number(a.split('=')[1]) : d; };
const career = args.includes('--career');
const showLog = args.includes('--log');
const RARITY = opt('rarity', 2);
const ENHANCE = opt('enhance', 3);

function fight(char, monsterId, level, seed) {
  const b = new Battle({ player: P.toFighter(data, char), monster: PC.monsters.monsterAt(monsterId, level), seed, data });
  const p = b.player;
  while (!b.ended && b.turn < 60) {
    const pot = p.consumables.find((c) => c.id.startsWith('hp_potion') && c.count > 0);
    if (pot && p.hp / p.maxHp < 0.35) b.useConsumable(p, pot.id);
    b.submit(b.autoAction(p));
  }
  return b;
}

function autoBuild(char) {
  const cls = data.classes[char.job];
  let i = 0;
  while (char.statPoints > 0) { char.stats[cls.auto[i++ % cls.auto.length]]++; char.statPoints--; }
  const actives = P.classSkills(data, char.job).filter((s) => s.unlock <= char.level);
  const passives = P.classPassives(data, char.job).slice(0, 4);
  for (const s of actives) if (!char.skills[s.id] && char.skillPoints > 0) P.learnSkill(data, char, s.id);
  let k = 0;
  while (char.skillPoints > 0 && k < 200) {
    const pool = [...actives.slice(-2).map((s) => ['s', s.id]), ...passives.map((p) => ['p', p.id])];
    const [kind, id] = pool[k++ % pool.length];
    if (kind === 's') P.learnSkill(data, char, id); else P.learnPassive(data, char, id);
  }
  P.setSlots(data, char, actives.slice(-4).reverse().map((s) => s.id));
}

// Первая база в каждый слот для класса на уровне L; броня — первая вариация «своего» материала (--armor=chitin — другого)
const ARMOR = (args.find((a) => a.startsWith('--armor=')) || '').split('=')[1];
function typicalGear(char, rng) {
  const tier = I.maxTierFor(data, char.level);
  const mat = ARMOR || data.classes[char.job].armor;
  char.equipment = {};
  for (const slot of Object.keys(data.slots)) {
    const kind = data.slots[slot].kind;
    const all = I.typesFor(data, kind, char.job);
    const types = all.some((t) => t.armor) ? all.filter((t) => t.armor === mat) : all;
    if (!types.length) continue;
    const w = char.equipment.weapon && data.types[char.equipment.weapon.type];
    if (kind === 'offhand' && w && w.twoHanded) continue;
    const item = I.generate(data, { ilvl: char.level, tier, type: types[0].id, cls: char.job, rarityFloor: RARITY }, rng);
    while (item.affixes.length > data.rarities[RARITY].affixes) item.affixes.pop();
    item.rarity = RARITY; item.legendary = []; item.quality = 50; item.enhance = Math.min(ENHANCE, 5);
    char.equipment[slot] = item;
  }
}

function charAt(job, L, rng) {
  const c = P.newCharacter(data, { nick: 'Тест', gender: 'm', job });
  c.level = L;
  c.statPoints = (L - 1) * P.STAT_POINTS_PER_LEVEL;
  c.skillPoints += (L - 1) * P.SKILL_POINTS_PER_LEVEL;
  autoBuild(c);
  typicalGear(c, rng);
  I.matTake(data, c, 'hp_potion_1', I.matCount(data, c, 'hp_potion_1'));
  I.matAdd(data, c, 'hp_potion_1', 3);
  return c;
}

if (!career) {
  const rows = [];
  for (const [zoneId, zone] of Object.entries(data.locations)) {
    if (zone.safe) continue;
    const entries = [...zone.monsters, ...(zone.boss ? [[zone.boss[0], zone.boss[1], zone.boss[1]]] : [])];
    for (const [monId, lo, hi] of entries) {
      const L = Math.round((lo + hi) / 2);
      const row = { zone: zoneId, monster: `${monId} ${L}` };
      for (const job of Object.keys(data.classes)) {
        // Экипировка зависит только от класса и уровня: новые монстры не меняют удачу свойств в других строках
        const c = charAt(job, Math.min(L, P.MAX_LEVEL), makeRng(1000 + L * 7 + Object.keys(data.classes).indexOf(job)));
        let wins = 0, turns = 0, hpLeft = 0;
        for (let i = 0; i < N; i++) {
          const b = fight(c, monId, L, i + 1);
          if (b.winner === b.player) { wins++; hpLeft += b.player.hp / b.player.maxHp; }
          turns += b.turn;
          if (showLog && i === 0) console.log(b.log.map((l) => l.text.replace(/<[^>]+>/g, '')).join('\n'), '\n');
        }
        row[job] = `${Math.round(wins / N * 100)}% ${(turns / N).toFixed(1)}х ${wins ? Math.round(hpLeft / wins * 100) : 0}♥`;
      }
      rows.push(row);
    }
  }
  console.log(`Экипировка: редкость ${data.rarities[RARITY].name}, заточка +${Math.min(ENHANCE, 5)}. Ячейка: победы, ходов, остаток здоровья`);
  console.table(rows);
} else {
  // Прохождение: зона с монстрами не выше уровня+1, при двух поражениях подряд — зона ниже
  const rng = makeRng(42);
  const rows = [];
  for (const job of Object.keys(data.classes)) {
    const c = P.newCharacter(data, { nick: 'Тест', gender: 'm', job });
    const zones = Object.entries(data.locations).filter(([, z]) => !z.safe);
    let battles = 0, streak = 0, penalty = 0;
    const levelAt = {};
    while (c.level < 30 && battles < 6000) {
      const ok = zones.filter(([, z]) => z.levels[0] <= c.level + 1);
      const [zoneId, zone] = ok[Math.max(0, ok.length - 1 - penalty)];
      c.location = zoneId;
      // Босс необязателен: бот идёт на него, только если дорос до его уровня
      const bossOk = zone.boss && (c.zoneKills[zoneId] || 0) >= data.BOSS_KILLS && c.level >= zone.boss[1] - 1 && rng.chance(30);
      const entry = bossOk ? [zone.boss[0], zone.boss[1], zone.boss[1]] : rng.pick(zone.monsters);
      const level = rng.int(entry[1], entry[2]);
      const b = fight(c, entry[0], level, rng.int(1, 1e9));
      const res = P.applyBattleResult(data, c, b, { monsterId: entry[0], level }, rng);
      battles++;
      streak = res.win ? 0 : streak + 1;
      if (streak >= 2) { penalty = Math.min(penalty + 1, ok.length - 1); streak = 0; } else if (res.win && penalty && rng.chance(10)) penalty--;
      // Надеваем то, что поднимает боевую оценку героя (как окно сравнения вещей), остальное разбираем; точим до +5
      const rate = (ch) => PC.stats.combatScore(PC.stats.compute(data, ch));
      for (let i = 0; i < c.bag.length; i++) {
        const it = c.bag[i];
        if (!it || it.stack) continue;
        const slot = I.slotsFor(data, it).find((s) => !c.equipment[s]) || I.slotsFor(data, it)[0];
        if (!I.canEquip(data, c, it, slot).ok) continue;
        const trial = { ...c, equipment: { ...c.equipment, [slot]: it } };
        if (data.types[it.type].twoHanded) delete trial.equipment.offhand;
        if (rate(trial) > rate(c)) I.equip(data, c, i, slot);
      }
      for (const it of [...c.bag]) if (it && !it.stack) I.salvage(data, c, it.uid, rng);
      // Ресурсы ковки бот не тратит: сдаёт скупщику, чтобы сумка не забивалась стаками разных тиров
      for (const it of c.bag) if (it && it.stack && data.materials[it.stack].family) PC.economy.sellMaterial(data, c, it.stack, it.count);
      for (const it of Object.values(c.equipment)) {
        const info = I.enhanceInfo(data, it);
        if (!info.capped && !info.maxed && info.next <= 5 && I.matCount(data, c, 'stone1') > 0 && c.gold > info.gold + 100) I.enhance(data, c, it.uid, {}, rng);
      }
      while (I.matCount(data, c, 'hp_potion_1') < 4 && c.gold > 100 && PC.economy.buy(data, c, 'hp_potion_1').ok);
      autoBuild(c);
      for (const L of [5, 10, 15, 20, 25, 30]) if (c.level >= L && !levelAt[L]) levelAt[L] = battles;
    }
    rows.push({ job, ...Object.fromEntries(Object.entries(levelAt).map(([k, v]) => [`ур.${k}`, v])), 'поражений': `${Math.round(c.losses / battles * 100)}%`, золото: c.gold });
  }
  console.log('Боёв до уровня:');
  console.table(rows);
}
