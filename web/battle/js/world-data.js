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
      npcs: ['shop', 'buyer', 'smith', 'enchanter'],
      routes: { forest_edge: 6 },
    },
    forest_edge: {
      name: 'Лесная опушка', levels: [1, 5], tier: 1, art: 'locations/forest_edge',
      desc: 'Светлый подлесок за частоколом. В траве шуршат крысы, между деревьями блестит паутина.',
      monsters: [['rat', 1, 3], ['spider', 2, 4], ['boar', 3, 5]],
      boss: ['boar_king', 6],
      routes: { village: 6, deep_forest: 10 },
    },
    deep_forest: {
      name: 'Глухой лес', levels: [5, 10], tier: 2, art: 'locations/deep_forest',
      desc: 'Ели смыкаются над головой, и днём здесь сумрачно. Волки охотятся стаей.',
      monsters: [['wolf', 5, 8], ['spider', 6, 9], ['forest_spirit', 7, 10]],
      boss: ['ancient_spirit', 11],
      routes: { forest_edge: 10, goblin_camp: 12 },
    },
    goblin_camp: {
      name: 'Гоблинская стоянка', levels: [10, 15], tier: 3, art: 'locations/goblin_camp',
      desc: 'Дым от костров, кости и ржавые котлы. Шаманы бормочут заклинания над варевом.',
      monsters: [['goblin_warrior', 10, 13], ['goblin_shaman', 11, 14], ['wolf', 12, 15]],
      boss: ['goblin_chief', 16],
      routes: { deep_forest: 12, old_road: 14 },
    },
    old_road: {
      name: 'Старый тракт', levels: [15, 20], tier: 4, art: 'locations/old_road',
      desc: 'Заброшенная дорога через холмы. Купцы давно здесь не ездят — на тракте хозяйничают разбойники.',
      monsters: [['bandit', 15, 18], ['bandit_archer', 16, 19], ['harpy', 17, 20]],
      boss: ['ataman', 21],
      routes: { goblin_camp: 14, stone_hills: 16 },
    },
    stone_hills: {
      name: 'Каменные холмы', levels: [20, 27], tier: 5, art: 'locations/stone_hills',
      desc: 'Валуны размером с избу. Говорят, один из них иногда встаёт и уходит.',
      monsters: [['golem', 20, 24], ['harpy', 21, 25], ['stone_troll', 23, 27]],
      boss: ['troll_elder', 28],
      routes: { old_road: 16, flooded_crypt: 18 },
    },
    flooded_crypt: {
      name: 'Затопленный склеп', levels: [27, 35], tier: 6, art: 'locations/flooded_crypt',
      desc: 'Руины склепа наполовину под водой. Из тёмных арок тянет холодом и тихим шёпотом.',
      monsters: [['skeleton', 27, 31], ['ghoul', 28, 33], ['wraith', 30, 35]],
      boss: ['lich', 36],
      routes: { stone_hills: 18 },
    },
  };

  const BOSS_KILLS = 10;           // побед в зоне до появления босса
  const AMBUSH_CHANCE = 0;         // засады отключены: в гриндилке мешают автобою
  const DEATH_GOLD_LOSS = 0.1;     // поражение стоит 10% золота и возвращает в деревню

  const npcs = {
    shop: { name: 'Лавка Марфы', art: 'npcs/shopkeeper', emoji: '🏪', desc: 'Зелья, камни заточки и свитки.', greeting: 'Проходи, не стесняйся. Всё свежее, почти не ржавое.' },
    buyer: { name: 'Скупщик Ефим', art: 'npcs/buyer', emoji: '⚖️', desc: 'Купит всё, что вы принесли с охоты.', greeting: 'Показывай, что притащил. Только не торгуйся — не люблю.' },
    smith: { name: 'Кузнец Тарас', art: 'npcs/blacksmith', emoji: '⚒️', desc: 'Заточка, ранги, разбор и ковка.', greeting: 'До +5 точу без риска. Дальше металл может и не выдержать — бери свиток защиты.' },
    enchanter: { name: 'Чародейка Велена', art: 'npcs/enchanter', emoji: '🔮', desc: 'Перековка свойств вещей.', greeting: 'Свойства вещи — как нити. Потяну за одну, и узор сложится иначе.' },
  };

  Object.assign(data, { HOME, locations, npcs, BOSS_KILLS, AMBUSH_CHANCE, DEATH_GOLD_LOSS });
  if (typeof module !== 'undefined') module.exports = PC;
})(typeof window !== 'undefined' ? window : globalThis);
