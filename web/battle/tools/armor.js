// Баланс материалов брони: node web/battle/tools/armor.js [боёв] [--levels=5,10] [--variants] [--acc]
// Каждый класс на уровнях 5, 10 … 35 в полном комплекте брони каждого материала (и каждой вариации с --variants)
// против всех обычных монстров того же уровня и ближайшего босса (того же уровня). Остальная экипировка одинаковая
// (редкая, заточка +3, те же свойства), у брони свойств нет — сравниваются только базы.
// «Физ.» и «Маги» (монстры с оружием и заклинатели): средний остаток здоровья ♥ (поражение = 0) и ходов на бой.
// «Босс»: победы %. Оценка 0–100 — сводная, см. score.
// --acc — пояса, амулеты и кольца: класс в своём материале с каждой вариацией аксессуара.
const path = require('path');
['data.js', 'classes.js', 'stats.js', 'items-data.js', 'monsters.js', 'world-data.js',
  'engine.js', 'items.js', 'progression.js', 'economy.js', 'world.js'].forEach((f) => require(path.join(__dirname, '../js', f)));
const PC = globalThis.PC;
const { data, Battle, progression: P, items: I, makeRng } = PC;

const args = process.argv.slice(2);
const N = Number(args.find((a) => /^\d+$/.test(a))) || 40;
const optStr = (k, d) => { const a = args.find((x) => x.startsWith(`--${k}=`)); return a ? a.split('=')[1] : d; };
const LEVELS = optStr('levels', '5,10,15,20,25,30,35').split(',').map(Number);
const VARIANTS = args.includes('--variants');
const ACC = args.includes('--acc');
const JOBS = Object.keys(data.classes);
const MATS = Object.keys(data.armorMaterials);
const ARMOR = ['head', 'body', 'hands', 'feet'];

// Обычные монстры (без боссов и чучела) и боссы по уровню зоны
const MOBS = Object.keys(data.monsters).filter((id) => !data.monsters[id].boss && data.monsters[id].ai !== 'idle');
const CASTERS = new Set(MOBS.filter((id) => data.monsters[id].caster));
const BOSSES = Object.values(data.locations).filter((z) => z.boss).map((z) => z.boss).sort((a, b) => a[1] - b[1]);
const bossFor = (L) => (BOSSES.find(([, lvl]) => lvl >= L) || BOSSES[BOSSES.length - 1])[0];

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

function baseChar(job, L) {
  const c = P.newCharacter(data, { nick: 'Тест', gender: 'm', job });
  const cls = data.classes[job];
  c.level = L;
  c.statPoints = (L - 1) * P.STAT_POINTS_PER_LEVEL;
  c.skillPoints += (L - 1) * P.SKILL_POINTS_PER_LEVEL;
  let i = 0;
  while (c.statPoints > 0) { c.stats[cls.auto[i++ % cls.auto.length]]++; c.statPoints--; }
  const actives = P.classSkills(data, job).filter((s) => s.unlock <= L);
  const passives = P.classPassives(data, job).slice(0, 4);
  for (const s of actives) if (!c.skills[s.id] && c.skillPoints > 0) P.learnSkill(data, c, s.id);
  let k = 0;
  while (c.skillPoints > 0 && k < 200) {
    const pool = [...actives.slice(-2).map((s) => ['s', s.id]), ...passives.map((p) => ['p', p.id])];
    const [kind, id] = pool[k++ % pool.length];
    if (kind === 's') P.learnSkill(data, c, id); else P.learnPassive(data, c, id);
  }
  P.setSlots(data, c, actives.slice(-4).reverse().map((s) => s.id));
  I.matTake(data, c, 'hp_potion_1', I.matCount(data, c, 'hp_potion_1'));
  I.matAdd(data, c, 'hp_potion_1', 3);
  return c;
}

// Экипировка: armor — { kind: typeId } для брони, acc — { kind: typeId } для аксессуаров; остальное — первая база класса
function equip(c, armor, acc = {}) {
  const tier = I.maxTierFor(data, c.level);
  const rng = makeRng(1000 + c.level * 7 + JOBS.indexOf(c.job));   // одинаковые свойства для всех комплектов
  c.equipment = {};
  for (const slot of Object.keys(data.slots)) {
    const kind = data.slots[slot].kind;
    const own = I.typesFor(data, kind, c.job);
    const w = c.equipment.weapon && data.types[c.equipment.weapon.type];
    if (!own.length || (kind === 'offhand' && w && w.twoHanded)) continue;
    const isArmor = ARMOR.includes(kind);
    const type = armor[kind] || acc[kind] || own[0].id;
    const item = I.generate(data, { ilvl: c.level, tier, type, cls: c.job, rarityFloor: 2 }, rng);
    while (item.affixes.length > data.rarities[2].affixes) item.affixes.pop();
    if (isArmor || acc[kind]) item.affixes = [];
    item.rarity = 2; item.legendary = []; item.quality = 50; item.enhance = 3;
    c.equipment[slot] = item;
  }
  return c;
}

