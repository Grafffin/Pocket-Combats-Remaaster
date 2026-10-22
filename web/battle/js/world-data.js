// Данные мира: локации и переходы между ними, NPC, лавка, заточка.
// В оригинале локации, маршруты (с длительностью перехода) и NPC приходили с сервера (api/location/...).
(function (root) {
  'use strict';
  const PC = root.PC || (root.PC = {});
  const data = PC.data;

  const HOME = 'village';

  // routes: { куда: секунд в пути }. levels — подсказка, на какой уровень рассчитана локация.
  const locations = {
    village: {
      name: 'Пыльный Брод', levels: null, safe: true,
      desc: 'Деревня на краю леса. Тут можно перевести дух, продать добычу и подлатать снаряжение.',
      monsters: ['dummy'],
      npcs: ['shop', 'buyer', 'smith'],
      routes: { forest_edge: 8 },
    },
    forest_edge: {
      name: 'Лесная опушка', levels: [1, 2],
      desc: 'Светлый подлесок сразу за частоколом. В траве шуршат крысы, между деревьями блестит паутина.',
      monsters: ['rat', 'spider'],
      routes: { village: 8, deep_forest: 12, old_road: 15 },
    },
    deep_forest: {
      name: 'Глухой лес', levels: [3, 4],
      desc: 'Ели смыкаются над головой, и днём здесь сумрачно. Волки охотятся стаей и нападают первыми.',
      monsters: ['wolf', 'spider'],
      routes: { forest_edge: 12, goblin_camp: 15 },
    },
    goblin_camp: {
      name: 'Гоблинская стоянка', levels: [4, 5],
      desc: 'Дым от костров, кости и ржавые котлы. Шаманы бормочут заклинания над варевом.',
      monsters: ['shaman', 'wolf'],
      routes: { deep_forest: 15 },
    },
    old_road: {
      name: 'Старый тракт', levels: [6, 7],
      desc: 'Заброшенная дорога через холмы. Купцы давно здесь не ездят — на тракте хозяйничают разбойники.',
      monsters: ['bandit', 'wolf'],
      routes: { forest_edge: 15, stone_hills: 20 },
    },
    stone_hills: {
      name: 'Каменные холмы', levels: [8, 9],
      desc: 'Валуны размером с избу. Говорят, один из них иногда встаёт и уходит.',
      monsters: ['troll', 'bandit'],
      routes: { old_road: 20 },
    },
  };

  // Шанс, что агрессивный монстр нападёт по прибытии на локацию
  const AMBUSH_CHANCE = 30;
  // Сколько золота теряется при поражении (персонаж приходит в себя в деревне)
  const DEATH_GOLD_LOSS = 0.1;

  const npcs = {
    shop: {
      name: 'Лавка Марфы', emoji: '🏪',
      desc: 'Зелья и простое снаряжение для начинающих.',
      greeting: 'Проходи, не стесняйся. Всё свежее, почти не ржавое.',
      stock: [
        'hp_potion', 'mp_potion',
        'rusty_sword', 'short_sword', 'short_bow', 'hunting_bow', 'novice_staff', 'ash_staff',
        'wooden_shield', 'leather_cap', 'quilted', 'leather_jacket', 'novice_robe', 'boots', 'leather_gloves',
      ],
    },
    buyer: {
      name: 'Скупщик Ефим', emoji: '⚖️',
      desc: 'Купит всё, что вы принесли с охоты. За четверть цены.',
      greeting: 'Показывай, что притащил. Только не торгуйся — не люблю.',
    },
    smith: {
      name: 'Кузнец Тарас', emoji: '⚒️',
      desc: 'Заточка оружия и доспехов. Чем выше заточка, тем выше риск.',
      greeting: 'До +4 точу без риска — в худшем случае потеряешь деньги. Дальше металл может не выдержать.',
    },
  };

  // Заточка: шанс успеха для перехода на уровень N (индекс = целевой уровень).
  // До SAFE_REFINE неудача стоит только денег, выше — предмет ломается.
  const refine = {
    max: 7,
    safe: 4,
    chance: [0, 100, 95, 85, 70, 55, 40, 30],
    costFactor: 0.25,
  };

  // Цена зелий; цена вещей считается по уровню (economy.priceOf), здесь можно переопределить
  const prices = { hp_potion: 12, mp_potion: 15 };

  // Золото с монстров и агрессивность (нападают первыми при входе на локацию)
  const monsterExtras = {
    dummy: { gold: [0, 0] },
    rat: { gold: [2, 5] },
    spider: { gold: [3, 7] },
    wolf: { gold: [6, 12], aggressive: true },
    shaman: { gold: [8, 15] },
    bandit: { gold: [15, 30], aggressive: true },
    troll: { gold: [60, 100] },
  };
  for (const [id, extra] of Object.entries(monsterExtras)) Object.assign(data.monsters[id], extra);

  Object.assign(data, { HOME, locations, npcs, refine, prices, AMBUSH_CHANCE, DEATH_GOLD_LOSS });
  if (typeof module !== 'undefined') module.exports = PC;
})(typeof window !== 'undefined' ? window : globalThis);
