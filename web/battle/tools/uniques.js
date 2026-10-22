// Проверка уников: «сильные, но не универсальные».
// node web/battle/tools/uniques.js [боёв]
//
// Берём случайные сборки легендарных вещей +10 ★3 на уровне босса уника и заменяем одну вещь
// уником с теми же вложениями. Меряем, во сколько раз можно усилить противника,
// чтобы победы оставались в половине боёв: против «своего» босса и против обычного монстра той же зоны.
const path = require('path');
const { baseChar, randomGear, breakpoint, finish, INVEST } = require('./compare.js');
// Реалистичная поздняя экипировка: легендарные вещи +10 ★3; уник — с теми же вложениями
Object.assign(INVEST, { quality: 100, enhance: 10, rank: 3, rarity: 4 });
const PC = globalThis.PC;
const { data, items: I, makeRng } = PC;

const N = Number(process.argv[2]) || 30;

// Класс, который может надеть уник (для аксессуаров — тот, кому он подходит по смыслу)
const OWNER = {
  boar_fang: 'berserker', boar_hide: 'warrior', thorn_crown: 'mage', world_root: 'warrior', chief_cleaver: 'warrior',
  greed_ring: 'berserker', ataman_bow: 'hunter', bandit_belt: 'hunter', stone_heart: 'berserker', giant_grip: 'warrior',
  phylactery: 'mage', winter_scythe: 'mage',
};

const zoneOf = (bossId) => Object.values(data.locations).find((l) => l.boss && l.boss[0] === bossId);

const rows = [];
const only = process.argv[3];
for (const u of Object.values(data.uniques)) {
  if (only && !u.id.includes(only)) continue;
  const job = OWNER[u.id];
  const zone = zoneOf(u.boss);
  const level = zone.boss[1];
  const mob = zone.monsters[zone.monsters.length - 1];
  const builds = Array.from({ length: 4 }, (_, i) => { const c = baseChar(job, level); randomGear(c, makeRng(200 + i)); return c; });
  const withUnique = builds.map((c, i) => {
    const copy = JSON.parse(JSON.stringify(c));
    const it = finish(I.generateUnique(data, u.id, { ilvl: level }, makeRng(300 + i)));
    const slot = I.slotsFor(data, it).find((s) => s !== 'ring2') || I.slotsFor(data, it)[0];
    copy.equipment[slot] = it;
    if (data.types[it.type].twoHanded) delete copy.equipment.offhand;
    return copy;
  });
  const N0 = N;
  if (u.farm) { rows.push({ уник: u.name, класс: job, босс: 'вещь для фарма: +100% золота, +60% находки', 'обычный монстр': '—', 'лучшее применение': '—' }); continue; }
  const kb0 = breakpoint(builds, u.boss, level, N0), kb1 = breakpoint(withUnique, u.boss, level, N0);
  // «Лучшее применение»: герой и уник — на уровне этого противника (уник как будто добыт на высокой сложности)
  const bestLoc = Object.values(data.locations).find((l) => l.boss && l.boss[0] === u.best) || Object.values(data.locations).find((l) => l.monsters.some((m) => m[0] === u.best));
  const bl = bestLoc.boss && bestLoc.boss[0] === u.best ? bestLoc.boss[1] : bestLoc.monsters.find((m) => m[0] === u.best)[2];
  const bBuilds = Array.from({ length: 4 }, (_, i) => { const c = baseChar(job, Math.max(level, bl)); randomGear(c, makeRng(400 + i)); return c; });
  const bWith = bBuilds.map((c, i) => {
    const copy = JSON.parse(JSON.stringify(c));
    const it = finish(I.generateUnique(data, u.id, { ilvl: Math.max(level, bl) }, makeRng(500 + i)));
    const slot = I.slotsFor(data, it).find((x) => x !== 'ring2') || I.slotsFor(data, it)[0];
    copy.equipment[slot] = it;
    if (data.types[it.type].twoHanded) delete copy.equipment.offhand;
    return copy;
  });
  const bb0 = breakpoint(bBuilds, u.best, bl, N0), bb1 = breakpoint(bWith, u.best, bl, N0);
  const km0 = breakpoint(builds, mob[0], mob[2], N0), km1 = breakpoint(withUnique, mob[0], mob[2], N0);
  const pct = (a, b) => `${b >= a ? '+' : '−'}${Math.abs(Math.round((b / a - 1) * 100))}%`;
  rows.push({ уник: u.name, класс: job, босс: `${data.monsters[u.boss].name}: ${pct(kb0, kb1)}`, 'обычный монстр': `${data.monsters[mob[0]].name}: ${pct(km0, km1)}`, 'лучшее применение': `${data.monsters[u.best].name} (${Math.max(level, bl)} ур.): ${pct(bb0, bb1)}` });
}
console.log('Как меняется сила героя от замены одной вещи на уник (та же заточка и ранг):');
console.table(rows);
