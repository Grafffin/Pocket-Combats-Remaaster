// Сравнение экипировки: «идеальный» герой против героя со случайной экипировкой того же качества.
// node web/battle/tools/compare.js [боёв]
//
// Оба героя: уровень босса, все 10 слотов — тир T7, «Древние», качество 100%, заточка +15, ранг ★5,
// одинаковые очки характеристик, умений и пассивок. Различаются только базы, свойства и легендарки:
//  • идеальный — лучшая база класса, 5 лучших для класса свойств (4 + 1 за веху +10) в тире T7 с максимальным
//    значением, все полезные легендарные свойства разложены по вещам, 6+ вещей со знаком «Справедливость»;
//  • случайный — случайные базы класса, случайные свойства (как у древних: верхняя половина диапазона),
//    вехи заточки (+5 — тир одного свойства, +10 — ещё одно свойство, +15 — все свойства +1 тир), случайные легендарки и знаки.
// Зелий нет — меряем только экипировку.
const path = require('path');
['data.js', 'classes.js', 'stats.js', 'items-data.js', 'monsters.js', 'world-data.js',
  'engine.js', 'items.js', 'progression.js', 'economy.js', 'world.js'].forEach((f) => require(path.join(__dirname, '../js', f)));
const PC = globalThis.PC;
const { data, Battle, progression: P, items: I, stats: S, makeRng } = PC;
const N = Number(process.argv[2]) || 60;

// Лучшая база в каждый вид слота для класса
const BEST_BASE = {
  warrior: { weapon: 'axe', offhand: 'shield' },
  berserker: { weapon: 'greataxe' },
  hunter: { weapon: 'bow' },
  mage: { weapon: 'wand', offhand: 'orb' },
};
// Приоритет свойств для класса (сверху — ценнее)
const PRIORITY = {
  phys: ['atkPct', 'dmgPct', 'critDmg', 'crit', 'skillDmg', 'allSkills', 'str', 'lifesteal', 'atk', 'hpPct', 'speed', 'defPct', 'vit', 'hp', 'block', 'dmgReduce', 'def'],
  hunter: ['atkPct', 'dmgPct', 'critDmg', 'crit', 'skillDmg', 'allSkills', 'agi', 'atk', 'speed', 'lifesteal', 'hpPct', 'acc', 'eva', 'vit', 'hp'],
  mage: ['matkPct', 'dmgPct', 'critDmg', 'crit', 'skillDmg', 'allSkills', 'int', 'matk', 'mpRegen', 'hpPct', 'mdefPct', 'vit', 'hp', 'cdr', 'mp'],
};
const prioFor = (job) => (job === 'mage' ? PRIORITY.mage : job === 'hunter' ? PRIORITY.hunter : PRIORITY.phys);
// Главное атакующее умение класса — для «+% урона умения»
const MAIN_SKILL = { warrior: 'execute', berserker: 'bloodbath', hunter: 'deadeye', mage: 'meteor' };
const USEFUL_LEGENDS = Object.keys(data.legendaries).filter((id) => id !== 'goldFever');

function baseChar(job, level) {
  const c = P.newCharacter(data, { nick: 'Тест', gender: 'm', job });
  c.level = level;
  c.statPoints = (level - 1) * P.STAT_POINTS_PER_LEVEL;
  c.skillPoints += (level - 1) * P.SKILL_POINTS_PER_LEVEL;
  const cls = data.classes[job];
  let i = 0;
  while (c.statPoints > 0) { c.stats[cls.auto[i++ % cls.auto.length]]++; c.statPoints--; }
  const actives = P.classSkills(data, job).filter((s) => s.unlock <= level);
  for (const s of actives) if (!c.skills[s.id]) P.learnSkill(data, c, s.id);
  const passives = P.classPassives(data, job);
  let k = 0;
  while (c.skillPoints > 0 && k < 500) {
    const pool = [...actives.slice(-3).map((s) => ['s', s.id]), ...passives.map((p) => ['p', p.id])];
    const [kind, id] = pool[k++ % pool.length];
    if (kind === 's') P.learnSkill(data, c, id); else P.learnPassive(data, c, id);
  }
  P.setSlots(data, c, actives.slice(-4).reverse().map((s) => s.id));
  c.materials = {};
  c.equipment = {};
  return c;
}

function slotList(job) {
  const cls = data.classes[job];
  const base = BEST_BASE[job];
  const twoHanded = data.types[base.weapon].twoHanded;
  return Object.keys(data.slots).filter((s) => s !== 'offhand' || (cls.offhand.length && !twoHanded));
}

const finish = (item) => Object.assign(item, { quality: 100, enhance: 15, rank: 5 });

function perfectGear(c, rng) {
  const job = c.job;
  const prio = prioFor(job);
  const legends = [...USEFUL_LEGENDS];
  let virtueCount = 0;
  for (const slot of slotList(job)) {
    const kind = data.slots[slot].kind;
    const typeId = BEST_BASE[job][kind] || I.typesFor(data, kind, job)[0].id;
    const item = finish(I.generate(data, { ilvl: c.level, tier: I.maxTierFor(data, c.level), type: typeId, cls: job, rarityFloor: 6 }, rng));
    const type = data.types[typeId];
    const pool = Object.values(data.affixes).filter((a) => a.slots.includes(type.kind) && (!a.cls || a.cls.includes(job)));
    pool.sort((a, b) => (prio.indexOf(a.id) < 0 ? 99 : prio.indexOf(a.id)) - (prio.indexOf(b.id) < 0 ? 99 : prio.indexOf(b.id)));
    item.affixes = pool.slice(0, 5).map((a) => ({ id: a.id, tier: I.maxTierFor(data, c.level), roll: 1, lvl: c.level, ...(a.param ? { param: MAIN_SKILL[job] } : {}) }));
    item.legendary = legends.splice(0, 2);
    if (!item.legendary.length) item.legendary = ['execute', 'berserkBlood'];
    item.virtue = 'justice';
    virtueCount++;
    c.equipment[slot] = item;
  }
  return virtueCount;
}

