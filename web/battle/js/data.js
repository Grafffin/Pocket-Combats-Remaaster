// Данные прототипа: классы, приёмы, эффекты, монстры, тексты боевого лога.
// Цифры подобраны на глаз и симуляцией (tools/sim.js), это не данные оригинала — их сервер не сохранился.
(function (root) {
  'use strict';
  const PC = root.PC || (root.PC = {});
  const CDN = 'https://static.pocketcombats.com/v2';

  // ---------- Приёмы ----------
  // cost: тактики {hit, block, crit, dodge} и mana. run(battle, actor, target).
  const skills = {
    basic: {
      id: 'basic', name: 'Обычный удар',
      desc: 'Простой удар оружием. Доступен всегда.',
      run: (b, a, t) => b.strike(a, t),
    },
    idle: {
      id: 'idle', name: 'Бездействие',
      run: (b, a, t) => b.say('passed', b.fill(b.rng.pick(phrases.idle), a, t)),
    },

    // Общий приём из обучения оригинала
    focus: {
      id: 'focus', name: 'Сосредоточенный удар', icon: `${CDN}/skill/hit_strong.png`,
      desc: 'Гарантированный критический удар, от которого невозможно уклониться.',
      cost: { hit: 2, block: 1 },
      announce: ['{A}, применяя приём {skill}, {a:собрался|собралась} с силами.', '{A} {a:замер|замерла}, готовя {skill}.'],
      run: (b, a, t) => b.strike(a, t, { forceCrit: true, undodgeable: true }),
    },

    // Воин
    double: {
      id: 'double', name: 'Двойной удар',
      desc: 'Два удара подряд. Каждое попадание приносит тактику атаки.',
      cost: { hit: 3 },
      announce: ['{A} {a:обрушил|обрушила} на противника {skill}.'],
      run: (b, a, t) => { b.strike(a, t); b.strike(a, t); },
    },
    stun: {
      id: 'stun', name: 'Оглушающий удар',
      desc: 'Удар щитом. При попадании противник пропускает следующее действие.',
      cost: { block: 2, crit: 1 }, cooldown: 3,
      announce: ['{A} {a:замахнулся|замахнулась} щитом — {skill}!'],
      run: (b, a, t) => {
        const r = b.strike(a, t, { mult: 0.8, unblockable: true });
        if (r.outcome === 'hit' && t.hp > 0) b.addEffect(t, 'stun', a);
      },
    },
    rage: {
      id: 'rage', name: 'Ярость',
      desc: 'Удар, после которого урон повышен на 40% в течение 3 ходов.',
      cost: { crit: 2 }, cooldown: 4,
      announce: ['{A} {a:взревел|взревела}, впадая в {skill}.'],
      run: (b, a, t) => { b.addEffect(a, 'rage', a); b.strike(a, t); },
    },
    bandage: {
      id: 'bandage', name: 'Перевязка', heals: true,
      desc: 'Восстанавливает 25% здоровья вместо атаки.',
      cost: { block: 2, dodge: 1 }, cooldown: 4,
      run: (b, a) => b.heal(a, Math.round(a.maxHp * 0.25), '{A} наспех {a:перевязал|перевязала} раны {heal} {hp}.'),
    },

    // Охотник
    aimed: {
      id: 'aimed', name: 'Прицельный выстрел',
      desc: 'Выстрел с уроном ×1.4 в обход защиты, от него невозможно уклониться.',
      cost: { hit: 2 },
      announce: ['{A} {a:натянул|натянула} тетиву до самого уха — {skill}.'],
      run: (b, a, t) => b.strike(a, t, { mult: 1.4, undodgeable: true, ignoreDef: true }),
    },
    poison: {
      id: 'poison', name: 'Отравленная стрела',
      desc: 'Выстрел, отравляющий цель на 4 хода.',
      cost: { hit: 1, crit: 1 }, cooldown: 3,
      announce: ['{A} {a:обмакнул|обмакнула} наконечник в яд — {skill}.'],
      run: (b, a, t) => {
        const r = b.strike(a, t);
        if (r.outcome !== 'dodge' && t.hp > 0) b.addEffect(t, 'poison', a);
      },
    },
    volley: {
      id: 'volley', name: 'Град стрел',
      desc: 'Три быстрых выстрела с уроном ×0.7.',
      cost: { hit: 2, dodge: 2 },
      announce: ['{A} {a:выхватил|выхватила} из колчана сразу три стрелы — {skill}!'],
      run: (b, a, t) => { for (let i = 0; i < 3; i++) b.strike(a, t, { mult: 0.7 }); },
    },
    evasion: {
      id: 'evasion', name: 'Танец теней',
      desc: 'Выстрел, после которого шанс уклонения +25% на 2 хода.',
      cost: { dodge: 2 }, cooldown: 4,
      announce: ['{A} {a:скользнул|скользнула} в тень — {skill}.'],
      run: (b, a, t) => { b.addEffect(a, 'evasion', a); b.strike(a, t); },
    },

    // Маг
    firebolt: {
      id: 'firebolt', name: 'Огненная стрела',
      desc: 'Магический урон 5–8 + мудрость. Нельзя заблокировать или уклониться.',
      cost: { mana: 8 },
      run: (b, a, t) => b.strike(a, t, {
        magic: true, min: 5, max: 8,
        text: '{A} {a:метнул|метнула} огненную стрелу в {B.acc} {dmg} {hp}.',
      }),
    },
    frost: {
      id: 'frost', name: 'Ледяные оковы',
      desc: 'Магический урон 4–7 и заморозка: цель пропускает действие.',
      cost: { mana: 9, hit: 1 }, cooldown: 4,
      run: (b, a, t) => {
        b.strike(a, t, { magic: true, min: 4, max: 7, text: '{A} {a:сковал|сковала} {B.acc} ледяными оковами {dmg} {hp}.' });
        if (t.hp > 0) b.addEffect(t, 'freeze', a);
      },
    },
    heal: {
      id: 'heal', name: 'Исцеление', heals: true,
      desc: 'Восстанавливает 14–20 здоровья.',
      cost: { mana: 10 }, cooldown: 4,
      run: (b, a) => b.heal(a, b.rng.int(14, 20), '{A} {a:прошептал|прошептала} слова исцеления {heal} {hp}.'),
    },
    stoneskin: {
      id: 'stoneskin', name: 'Каменная кожа',
      desc: 'Удар посохом и +25% к защите на 3 хода.',
      cost: { block: 1, dodge: 1, mana: 4 }, cooldown: 4,
      announce: ['Кожа {A.gen} покрылась серой коркой — {skill}.'],
      run: (b, a, t) => { b.addEffect(a, 'stoneskin', a); b.strike(a, t); },
    },

    // Монстры
    m_bite: {
      id: 'm_bite', name: 'Бешеный укус', cost: { hit: 3 },
      announce: ['{A} {a:ощерился|ощерилась} и {a:бросился|бросилась} в атаку.'],
      run: (b, a, t) => { b.strike(a, t); b.strike(a, t); },
    },
    m_rend: {
      id: 'm_rend', name: 'Рваная рана', cost: { hit: 1, crit: 1 }, cooldown: 3,
      run: (b, a, t) => {
        const r = b.strike(a, t, { text: '{A} {a:вцепился|вцепилась} клыками в {B.acc} и {a:рванул|рванула} {dmg} {hp}.' });
        if (r.outcome !== 'dodge' && t.hp > 0) b.addEffect(t, 'bleed', a);
      },
    },
    m_howl: {
      id: 'm_howl', name: 'Вой', cost: { hit: 2, dodge: 1 }, cooldown: 5,
      run: (b, a, t) => { b.addEffect(a, 'rage', a); b.strike(a, t); },
    },
    m_spark: {
      id: 'm_spark', name: 'Тёмная искра', cost: { mana: 7 },
      run: (b, a, t) => b.strike(a, t, {
        magic: true, min: 5, max: 9,
        text: '{A} {a:щёлкнул|щёлкнула} пальцами, и тёмная искра ужалила {B.acc} {dmg} {hp}.',
      }),
    },
    m_mend: {
      id: 'm_mend', name: 'Гнилое снадобье', heals: true, cost: { mana: 8 }, cooldown: 4,
      run: (b, a) => b.heal(a, b.rng.int(12, 16), '{A} {a:хлебнул|хлебнула} из грязной склянки {heal} {hp}.'),
    },
    m_curse: {
      id: 'm_curse', name: 'Порча', cost: { mana: 5, hit: 1 }, cooldown: 4,
      run: (b, a, t) => b.addEffect(t, 'poison', a),
    },
    m_smash: {
      id: 'm_smash', name: 'Сокрушающий удар', cost: { hit: 2, block: 1 }, cooldown: 3,
      announce: ['{A} {a:занёс|занесла} над головой огромный валун.'],
      run: (b, a, t) => {
        const r = b.strike(a, t, { mult: 1.5, text: 'Валун {A.gen} обрушился на {B.acc} {dmg} {hp}.' });
        if (r.outcome === 'hit' && t.hp > 0) b.addEffect(t, 'stun', a);
      },
    },
    m_venom: {
      id: 'm_venom', name: 'Ядовитый укус', cost: { hit: 2 }, cooldown: 3,
      run: (b, a, t) => {
        const r = b.strike(a, t, { text: '{A} {a:вонзил|вонзила} ядовитые жвала в {B.acc} {dmg} {hp}.' });
        if (r.outcome !== 'dodge' && t.hp > 0) b.addEffect(t, 'poison', a);
      },
    },
    m_dirty: {
      id: 'm_dirty', name: 'Подлый удар', cost: { hit: 2, dodge: 1 },
      announce: ['{A} {a:сделал|сделала} обманный выпад.'],
      run: (b, a, t) => b.strike(a, t, { mult: 1.3, ignoreDef: true, text: '{A} {a:ударил|ударила} {B.acc} исподтишка, в обход защиты {dmg} {hp}.' }),
    },
    m_bash: {
      id: 'm_bash', name: 'Удар щитом', cost: { block: 2 }, cooldown: 4,
      run: (b, a, t) => {
        const r = b.strike(a, t, { mult: 0.8, unblockable: true, text: '{A} {a:двинул|двинула} {B.acc} краем щита {dmg} {hp}.' });
        if (r.outcome === 'hit' && t.hp > 0) b.addEffect(t, 'stun', a);
      },
    },
    m_hide: {
      id: 'm_hide', name: 'Каменная шкура', cost: { block: 2 }, cooldown: 5,
      run: (b, a, t) => { b.addEffect(a, 'stoneskin', a); b.strike(a, t); },
    },
  };

  // ---------- Эффекты ----------
  // disable: пропуск одного действия. dot: урон в конце хода. turns: длительность в ходах.
  const effects = {
    stun: {
      name: 'Оглушение', kind: 'debuff', turns: 1, disable: true,
      desc: 'Пропускает следующее действие.',
      applyText: '{B} {b:оглушён|оглушена}.',
      skipText: '{A} {a:оглушён|оглушена} и не может действовать.',
    },
    freeze: {
      name: 'Заморозка', kind: 'debuff', turns: 1, disable: true,
      desc: 'Пропускает следующее действие.',
      applyText: '{B} {b:скован|скована} льдом.',
      skipText: '{A} {a:скован|скована} льдом и не может пошевелиться.',
    },
    poison: {
      name: 'Яд', kind: 'debuff', turns: 4, dot: [2, 4], dotKind: 'poison',
      desc: 'Теряет 2–4 здоровья в конце каждого хода.',
      applyText: '{B} {b:отравлен|отравлена}.',
      dotText: 'Яд разъедает {A.acc} {dmg} {hp}.',
    },
    bleed: {
      name: 'Кровотечение', kind: 'debuff', turns: 3, dot: [3, 5], dotKind: 'bleed',
      desc: 'Теряет 3–5 здоровья в конце каждого хода.',
      applyText: 'У {B.gen} открылось кровотечение.',
      dotText: '{A} истекает кровью {dmg} {hp}.',
    },
    rage: { name: 'Ярость', kind: 'buff', turns: 3, dmgBonus: 40, desc: 'Урон +40%.' },
    evasion: { name: 'Танец теней', kind: 'buff', turns: 2, dodgeBonus: 25, desc: 'Уклонение +25%.' },
    stoneskin: { name: 'Каменная кожа', kind: 'buff', turns: 3, hardDefBonus: 25, desc: 'Защита +25%.' },
  };

  const consumables = {
    hp_potion: { name: 'Зелье здоровья', desc: '+25 HP', heal: 25, text: '{A} {a:выпил|выпила} зелье здоровья {heal} {hp}.' },
    mp_potion: { name: 'Зелье маны', desc: '+15 маны', mana: 15, text: '{A} {a:выпил|выпила} зелье маны {heal}.' },
  };

  // ---------- Классы ----------
  // stats — стартовые характеристики 1 уровня. unlocks — уровень, на котором открывается приём.
  // auto — порядок, в котором симулятор раскидывает очки (tools/sim.js), игрок распределяет сам.
  const jobs = {
    warrior: {
      title: 'Воин', desc: 'Меч и щит. Много здоровья, часто блокирует.',
      stats: { str: 6, agi: 3, vit: 5, wis: 1, dex: 4, luk: 2 },
      gear: ['rusty_sword', 'wooden_shield', 'quilted'],
      unlocks: { focus: 1, double: 2, bandage: 3, stun: 4, rage: 6 },
      potions: { hp_potion: 3 },
      auto: ['str', 'vit', 'str', 'dex', 'vit', 'agi', 'str', 'luk'],
    },
    hunter: {
      title: 'Охотник', desc: 'Лук. Метко стреляет и уклоняется, но не блокирует.',
      stats: { str: 2, agi: 5, vit: 4, wis: 1, dex: 7, luk: 3 },
      gear: ['short_bow', 'quilted'],
      unlocks: { focus: 1, aimed: 2, poison: 3, evasion: 4, volley: 6 },
      potions: { hp_potion: 3 },
      auto: ['dex', 'agi', 'dex', 'vit', 'luk', 'dex', 'vit', 'agi'],
    },
    mage: {
      title: 'Маг', desc: 'Посох и заклинания. Мало здоровья, магию нельзя заблокировать.',
      stats: { str: 2, agi: 3, vit: 4, wis: 7, dex: 4, luk: 2 },
      gear: ['novice_staff', 'novice_robe'],
      unlocks: { firebolt: 1, focus: 2, heal: 3, frost: 4, stoneskin: 6 },
      potions: { hp_potion: 2, mp_potion: 2 },
      auto: ['wis', 'vit', 'wis', 'dex', 'vit', 'wis', 'agi', 'vit'],
    },
  };

  const stats = {
    str: { name: 'Сила', desc: 'Урон мечами и посохами.' },
    agi: { name: 'Ловкость', desc: 'Уклонение и очерёдность хода.' },
    vit: { name: 'Живучесть', desc: 'Здоровье, шанс блока со щитом и защита.' },
    wis: { name: 'Мудрость', desc: 'Мана, её восстановление, сила заклинаний и магическая защита.' },
    dex: { name: 'Интуиция', desc: 'Меткость и урон из лука.' },
    luk: { name: 'Удача', desc: 'Критические удары, немного меткости и уклонения.' },
  };

  // ---------- Предметы ----------
  // slot: weapon | shield | head | armor | gloves | boots. level — требуемый уровень, jobs — кому можно надеть.
  // def — защита в % (hard def), soft — плоская защита, mdef — магическая защита в %, block — шанс блока щита,
  // mdmg — бонус к урону заклинаний, bonus — прибавка к характеристикам.
  const slots = {
    weapon: 'Оружие', shield: 'Щит', head: 'Голова', armor: 'Доспех', gloves: 'Перчатки', boots: 'Обувь',
  };
  const items = {
    // Мечи
    rusty_sword: { name: 'Ржавый меч', slot: 'weapon', wtype: 'melee', jobs: ['warrior'], level: 1, min: 3, max: 5, emoji: '🗡️' },
    short_sword: { name: 'Короткий меч', slot: 'weapon', wtype: 'melee', jobs: ['warrior'], level: 3, min: 4, max: 7, emoji: '🗡️' },
    broadsword: { name: 'Палаш', slot: 'weapon', wtype: 'melee', jobs: ['warrior'], level: 5, min: 6, max: 9, bonus: { str: 1 }, emoji: '⚔️' },
    war_axe: { name: 'Боевой топор', slot: 'weapon', wtype: 'melee', jobs: ['warrior'], level: 7, min: 8, max: 12, emoji: '⚒️' },
    // Луки — двуручные, щит с ними не надеть
    short_bow: { name: 'Короткий лук', slot: 'weapon', wtype: 'bow', jobs: ['hunter'], level: 1, min: 3, max: 6, twoHanded: true, emoji: '🏹' },
    hunting_bow: { name: 'Охотничий лук', slot: 'weapon', wtype: 'bow', jobs: ['hunter'], level: 3, min: 5, max: 8, twoHanded: true, emoji: '🏹' },
    composite_bow: { name: 'Составной лук', slot: 'weapon', wtype: 'bow', jobs: ['hunter'], level: 5, min: 7, max: 10, bonus: { dex: 1 }, twoHanded: true, emoji: '🏹' },
    warden_bow: { name: 'Лук стража', slot: 'weapon', wtype: 'bow', jobs: ['hunter'], level: 7, min: 9, max: 13, twoHanded: true, emoji: '🏹' },
    // Посохи — двуручные
    novice_staff: { name: 'Ученический посох', slot: 'weapon', wtype: 'staff', jobs: ['mage'], level: 1, min: 2, max: 4, twoHanded: true, emoji: '🔮' },
    ash_staff: { name: 'Ясеневый посох', slot: 'weapon', wtype: 'staff', jobs: ['mage'], level: 3, min: 3, max: 5, mdmg: 2, bonus: { wis: 1 }, twoHanded: true, emoji: '🔮' },
    spark_staff: { name: 'Посох искр', slot: 'weapon', wtype: 'staff', jobs: ['mage'], level: 5, min: 4, max: 6, mdmg: 4, bonus: { wis: 2 }, twoHanded: true, emoji: '🔮' },
    shaman_staff: { name: 'Посох шамана', slot: 'weapon', wtype: 'staff', jobs: ['mage'], level: 7, min: 5, max: 7, mdmg: 6, bonus: { wis: 3 }, twoHanded: true, emoji: '🔮' },
    // Щиты
    wooden_shield: { name: 'Деревянный щит', slot: 'shield', level: 1, block: 15, def: 2, emoji: '🛡️' },
    iron_shield: { name: 'Окованный щит', slot: 'shield', level: 4, block: 20, def: 5, emoji: '🛡️' },
    bandit_shield: { name: 'Щит разбойника', slot: 'shield', level: 6, block: 22, def: 7, bonus: { vit: 1 }, emoji: '🛡️' },
    // Голова
    leather_cap: { name: 'Кожаная шапка', slot: 'head', level: 1, def: 2, emoji: '🧢' },
    iron_helm: { name: 'Железный шлем', slot: 'head', level: 5, def: 5, soft: 1, emoji: '⛑️' },
    // Доспехи
    quilted: { name: 'Стёганка', slot: 'armor', level: 1, def: 4, emoji: '🥋' },
    leather_jacket: { name: 'Кожаная куртка', slot: 'armor', level: 3, def: 7, soft: 1, emoji: '🧥' },
    chainmail: { name: 'Кольчуга', slot: 'armor', level: 6, def: 12, soft: 2, jobs: ['warrior'], emoji: '🦺' },
    novice_robe: { name: 'Мантия ученика', slot: 'armor', level: 1, def: 2, mdef: 5, jobs: ['mage'], emoji: '👘' },
    sage_robe: { name: 'Мантия мудреца', slot: 'armor', level: 5, def: 4, mdef: 12, bonus: { wis: 2 }, jobs: ['mage'], emoji: '👘' },
    // Перчатки и обувь
    leather_gloves: { name: 'Кожаные перчатки', slot: 'gloves', level: 2, def: 1, bonus: { dex: 1 }, emoji: '🧤' },
    bracers: { name: 'Наручи', slot: 'gloves', level: 5, def: 3, bonus: { str: 1 }, emoji: '🧤' },
    boots: { name: 'Сапоги', slot: 'boots', level: 1, def: 1, emoji: '🥾' },
    light_boots: { name: 'Лёгкие сапоги', slot: 'boots', level: 3, def: 1, bonus: { agi: 2 }, emoji: '👢' },
  };

  // Качество выпавшего предмета: случайные прибавки к характеристикам, как random_properties в оригинале
  const rarities = [
    { name: 'обычный', chance: 75, bonuses: 0 },
    { name: 'хороший', chance: 20, bonuses: 1 },
    { name: 'редкий', chance: 5, bonuses: 2 },
  ];

  // ---------- Монстры ----------
  // drops: [предмет или зелье, шанс в %]
  const monsters = {
    dummy: {
      name: 'Учебный манекен', gender: 'm', forms: { gen: 'Учебного манекена', dat: 'Учебному манекену', acc: 'Учебный манекен' },
      level: 1, hp: 30, mana: 0, stats: { str: 0, agi: 1, vit: 1, wis: 0, dex: 0, luk: 0 },
      weapon: { type: 'melee', min: 0, max: 0 }, block: 15, exp: 1, ai: 'idle',
      icon: `${CDN}/npc/simulator.png`, emoji: '🪵',
      drops: [],
      blurb: 'Деревянный и терпеливый. Сдачи не даёт.',
    },
    rat: {
      name: 'Лесная крыса', gender: 'f', forms: { gen: 'Лесной крысы', dat: 'Лесной крысе', acc: 'Лесную крысу' },
      level: 1, hp: 32, mana: 0, stats: { str: 2, agi: 7, vit: 2, wis: 0, dex: 4, luk: 2 },
      weapon: { type: 'melee', min: 3, max: 5 }, block: 0, exp: 10, emoji: '🐀',
      verbs: [
        { m: 'укусил', f: 'укусила', c: 'acc' },
        { m: 'цапнул', f: 'цапнула', c: 'acc' },
        { m: 'полоснул когтями', f: 'полоснула когтями', p: 'по', c: 'dat' },
      ],
      skills: ['m_bite'],
      drops: [['hp_potion', 20], ['boots', 8], ['leather_cap', 8], ['quilted', 5]],
      blurb: 'Юркая и злая. Уворачивается чаще, чем хотелось бы.',
    },
    spider: {
      name: 'Лесной паук', gender: 'm', forms: { gen: 'Лесного паука', dat: 'Лесному пауку', acc: 'Лесного паука' },
      level: 2, hp: 42, mana: 0, stats: { str: 3, agi: 6, vit: 3, wis: 0, dex: 6, luk: 3 },
      weapon: { type: 'melee', min: 3, max: 5 }, block: 0, exp: 16, emoji: '🕷️',
      verbs: [
        { m: 'укусил', f: 'укусила', c: 'acc' },
        { m: 'ужалил', f: 'ужалила', c: 'acc' },
        { m: 'хлестнул лапой', f: 'хлестнула лапой', p: 'по', c: 'dat' },
      ],
      skills: ['m_venom'],
      drops: [['hp_potion', 20], ['mp_potion', 10], ['leather_gloves', 8], ['boots', 6], ['short_sword', 4], ['hunting_bow', 4], ['ash_staff', 4]],
      blurb: 'Ядовит. Отравленные раны ноют ещё несколько ходов.',
    },
    wolf: {
      name: 'Серый волк', gender: 'm', forms: { gen: 'Серого волка', dat: 'Серому волку', acc: 'Серого волка' },
      level: 3, hp: 64, mana: 0, stats: { str: 6, agi: 7, vit: 4, wis: 0, dex: 7, luk: 5 },
      weapon: { type: 'melee', min: 4, max: 8 }, block: 4, softDef: 1, hardDef: 4, exp: 26, emoji: '🐺',
      verbs: [
        { m: 'укусил', f: 'укусила', c: 'acc' },
        { m: 'рванул клыками', f: 'рванула клыками', c: 'acc' },
        { m: 'ударил лапой', f: 'ударила лапой', p: 'по', c: 'dat' },
      ],
      skills: ['m_rend', 'm_howl'],
      drops: [['hp_potion', 25], ['leather_jacket', 8], ['light_boots', 6], ['short_sword', 6], ['hunting_bow', 6], ['ash_staff', 6]],
      blurb: 'Кусает до крови. Раны потом долго кровоточат.',
    },
    shaman: {
      name: 'Гоблин-шаман', gender: 'm', forms: { gen: 'Гоблина-шамана', dat: 'Гоблину-шаману', acc: 'Гоблина-шамана' },
      level: 4, hp: 62, mana: 24, stats: { str: 3, agi: 5, vit: 4, wis: 8, dex: 5, luk: 4 },
      weapon: { type: 'melee', min: 2, max: 4 }, block: 6, softDef: 1, hardDef: 5, softMdef: 3, hardMdef: 15, exp: 36, emoji: '👺',
      verbs: [
        { m: 'огрел клюкой', f: 'огрела клюкой', c: 'acc' },
        { m: 'ткнул посохом', f: 'ткнула посохом', c: 'acc' },
      ],
      skills: ['m_spark', 'm_mend', 'm_curse'],
      drops: [['mp_potion', 25], ['hp_potion', 20], ['iron_shield', 6], ['leather_jacket', 6], ['spark_staff', 4], ['sage_robe', 3]],
      blurb: 'Колдует, травит и лечится. Магию не заблокировать.',
    },
    bandit: {
      name: 'Разбойник', gender: 'm', forms: { gen: 'Разбойника', dat: 'Разбойнику', acc: 'Разбойника' },
      level: 6, hp: 110, mana: 0, stats: { str: 9, agi: 7, vit: 6, wis: 0, dex: 9, luk: 5 },
      weapon: { type: 'melee', min: 6, max: 10 }, shield: true, block: 18, softDef: 3, hardDef: 12, exp: 60, emoji: '🧔',
      skills: ['m_dirty', 'm_bash'],
      drops: [['hp_potion', 30], ['broadsword', 6], ['composite_bow', 6], ['spark_staff', 5], ['iron_helm', 6], ['bracers', 6], ['chainmail', 4], ['bandit_shield', 4], ['sage_robe', 4]],
      blurb: 'Бьёт исподтишка и прикрывается щитом.',
    },
    troll: {
      name: 'Каменный тролль', gender: 'm', forms: { gen: 'Каменного тролля', dat: 'Каменному троллю', acc: 'Каменного тролля' },
      level: 8, hp: 210, mana: 0, stats: { str: 13, agi: 3, vit: 13, wis: 0, dex: 7, luk: 2 },
      weapon: { type: 'melee', min: 7, max: 11 }, block: 10, softDef: 5, hardDef: 20, softMdef: 4, hardMdef: 22, exp: 140, emoji: '🗿', boss: true,
      verbs: [
        { m: 'ударил кулачищем', f: 'ударила кулачищем', p: 'по', c: 'dat' },
        { m: 'отшвырнул', f: 'отшвырнула', c: 'acc' },
        { m: 'приложил дубиной', f: 'приложила дубиной', c: 'acc' },
      ],
      skills: ['m_smash', 'm_hide'],
      drops: [['hp_potion', 60], ['war_axe', 15], ['warden_bow', 15], ['shaman_staff', 15], ['chainmail', 10], ['iron_helm', 10]],
      blurb: 'Босс. Медленный, толстокожий, оглушает валуном.',
    },
  };

  // ---------- Тексты лога ----------
  const phrases = {
    gerunds: [
      'недолго думая', 'собравшись с духом', 'выбрав удачный момент', 'почти не целясь', 'хитро прищурившись',
      'отбросив сомнения', 'вспомнив уроки наставника', 'глубоко вдохнув', 'издав боевой клич', 'улучив момент',
      'не теряя ни секунды', 'обманным движением отвлекая противника',
    ],
    adverbs: ['ловко', 'сильно', 'резко', 'точно', 'размашисто', 'наотмашь', 'неуклюже', 'со всей силы', 'небрежно', 'яростно'],
    verbs: {
      melee: [
        { m: 'ударил', f: 'ударила', p: 'по', c: 'dat' },
        { m: 'рубанул', f: 'рубанула', p: 'по', c: 'dat' },
        { m: 'хлестнул', f: 'хлестнула', p: 'по', c: 'dat' },
        { m: 'саданул', f: 'саданула', p: 'по', c: 'dat' },
        { m: 'полоснул', f: 'полоснула', p: 'по', c: 'dat' },
        { m: 'ткнул локтем', f: 'ткнула локтем', c: 'acc' },
        { m: 'пнул', f: 'пнула', c: 'acc' },
      ],
      staff: [
        { m: 'огрел посохом', f: 'огрела посохом', c: 'acc' },
        { m: 'стукнул посохом', f: 'стукнула посохом', p: 'по', c: 'dat' },
        { m: 'ткнул посохом', f: 'ткнула посохом', c: 'acc' },
        { m: 'пнул', f: 'пнула', c: 'acc' },
      ],
      bow: [
        { m: 'выстрелил в', f: 'выстрелила в', c: 'acc' },
        { m: 'всадил стрелу в', f: 'всадила стрелу в', c: 'acc' },
        { m: 'пустил стрелу в', f: 'пустила стрелу в', c: 'acc' },
      ],
    },
    hit: [
      '{A} {adv} {verb} {dmg} {hp}.',
      '{A}, {ger}, {verb} {dmg} {hp}.',
      '{Ger}, {A} {adv} {verb} {dmg} {hp}.',
    ],
    crit: [
      '{A} {a:нашёл|нашла} брешь в защите и {verb} в полную силу {dmg} {hp}.',
      '{A}, {ger}, {verb} — точно в уязвимое место {dmg} {hp}.',
      'Удар {A.gen} пришёлся точно в цель, {B} {b:взвыл|взвыла} от боли {dmg} {hp}.',
    ],
    critBlock: [
      '{A} {a:пробил|пробила} блок {B.gen} {dmg} {hp}.',
      '{B} {b:попытался|попыталась} закрыться, но удар {A.gen} прошёл сквозь блок {dmg} {hp}.',
    ],
    block: [
      '{B} {b:парировал|парировала} удар {A.gen} {dmg} {hp}.',
      '{A} {a:засмотрелся|засмотрелась} по сторонам, и {B} {b:отбил|отбила} удар {dmg} {hp}.',
      '{B} {b:закрылся|закрылась} от удара {A.gen}, и тот пришёлся вскользь {dmg} {hp}.',
    ],
    blockShield: [
      '{B} {b:принял|приняла} удар {A.gen} на щит {dmg} {hp}.',
      '{B} вовремя {b:подставил|подставила} щит под удар {A.gen} {dmg} {hp}.',
    ],
    dodge: [
      '{B} {b:увернулся|увернулась} от удара {A.gen}.',
      '{A} {a:промахнулся|промахнулась}: {B} вовремя {b:отскочил|отскочила} в сторону.',
      '{B} ловко {b:поднырнул|поднырнула} под удар {A.gen}.',
      '{A} {a:размахнулся|размахнулась} что есть сил, но лишь {a:рассёк|рассекла} воздух.',
    ],
    idle: ['{A} невозмутимо покачивается.', '{A} молча скрипит.', '{A} делает вид, что ничего не происходит.'],
    deathMonster: ['{B} {b:повержен|повержена}.', '{B} {b:испустил|испустила} дух.'],
    deathPlayer: ['{B} {b:рухнул|рухнула} без сил.', 'В глазах у {B.gen} потемнело. Бой проигран.'],
  };

  // Бой в оригинале начинался с хайку. Эти написаны заново.
  const haiku = [
    'Сталь о сталь звенит —\nа над полем сражения\nвсё поют дрозды.',
    'Ржавый меч в траве.\nКто-то когда-то здесь\nтоже ждал победы.',
    'Осенний ветер.\nЩит мой стал тяжелее\nна один удар.',
    'Капля крови\nна чужом клинке.\nСтынет закат.',
    'Перед боем\nзатянуть покрепче\nстарый сапог.',
    'Тень от клинка\nдлиннее, чем сам клинок.\nВечер близко.',
  ];

  // Описания тактик для подсказок (по мотивам оригинала)
  const tactics = {
    hit: { name: 'Тактика атаки', desc: 'За каждое удачное попадание по противнику. Шанс попасть зависит от интуиции и немного от удачи.' },
    block: { name: 'Тактика защиты', desc: 'За заблокированный удар противника. Щит сильно повышает шанс блока. Блок вдвое снижает урон, магию заблокировать нельзя, а с луком блокировать невозможно.' },
    crit: { name: 'Тактика крови', desc: 'За критический удар, не попавший в блок. Критический шанс зависит в основном от удачи.' },
    dodge: { name: 'Тактика уклонения', desc: 'За уклонение от удара противника. Уклонившись, вы лишаете атакующего тактик. От магии не уклониться.' },
    mana: { name: 'Запас маны', desc: 'Зависит от мудрости и понемногу восстанавливается каждый ход. Тратится на заклинания.' },
  };

  PC.data = { skills, effects, consumables, jobs, stats, slots, items, rarities, monsters, phrases, haiku, tactics };
  if (typeof module !== 'undefined') module.exports = PC;
})(typeof window !== 'undefined' ? window : globalThis);
