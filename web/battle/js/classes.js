// Классы, активные умения и пассивки (GDD §2, §5).
// Числа умений растут с уровнем: v(lvl) возвращает значения, desc подставляет их в {ключ}.
(function (root) {
  'use strict';
  const PC = root.PC || (root.PC = {});
  const data = PC.data || (PC.data = {});

  const pct = (x) => Math.round(x * 100);
  const lin = (base, per) => (lvl) => base + per * (lvl - 1);

  // ---------- Классы ----------
  const classes = {
    warrior: {
      title: 'Воин', desc: 'Меч и щит. Держит удар, блокирует, отвечает контратаками.',
      resource: 'rage', primary: 'str',
      stats: { str: 7, agi: 3, int: 1, vit: 7, luk: 2 },
      weapons: ['sword', 'mace', 'axe'], offhand: ['shield'], armor: 'heavy',
      startGear: ['sword', 'shield', 'plate'],
      auto: ['str', 'vit', 'str', 'agi', 'vit', 'luk'],
    },
    berserker: {
      title: 'Берсерк', desc: 'Двуручное оружие. Огромный урон, вампиризм, жизнь на грани.',
      resource: 'rage', primary: 'str',
      stats: { str: 9, agi: 3, int: 1, vit: 5, luk: 2 },
      weapons: ['greatsword', 'greataxe'], offhand: [], armor: 'heavy',
      startGear: ['greataxe', 'plate'],
      auto: ['str', 'str', 'vit', 'luk', 'str', 'agi'],
    },
    hunter: {
      title: 'Охотник', desc: 'Лук и арбалет. Криты, скорость, уклонение и яд.',
      resource: 'energy', primary: 'agi',
      stats: { str: 2, agi: 9, int: 1, vit: 4, luk: 4 },
      weapons: ['bow', 'crossbow'], offhand: [], armor: 'light',
      startGear: ['bow', 'jerkin'],
      auto: ['agi', 'agi', 'luk', 'vit', 'agi', 'vit'],
    },
    mage: {
      title: 'Маг', desc: 'Посох или жезл со сферой. Стихии, контроль, магические щиты.',
      resource: 'mana', primary: 'int',
      stats: { str: 1, agi: 3, int: 10, vit: 4, luk: 2 },
      weapons: ['staff', 'wand'], offhand: ['orb'], armor: 'cloth',
      // Врождённое: маг носит ткань и не блокирует — немного живучести, чтобы не рассыпаться о тяжёлых боссов
      innate: { hpPct: 0.15, mdefPct: 0.2 },
      startGear: ['staff', 'robe'],
      auto: ['int', 'int', 'vit', 'int', 'agi', 'luk'],
    },
  };

  const resources = {
    rage: { name: 'Ярость', max: 100, start: 0, perTurn: 0, onHit: 12, onHurt: 8, color: '#d9534f' },
    energy: { name: 'Энергия', max: 100, start: 50, perTurn: 25, onHit: 0, onHurt: 0, color: '#e8c547' },
    mana: { name: 'Мана', max: null, start: 'full', perTurn: 0, onHit: 0, onHurt: 0, color: '#4f8fe8' },
  };

  // ---------- Активные умения ----------
  // cost — ресурс, cd — перезарядка в ходах, unlock — уровень персонажа.
  // run(b, a, t, v) — b: бой, a: исполнитель, t: цель, v: значения уровня.
  const skills = {
    // Воин
    shield_bash: {
      cls: 'warrior', name: 'Удар щитом', unlock: 1, cost: 20, cd: 3, icon: 'block',
      v: (l) => ({ dmg: lin(1.0, 0.1)(l), stun: lin(0.45, 0.05)(l) }),
      desc: (v) => `Удар на ${pct(v.dmg)}% атаки, ${pct(v.stun)}% шанс оглушить на ход.`,
      run: (b, a, t, v) => { const r = b.attack(a, t, { mult: v.dmg }); if (r.hit && b.roll(v.stun)) b.applyStun(t, a); },
    },
    war_cry: {
      cls: 'warrior', name: 'Боевой клич', unlock: 3, cost: 30, cd: 5, icon: 'atk',
      v: (l) => ({ atk: lin(0.2, 0.03)(l) }),
      desc: (v) => `+${pct(v.atk)}% физической атаки на 3 хода.`,
      run: (b, a, t, v) => b.buff(a, { id: 'war_cry', name: 'Боевой клич', turns: 3, mods: { atkPct: v.atk } }),
    },
    cleave: {
      cls: 'warrior', name: 'Рассекающий удар', unlock: 6, cost: 35, cd: 2, icon: 'atk',
      v: (l) => ({ dmg: lin(1.6, 0.15)(l) }),
      desc: (v) => `Удар на ${pct(v.dmg)}% атаки, вызывает кровотечение.`,
      run: (b, a, t, v) => { const r = b.attack(a, t, { mult: v.dmg }); if (r.hit) b.applyDot(t, a, 'bleed', 0.15, 3); },
    },
    iron_will: {
      cls: 'warrior', name: 'Несокрушимость', unlock: 10, cost: 40, cd: 6, icon: 'def',
      v: (l) => ({ shield: lin(0.2, 0.03)(l) }),
      desc: (v) => `Щит на ${pct(v.shield)}% здоровья на 3 хода.`,
      run: (b, a, t, v) => b.addShield(a, Math.round(a.maxHp * v.shield), 3),
    },
    retaliation: {
      cls: 'warrior', name: 'Возмездие', unlock: 15, cost: 30, cd: 5, icon: 'block',
      v: (l) => ({ counter: lin(0.6, 0.08)(l) }),
      desc: (v) => `2 хода отвечает на каждый удар контратакой на ${pct(v.counter)}% атаки.`,
      run: (b, a, t, v) => b.buff(a, { id: 'retaliation', name: 'Возмездие', turns: 2, counter: v.counter }),
    },
    execute: {
      cls: 'warrior', name: 'Казнь', unlock: 20, cost: 50, cd: 4, icon: 'crit',
      v: (l) => ({ dmg: lin(2.0, 0.2)(l) }),
      desc: (v) => `Удар на ${pct(v.dmg)}% атаки, вдвое сильнее по цели ниже 30% здоровья.`,
      run: (b, a, t, v) => b.attack(a, t, { mult: t.hp / t.maxHp < 0.3 ? v.dmg * 2 : v.dmg }),
    },

    // Берсерк
    reckless_strike: {
      cls: 'berserker', name: 'Безрассудный удар', unlock: 1, cost: 20, cd: 2, icon: 'atk',
      v: (l) => ({ dmg: lin(1.4, 0.12)(l) }),
      desc: (v) => `Удар на ${pct(v.dmg)}% атаки, ценой 5% своего здоровья.`,
      run: (b, a, t, v) => { b.selfDamage(a, Math.round(a.maxHp * 0.05)); b.attack(a, t, { mult: v.dmg }); },
    },
    blood_frenzy: {
      cls: 'berserker', name: 'Кровавое безумие', unlock: 3, cost: 30, cd: 5, icon: 'lifesteal',
      v: (l) => ({ ls: lin(0.2, 0.02)(l) }),
      desc: (v) => `+${pct(v.ls)}% вампиризма на 3 хода.`,
      run: (b, a, t, v) => b.buff(a, { id: 'blood_frenzy', name: 'Кровавое безумие', turns: 3, mods: { lifesteal: v.ls } }),
    },
    whirlwind: {
      cls: 'berserker', name: 'Вихрь', unlock: 6, cost: 40, cd: 3, icon: 'speed',
      v: (l) => ({ dmg: lin(0.6, 0.06)(l) }),
      desc: (v) => `Три удара по ${pct(v.dmg)}% атаки.`,
      run: (b, a, t, v) => { for (let i = 0; i < 3; i++) b.attack(a, t, { mult: v.dmg }); },
    },
    roar: {
      cls: 'berserker', name: 'Устрашающий рёв', unlock: 10, cost: 25, cd: 6, icon: 'def',
      v: (l) => ({ weak: lin(0.2, 0.02)(l) }),
      desc: (v) => `Враг теряет ${pct(v.weak)}% атаки на 3 хода.`,
      run: (b, a, t, v) => b.debuff(t, a, { id: 'roar', name: 'Устрашение', turns: 3, mods: { atkPct: -v.weak, matkPct: -v.weak } }),
    },
    bloodbath: {
      cls: 'berserker', name: 'Кровавая баня', unlock: 15, cost: 50, cd: 4, icon: 'hp',
      v: (l) => ({ dmg: lin(2.2, 0.2)(l) }),
      desc: (v) => `Удар на ${pct(v.dmg)}% атаки, лечит на половину нанесённого урона.`,
      run: (b, a, t, v) => { const r = b.attack(a, t, { mult: v.dmg }); if (r.dmg) b.heal(a, Math.round(r.dmg / 2)); },
    },
    rampage: {
      cls: 'berserker', name: 'Неистовство', unlock: 20, cost: 70, cd: 8, icon: 'crit',
      v: (l) => ({ dmg: lin(0.4, 0.04)(l) }),
      desc: (v) => `4 хода: +${pct(v.dmg)}% урона и +20% скорости.`,
      run: (b, a, t, v) => b.buff(a, { id: 'rampage', name: 'Неистовство', turns: 4, mods: { dmgPct: v.dmg, speedPct: 0.2 } }),
    },

    // Охотник
    aimed_shot: {
      cls: 'hunter', name: 'Прицельный выстрел', unlock: 1, cost: 30, cd: 2, icon: 'accuracy',
      v: (l) => ({ dmg: lin(1.5, 0.12)(l) }),
      desc: (v) => `Выстрел на ${pct(v.dmg)}% атаки, не промахивается.`,
      run: (b, a, t, v) => b.attack(a, t, { mult: v.dmg, sure: true }),
    },
    poison_arrow: {
      cls: 'hunter', name: 'Отравленная стрела', unlock: 3, cost: 30, cd: 3, icon: 'crit',
      v: (l) => ({ dot: lin(0.18, 0.03)(l) }),
      desc: (v) => `Выстрел и яд: ${pct(v.dot)}% атаки каждый ход, 3 хода.`,
      run: (b, a, t, v) => { const r = b.attack(a, t, { mult: 1 }); if (r.hit) b.applyDot(t, a, 'poison', v.dot, 3); },
    },
    evasive_step: {
      cls: 'hunter', name: 'Уход в тень', unlock: 6, cost: 25, cd: 5, icon: 'evasion',
      v: (l) => ({ eva: lin(0.3, 0.03)(l) }),
      desc: (v) => `2 хода +${pct(v.eva)}% к шансу уклонения, следующий выстрел критический.`,
      run: (b, a, t, v) => b.buff(a, { id: 'evasive_step', name: 'Уход в тень', turns: 2, dodge: v.eva, nextCrit: true }),
    },
    multishot: {
      cls: 'hunter', name: 'Залп', unlock: 10, cost: 50, cd: 3, icon: 'atk',
      v: (l) => ({ dmg: lin(0.55, 0.05)(l) }),
      desc: (v) => `Три выстрела по ${pct(v.dmg)}% атаки.`,
      run: (b, a, t, v) => { for (let i = 0; i < 3; i++) b.attack(a, t, { mult: v.dmg }); },
    },
    hunters_mark: {
      cls: 'hunter', name: 'Метка охотника', unlock: 15, cost: 20, cd: 6, icon: 'crit',
      v: (l) => ({ vuln: lin(0.15, 0.02)(l) }),
      desc: (v) => `Цель получает +${pct(v.vuln)}% урона 4 хода.`,
      run: (b, a, t, v) => b.debuff(t, a, { id: 'mark', name: 'Метка', turns: 4, mods: { dmgTakenPct: v.vuln } }),
    },
    deadeye: {
      cls: 'hunter', name: 'Смертельный выстрел', unlock: 20, cost: 80, cd: 6, icon: 'critdmg',
      v: (l) => ({ dmg: lin(3.0, 0.25)(l) }),
      desc: (v) => `Гарантированный крит на ${pct(v.dmg)}% атаки.`,
      run: (b, a, t, v) => b.attack(a, t, { mult: v.dmg, sure: true, forceCrit: true }),
    },

    // Маг
    fire_bolt: {
      cls: 'mage', name: 'Огненная стрела', unlock: 1, cost: 8, cd: 0, icon: 'matk',
      v: (l) => ({ dmg: lin(1.15, 0.08)(l) }),
      desc: (v) => `Огонь: ${pct(v.dmg)}% маг. атаки.`,
      run: (b, a, t, v) => b.spell(a, t, { mult: v.dmg, element: 'fire' }),
    },
    frost_nova: {
      cls: 'mage', name: 'Ледяная волна', unlock: 3, cost: 15, cd: 4, icon: 'speed',
      v: (l) => ({ dmg: lin(0.9, 0.08)(l), freeze: lin(0.25, 0.03)(l) }),
      desc: (v) => `Холод: ${pct(v.dmg)}% маг. атаки, замедление, ${pct(v.freeze)}% шанс заморозить.`,
      run: (b, a, t, v) => {
        b.spell(a, t, { mult: v.dmg, element: 'cold' });
        if (t.hp <= 0) return;
        b.applyChill(t, a);
        if (b.roll(v.freeze)) b.applyStun(t, a, 'freeze');
      },
    },
    arcane_shield: {
      cls: 'mage', name: 'Магический щит', unlock: 6, cost: 20, cd: 6, icon: 'mdef',
      v: (l) => ({ shield: lin(0.25, 0.03)(l) }),
      desc: (v) => `Щит на ${pct(v.shield)}% здоровья на 3 хода.`,
      run: (b, a, t, v) => b.addShield(a, Math.round(a.maxHp * v.shield), 3),
    },
    chain_lightning: {
      cls: 'mage', name: 'Цепная молния', unlock: 10, cost: 25, cd: 3, icon: 'matk',
      v: (l) => ({ dmg: lin(0.45, 0.04)(l) }),
      desc: (v) => `Три разряда по ${pct(v.dmg)}% маг. атаки.`,
      run: (b, a, t, v) => { for (let i = 0; i < 3; i++) b.spell(a, t, { mult: v.dmg, element: 'lightning' }); },
    },
    meteor: {
      cls: 'mage', name: 'Метеор', unlock: 15, cost: 40, cd: 5, icon: 'matk',
      v: (l) => ({ dmg: lin(2.2, 0.18)(l) }),
      desc: (v) => `Огонь: ${pct(v.dmg)}% маг. атаки и горение 3 хода.`,
      run: (b, a, t, v) => { const r = b.spell(a, t, { mult: v.dmg, element: 'fire' }); if (r.dmg) b.applyDot(t, a, 'burn', 0.2, 3, true); },
    },
    mana_surge: {
      cls: 'mage', name: 'Прилив маны', unlock: 20, cost: 0, cd: 8, icon: 'mp',
      v: (l) => ({ mana: lin(0.4, 0.03)(l) }),
      desc: (v) => `Восстанавливает ${pct(v.mana)}% маны, следующее заклинание +50% урона.`,
      run: (b, a, t, v) => {
        b.gainResource(a, Math.round(a.resMax * v.mana), true);
        b.buff(a, { id: 'mana_surge', name: 'Прилив маны', turns: 3, nextSpell: 0.5 });
      },
    },
  };
  for (const [id, s] of Object.entries(skills)) s.id = id;

  // ---------- Пассивки ----------
  // mods(rank) — прибавки к характеристикам (ключи из stats.js), либо особый флаг для движка.
  const passives = {
    // Воин
    toughness: { cls: 'warrior', name: 'Закалка', max: 5, mods: (r) => ({ defPct: 0.04 * r }), desc: (r) => `+${4 * r}% защиты` },
    shield_master: { cls: 'warrior', name: 'Мастер щита', max: 5, mods: (r) => ({ block: 3 * r }), desc: (r) => `+${3 * r}% блока со щитом` },
    spiked_armor: { cls: 'warrior', name: 'Шипастая броня', max: 5, mods: (r) => ({ thornsPct: 0.04 * r }), desc: (r) => `Шипы: ${4 * r}% защиты возвращается атакующему` },
    second_breath: { cls: 'warrior', name: 'Второе дыхание', max: 5, mods: (r) => ({ hpRegenPct: 0.01 * r }), desc: (r) => `+${r}% здоровья каждый ход` },
    weapon_mastery: { cls: 'warrior', name: 'Владение оружием', max: 5, mods: (r) => ({ atkPct: 0.04 * r }), desc: (r) => `+${4 * r}% физической атаки` },
    battle_rage: { cls: 'warrior', name: 'Боевой задор', max: 5, mods: (r) => ({ rageGain: 2 * r }), desc: (r) => `+${2 * r} ярости за удар` },
    unbreakable: { cls: 'warrior', name: 'Непоколебимость', max: 5, mods: (r) => ({ dmgReduce: 2 * r }), desc: (r) => `−${2 * r}% получаемого урона` },
    counter_instinct: { cls: 'warrior', name: 'Чутьё бойца', max: 5, mods: (r) => ({ counterChance: 4 * r }), desc: (r) => `${4 * r}% шанс контратаки после блока или уклонения` },

    // Берсерк
    brute_force: { cls: 'berserker', name: 'Грубая сила', max: 5, mods: (r) => ({ atkPct: 0.05 * r }), desc: (r) => `+${5 * r}% физической атаки` },
    bloodlust: { cls: 'berserker', name: 'Жажда крови', max: 5, mods: (r) => ({ lifesteal: 2 * r }), desc: (r) => `+${2 * r}% вампиризма` },
    on_the_edge: { cls: 'berserker', name: 'На грани', max: 5, mods: (r) => ({ lowHpDmg: 0.06 * r }), desc: (r) => `+${6 * r}% урона, пока здоровье ниже 50%` },
    thick_hide: { cls: 'berserker', name: 'Толстая шкура', max: 5, mods: (r) => ({ hpPct: 0.05 * r }), desc: (r) => `+${5 * r}% здоровья` },
    pent_rage: { cls: 'berserker', name: 'Затаённая злоба', max: 5, mods: (r) => ({ startRes: 10 * r }), desc: (r) => `Бой начинается с ${10 * r} ярости` },
    savage: { cls: 'berserker', name: 'Свирепость', max: 5, mods: (r) => ({ crit: 2 * r }), desc: (r) => `+${2 * r}% шанса крита` },
    cleaver: { cls: 'berserker', name: 'Мясник', max: 5, mods: (r) => ({ critDmg: 8 * r }), desc: (r) => `+${8 * r}% крит. урона` },
    relentless: { cls: 'berserker', name: 'Неудержимость', max: 5, mods: (r) => ({ speedPct: 0.03 * r }), desc: (r) => `+${3 * r}% скорости` },

    // Охотник
    sharp_eye: { cls: 'hunter', name: 'Зоркий глаз', max: 5, mods: (r) => ({ crit: 2 * r }), desc: (r) => `+${2 * r}% шанса крита` },
    keen_arrows: { cls: 'hunter', name: 'Острые наконечники', max: 5, mods: (r) => ({ critDmg: 8 * r }), desc: (r) => `+${8 * r}% крит. урона` },
    fleet_foot: { cls: 'hunter', name: 'Лёгкий шаг', max: 5, mods: (r) => ({ evaPct: 0.05 * r }), desc: (r) => `+${5 * r}% уклонения` },
    toxicology: { cls: 'hunter', name: 'Токсиколог', max: 5, mods: (r) => ({ dotPct: 0.1 * r }), desc: (r) => `+${10 * r}% урона ядов и кровотечений` },
    survivalist: { cls: 'hunter', name: 'Выживальщик', max: 5, mods: (r) => ({ hpPct: 0.04 * r }), desc: (r) => `+${4 * r}% здоровья` },
    quick_draw: { cls: 'hunter', name: 'Быстрая рука', max: 5, mods: (r) => ({ resPerTurn: 3 * r }), desc: (r) => `+${3 * r} энергии каждый ход` },
    predator: { cls: 'hunter', name: 'Хищник', max: 5, mods: (r) => ({ vsBeast: 6 * r, vsHuman: 6 * r }), desc: (r) => `+${6 * r}% урона по зверям и людям` },
    steady_aim: { cls: 'hunter', name: 'Твёрдая рука', max: 5, mods: (r) => ({ accPct: 0.06 * r }), desc: (r) => `+${6 * r}% точности` },

    // Маг
    arcane_mind: { cls: 'mage', name: 'Тайное знание', max: 5, mods: (r) => ({ mpPct: 0.06 * r }), desc: (r) => `+${6 * r}% маны` },
    spell_power: { cls: 'mage', name: 'Сила чар', max: 5, mods: (r) => ({ matkPct: 0.05 * r }), desc: (r) => `+${5 * r}% магической атаки` },
    pyromancy: { cls: 'mage', name: 'Пиромантия', max: 5, mods: (r) => ({ fireSpellPct: 0.08 * r }), desc: (r) => `+${8 * r}% урона огнём` },
    frost_touch: { cls: 'mage', name: 'Касание стужи', max: 5, mods: (r) => ({ chillChance: 4 * r }), desc: (r) => `${4 * r}% шанс замедлить врага заклинанием` },
    meditation: { cls: 'mage', name: 'Медитация', max: 5, mods: (r) => ({ mpRegen: 2 * r }), desc: (r) => `+${2 * r} маны каждый ход` },
    mana_barrier: { cls: 'mage', name: 'Барьер маны', max: 5, mods: (r) => ({ dmgReduce: 2 * r }), desc: (r) => `−${2 * r}% получаемого урона` },
    focus: { cls: 'mage', name: 'Сосредоточение', max: 5, mods: (r) => ({ crit: 2 * r }), desc: (r) => `+${2 * r}% шанса крита` },
    elemental_ward: { cls: 'mage', name: 'Стихийная защита', max: 5, mods: (r) => ({ fireRes: 6 * r, coldRes: 6 * r, poisonRes: 6 * r }), desc: (r) => `+${6 * r}% ко всем сопротивлениям` },
  };
  for (const [id, p] of Object.entries(passives)) p.id = id;

  const SKILL_SLOTS = 4;
  const SKILL_MAX = 10;

  Object.assign(data, { classes, resources, skills, passives, SKILL_SLOTS, SKILL_MAX });
  if (typeof module !== 'undefined') module.exports = PC;
})(typeof window !== 'undefined' ? window : globalThis);