function randomGear(c, rng) {
  const job = c.job;
  const cls = data.classes[job];
  for (const slot of Object.keys(data.slots)) {
    const kind = data.slots[slot].kind;
    const w = c.equipment.weapon && data.types[c.equipment.weapon.type];
    if (kind === 'offhand' && (!cls.offhand.length || (w && w.twoHanded))) continue;
    const typeId = rng.pick(I.typesFor(data, kind, job)).id;
    const item = finish(I.generate(data, { ilvl: c.level, tier: I.maxTierFor(data, c.level), type: typeId, cls: job, rarityFloor: 6 }, rng));
    // вехи заточки: +5 — тир одного свойства, +10 — ещё одно свойство, +15 — все +1 тир
    const cap = I.maxTierFor(data, c.level);
    if (item.affixes.length) { const af = rng.pick(item.affixes); af.tier = Math.min(cap, af.tier + 1); }
    addAffix(item, rng);
    item.affixes.forEach((af) => { af.tier = Math.min(cap, af.tier + 1); });
    item.virtue = rng.pick(Object.keys(data.virtues));
    c.equipment[slot] = item;
    if (kind === 'weapon' && data.types[typeId].twoHanded) delete c.equipment.offhand;
  }
}

// Добавить свойство как веха +10 (используем тот же генератор, что и игра)
function addAffix(item, rng) {
  const tmp = I.generate(data, { ilvl: item.ilvl, tier: item.tier, type: item.type, cls: item.cls, rarityFloor: 6 }, rng);
  const fresh = tmp.affixes.find((a) => !item.affixes.some((b) => b.id === a.id));
  if (fresh) item.affixes.push(fresh);
}

// k — во сколько раз усилен босс (здоровье и атака)
function fight(c, monId, level, seed, k = 1) {
  const mon = PC.monsters.monsterAt(monId, level);
  mon.stats.maxHp = Math.round(mon.stats.maxHp * k);
  for (const key of ['atk', 'matk', 'weaponMax']) mon.stats[key] = Math.round(mon.stats[key] * k);
  const b = new Battle({ player: P.toFighter(data, c), monster: mon, seed, data });
  while (!b.ended && b.turn < 80) b.submit(b.autoAction(b.player));
  return b;
}

function sheet(c) {
  const s = S.compute(data, c);
  const f = PC.fmtBig;
  const power = Object.values(c.equipment).filter(Boolean).reduce((x, it) => x + I.power(data, it), 0);
  return { HP: f(s.maxHp), Атака: f(s.caster ? s.matk : s.atk), Крит: `${Math.round(s.crit)}%`, 'Крит.урон': `${Math.round(s.critDmg)}%`,
    Защита: f(s.def), Скорость: s.speed, Вампиризм: `${Math.round(s.lifesteal)}%`, Сила: power, Оценка: f(S.combatScore(s)), Легендарки: s.legendary.length };
}

// Множитель силы босса, при котором герой побеждает в половине боёв (двоичный поиск по логарифму)
function breakpoint(builds, boss, level) {
  const winRate = (k) => {
    let w = 0;
    for (let i = 0; i < N; i++) {
      const b = fight(builds[i % builds.length], boss, level, 7 + i, k);
      if (b.winner === b.player) w++;
    }
    return w / N;
  };
  let lo = 0.25, hi = 1;
  while (winRate(hi) >= 0.5 && hi < 4096) { lo = hi; hi *= 2; }
  for (let s = 0; s < 7; s++) { const mid = Math.sqrt(lo * hi); if (winRate(mid) >= 0.5) lo = mid; else hi = mid; }
  return lo;
}

const BOSSES = [['lich', 36], ['troll_elder', 28], ['ancient_spirit', 11]];
const rows = [];
const sheets = [];
for (const [boss, level] of BOSSES) {
  for (const job of Object.keys(data.classes)) {
    const perfect = baseChar(job, level);
    perfectGear(perfect, makeRng(1));
    const randoms = Array.from({ length: 6 }, (_, i) => { const c = baseChar(job, level); randomGear(c, makeRng(100 + i)); return c; });
    if (boss === 'lich') {
      sheets.push({ класс: job, набор: 'идеальный', ...sheet(perfect) });
      sheets.push({ класс: job, набор: 'случайный', ...sheet(randoms[0]) });
    }
    const kp = breakpoint([perfect], boss, level);
    const kr = breakpoint(randoms, boss, level);
    // Самая высокая сложность зоны, на которой герой ещё побеждает в половине боёв
    const maxDiff = (k) => data.difficulties.filter((d) => d.mult <= k).pop().name;
    rows.push({ босс: `${data.monsters[boss].name} (${level})`, класс: job, 'идеальный ×': `${kp.toFixed(1)} · ${maxDiff(kp)}`, 'случайный ×': `${kr.toFixed(1)} · ${maxDiff(kr)}`, разница: `в ${(kp / kr).toFixed(1)} раза` });
  }
}
console.log('Характеристики (Лич, уровень 36; тир вещей по уровню героя):');
console.table(sheets);
console.log('Во сколько раз можно усилить босса (здоровье и атаку), чтобы герой побеждал в половине боёв, и какая это сложность зоны:');
console.table(rows);