const typeOf = (kind, mat, variant) => Object.values(data.types).find((t) => t.kind === kind && t.armor === mat && t.variant === variant).id;
const setOf = (mat, variant) => Object.fromEntries(ARMOR.map((k) => [k, typeOf(k, mat, variant)]));

// Результат комплекта: { phys, mag, boss } — каждый { win, hp } в долях
function run(job, L, armor, acc) {
  const c = equip(baseChar(job, L), armor, acc);
  const out = { phys: { win: 0, hp: 0, turns: 0, n: 0 }, mag: { win: 0, hp: 0, turns: 0, n: 0 }, boss: { win: 0, hp: 0, turns: 0, n: 0 } };
  const go = (bucket, id, lvl) => {
    for (let i = 0; i < N; i++) {
      const b = fight(c, id, lvl, i + 1);
      bucket.n++; bucket.turns += b.turn;
      if (b.winner === b.player) { bucket.win++; bucket.hp += b.player.hp / b.player.maxHp; }
    }
  };
  for (const id of MOBS) go(CASTERS.has(id) ? out.mag : out.phys, id, L);
  go(out.boss, bossFor(L), L);
  for (const v of Object.values(out)) { v.hp /= v.n; v.win /= v.n; v.turns /= v.n; }
  return out;
}
const cell = (r) => `${Math.round(r.hp * 100)}♥ ${r.turns.toFixed(1)}х`;
// Оценка: остаток здоровья в обычных боях (физ. ×2, маги ×1) и победы над боссом (×1)
const score = (r) => (r.phys.hp * 2 + r.mag.hp + r.boss.win) / 4;

const t0 = Date.now();
if (ACC) {
  // Аксессуары: средняя оценка по уровням для каждой вариации
  const rows = [];
  for (const kind of ['belt', 'amulet', 'ring']) {
    for (const t of Object.values(data.types).filter((x) => x.kind === kind)) {
      const row = { вещь: `${kind}: ${t.name}` };
      for (const job of JOBS) {
        const own = data.classes[job].armor;
        row[job] = Math.round(LEVELS.reduce((s, L) => s + score(run(job, L, setOf(own, 0), { [kind]: t.id })), 0) / LEVELS.length * 100);
      }
      rows.push(row);
    }
  }
  console.log('Аксессуары: оценка 0–100 (в среднем по уровням) у класса в своём материале');
  console.table(rows);
} else {
  const variantRows = [];
  for (const L of LEVELS) {
    const rows = [];
    for (const job of JOBS) {
      for (const mat of MATS) {
        const variants = VARIANTS ? [0, 1, 2, 3, 4] : [0];
        const res = variants.map((v) => ({ v, r: run(job, L, setOf(mat, v)) }));
        const best = res.reduce((a, b) => (score(b.r) > score(a.r) ? b : a));
        const r0 = res[0].r;
        rows.push({ класс: job, материал: data.armorMaterials[mat].name + (mat === data.classes[job].armor ? ' ★' : ''), 'физ.': cell(r0.phys), маги: cell(r0.mag), босс: `${Math.round(r0.boss.win * 100)}%`, оценка: Math.round(score(r0) * 100), ...(VARIANTS ? { 'лучшая вар.': `${data.types[typeOf('body', mat, best.v)].name} ${Math.round(score(best.r) * 100)}` } : {}) });
        if (VARIANTS) for (const { v, r } of res) variantRows.push({ L, job, mat, v, s: score(r) });
      }
    }
    console.log(`\nУровень ${L} (босс: ${data.monsters[bossFor(L)].name}). ★ — «свой» материал класса`);
    console.table(rows);
  }
  if (VARIANTS) {
    // Вариации: средняя оценка по уровням и классам; разброс показывает, нет ли заведомо худшей
    const rows = [];
    for (const mat of MATS) {
      const row = { материал: data.armorMaterials[mat].name };
      for (let v = 0; v < 5; v++) {
        const list = variantRows.filter((x) => x.mat === mat && x.v === v);
        row[data.types[typeOf('body', mat, v)].name] = Math.round(list.reduce((s, x) => s + x.s, 0) / list.length * 100);
      }
      rows.push(row);
    }
    console.log('\nВариации: средняя оценка по всем уровням и классам (названия — по доспеху)');
    console.table(rows);
  }
}
console.log(`Боёв на ячейку: ${N}, время ${Math.round((Date.now() - t0) / 1000)} с`);
