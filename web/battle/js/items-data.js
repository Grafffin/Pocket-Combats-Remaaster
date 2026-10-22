// Данные предметов (GDD §4): слоты, типы баз и их тиры, редкости, качество, аффиксы, легендарные свойства,
// заточка, ранги, материалы. Логика — items.js.
(function (root) {
  'use strict';
  const PC = root.PC || (root.PC = {});
  const data = PC.data || (PC.data = {});

  // ---------- Слоты ----------
  // kind — какой тип слота принимает вещь (оба кольца — 'ring')
  const slots = {
    weapon: { name: 'Оружие', kind: 'weapon', art: 'ui/slots/weapon' },
    offhand: { name: 'Левая рука', kind: 'offhand', art: 'ui/slots/offhand' },
    head: { name: 'Голова', kind: 'head', art: 'ui/slots/head' },
    body: { name: 'Тело', kind: 'body', art: 'ui/slots/body' },
    hands: { name: 'Руки', kind: 'hands', art: 'ui/slots/hands' },
    feet: { name: 'Ноги', kind: 'feet', art: 'ui/slots/feet' },
    belt: { name: 'Пояс', kind: 'belt', art: 'ui/slots/belt' },
    amulet: { name: 'Амулет', kind: 'amulet', art: 'ui/slots/amulet' },
    ring1: { name: 'Кольцо', kind: 'ring', art: 'ui/slots/ring' },
    ring2: { name: 'Кольцо', kind: 'ring', art: 'ui/slots/ring' },
  };

  // ---------- Тиры ----------
  // Тир базы = зона. Уровень, с которого вещь можно надеть, и ilvl, с которого она падает.
  const TIER_LEVEL = [0, 1, 5, 10, 15, 20, 27, 33];
  const MAX_TIER = 7;

  // Прилагательные тиров по материалу, во всех родах: m, f, n, pl
  const adj = (m, f, n, pl) => ({ m, f, n, pl });
  const materials = {
    metal: [adj('Ржавый', 'Ржавая', 'Ржавое', 'Ржавые'), adj('Железный', 'Железная', 'Железное', 'Железные'),
      adj('Стальной', 'Стальная', 'Стальное', 'Стальные'), adj('Рунный', 'Рунная', 'Рунное', 'Рунные'),
      adj('Мифриловый', 'Мифриловая', 'Мифриловое', 'Мифриловые'), adj('Драконий', 'Драконья', 'Драконье', 'Драконьи'),
      adj('Древний', 'Древняя', 'Древнее', 'Древние')],
    wood: [adj('Кривой', 'Кривая', 'Кривое', 'Кривые'), adj('Тисовый', 'Тисовая', 'Тисовое', 'Тисовые'),
      adj('Ясеневый', 'Ясеневая', 'Ясеневое', 'Ясеневые'), adj('Рунный', 'Рунная', 'Рунное', 'Рунные'),
      adj('Эльфийский', 'Эльфийская', 'Эльфийское', 'Эльфийские'), adj('Драконий', 'Драконья', 'Драконье', 'Драконьи'),
      adj('Древний', 'Древняя', 'Древнее', 'Древние')],
    leather: [adj('Потёртый', 'Потёртая', 'Потёртое', 'Потёртые'), adj('Дублёный', 'Дублёная', 'Дублёное', 'Дублёные'),
      adj('Клёпаный', 'Клёпаная', 'Клёпаное', 'Клёпаные'), adj('Теневой', 'Теневая', 'Теневое', 'Теневые'),
      adj('Эльфийский', 'Эльфийская', 'Эльфийское', 'Эльфийские'), adj('Драконий', 'Драконья', 'Драконье', 'Драконьи'),
      adj('Древний', 'Древняя', 'Древнее', 'Древние')],
    cloth: [adj('Холщовый', 'Холщовая', 'Холщовое', 'Холщовые'), adj('Льняной', 'Льняная', 'Льняное', 'Льняные'),
      adj('Шёлковый', 'Шёлковая', 'Шёлковое', 'Шёлковые'), adj('Зачарованный', 'Зачарованная', 'Зачарованное', 'Зачарованные'),
      adj('Звёздный', 'Звёздная', 'Звёздное', 'Звёздные'), adj('Драконий', 'Драконья', 'Драконье', 'Драконьи'),
      adj('Древний', 'Древняя', 'Древнее', 'Древние')],
    jewel: [adj('Медный', 'Медная', 'Медное', 'Медные'), adj('Серебряный', 'Серебряная', 'Серебряное', 'Серебряные'),
      adj('Золотой', 'Золотая', 'Золотое', 'Золотые'), adj('Рунный', 'Рунная', 'Рунное', 'Рунные'),
      adj('Мифриловый', 'Мифриловая', 'Мифриловое', 'Мифриловые'), adj('Драконий', 'Драконья', 'Драконье', 'Драконьи'),
      adj('Древний', 'Древняя', 'Древнее', 'Древние')],
  };

  // Кривые базовых характеристик по тиру
  const wAvg = (t) => 6 + 9 * (t - 1) + 2 * (t - 1) * (t - 1);   // средний урон оружия: 6, 17, 32, 51, 74, 101, 132
  const aDef = (t) => 5 + 8 * (t - 1) + 1.5 * (t - 1) * (t - 1); // защита доспеха: 5 … 107

  // ---------- Типы баз ----------
  // kind — тип слота. cls — кому можно (нет — всем). mat — материал для имени, salvage — что даёт разбор.
  // base(t) — неотъемлемые характеристики (до качества, заточки и ранга). dmg — урон оружия [мин, макс].
  const W = (mult) => (t) => ({ dmg: [Math.round(wAvg(t) * mult * 0.7), Math.round(wAvg(t) * mult * 1.3)] });
  const types = {
    sword: { name: 'меч', g: 'm', kind: 'weapon', cls: ['warrior'], mat: 'metal', salvage: 'ore', art: 'items/sword', base: W(0.9) },
    mace: { name: 'булава', g: 'f', kind: 'weapon', cls: ['warrior'], mat: 'metal', salvage: 'ore', art: 'items/mace', base: (t) => ({ ...W(0.75)(t), stunChance: 3 }) },
    axe: { name: 'топор', g: 'm', kind: 'weapon', cls: ['warrior'], mat: 'metal', salvage: 'ore', art: 'items/axe', base: (t) => ({ ...W(0.85)(t), critDmg: 10 }) },
    greatsword: { name: 'двуручный меч', g: 'm', kind: 'weapon', cls: ['berserker'], twoHanded: true, mat: 'metal', salvage: 'ore', art: 'items/greatsword', base: (t) => ({ ...W(1.3)(t), crit: 3 }) },
    greataxe: { name: 'секира', g: 'f', kind: 'weapon', cls: ['berserker'], twoHanded: true, mat: 'metal', salvage: 'ore', art: 'items/greataxe', base: (t) => ({ ...W(1.4)(t), critDmg: 15 }) },
    bow: { name: 'лук', g: 'm', kind: 'weapon', cls: ['hunter'], twoHanded: true, mat: 'wood', salvage: 'leather', art: 'items/bow', base: (t) => ({ ...W(1.15)(t), crit: 3 }) },
    crossbow: { name: 'арбалет', g: 'm', kind: 'weapon', cls: ['hunter'], twoHanded: true, mat: 'metal', salvage: 'ore', art: 'items/crossbow', base: (t) => ({ ...W(1.25)(t), speed: -5 }) },
    staff: { name: 'посох', g: 'm', kind: 'weapon', cls: ['mage'], twoHanded: true, mat: 'wood', salvage: 'essence', art: 'items/staff', base: (t) => ({ dmg: [1, 3], matk: Math.round(wAvg(t) * 1.0) }) },
    wand: { name: 'жезл', g: 'm', kind: 'weapon', cls: ['mage'], mat: 'wood', salvage: 'essence', art: 'items/wand', base: (t) => ({ dmg: [1, 2], matk: Math.round(wAvg(t) * 0.7) }) },
    shield: { name: 'щит', g: 'm', kind: 'offhand', cls: ['warrior'], mat: 'metal', salvage: 'ore', art: 'items/shield', isShield: true, base: (t) => ({ def: Math.round(aDef(t) * 0.5), block: 12 + 2 * t }) },
    orb: { name: 'сфера', g: 'f', kind: 'offhand', cls: ['mage'], mat: 'jewel', salvage: 'essence', art: 'items/orb', base: (t) => ({ matk: Math.round(wAvg(t) * 0.45), mp: 8 * t }) },

    helm: { name: 'шлем', g: 'm', kind: 'head', armor: 'heavy', mat: 'metal', salvage: 'ore', art: 'items/helmet_heavy', base: (t) => ({ def: Math.round(aDef(t) * 0.45) }) },
    hood: { name: 'капюшон', g: 'm', kind: 'head', armor: 'light', mat: 'leather', salvage: 'leather', art: 'items/helmet_light', base: (t) => ({ def: Math.round(aDef(t) * 0.3), eva: 3 * t }) },
    hat: { name: 'колпак', g: 'm', kind: 'head', armor: 'cloth', mat: 'cloth', salvage: 'essence', art: 'items/helmet_light', base: (t) => ({ def: Math.round(aDef(t) * 0.18), mdef: Math.round(aDef(t) * 0.3) }) },
    plate: { name: 'латы', g: 'pl', kind: 'body', armor: 'heavy', mat: 'metal', salvage: 'ore', art: 'items/armor_heavy', base: (t) => ({ def: Math.round(aDef(t)) }) },
    jerkin: { name: 'куртка', g: 'f', kind: 'body', armor: 'light', mat: 'leather', salvage: 'leather', art: 'items/armor_light', base: (t) => ({ def: Math.round(aDef(t) * 0.65), eva: 5 * t }) },
    robe: { name: 'мантия', g: 'f', kind: 'body', armor: 'cloth', mat: 'cloth', salvage: 'essence', art: 'items/robe', base: (t) => ({ def: Math.round(aDef(t) * 0.55), mdef: Math.round(aDef(t) * 0.6), mp: 6 * t, hp: 6 * t }) },
    gauntlets: { name: 'наручи', g: 'pl', kind: 'hands', armor: 'heavy', mat: 'metal', salvage: 'ore', art: 'items/gloves_heavy', base: (t) => ({ def: Math.round(aDef(t) * 0.3) }) },
    gloves: { name: 'перчатки', g: 'pl', kind: 'hands', armor: 'light', mat: 'leather', salvage: 'leather', art: 'items/gloves_light', base: (t) => ({ def: Math.round(aDef(t) * 0.2), acc: 4 * t }) },
    wraps: { name: 'обмотки', g: 'pl', kind: 'hands', armor: 'cloth', mat: 'cloth', salvage: 'essence', art: 'items/gloves_light', base: (t) => ({ def: Math.round(aDef(t) * 0.12), matk: 2 * t }) },
    sabatons: { name: 'сабатоны', g: 'pl', kind: 'feet', armor: 'heavy', mat: 'metal', salvage: 'ore', art: 'items/boots_heavy', base: (t) => ({ def: Math.round(aDef(t) * 0.35) }) },
    boots: { name: 'сапоги', g: 'pl', kind: 'feet', armor: 'light', mat: 'leather', salvage: 'leather', art: 'items/boots_light', base: (t) => ({ def: Math.round(aDef(t) * 0.22), speed: 1 + t }) },
    slippers: { name: 'туфли', g: 'pl', kind: 'feet', armor: 'cloth', mat: 'cloth', salvage: 'essence', art: 'items/boots_light', base: (t) => ({ def: Math.round(aDef(t) * 0.12), mdef: Math.round(aDef(t) * 0.15) }) },

    belt: { name: 'пояс', g: 'm', kind: 'belt', mat: 'leather', salvage: 'leather', art: 'items/belt', base: (t) => ({ hp: 15 * t }) },
    amulet: { name: 'амулет', g: 'm', kind: 'amulet', mat: 'jewel', salvage: 'essence', art: 'items/amulet', base: (t) => ({ mdef: 3 * t, hp: 8 * t }) },
    ring: { name: 'кольцо', g: 'n', kind: 'ring', mat: 'jewel', salvage: 'essence', art: 'items/ring', base: (t) => ({ luk: Math.ceil(t / 2) }) },
  };
  for (const [id, t] of Object.entries(types)) t.id = id;

  // ---------- Редкость ----------
  // affixes — сколько случайных свойств, legendary — сколько легендарных, floor — минимальный тир аффиксов от потолка,
  // high — значения аффиксов не ниже середины диапазона, value — множитель цены.
  const rarities = [
    { id: 'common', name: 'Обычный', color: '#9aa3b2', weight: 55, affixes: 0, legendary: 0, value: 1 },
    { id: 'uncommon', name: 'Необычный', color: '#5fd068', weight: 27, affixes: 1, legendary: 0, value: 1.6 },
    { id: 'rare', name: 'Редкий', color: '#4f9cff', weight: 12, affixes: 2, legendary: 0, value: 2.6 },
    { id: 'heroic', name: 'Героический', color: '#b27bff', weight: 4.5, affixes: 3, legendary: 0, value: 4.5 },
    { id: 'legendary', name: 'Легендарный', color: '#ff9f3d', weight: 1.2, affixes: 3, legendary: 1, value: 9 },
    { id: 'mythic', name: 'Мифический', color: '#ff4d5e', weight: 0.25, affixes: 4, legendary: 1, floor: 1, value: 20 },
    { id: 'ancient', name: 'Древний', color: '#3fe0d0', weight: 0.05, affixes: 4, legendary: 2, floor: 1, high: true, value: 50 },
    // Уникальные — не выпадают случайно, только конкретные вещи с конкретных боссов (data.uniques)
    { id: 'unique', name: 'Уникальный', color: '#e8c26b', weight: 0, affixes: 3, legendary: 0, value: 30 },
  ];
  // Окончания прилагательных редкости не нужны: редкость показывается цветом и подписью

  // ---------- Качество ----------
  const qualities = [
    { min: 0, name: 'Ветхое' },
    { min: 20, name: 'Обычное' },
    { min: 60, name: 'Добротное' },
    { min: 85, name: 'Отличное' },
    { min: 98, name: 'Безупречное' },
  ];

  // ---------- Аффиксы ----------
  // stat — ключ из stats.js; slots — виды слотов; cls — только для этих классов (контекст генерации);
  // t — диапазоны значений T1…T7; pct — значение хранится долей (в t — проценты); w — вес выпадения.
  // param: 'skill' — аффикс привязан к случайному умению класса вещи.
  const R = (...pairs) => pairs; // для читаемости таблиц
  const ATK = R([2, 4], [5, 8], [9, 14], [15, 22], [23, 32], [33, 45], [46, 60]);
  const PCT_BIG = R([2, 4], [4, 6], [6, 9], [9, 12], [12, 16], [16, 20], [20, 25]);
  const VS = R([3, 5], [5, 8], [8, 11], [11, 15], [15, 19], [19, 24], [24, 30]);
  const ELEM = R([2, 4], [4, 8], [8, 13], [13, 19], [19, 27], [27, 36], [36, 48]);
  const CHANCE = R([2, 3], [3, 4], [4, 5], [5, 6], [6, 8], [8, 9], [9, 11]);
  const RES = R([4, 6], [6, 9], [9, 12], [12, 15], [15, 18], [18, 22], [22, 26]);
  const PRIM = R([1, 2], [2, 3], [3, 5], [5, 7], [7, 9], [9, 12], [12, 15]);
  const HP = R([8, 15], [15, 30], [30, 50], [50, 80], [80, 120], [120, 170], [170, 230]);
  const DEF = R([3, 5], [5, 9], [9, 14], [14, 20], [20, 28], [28, 38], [38, 50]);
  const RATING = R([5, 10], [10, 18], [18, 28], [28, 40], [40, 55], [55, 72], [72, 90]);

  const ARMOR = ['head', 'body', 'hands', 'feet'];
  const JEWEL = ['amulet', 'ring'];
  const affixes = {
    // Атака
    atk: { stat: 'atk', slots: ['weapon', 'hands', ...JEWEL], cls: ['warrior', 'berserker', 'hunter'], t: ATK, w: 10, group: 'attack' },
    atkPct: { stat: 'atkPct', pct: true, slots: ['weapon', ...JEWEL], cls: ['warrior', 'berserker', 'hunter'], t: PCT_BIG, w: 7, group: 'attack' },
    matk: { stat: 'matk', slots: ['weapon', 'offhand', 'head', ...JEWEL], cls: ['mage'], t: ATK, w: 10, group: 'attack' },
    // На сфере нет «+% маг. атаки»: иначе у мага на одно процентное свойство больше, чем у остальных
    matkPct: { stat: 'matkPct', pct: true, slots: ['weapon', ...JEWEL], cls: ['mage'], t: PCT_BIG, w: 7, group: 'attack' },
    crit: { stat: 'crit', slots: ['weapon', 'head', 'hands', ...JEWEL], t: R([1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 8], [8, 10]), w: 8, group: 'attack' },
    critDmg: { stat: 'critDmg', slots: ['weapon', 'hands', ...JEWEL], t: R([5, 8], [8, 12], [12, 16], [16, 21], [21, 27], [27, 34], [34, 42]), w: 7, group: 'attack' },
    acc: { stat: 'acc', slots: ['weapon', 'head', 'hands', 'ring'], cls: ['warrior', 'berserker', 'hunter'], t: RATING, w: 6, group: 'attack' },
    speed: { stat: 'speed', slots: ['feet', 'weapon', 'hands', 'amulet'], t: R([1, 2], [2, 3], [3, 5], [5, 7], [7, 9], [9, 12], [12, 15]), w: 6, group: 'attack' },
    dmgPct: { stat: 'dmgPct', pct: true, slots: ['weapon', 'amulet'], t: R([2, 3], [3, 4], [4, 6], [6, 8], [8, 10], [10, 12], [12, 15]), w: 3, group: 'attack' },
    fireDmg: { stat: 'fireDmg', slots: ['weapon', 'hands', 'ring'], cls: ['warrior', 'berserker', 'hunter'], t: ELEM, w: 4, group: 'attack' },
    coldDmg: { stat: 'coldDmg', slots: ['weapon', 'hands', 'ring'], cls: ['warrior', 'berserker', 'hunter'], t: ELEM, w: 4, group: 'attack' },
    poisonDmg: { stat: 'poisonDmg', slots: ['weapon', 'hands', 'ring'], cls: ['warrior', 'berserker', 'hunter'], t: ELEM, w: 4, group: 'attack' },
    vsBeast: { stat: 'vsBeast', slots: ['weapon', ...JEWEL], t: VS, w: 3, group: 'attack' },
    vsUndead: { stat: 'vsUndead', slots: ['weapon', ...JEWEL], t: VS, w: 3, group: 'attack' },
    vsGoblin: { stat: 'vsGoblin', slots: ['weapon', ...JEWEL], t: VS, w: 3, group: 'attack' },
    vsHuman: { stat: 'vsHuman', slots: ['weapon', ...JEWEL], t: VS, w: 3, group: 'attack' },
    vsConstruct: { stat: 'vsConstruct', slots: ['weapon', ...JEWEL], t: VS, w: 3, group: 'attack' },
    stunChance: { stat: 'stunChance', slots: ['weapon', 'offhand'], cls: ['warrior', 'berserker'], t: CHANCE, w: 3, group: 'attack' },
    bleedChance: { stat: 'bleedChance', slots: ['weapon', 'hands'], cls: ['warrior', 'berserker', 'hunter'], t: CHANCE, w: 3, group: 'attack' },
    chillChance: { stat: 'chillChance', slots: ['weapon', 'offhand', 'hands'], cls: ['mage'], t: CHANCE, w: 3, group: 'attack' },
    lifesteal: { stat: 'lifesteal', slots: ['weapon', ...JEWEL], t: R([1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7], [7, 9]), w: 4, group: 'attack' },

    // Защита
    hp: { stat: 'hp', slots: [...ARMOR, 'offhand', 'belt', ...JEWEL], t: HP, w: 10, group: 'defense' },
    hpPct: { stat: 'hpPct', pct: true, slots: ['body', 'belt', 'amulet'], t: R([2, 3], [3, 5], [5, 7], [7, 9], [9, 11], [11, 13], [13, 16]), w: 5, group: 'defense' },
    def: { stat: 'def', slots: [...ARMOR, 'offhand', 'belt', 'ring'], t: DEF, w: 9, group: 'defense' },
    defPct: { stat: 'defPct', pct: true, slots: [...ARMOR, 'offhand'], t: R([3, 5], [5, 8], [8, 11], [11, 14], [14, 18], [18, 22], [22, 27]), w: 6, group: 'defense' },
    mdef: { stat: 'mdef', slots: [...ARMOR, 'offhand', ...JEWEL], t: DEF, w: 7, group: 'defense' },
    mdefPct: { stat: 'mdefPct', pct: true, slots: [...ARMOR, 'amulet'], t: R([3, 5], [5, 8], [8, 11], [11, 14], [14, 18], [18, 22], [22, 27]), w: 4, group: 'defense' },
    block: { stat: 'block', slots: ['offhand', 'hands'], cls: ['warrior'], t: R([2, 3], [3, 4], [4, 6], [6, 7], [7, 9], [9, 10], [10, 12]), w: 6, group: 'defense' },
    eva: { stat: 'eva', slots: ['feet', 'body', 'head', 'hands'], t: RATING, w: 6, group: 'defense' },
    fireRes: { stat: 'fireRes', slots: [...ARMOR, 'offhand', 'belt', ...JEWEL], t: RES, w: 4, group: 'defense' },
    coldRes: { stat: 'coldRes', slots: [...ARMOR, 'offhand', 'belt', ...JEWEL], t: RES, w: 4, group: 'defense' },
    poisonRes: { stat: 'poisonRes', slots: [...ARMOR, 'offhand', 'belt', ...JEWEL], t: RES, w: 4, group: 'defense' },
    dmgReduce: { stat: 'dmgReduce', slots: ['body', 'offhand', 'belt'], t: R([1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7], [7, 8]), w: 3, group: 'defense' },
    thorns: { stat: 'thorns', slots: ['body', 'offhand', 'hands'], t: R([3, 6], [6, 11], [11, 18], [18, 27], [27, 38], [38, 52], [52, 70]), w: 4, group: 'defense' },
    hpRegen: { stat: 'hpRegen', slots: ['belt', 'body', ...JEWEL], t: R([1, 2], [2, 4], [4, 6], [6, 9], [9, 13], [13, 17], [17, 22]), w: 5, group: 'defense' },

    // Ресурс
    mp: { stat: 'mp', slots: ['offhand', 'head', 'body', ...JEWEL], cls: ['mage'], t: RATING, w: 6, group: 'resource' },
    mpRegen: { stat: 'mpRegen', slots: ['offhand', 'head', ...JEWEL], cls: ['mage'], t: R([1, 2], [2, 3], [3, 4], [4, 5], [5, 7], [7, 9], [9, 11]), w: 5, group: 'resource' },
    cdr: { stat: 'cdr', slots: ['amulet', 'head', 'hands'], t: R([2, 3], [3, 4], [4, 6], [6, 8], [8, 10], [10, 12], [12, 15]), w: 2, group: 'resource' },

    // Основные характеристики
    str: { stat: 'str', slots: ['weapon', ...ARMOR, 'belt', ...JEWEL], cls: ['warrior', 'berserker'], t: PRIM, w: 7, group: 'primary' },
    agi: { stat: 'agi', slots: ['weapon', ...ARMOR, 'belt', ...JEWEL], t: PRIM, w: 7, group: 'primary' },
    int: { stat: 'int', slots: ['weapon', 'offhand', ...ARMOR, 'belt', ...JEWEL], cls: ['mage'], t: PRIM, w: 7, group: 'primary' },
    vit: { stat: 'vit', slots: ['offhand', ...ARMOR, 'belt', ...JEWEL], t: PRIM, w: 7, group: 'primary' },
    luk: { stat: 'luk', slots: ['weapon', ...ARMOR, ...JEWEL], t: PRIM, w: 5, group: 'primary' },
    allPrimary: { stat: 'allPrimary', slots: ['amulet'], t: R([1, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 8]), w: 2, group: 'primary' },

    // Полезное
    expPct: { stat: 'expPct', pct: true, slots: ['head', ...JEWEL], t: R([2, 3], [3, 5], [5, 7], [7, 9], [9, 11], [11, 13], [13, 15]), w: 3, group: 'utility' },
    goldPct: { stat: 'goldPct', pct: true, slots: ['feet', 'belt', ...JEWEL], t: R([3, 5], [5, 8], [8, 12], [12, 16], [16, 20], [20, 25], [25, 30]), w: 3, group: 'utility' },
    mf: { stat: 'mf', slots: ['head', ...JEWEL], t: R([2, 4], [4, 6], [6, 9], [9, 12], [12, 15], [15, 19], [19, 24]), w: 3, group: 'utility' },

    // Классовые
    skillLvl: { param: 'skill', slots: ['weapon', 'offhand', 'head', 'amulet'], t: R([1, 1], [1, 1], [1, 1], [1, 2], [1, 2], [2, 2], [2, 3]), w: 4, group: 'class' },
    skillDmg: { param: 'skill', pct: true, slots: ['weapon', 'offhand', 'head', 'hands', 'body', 'amulet'], t: R([5, 8], [8, 12], [12, 16], [16, 21], [21, 27], [27, 34], [34, 42]), w: 5, group: 'class' },
    allSkills: { stat: 'allSkills', slots: ['weapon', 'amulet'], minTier: 4, t: R([0, 0], [0, 0], [0, 0], [1, 1], [1, 1], [1, 1], [1, 2]), w: 1, group: 'class' },
  };
  for (const [id, a] of Object.entries(affixes)) a.id = id;

  // Вес тиров аффикса: чем выше тир относительно потолка ilvl, тем реже (потолок — индекс 0)
  const TIER_FALLOFF = [1, 2, 3, 3, 2, 1, 1];

  // ---------- Легендарные свойства ----------
  // Поведение реализовано в движке по id (engine.js), здесь — имя, описание и (для простых) прибавки к статам.
  const legendaries = {
    thunder: { name: 'Гром небесный', desc: '15% шанс при ударе ударить молнией на 80% атаки.' },
    thirst: { name: 'Неутолимая жажда', desc: 'Вампиризм удваивается, пока здоровье ниже 30%.', mods: { lifesteal: 3 } },
    echo: { name: 'Эхо', desc: '20% шанс, что умение не уйдёт на перезарядку.' },
    boneShield: { name: 'Костяной щит', desc: 'В начале боя щит на 15% здоровья.' },
    firstBlood: { name: 'Первая кровь', desc: 'Первый удар в бою всегда критический.' },
    execute: { name: 'Палач', desc: '+60% урона по целям ниже 25% здоровья.' },
    coldHeart: { name: 'Холодное сердце', desc: 'Замедленные враги получают +30% урона.', mods: { chillChance: 8 } },
    goldFever: { name: 'Золотая лихорадка', desc: '+50% золота, но −10% защиты.', mods: { goldPct: 0.5, defPct: -0.1 } },
    berserkBlood: { name: 'Кровь берсерка', desc: 'До +50% урона по мере потери здоровья.' },
    secondWind: { name: 'Второе дыхание', desc: 'Раз за бой при здоровье ниже 20% восстанавливает 30%.' },
    venomous: { name: 'Ядовитое жало', desc: 'Каждое попадание отравляет на 3 хода.' },
    mirrorShield: { name: 'Зеркальный щит', desc: '20% шанс отразить половину полученного урона.' },
    manaFont: { name: 'Неиссякаемый источник', desc: 'Умения стоят на 30% меньше ресурса.' },
    hunterMark: { name: 'Метка добычи', desc: 'Первое попадание помечает цель: +20% получаемого урона до конца боя.' },
  };

  // ---------- Уники ----------
  // Именные вещи с боссов. Каждая задумана как центр отдельной сборки: сильный необычный эффект,
  // заметный минус и узкая роль — ни одна не подходит «всем и всегда».
  // boss — с кого падает, minDiff — с какой сложности, mods — постоянные свойства (минусы со знаком −),
  // effects — особые механики (реализованы в engine.js), role — для чего вещь, flavor — текст на карточке.
  // Шанс выпадения — UNIQUE_CHANCE% за победу над боссом (растёт с находкой).
  const UNIQUE_CHANCE = 4;
  const UNIQUE_BASE = 1.25; // база уника мощнее обычной вещи того же тира
  const uniques = {
    boar_fang: {
      name: 'Клык Вожака', type: 'greataxe', tier: 2, boss: 'boar_king', minDiff: 0,
      mods: { atkPct: 0.35, defPct: -0.25 }, effects: ['shred'], best: 'troll_elder',
      effect: 'Каждое попадание дополнительно отнимает 6% текущего здоровья цели.',
      role: 'Против боссов и толстых врагов. Против мелочи — почти бесполезно, а защита ниже.',
      flavor: 'Старый секач сломал о него трёх охотников. Четвёртый сломал секача.',
    },
    boar_hide: {
      name: 'Шкура Секача', type: 'plate', tier: 2, boss: 'boar_king', minDiff: 0,
      mods: { hpPct: 0.4, thornsPct: 0.6, speedPct: -0.15 }, best: 'ataman',
      effect: '60% вашей защиты возвращается каждому, кто бьёт вас вблизи.',
      role: 'Танк против рукопашных монстров. Медленнее — враг чаще бьёт первым.',
      flavor: 'Щетина до сих пор колется. Особенно когда по ней бьют.',
    },
    thorn_crown: {
      name: 'Терновый венец', type: 'hat', tier: 3, boss: 'ancient_spirit', minDiff: 0,
      mods: { matkPct: 0.3, hpPct: -0.1 }, effects: ['spellPoison'], best: 'troll_elder',
      effect: 'Каждое заклинание оплетает цель терновым ядом: 50% маг. атаки каждый ход, 3 хода (складывается с обычным ядом).',
      role: 'Маг на долгие бои с боссами. Против нежити и големов с сопротивлением яду — слабее.',
      flavor: 'Корни прорастают сквозь мысли. Мысли от этого становятся острее.',
    },
    world_root: {
      name: 'Корень мира', type: 'amulet', tier: 3, boss: 'ancient_spirit', minDiff: 2,
      mods: { hpRegenPct: 0.06, dmgPct: -0.2 }, best: 'troll_elder',
      effect: 'Каждый ход восстанавливает 6% здоровья.',
      role: 'Выживание без зелий на долгой охоте. Урон заметно ниже.',
      flavor: 'Говорят, лес растёт, пока этот корень цел.',
    },
    chief_cleaver: {
      name: 'Тесак вождя', type: 'sword', tier: 4, boss: 'goblin_chief', minDiff: 0,
      mods: { stunChance: 30, block: 15, atkPct: 0.2, critDmg: -25 }, best: 'troll_elder',
      effect: '30% шанс оглушить при попадании, +15% блока, +20% атаки.',
      role: 'Контроль для воина со щитом. Криты слабее — не для сборки на крит.',
      flavor: 'Гоблины верят, что им можно оглушить даже гору. Пока не пробовали.',
    },
    greed_ring: {
      name: 'Кольцо жадности', type: 'ring', tier: 4, boss: 'goblin_chief', minDiff: 0,
      mods: { goldPct: 1.0, mf: 60, atkPct: -0.25, matkPct: -0.25 }, farm: true,
      effect: '+100% золота и +60% находки предметов.',
      role: 'Фарм на лёгкой сложности. В тяжёлых боях — обуза.',
      flavor: 'Вождь носил его, не снимая. Даже когда умирал.',
    },
    ataman_bow: {
      name: 'Лук атамана', type: 'bow', tier: 5, boss: 'ataman', minDiff: 0,
      mods: { crit: 15, atkPct: 0.2, critDmg: 30, hpPct: -0.2 }, effects: ['critShot'], best: 'troll_elder',
      effect: 'После каждого критического выстрела — сразу ещё один выстрел (70% урона).',
      role: 'Охотник на крит. Хрупкий: здоровья на четверть меньше.',
      flavor: 'На прикладе — двадцать зарубок. Последнюю делал не атаман.',
    },
    bandit_belt: {
      name: 'Пояс разбойника', type: 'belt', tier: 5, boss: 'ataman', minDiff: 2,
      mods: { speed: 60, atkPct: 0.35, critDmg: 20, hpPct: -0.1 }, effects: ['haste'], best: 'harpy',
      effect: '+60 скорости, шанс дополнительного удара удваивается.',
      role: 'Лишние удары против быстрых и вёртких врагов (гарпии, разбойники). Против толстокожих почти бесполезен, здоровья меньше.',
      flavor: 'Кто носит этот пояс, всегда успевает уйти. Почти всегда.',
    },
    stone_heart: {
      name: 'Каменное сердце', type: 'amulet', tier: 6, boss: 'troll_elder', minDiff: 0,
      mods: { defPct: 0.6, mdefPct: 0.8, speed: -20 }, effects: ['stoneHeart'], best: 'lich',
      effect: 'Иммунитет к оглушению, заморозке и замедлению; +60% защиты и +80% маг. защиты.',
      role: 'Против боссов с контролем (тролли, лич). Очень медленно: враг почти всегда бьёт первым.',
      flavor: 'Оно бьётся раз в сто лет. Но очень уверенно.',
    },
    giant_grip: {
      name: 'Длань великана', type: 'gauntlets', tier: 6, boss: 'troll_elder', minDiff: 3,
      mods: { atkPct: 0.2 }, effects: ['giantSlayer'], best: 'lich',
      effect: '+80% урона по врагам, у которых больше здоровья, чем у вас; −15% по остальным.',
      role: 'Убийца боссов. На обычной охоте вредит.',
      flavor: 'Сшита из перчатки тролля. Изнутри всё ещё тепло.',
    },
    phylactery: {
      name: 'Филактерия', type: 'orb', tier: 7, boss: 'lich', minDiff: 0,
      mods: { matkPct: 0.15, hpPct: -0.15 }, effects: ['phylactery'], best: 'troll_elder',
      effect: 'Раз за бой смертельный удар оставляет 1 здоровья и лечит 40%.',
      role: 'Страховка мага в тяжёлых боях. Меньше здоровья — чаще срабатывает, чем хотелось бы.',
      flavor: 'Лич держал в ней душу. Ваша там тоже поместится.',
    },
    winter_scythe: {
      name: 'Коса вечной зимы', type: 'staff', tier: 7, boss: 'lich', minDiff: 4,
      mods: { matkPct: 0.8, int: 12, mp: 90, mpRegen: 8, hpPct: 0.15, dmgReduce: 8, critDmg: -20 }, effects: ['frostScythe'], best: 'troll_elder',
      effect: 'Все заклинания — холодом и замедляют цель; 50% шанс заморозить; по замедленным врагам +40% урона.',
      role: 'Контроль-маг. Против врагов с сопротивлением холоду (призраки, лич) — плохо.',
      flavor: 'Лезвие не тает даже в огне. Огонь от этого гаснет.',
    },
  };
  for (const [id, u] of Object.entries(uniques)) u.id = id;

  // ---------- Заточка ----------
  // chance[n] — шанс перехода на +n. fail: что бывает при неудаче на этом шаге.
  const enhance = {
    max: 15,
    perLevel: 0.06,        // +6% к базовым характеристикам за уровень
    capByRank: [5, 7, 9, 11, 13, 15],
    chance: [0, 100, 95, 90, 85, 80, 70, 65, 58, 52, 45, 35, 28, 22, 16, 12],
    stone: (n) => (n <= 5 ? 'stone1' : n <= 10 ? 'stone2' : 'stone3'),
    fail: (n) => (n <= 5 ? 'none' : n <= 10 ? 'down' : 'break'),
    gold: (item, n) => Math.round(10 * item.tier * n * (1 + n / 5)),
    milestones: { 5: 'Случайный аффикс +1 тир', 10: 'Новый аффикс', 15: 'Все аффиксы +1 тир' },
  };

  // ---------- Минусовые свойства ----------
  // Как в EHT: у вещей средней редкости свойство может выпасть со знаком минус. Его можно перековать.
  const NEGATIVE = { chance: 10, rarities: [1, 2, 3], scale: 0.6 };

  // ---------- Знаки-добродетели (сетовые бонусы) ----------
  // Вещь получает случайный знак, когда ранг доходит до ★3. Бонус — за 2, 4 и 6 надетых вещей с одним знаком.
  const VIRTUE_RANK = 3;
  const virtues = {
    justice: { name: 'Справедливость', color: '#ffcf5a', sets: { 2: { dmgPct: 0.06 }, 4: { dmgPct: 0.14 }, 6: { dmgPct: 0.25 } } },
    fortitude: { name: 'Стойкость', color: '#7fb3ff', sets: { 2: { hpPct: 0.08 }, 4: { hpPct: 0.15, defPct: 0.1 }, 6: { hpPct: 0.25, defPct: 0.2, dmgReduce: 5 } } },
    wisdom: { name: 'Мудрость', color: '#b98cff', sets: { 2: { matkPct: 0.08 }, 4: { matkPct: 0.15, mdefPct: 0.15 }, 6: { matkPct: 0.25, mdefPct: 0.25, mpRegen: 5 } } },
    fury: { name: 'Ярость', color: '#ff6b5e', sets: { 2: { crit: 4 }, 4: { crit: 8, critDmg: 20 }, 6: { crit: 12, critDmg: 45 } } },
    fortune: { name: 'Удача', color: '#5fe0a0', sets: { 2: { goldPct: 0.15 }, 4: { goldPct: 0.3, mf: 20 }, 6: { goldPct: 0.5, mf: 40, expPct: 0.15 } } },
  };

  // ---------- Ранги ★ ----------
  const rank = {
    max: 5,
    perRank: 0.1,          // +10% к базовым характеристикам за звезду
    essence: (item) => (item.rank + 1) * 3 * item.tier,
    gold: (item) => (item.rank + 1) * 60 * item.tier,
  };

  // ---------- Материалы и расходники ----------
  const materials2 = {
    ore: { name: 'Железная руда', art: 'materials/ore', price: 4 },
    leather: { name: 'Выделанная кожа', art: 'materials/leather', price: 4 },
    essence: { name: 'Магическая эссенция', art: 'materials/essence', price: 10 },
    stone1: { name: 'Камень заточки I', art: 'materials/enhance_stone_1', price: 30, desc: 'Для заточки до +5.' },
    stone2: { name: 'Камень заточки II', art: 'materials/enhance_stone_2', price: 220, desc: 'Для заточки с +6 до +10.' },
    stone3: { name: 'Камень заточки III', art: 'materials/enhance_stone_3', price: 1500, desc: 'Для заточки с +11 до +15.' },
    protect: { name: 'Свиток защиты', art: 'materials/protect_scroll', price: 900, desc: 'Спасает вещь от поломки при заточке.' },
    reroll: { name: 'Свиток перековки', art: 'materials/reroll_scroll', price: 120, desc: 'Нужен чародейке для перековки свойств.' },
    // Зелья (действие — в data.consumables)
    hp_potion_1: { name: 'Малое зелье здоровья', art: 'materials/potion_hp_1', price: 30, kind: 'potion', desc: '+15% здоровья в бою.' },
    hp_potion_2: { name: 'Зелье здоровья', art: 'materials/potion_hp_2', price: 0, kind: 'potion', desc: '+25% здоровья в бою. Варит алхимик.' },
    hp_potion_3: { name: 'Большое зелье здоровья', art: 'materials/potion_hp_3', price: 0, kind: 'potion', desc: '+40% здоровья в бою. Варит алхимик.' },
    mp_potion_1: { name: 'Малое зелье ресурса', art: 'materials/potion_mp_1', price: 35, kind: 'potion', desc: '+25% ресурса в бою.' },
    mp_potion_2: { name: 'Зелье ресурса', art: 'materials/potion_mp_2', price: 0, kind: 'potion', desc: '+40% ресурса в бою. Варит алхимик.' },
    mp_potion_3: { name: 'Большое зелье ресурса', art: 'materials/potion_mp_3', price: 0, kind: 'potion', desc: '+60% ресурса в бою. Варит алхимик.' },
    // Эликсиры: действуют несколько побед подряд
    elixir_power: { name: 'Эликсир силы', art: 'materials/elixir_power', price: 0, kind: 'elixir', desc: '+12% всего урона на 8 побед.' },
    elixir_fortune: { name: 'Эликсир удачи', art: 'materials/elixir_fortune', price: 0, kind: 'elixir', desc: '+30% находки и +25% золота на 8 побед.' },
    // Материалы зон — для алхимии
    herb_stjohn: { name: 'Зверобой', art: 'materials/herb_stjohn', price: 3, kind: 'herb', desc: 'Растёт на Лесной опушке.' },
    spider_gland: { name: 'Паучья железа', art: 'materials/spider_gland', price: 3, kind: 'herb', desc: 'Лесная опушка.' },
    wolf_pelt: { name: 'Волчья шкура', art: 'materials/wolf_pelt', price: 6, kind: 'herb', desc: 'Глухой лес.' },
    spirit_moss: { name: 'Мох лесного духа', art: 'materials/spirit_moss', price: 6, kind: 'herb', desc: 'Глухой лес.' },
    goblin_brew: { name: 'Гоблинское варево', art: 'materials/goblin_brew', price: 9, kind: 'herb', desc: 'Гоблинская стоянка.' },
    shaman_root: { name: 'Шаманский корень', art: 'materials/shaman_root', price: 9, kind: 'herb', desc: 'Гоблинская стоянка.' },
    harpy_feather: { name: 'Перо гарпии', art: 'materials/harpy_feather', price: 12, kind: 'herb', desc: 'Старый тракт.' },
    stolen_spices: { name: 'Краденые специи', art: 'materials/stolen_spices', price: 12, kind: 'herb', desc: 'Старый тракт.' },
    rune_dust: { name: 'Рунная пыль', art: 'materials/rune_dust', price: 16, kind: 'herb', desc: 'Каменные холмы.' },
    golem_heart: { name: 'Сердце голема', art: 'materials/golem_heart', price: 16, kind: 'herb', desc: 'Каменные холмы.' },
    bone_meal: { name: 'Костная мука', art: 'materials/bone_meal', price: 20, kind: 'herb', desc: 'Затопленный склеп.' },
    ectoplasm: { name: 'Эктоплазма', art: 'materials/ectoplasm', price: 20, kind: 'herb', desc: 'Затопленный склеп.' },
  };

  // В лавке только малые зелья — остальные варит алхимик
  const shopStock = ['hp_potion_1', 'mp_potion_1', 'stone1', 'stone2', 'reroll', 'protect'];

  // Рецепты алхимика: out — что получится, n — сколько, need — материалы, gold — плата
  const recipes = [
    { out: 'hp_potion_1', n: 2, need: { herb_stjohn: 2 }, gold: 5 },
    { out: 'mp_potion_1', n: 2, need: { spider_gland: 2 }, gold: 5 },
    { out: 'hp_potion_2', n: 2, need: { spirit_moss: 2, wolf_pelt: 1 }, gold: 25 },
    { out: 'mp_potion_2', n: 2, need: { shaman_root: 2, goblin_brew: 1 }, gold: 25 },
    { out: 'hp_potion_3', n: 2, need: { golem_heart: 1, ectoplasm: 2 }, gold: 80 },
    { out: 'mp_potion_3', n: 2, need: { rune_dust: 2, bone_meal: 1 }, gold: 80 },
    { out: 'elixir_power', n: 1, need: { harpy_feather: 2, wolf_pelt: 2, goblin_brew: 1 }, gold: 120 },
    { out: 'elixir_fortune', n: 1, need: { stolen_spices: 2, rune_dust: 1, herb_stjohn: 3 }, gold: 150 },
  ];

  // Действие эликсиров: прибавки к статам и сколько побед длится
  const elixirs = {
    elixir_power: { battles: 8, mods: { dmgPct: 0.12 } },
    elixir_fortune: { battles: 8, mods: { mf: 30, goldPct: 0.25 } },
  };

  // Перековка у чародейки
  const reroll = {
    value: { scrolls: 1, gold: (item) => 20 * item.tier },
    affixes: { scrolls: 2, essence: (item) => 2 * item.tier, gold: (item) => 60 * item.tier, lockMult: 1.0 }, // +100% цены за каждый замок
  };

  // Перековка качества у чародейки
  const requality = { gold: (item) => 40 * item.tier, essence: (item) => item.tier };

  // Перенос заточки, ранга и знака на другую вещь того же вида (донор разбирается) — вложения не сгорают
  const inherit = { essence: (item) => 4 * item.tier, gold: (item) => 80 * item.tier };

  // Ковка у кузнеца: вещь выбранного типа и тира с редкостью не ниже «Необычной»
  const craft = {
    cost: (tier) => ({ main: 4 + 3 * tier, essence: 1 + tier, gold: 40 * tier * tier }),
    rarityFloor: 1,
    rarityBoost: 2,
  };

  Object.assign(data, {
    slots, TIER_LEVEL, MAX_TIER, adjectives: materials, types, rarities, qualities, affixes, TIER_FALLOFF,
    legendaries, uniques, UNIQUE_CHANCE, UNIQUE_BASE, enhance, rank, materials: materials2, shopStock, recipes, elixirs, reroll, craft, NEGATIVE, VIRTUE_RANK, virtues, requality, inherit,
  });
  if (typeof module !== 'undefined') module.exports = PC;
})(typeof window !== 'undefined' ? window : globalThis);
