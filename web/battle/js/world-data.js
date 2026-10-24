// Мир (GDD §7): зоны, переходы, NPC деревни.
(function (root) {
  'use strict';
  const PC = root.PC || (root.PC = {});
  const data = PC.data || (PC.data = {});

  const HOME = 'village';

  // monsters: [id, мин. уровень, макс. уровень]. boss: [id, уровень] — открывается после BOSS_KILLS побед в зоне.
  // tier — тир вещей и материалов зоны (1…7). routes: { куда: секунд в пути }.
  const locations = {
    village: {
      name: 'Пыльный Брод', levels: null, safe: true, tier: 1, art: 'locations/village',
      desc: 'Деревня на краю леса. Тут можно перевести дух, продать добычу и подлатать снаряжение.',
      monsters: [['dummy', 1, 1]],
      npcs: ['shop', 'buyer', 'market', 'smith', 'enchanter', 'alchemist', 'stash'],
      routes: { forest_edge: 6 },
    },
    forest_edge: {
      name: 'Лесная опушка', levels: [1, 5], tier: 1, art: 'locations/forest_edge',
      desc: 'Светлый подлесок за частоколом. В траве шуршат крысы, между деревьями блестит паутина.',
      monsters: [['rat', 1, 3], ['spider', 2, 4], ['boar', 3, 5]], mats: ['herb_stjohn', 'spider_gland'],
      boss: ['boar_king', 6],
      routes: { village: 6, deep_forest: 10 },
    },
    deep_forest: {
      name: 'Глухой лес', levels: [5, 10], tier: 2, art: 'locations/deep_forest',
      desc: 'Ели смыкаются над головой, и днём здесь сумрачно. Волки охотятся стаей.',
      monsters: [['wolf', 5, 8], ['spider', 6, 9], ['forest_spirit', 7, 10]], mats: ['wolf_pelt', 'spirit_moss'],
      boss: ['ancient_spirit', 11],
      routes: { forest_edge: 10, goblin_camp: 12 },
    },
    goblin_camp: {
      name: 'Гоблинская стоянка', levels: [10, 15], tier: 3, art: 'locations/goblin_camp',
      desc: 'Дым от костров, кости и ржавые котлы. Шаманы бормочут заклинания над варевом.',
      monsters: [['goblin_warrior', 10, 13], ['goblin_shaman', 11, 14], ['wolf', 12, 15]], mats: ['goblin_brew', 'shaman_root'],
      boss: ['goblin_chief', 16],
      routes: { deep_forest: 12, old_road: 14 },
    },
    old_road: {
      name: 'Старый тракт', levels: [15, 20], tier: 4, art: 'locations/old_road',
      desc: 'Заброшенная дорога через холмы. Купцы давно здесь не ездят — на тракте хозяйничают разбойники.',
      monsters: [['bandit', 15, 18], ['bandit_archer', 16, 19], ['harpy', 17, 20]], mats: ['harpy_feather', 'stolen_spices'],
      boss: ['ataman', 21],
      routes: { goblin_camp: 14, stone_hills: 16 },
    },
    stone_hills: {
      name: 'Каменные холмы', levels: [20, 27], tier: 5, art: 'locations/stone_hills',
      desc: 'Валуны размером с избу. Говорят, один из них иногда встаёт и уходит.',
      monsters: [['golem', 20, 24], ['harpy', 21, 25], ['stone_troll', 23, 27]], mats: ['rune_dust', 'golem_heart'],
      boss: ['troll_elder', 28],
      routes: { old_road: 16, flooded_crypt: 18 },
    },
    flooded_crypt: {
      name: 'Затопленный склеп', levels: [27, 35], tier: 6, art: 'locations/flooded_crypt',
      desc: 'Руины склепа наполовину под водой. Из тёмных арок тянет холодом и тихим шёпотом.',
      monsters: [['skeleton', 27, 31], ['ghoul', 28, 33], ['wraith', 30, 35]], mats: ['bone_meal', 'ectoplasm'],
      boss: ['lich', 36],
      final: true, // последний босс мира: победа открывает следующую сложность
      routes: { stone_hills: 18 },
    },
  };

  // Сложность мира (по мотивам Torment в EHT) — общая для всех зон. Следующая открывается победой над
  // последним боссом мира (зона с final: true) на текущей сложности. Цель — гриндить характеристики и вещи,
  // а не просто проходить мобов. mult — во сколько раз сильнее монстры (здоровье и атака; защита прежняя).
  // ilvl — прибавка к уровню выпавших вещей (сильнее база и плоские свойства), mf — к находке.
  // Гарантий редкости нет: на неё влияет только находка (mf). anim — анимация значка в шапке.
  const difficulties = [
    { id: 0, name: 'Обычная', short: 'I', mult: 1, exp: 1, gold: 1, ilvl: 0, mf: 0, stone3: 0, color: '#8b93a7', anim: 'calm' },
    { id: 1, name: 'Кошмар', short: 'II', mult: 2, exp: 1.6, gold: 1.6, ilvl: 4, mf: 40, stone3: 3, color: '#b27bff', anim: 'pulse' },
    { id: 2, name: 'Ад', short: 'III', mult: 4, exp: 2.4, gold: 2.4, ilvl: 8, mf: 80, stone3: 6, color: '#ff9f3d', anim: 'flame' },
    { id: 3, name: 'Пытка I', short: 'IV', mult: 7, exp: 3.4, gold: 3.4, ilvl: 12, mf: 130, stone3: 10, color: '#ff4d5e', anim: 'blood' },
    { id: 4, name: 'Пытка II', short: 'V', mult: 12, exp: 4.6, gold: 4.6, ilvl: 16, mf: 190, stone3: 15, color: '#ff4d5e', anim: 'blood' },
    { id: 5, name: 'Пытка III', short: 'VI', mult: 20, exp: 6, gold: 6, ilvl: 20, mf: 260, stone3: 20, color: '#ff2a3d', anim: 'rage' },
    { id: 6, name: 'Пытка IV', short: 'VII', mult: 32, exp: 8, gold: 8, ilvl: 24, mf: 340, stone3: 28, color: '#3fe0d0', anim: 'void' },
    { id: 7, name: 'Пытка V', short: 'VIII', mult: 50, exp: 10, gold: 10, ilvl: 28, mf: 430, stone3: 36, color: '#f0c46a', anim: 'void' },
  ];

  const BOSS_KILLS = 10;           // побед в зоне до появления босса
  const DEATH_GOLD_LOSS = 0.1;     // поражение стоит 10% золота и возвращает в деревню

  const npcs = {
    shop: { name: 'Лавка Марфы', art: 'npcs/shopkeeper', emoji: '🏪', desc: 'Зелья, камни заточки и свитки.', greeting: 'Проходи, не стесняйся. Всё свежее, почти не ржавое.' },
    buyer: { name: 'Скупщик Ефим', art: 'npcs/buyer', emoji: '⚖️', desc: 'Купит всё, что вы принесли с охоты.', greeting: 'Показывай, что притащил. Только не торгуйся — не люблю.' },
    smith: { name: 'Кузнец Тарас', art: 'npcs/blacksmith', emoji: '⚒️', desc: 'Заточка, ранги, разбор и ковка.', greeting: 'До +5 точу без риска. Дальше металл может и не выдержать — бери свиток защиты.' },
    alchemist: { name: 'Алхимик Зоряна', art: 'npcs/alchemist', emoji: '⚗️', desc: 'Зелья и эликсиры из материалов охоты.', greeting: 'Принеси травы да железы — сварю такое, что мёртвого поднимет. Ну, почти.' },
    market: { name: 'Торговый ряд', art: 'npcs/market', emoji: '🏷️', desc: 'Рынок игроков: купить и выставить вещи.', greeting: 'Тут торгуют такие же охотники, как ты. Цену ставит продавец, рынок берёт свои 5%.' },
    stash: { name: 'Личный сундук', art: 'npcs/chest', emoji: '🧰', desc: 'Хранилище на 300 вещей, общее для всех ваших героев.', greeting: 'Тяжёлая крышка со скрипом поднимается.' },
    enchanter: { name: 'Чародейка Велена', art: 'npcs/enchanter', emoji: '🔮', desc: 'Перековка свойств вещей.', greeting: 'Свойства вещи — как нити. Потяну за одну, и узор сложится иначе.' },
  };

  Object.assign(data, { HOME, locations, npcs, difficulties, BOSS_KILLS, DEATH_GOLD_LOSS });
  if (typeof module !== 'undefined') module.exports = PC;
})(typeof window !== 'undefined' ? window : globalThis);
