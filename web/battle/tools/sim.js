// Проверка баланса: node web/battle/tools/sim.js [боёв] [--career] [--log]
// По умолчанию — таблица: персонаж каждого класса на уровне монстра (и на 1 выше) с типичной экипировкой.
// --no-potions — без зелий, чтобы видеть «чистый» баланс.
// --career — «прохождение»: новый персонаж бьёт подходящих монстров, сам надевает лут и раскидывает очки.
// Игрок-бот играет «жадно»: самый дорогой доступный приём, зелье при HP < 35%.
const PC = require('../js/engine.js');
require('../js/data.js');
require('../js/progression.js');
const { data, Battle, progression: P, makeRng } = PC;

const N = Number(process.argv[2]) || 1000;
const career = process.argv.includes('--career');
const showLog = process.argv.includes('--log');
const noPotions = process.argv.includes('--no-potions');

function playerChoice(b) {
  const p = b.player;
  const has = (id) => p.consumables.find((c) => c.id === id && c.count > 0);
  if (has('hp_potion') && p.hp / p.maxHp < 0.35) b.useConsumable(p, 'hp_potion');
  else if (has('mp_potion') && p.maxMana && p.mana < 6) b.useConsumable(p, 'mp_potion');
  const usable = p.skills.filter((id) => id !== 'basic' && b.skillState(p, id).usable);
  const heal = usable.find((id) => data.skills[id].heals);
  if (heal && p.hp / p.maxHp < 0.5) return heal;
  const atk = usable.filter((id) => !data.skills[id].heals);
  const w = (id) => Object.values(data.skills[id].cost || {}).reduce((a, x) => a + x, 0);
  atk.sort((a, c) => w(c) - w(a));
  return atk[0] || 'basic';
}

function fight(char, monId, seed) {
  const b = new Battle({ player: P.toFighter(data, char), monster: data.monsters[monId], seed, data });
  while (!b.ended && b.turn < 100) b.submit(playerChoice(b));
  return b;
}

function autoAllocate(char) {
  const order = data.jobs[char.job].auto;
  let i = char.level * 7;
  while (char.statPoints > 0) { char.stats[order[i++ % order.length]]++; char.statPoints--; }
}

// Лучшая вещь в каждый слот среди доступных по уровню и классу (без случайных прибавок)
function typicalGear(char) {
  char.equipment = {};
  const bySlot = {};
  for (const [id, it] of Object.entries(data.items)) {
    if (it.level > char.level || (it.jobs && !it.jobs.includes(char.job))) continue;
    if (!bySlot[it.slot] || it.level > data.items[bySlot[it.slot]].level) bySlot[it.slot] = id;
  }
  for (const [slot, id] of Object.entries(bySlot)) {
    const w = bySlot.weapon && data.items[bySlot.weapon];
    if (slot === 'shield' && w && w.twoHanded) continue;
    char.equipment[slot] = P.makeItem(id);
  }
}

function charAt(job, level) {
  const c = P.newCharacter(data, { nick: 'Тест', gender: 'm', job });
  c.level = level;
  c.statPoints = (level - 1) * P.STAT_POINTS_PER_LEVEL;
  autoAllocate(c);
  typicalGear(c);
  if (noPotions) c.potions = {};
  return c;
}

if (!career) {
  const rows = [];
  for (const job of Object.keys(data.jobs)) {
    for (const [monId, m] of Object.entries(data.monsters)) {
      if (m.ai === 'idle') continue;
      const row = { job, monster: `${monId} (${m.level})` };
      for (const delta of [0, 1]) {
        const c = charAt(job, m.level + delta);
        let wins = 0, turns = 0;
        for (let i = 0; i < N; i++) {
          const b = fight(c, monId, i + 1);
          if (b.winner === b.player) wins++;
          turns += b.turn;
          if (showLog && i === 0 && delta === 0) console.log(b.log.map((l) => l.text.replace(/<[^>]+>/g, '')).join('\n'), '\n');
        }
        row[`lvl+${delta} win`] = `${Math.round(wins / N * 100)}%`;
        row[`lvl+${delta} turns`] = (turns / N).toFixed(1);
      }
      rows.push(row);
    }
  }
  console.table(rows);
} else {
  // Прохождение до 8 уровня: бьём самого сильного монстра не выше своего уровня
  const rng = makeRng(42);
  const rows = [];
  for (const job of Object.keys(data.jobs)) {
    let totalBattles = 0, totalLosses = 0, totalItems = 0;
    const runs = Math.max(1, Math.floor(N / 50));
    for (let run = 0; run < runs; run++) {
      const c = P.newCharacter(data, { nick: 'Тест', gender: 'm', job });
      let battles = 0;
      while (c.level < 8 && battles < 2000) {
        const pool = Object.entries(data.monsters).filter(([, m]) => m.ai !== 'idle' && !m.boss && m.level <= c.level);
        const [monId] = pool.sort((a, b) => b[1].level - a[1].level)[0];
        const b = fight(c, monId, rng.int(1, 1e9));
        const res = P.applyBattleResult(data, c, b, monId, rng);
        battles++;
        totalItems += res.loot.filter((d) => d.kind === 'item').length;
        // Надеваем всё, что новее по уровню, остальное выбрасываем
        for (const it of [...c.backpack]) {
          const p = data.items[it.id];
          const cur = c.equipment[p.slot];
          if (P.canEquip(data, c, it).ok && (!cur || data.items[cur.id].level < p.level)) P.equip(data, c, it.uid);
        }
        c.backpack = [];
        c.potions.hp_potion = Math.max(c.potions.hp_potion, 2); // как будто докупил зелья
        autoAllocate(c);
      }
      totalBattles += battles;
      totalLosses += c.losses;
    }
    rows.push({
      job, 'боёв до 8 ур.': (totalBattles / runs).toFixed(0),
      'поражений': `${Math.round(totalLosses / totalBattles * 100)}%`,
      'вещей выпало': (totalItems / runs).toFixed(1),
    });
  }
  console.table(rows);
}
