// Характеристики (GDD §3): справочник ключей и расчёт итоговых боевых статов персонажа.
// Соглашение: ключи на *Pct — доли (0.05 = +5%), остальные — «сырые» числа
// (очки атаки/защиты, проценты шансов вроде crit: 7 = 7%).
(function (root) {
  'use strict';
  const PC = root.PC || (root.PC = {});
  const data = PC.data || (PC.data = {});

  const PRIMARY = ['str', 'agi', 'int', 'vit', 'luk'];

  // Рост «силовых» чисел с уровнем: здоровье, атака, защита, урон растут на GROWTH за уровень
  // (1 ур. ×1, 10 ур. ×2.8, 20 ур. ×8.6, 35 ур. ×47). Персонаж и монстры — по своему уровню, база вещи — по тиру.
  // Плоские свойства вещей растут медленнее (корень из множителя), поэтому к позднему этапу
  // процентные свойства («+% атаки», «+% здоровья») дают всё больше по сравнению с плоскими.
  // Рейтинги (точность, уклонение, скорость), шансы и ресурс не растут.
  const GROWTH = 1.12;
  const MAX_GROWTH_LEVEL = 40;
  const growth = (L) => Math.pow(GROWTH, Math.min(Math.max(L, 1), MAX_GROWTH_LEVEL) - 1);
  const FLAT_POW = 0.5;
  const flatGrowth = (L) => Math.pow(growth(L), FLAT_POW);
  const SCALED = new Set(['atk', 'matk', 'def', 'mdef', 'hp', 'thorns', 'hpRegen', 'fireDmg', 'coldDmg', 'poisonDmg', 'dmg']);
  // Константа защиты для атакующего уровня L: множитель урона = K / (K + защита)
  const defK = (L) => 100 * growth(L);

  // 1234 → «1 234», 12 345 → «12.3к», 1 234 567 → «1.23кк», 1.2e9 → «1.2млрд»
  function fmtBig(n) {
    const a = Math.abs(n), sign = n < 0 ? '−' : '';
    const cut = (v) => (v >= 100 ? Math.round(v) : v >= 10 ? Math.round(v * 10) / 10 : Math.round(v * 100) / 100);
    if (a >= 1e9) return `${sign}${cut(a / 1e9)}млрд`;
    if (a >= 1e6) return `${sign}${cut(a / 1e6)}кк`;
    if (a >= 1e4) return `${sign}${cut(a / 1e3)}к`;
    return `${sign}${Math.round(a).toLocaleString(PC.i18n ? PC.i18n.locale : 'ru-RU')}`;
  }

  // name — для интерфейса и текста аффиксов; fmt — как показать значение; icon — assets/stats/<icon>.svg
  const n = (v) => fmtBig(v);
  const p = (v) => `${Math.round(v)}%`;
  const fp = (v) => `${Math.round(v * 1000) / 10}%`;
  const defs = {
    str: { name: 'Сила', fmt: n, icon: 'str' },
    agi: { name: 'Ловкость', fmt: n, icon: 'agi' },
    int: { name: 'Интеллект', fmt: n, icon: 'int' },
    vit: { name: 'Живучесть', fmt: n, icon: 'vit' },
    luk: { name: 'Удача', fmt: n, icon: 'luk' },
    allPrimary: { name: 'Все характеристики', fmt: n, icon: 'exp' },

    atk: { name: 'Физическая атака', fmt: n, icon: 'atk' },
    atkPct: { name: 'Физическая атака', fmt: fp, icon: 'atk' },
    matk: { name: 'Магическая атака', fmt: n, icon: 'matk' },
    matkPct: { name: 'Магическая атака', fmt: fp, icon: 'matk' },
    def: { name: 'Защита', fmt: n, icon: 'def' },
    defPct: { name: 'Защита', fmt: fp, icon: 'def' },
    mdef: { name: 'Магическая защита', fmt: n, icon: 'mdef' },
    mdefPct: { name: 'Магическая защита', fmt: fp, icon: 'mdef' },
    hp: { name: 'Здоровье', fmt: n, icon: 'hp' },
    hpPct: { name: 'Здоровье', fmt: fp, icon: 'hp' },
    mp: { name: 'Мана', fmt: n, icon: 'mp' },
    mpPct: { name: 'Мана', fmt: fp, icon: 'mp' },
    crit: { name: 'Шанс крита', fmt: p, icon: 'crit' },
    critDmg: { name: 'Крит. урон', fmt: p, icon: 'critdmg' },
    acc: { name: 'Точность', fmt: n, icon: 'accuracy' },
    accPct: { name: 'Точность', fmt: fp, icon: 'accuracy' },
    eva: { name: 'Уклонение', fmt: n, icon: 'evasion' },
    evaPct: { name: 'Уклонение', fmt: fp, icon: 'evasion' },
    speed: { name: 'Скорость', fmt: n, icon: 'speed' },
    speedPct: { name: 'Скорость', fmt: fp, icon: 'speed' },
    block: { name: 'Блок', fmt: p, icon: 'block' },
    lifesteal: { name: 'Вампиризм', fmt: p, icon: 'lifesteal' },
    hpRegen: { name: 'Здоровье за ход', fmt: n, icon: 'hp' },
    hpRegenPct: { name: 'Здоровье за ход', fmt: fp, icon: 'hp' },
    mpRegen: { name: 'Мана за ход', fmt: n, icon: 'mp' },
    cdr: { name: 'Сокращение перезарядки', fmt: p, icon: 'cooldown' },
    dmgReduce: { name: 'Снижение урона', fmt: p, icon: 'def' },
    dmgPct: { name: 'Весь урон', fmt: fp, icon: 'atk' },
    thorns: { name: 'Шипы', fmt: n, icon: 'def' },
    thornsPct: { name: 'Шипы от защиты', fmt: fp, icon: 'def' },
    vsBeast: { name: 'Урон по зверям', fmt: p, icon: 'atk' },
    vsUndead: { name: 'Урон по нежити', fmt: p, icon: 'atk' },
    vsGoblin: { name: 'Урон по гоблинам', fmt: p, icon: 'atk' },
    vsHuman: { name: 'Урон по людям', fmt: p, icon: 'atk' },
    vsConstruct: { name: 'Урон по конструктам', fmt: p, icon: 'atk' },
    fireDmg: { name: 'Урон огнём', fmt: n, icon: 'matk' },
    coldDmg: { name: 'Урон холодом', fmt: n, icon: 'matk' },
    poisonDmg: { name: 'Урон ядом', fmt: n, icon: 'matk' },
    fireRes: { name: 'Сопротивление огню', fmt: p, icon: 'mdef' },
    coldRes: { name: 'Сопротивление холоду', fmt: p, icon: 'mdef' },
    poisonRes: { name: 'Сопротивление яду', fmt: p, icon: 'mdef' },
    stunChance: { name: 'Шанс оглушить', fmt: p, icon: 'atk' },
    bleedChance: { name: 'Шанс кровотечения', fmt: p, icon: 'atk' },
    chillChance: { name: 'Шанс замедлить', fmt: p, icon: 'speed' },
    allSkills: { name: 'Уровень всех умений', fmt: n, icon: 'exp' },
    expPct: { name: 'Опыт', fmt: fp, icon: 'exp' },
    goldPct: { name: 'Золото', fmt: fp, icon: 'gold' },
    mf: { name: 'Находка предметов', fmt: p, icon: 'luk' },
    // Служебные (пассивки), в аффиксах не встречаются
    rageGain: { name: 'Ярость за удар', fmt: n, icon: 'atk' },
    startRes: { name: 'Ресурс в начале боя', fmt: n, icon: 'mp' },
    resPerTurn: { name: 'Ресурс за ход', fmt: n, icon: 'mp' },
    lowHpDmg: { name: 'Урон при здоровье < 50%', fmt: fp, icon: 'atk' },
    dotPct: { name: 'Урон ядов и кровотечений', fmt: fp, icon: 'atk' },
    fireSpellPct: { name: 'Урон огненных заклинаний', fmt: fp, icon: 'matk' },
    counterChance: { name: 'Шанс контратаки', fmt: p, icon: 'atk' },
  };

  // «Сырые» ключи с потолками
  const caps = { crit: 75, block: 75, dmgReduce: 50, fireRes: 75, coldRes: 75, poisonRes: 75, cdr: 50, lifesteal: 50 };

  function add(into, mods) {
    for (const [k, v] of Object.entries(mods || {})) {
      if (typeof v === 'number') into[k] = (into[k] || 0) + v;
      else if (v && typeof v === 'object') { into[k] = into[k] || {}; add(into[k], v); }
    }
    return into;
  }

  // Сумма всех источников: вещи (PC.items.totals) и пассивки. skillLvl / skillDmg — вложенные объекты по id умения.
  function gather(data, char) {
    const sum = {};
    const items = PC.items;
    if (items) for (const it of Object.values(char.equipment || {})) if (it) add(sum, items.totals(data, it));
    // Знаки-добродетели: бонус за 2/4/6 надетых вещей с одинаковым знаком
    const count = {};
    for (const it of Object.values(char.equipment || {})) if (it && it.virtue && !(items && items.isBroken(data, it))) count[it.virtue] = (count[it.virtue] || 0) + 1;
    for (const [id, n] of Object.entries(count)) {
      const sets = data.virtues[id].sets;
      const best = Object.keys(sets).map(Number).filter((k) => n >= k).pop();
      if (best) add(sum, sets[best]);
    }
    for (const id of Object.keys(char.buffs || {})) if (data.elixirs[id]) add(sum, data.elixirs[id].mods);
    const cls = data.classes[char.job];
    if (cls && cls.innate) add(sum, cls.innate);
    for (const [id, rank] of Object.entries(char.passives || {})) {
      const ps = data.passives[id];
      if (ps && rank > 0) add(sum, ps.mods(rank));
    }
    return sum;
  }

  // Итоговые характеристики для боя и экрана героя
  function compute(data, char) {
    const g = gather(data, char);
    const cls = data.classes[char.job];
    const v = (k) => g[k] || 0;
    const prim = {};
    for (const k of PRIMARY) prim[k] = (char.stats[k] || 0) + v(k) + v('allPrimary');

    const weapon = char.equipment && char.equipment.weapon;
    const wb = weapon && PC.items ? PC.items.weaponDamage(data, weapon) : null;
    const usesAgi = cls.primary === 'agi';
    const L = char.level;
    const G = growth(L);

    const s = {
      level: L,
      ...prim,
      weaponMin: wb ? wb.min : Math.round(1 * G),
      weaponMax: wb ? wb.max : Math.round(3 * G),
      atk: (v('atk') + (usesAgi ? prim.agi : prim.str) * 2 * G) * (1 + v('atkPct')),
      matk: (v('matk') + prim.int * 2.5 * G) * (1 + v('matkPct')),
      def: (v('def') + prim.vit * G) * (1 + v('defPct')),
      mdef: (v('mdef') + ((prim.int + prim.vit) * 0.5 + L) * G) * (1 + v('mdefPct')),
      maxHp: ((40 + L * 8 + prim.vit * 12) * G + v('hp')) * (1 + v('hpPct')),
      crit: 3 + prim.luk * 0.3 + v('crit'),
      critDmg: 150 + prim.str * 0.5 + v('critDmg'),
      acc: (80 + L * 2 + prim.agi * 3 + prim.luk + v('acc')) * (1 + v('accPct')),
      eva: (20 + L + prim.agi * 3 + v('eva')) * (1 + v('evaPct')),
      speed: (100 + prim.agi * 0.5 + v('speed')) * (1 + v('speedPct')),
      shield: !!(char.equipment && char.equipment.offhand && PC.items && PC.items.isShield(data, char.equipment.offhand)),
      lifesteal: v('lifesteal'),
      hpRegen: v('hpRegen'),
      hpRegenPct: v('hpRegenPct'),
      cdr: v('cdr'),
      dmgReduce: v('dmgReduce'),
      dmgPct: v('dmgPct'),
      thorns: v('thorns'),
      thornsPct: v('thornsPct'),
      mf: v('mf') + prim.luk * 0.5,
      expPct: v('expPct'),
      goldPct: v('goldPct'),
      allSkills: v('allSkills'),
      skillLvl: g.skillLvl || {},
      skillDmg: g.skillDmg || {},
      legendary: g.legendary ? Object.keys(g.legendary) : [],
    };
    s.block = s.shield ? v('block') + prim.vit * 0.2 : 0;
    for (const k of ['vsBeast', 'vsUndead', 'vsGoblin', 'vsHuman', 'vsConstruct', 'fireDmg', 'coldDmg', 'poisonDmg',
      'fireRes', 'coldRes', 'poisonRes', 'stunChance', 'bleedChance', 'chillChance',
      'rageGain', 'startRes', 'resPerTurn', 'lowHpDmg', 'dotPct', 'fireSpellPct', 'counterChance']) s[k] = v(k);

    const res = data.resources[cls.resource];
    s.resource = cls.resource;
    s.resMax = cls.resource === 'mana' ? Math.round((20 + prim.int * 4 + v('mp')) * (1 + v('mpPct'))) : res.max;
    s.mpRegen = cls.resource === 'mana' ? 2 + prim.int * 0.2 + v('mpRegen') : 0;
    // Маг бьёт обычной атакой магией: не промахивается и не блокируется
    s.caster = cls.resource === 'mana';
    s.element = s.caster ? 'arcane' : null;

    for (const [k, cap] of Object.entries(caps)) if (s[k] > cap) s[k] = cap;
    for (const k of ['atk', 'matk', 'def', 'mdef', 'maxHp', 'acc', 'eva', 'speed']) s[k] = Math.round(s[k]);
    return s;
  }

  // Уровень умения в бою: вложенные очки + аффиксы
  function skillLevel(stats, char, id) {
    const base = (char.skills && char.skills[id]) || 0;
    if (!base) return 0;
    return base + (stats.allSkills || 0) + ((stats.skillLvl && stats.skillLvl[id]) || 0);
  }

  // Боевая оценка: ожидаемый урон за удар × эффективное здоровье, геометрическое среднее.
  // Грубо, но учитывает проценты, криты и защиту так же, как бой.
  function combatScore(s) {
    const hit = (s.caster ? s.matk : s.atk + (s.weaponMin + s.weaponMax) / 2) * (1 + (s.dmgPct || 0));
    const crit = Math.min(75, s.crit) / 100;
    const offense = hit * (1 + crit * (s.critDmg / 100 - 1)) * (s.speed / 100) * (1 + (s.lifesteal || 0) / 200);
    const K = defK(s.level);
    const defense = s.maxHp * (1 + (s.caster ? s.mdef : s.def) / K) / (1 - Math.min(50, s.dmgReduce || 0) / 100) * (1 + (s.block || 0) / 200);
    return Math.sqrt(offense * defense);
  }

  PC.stats = { PRIMARY, GROWTH, combatScore, growth, flatGrowth, SCALED, defK, fmtBig, defs, caps, add, gather, compute, skillLevel };
  PC.fmtBig = fmtBig;
  data.statDefs = defs;
  if (typeof module !== 'undefined') module.exports = PC;
})(typeof window !== 'undefined' ? window : globalThis);
