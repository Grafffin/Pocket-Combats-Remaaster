// Английский перевод игровых данных: вещи, материалы, умения, монстры, классы, места. Ключ — русская строка из данных
// (для названий видов вещей — основа без «/m», «/pl»: «шлем/m» → «шлем»).
(function () {
  const o = {};
  // прилагательные названий вещей: мужской, женский, средний, множественное — одно английское слово
  const adj = (en, ...forms) => { for (const f of forms) o[f] = en; };
  adj('Rusty', 'Ржавый', 'Ржавая', 'Ржавое', 'Ржавые');
  adj('Iron', 'Железный', 'Железная', 'Железное', 'Железные');
  adj('Steel', 'Стальной', 'Стальная', 'Стальное', 'Стальные');
  adj('Runic', 'Рунный', 'Рунная', 'Рунное', 'Рунные');
  adj('Mithril', 'Мифриловый', 'Мифриловая', 'Мифриловое', 'Мифриловые');
  adj('Dragon', 'Драконий', 'Драконья', 'Драконье', 'Драконьи');
  adj('Ancient', 'Древний', 'Древняя', 'Древнее', 'Древние');
  adj('Crooked', 'Кривой', 'Кривая', 'Кривое', 'Кривые');
  adj('Yew', 'Тисовый', 'Тисовая', 'Тисовое', 'Тисовые');
  adj('Ashwood', 'Ясеневый', 'Ясеневая', 'Ясеневое', 'Ясеневые');
  adj('Elven', 'Эльфийский', 'Эльфийская', 'Эльфийское', 'Эльфийские');
  adj('Worn', 'Потёртый', 'Потёртая', 'Потёртое', 'Потёртые');
  adj('Tanned', 'Дублёный', 'Дублёная', 'Дублёное', 'Дублёные');
  adj('Studded', 'Клёпаный', 'Клёпаная', 'Клёпаное', 'Клёпаные');
  adj('Shadow', 'Теневой', 'Теневая', 'Теневое', 'Теневые');
  adj('Canvas', 'Холщовый', 'Холщовая', 'Холщовое', 'Холщовые');
  adj('Linen', 'Льняной', 'Льняная', 'Льняное', 'Льняные');
  adj('Silken', 'Шёлковый', 'Шёлковая', 'Шёлковое', 'Шёлковые');
  adj('Enchanted', 'Зачарованный', 'Зачарованная', 'Зачарованное', 'Зачарованные');
  adj('Starlit', 'Звёздный', 'Звёздная', 'Звёздное', 'Звёздные');
  adj('Brittle', 'Хрупкий', 'Хрупкая', 'Хрупкое', 'Хрупкие');
  adj('Beetle', 'Жучиный', 'Жучиная', 'Жучиное', 'Жучиные');
  adj('Horned', 'Роговой', 'Роговая', 'Роговое', 'Роговые');
  adj('Scorpion', 'Скорпионий', 'Скорпионья', 'Скорпионье', 'Скорпионьи');
  adj('Royal', 'Королевский', 'Королевская', 'Королевское', 'Королевские');
  adj('Copper', 'Медный', 'Медная', 'Медное', 'Медные');
  adj('Silver', 'Серебряный', 'Серебряная', 'Серебряное', 'Серебряные');
  adj('Golden', 'Золотой', 'Золотая', 'Золотое', 'Золотые');
  Object.assign(o, {
    // виды оружия и аксессуаров (названия с заглавной: «Rusty Sword»)
    'меч': 'Sword', 'булава': 'Mace', 'топор': 'Axe', 'двуручный меч': 'Greatsword', 'секира': 'Poleaxe', 'лук': 'Bow', 'арбалет': 'Crossbow',
    'посох': 'Staff', 'жезл': 'Wand', 'щит': 'Shield', 'сфера': 'Orb',
    // материалы брони
    'Латы': 'Plate', 'Самая высокая защита от оружия и больше здоровья. Тяжёлые: медленнее, мешают колдовать, магию почти не держат.': 'The highest weapon defense and more health. Heavy: slower, hinders spellcasting, barely resists magic.',
    'Кожа': 'Leather', 'Средняя защита, зато быстрее и чаще бьёт критом; вариации добавляют уклонение, крит или меткость. Магию держит хуже остальных.': 'Medium defense, but faster and crits more often; variants add evasion, crit or accuracy. Resists magic worse than the rest.',
    'Ткань': 'Cloth', 'Магическая защита и сила заклинаний. Тонкая: меньше здоровья, оружие пробивает легко.': 'Magic defense and spell power. Thin: less health, weapons pierce it easily.',
    'Хитин': 'Chitin', 'Держит и оружие, и магию, бережёт от яда. Жёсткий: уклоняться труднее.': 'Holds up against both weapons and magic, protects from poison. Rigid: harder to dodge in.',
    // латы
    'шлем': 'Helm', 'латы': 'Plate Armor', 'наручи': 'Gauntlets', 'сабатоны': 'Sabatons', 'классика': 'classic',
    'армет': 'Armet', 'кираса': 'Cuirass', 'рукавицы': 'Mitts', 'поножи': 'Greaves', 'ещё больше защиты, ещё медленнее': 'even more defense, even slower',
    'бацинет': 'Bascinet', 'кольчуга': 'Chainmail', 'поручи': 'Vambraces', 'солереты': 'Solerets', 'легче: почти не замедляет': 'lighter: barely slows you down',
    'шишак': 'Sallet', 'бригантина': 'Brigandine', 'кастеты': 'Knuckle Guards', 'наколенники': 'Poleyns', 'шипы': 'spikes',
    'барбют': 'Barbute', 'доспех': 'Harness', 'налокотники': 'Couters', 'ботфорты': 'Riding Boots', 'немного маг. защиты': 'a little magic defense',
    // кожа
    'капюшон': 'Hood', 'куртка': 'Jacket', 'перчатки': 'Gloves', 'сапоги': 'Boots', 'уклонение': 'evasion',
    'бандана': 'Bandana', 'колет': 'Jerkin', 'напульсники': 'Wristbands', 'мокасины': 'Moccasins', 'скорость': 'speed',
    'маска': 'Mask', 'дублет': 'Doublet', 'краги': 'Bracers', 'ботинки': 'Ankle Boots', 'шанс крита': 'crit chance',
    'треуголка': 'Tricorne', 'жилет': 'Vest', 'митенки': 'Fingerless Gloves', 'полусапожки': 'Half-boots', 'точность': 'accuracy',
    'шапка': 'Cap', 'нагрудник': 'Chest Guard', 'нарукавники': 'Sleeves', 'унты': 'Fur Boots', 'плотнее: защита и здоровье': 'denser: defense and health',
    // ткань
    'колпак': 'Pointed Hat', 'мантия': 'Robe', 'обмотки': 'Wraps', 'туфли': 'Slippers', 'маг. атака': 'magic attack',
    'чепец': 'Coif', 'ряса': 'Cassock', 'манжеты': 'Cuffs', 'чулки': 'Stockings', 'мана': 'mana',
    'тюрбан': 'Turban', 'халат': 'Gown', 'нарукавья': 'Armlets', 'сандалии': 'Sandals', 'интеллект': 'intellect',
    'вуаль': 'Veil', 'хламида': 'Chlamys', 'бинты': 'Bandages', 'гетры': 'Gaiters', 'оберег: больше защиты обоих видов': 'ward: more defense of both kinds',
    'повязка': 'Headband', 'балахон': 'Smock', 'рукава': 'Long Sleeves', 'шаровары': 'Sarouel',
    // хитин
    'наголовник': 'Headpiece', 'панцирь': 'Carapace', 'щитки': 'Plates', 'голенища': 'Shin Guards', 'гребень': 'Crest',
    'карапакс': 'Carapax', 'когти': 'Claws', 'шпоры': 'Spurs', 'купол': 'Dome', 'скорлупа': 'Shell', 'клешни': 'Pincers', 'копыта': 'Hooves',
    'твёрже: больше защиты от оружия': 'harder: more weapon defense',
    'личина': 'Visage', 'покров': 'Mantle', 'хваты': 'Grips', 'ходули': 'Stilts', 'сопротивление огню и холоду': 'fire and cold resistance',
    'рогач': 'Stag Beetle', 'кокон': 'Cocoon', 'лапы': 'Paws', 'ступни': 'Treads', 'здоровье каждый ход': 'health every turn',
    // аксессуары
    'пояс': 'Belt', 'кушак': 'Sash', 'ремень': 'Strap', 'перевязь': 'Baldric', 'кошель': 'Pouch',
    'амулет': 'Amulet', 'медальон': 'Medallion', 'кулон': 'Pendant', 'талисман': 'Talisman', 'ожерелье': 'Necklace',
    'кольцо': 'Ring', 'перстень': 'Signet', 'печатка': 'Seal Ring', 'серьга': 'Earring', 'браслет': 'Bracelet',
    // редкость и качество
    'Обычный': 'Common', 'Необычный': 'Uncommon', 'Редкий': 'Rare', 'Героический': 'Heroic', 'Легендарный': 'Legendary', 'Мифический': 'Mythic',
    'Ветхое': 'Shabby', 'Обычное': 'Plain', 'Добротное': 'Sturdy', 'Отличное': 'Excellent', 'Безупречное': 'Flawless',
    // уникальные эффекты
    'Гром небесный': 'Heavenly Thunder', '15% шанс при ударе ударить молнией на 80% атаки.': '15% chance on hit to strike with lightning for 80% of attack.',
    'Неутолимая жажда': 'Unquenchable Thirst', 'Вампиризм удваивается, пока здоровье ниже 30%.': 'Lifesteal doubles while health is below 30%.',
    'Эхо': 'Echo', '20% шанс, что умение не уйдёт на перезарядку.': '20% chance that a skill does not go on cooldown.',
    'В начале боя щит на 15% здоровья.': 'A shield for 15% of health at the start of battle.',
    'Первая кровь': 'First Blood', 'Первый удар в бою всегда критический.': 'The first hit in a battle is always a critical.',
    'Палач': 'Executioner', '+60% урона по целям ниже 25% здоровья.': '+60% damage to targets below 25% health.',
    'Холодное сердце': 'Cold Heart', 'Замедленные враги получают +30% урона.': 'Slowed enemies take +30% damage.',
    'Золотая лихорадка': 'Gold Fever', '+50% золота, но −10% защиты.': '+50% gold, but −10% defense.',
    'Кровь берсерка': 'Berserker Blood', 'До +50% урона по мере потери здоровья.': 'Up to +50% damage as health is lost.',
    'Раз за бой при здоровье ниже 20% восстанавливает 30%.': 'Once per battle, below 20% health, restores 30%.',
    'Ядовитое жало': 'Venomous Sting', 'Каждое попадание отравляет на 3 хода.': 'Every hit poisons for 3 turns.',
    'Зеркальный щит': 'Mirror Shield', '20% шанс отразить половину полученного урона.': '20% chance to reflect half of the damage taken.',
    'Неиссякаемый источник': 'Bottomless Well', 'Умения стоят на 30% меньше ресурса.': 'Skills cost 30% less resource.',
    'Первое попадание помечает цель: +20% получаемого урона до конца боя.': 'The first hit marks the target: +20% damage taken until the end of battle.',
    'Клык Вожака': "Packleader's Fang", 'Каждое попадание дополнительно отнимает 6% текущего здоровья цели.': 'Every hit also removes 6% of the target\'s current health.',
    'Против боссов и толстых врагов. Против мелочи — почти бесполезно, а защита ниже.': 'For bosses and tanky enemies. Almost useless against small fry, and defense is lower.',
    'Старый секач сломал о него трёх охотников. Четвёртый сломал секача.': 'The old boar broke three hunters on it. The fourth broke the boar.',
    'Шкура Секача': "Boar's Hide", '60% вашей защиты возвращается каждому, кто бьёт вас вблизи.': '60% of your defense is returned to anyone who hits you in melee.',
    'Танк против рукопашных монстров. Медленнее — враг чаще бьёт первым.': 'A tank against melee monsters. Slower: the enemy strikes first more often.',
    'Щетина до сих пор колется. Особенно когда по ней бьют.': 'The bristles still prick. Especially when struck.',
    'Терновый венец': 'Crown of Thorns', 'Каждое заклинание оплетает цель терновым ядом: 50% маг. атаки каждый ход, 3 хода (складывается с обычным ядом).': 'Every spell wraps the target in thorn venom: 50% magic attack each turn for 3 turns (stacks with regular poison).',
    'Маг на долгие бои с боссами. Против нежити и големов с сопротивлением яду — слабее.': 'A mage for long boss fights. Weaker against undead and golems that resist poison.',
    'Корни прорастают сквозь мысли. Мысли от этого становятся острее.': 'Roots grow through your thoughts. The thoughts grow sharper for it.',
    'Корень мира': 'World Root', 'Каждый ход восстанавливает 6% здоровья.': 'Restores 6% health every turn.',
    'Выживание без зелий на долгой охоте. Урон заметно ниже.': 'Survival without potions on a long hunt. Damage is noticeably lower.',
    'Говорят, лес растёт, пока этот корень цел.': 'They say the forest grows as long as this root is whole.',
    'Тесак вождя': "Chieftain's Cleaver", '30% шанс оглушить при попадании, +15% блока, +20% атаки.': '30% chance to stun on hit, +15% block, +20% attack.',
    'Контроль для воина со щитом. Криты слабее — не для сборки на крит.': 'Control for a warrior with a shield. Crits are weaker — not for a crit build.',
    'Гоблины верят, что им можно оглушить даже гору. Пока не пробовали.': 'Goblins believe it could stun even a mountain. They have not tried yet.',
    'Кольцо жадности': 'Ring of Greed', '+100% золота и +60% находки предметов.': '+100% gold and +60% item find.',
    'Фарм на лёгкой сложности. В тяжёлых боях — обуза.': 'For farming on easy difficulty. A burden in hard fights.',
    'Вождь носил его, не снимая. Даже когда умирал.': 'The chieftain never took it off. Not even as he died.',
    'Лук атамана': "Warlord's Bow", 'После каждого критического выстрела — сразу ещё один выстрел (70% урона).': 'After every critical shot, another shot follows at once (70% damage).',
    'Охотник на крит. Хрупкий: здоровья на четверть меньше.': 'A crit hunter. Fragile: a quarter less health.',
    'На прикладе — двадцать зарубок. Последнюю делал не атаман.': 'Twenty notches on the stock. The last one was not made by the warlord.',
    'Пояс разбойника': "Bandit's Belt", '+60 скорости, шанс дополнительного удара удваивается.': '+60 speed, the chance of an extra strike is doubled.',
    'Лишние удары против быстрых и вёртких врагов (гарпии, разбойники). Против толстокожих почти бесполезен, здоровья меньше.': 'Extra strikes against fast, nimble enemies (harpies, bandits). Almost useless against thick-skinned ones, and less health.',
    'Кто носит этот пояс, всегда успевает уйти. Почти всегда.': 'Whoever wears this belt always gets away in time. Almost always.',
    'Каменное сердце': 'Stone Heart', 'Иммунитет к оглушению, заморозке и замедлению; +60% защиты и +80% маг. защиты.': 'Immunity to stun, freeze and slow; +60% defense and +80% magic defense.',
    'Против боссов с контролем (тролли, лич). Очень медленно: враг почти всегда бьёт первым.': 'Against bosses with crowd control (trolls, the lich). Very slow: the enemy almost always strikes first.',
    'Оно бьётся раз в сто лет. Но очень уверенно.': 'It beats once every hundred years. But very confidently.',
    'Длань великана': "Giant's Hand", '+80% урона по врагам, у которых больше здоровья, чем у вас; −15% по остальным.': '+80% damage to enemies with more health than you; −15% against the rest.',
    'Убийца боссов. На обычной охоте вредит.': 'A boss killer. Harmful on ordinary hunts.',
    'Сшита из перчатки тролля. Изнутри всё ещё тепло.': "Sewn from a troll's glove. Still warm inside.",
    'Филактерия': 'Phylactery', 'Раз за бой смертельный удар оставляет 1 здоровья и лечит 40%.': 'Once per battle, a lethal blow leaves 1 health and heals 40%.',
    'Страховка мага в тяжёлых боях. Меньше здоровья — чаще срабатывает, чем хотелось бы.': "A mage's insurance in hard fights. Less health — it triggers more often than you'd like.",
    'Лич держал в ней душу. Ваша там тоже поместится.': 'The lich kept his soul in it. Yours will fit too.',
    'Коса вечной зимы': 'Scythe of Eternal Winter', 'Все заклинания — холодом и замедляют цель; 50% шанс заморозить; по замедленным врагам +40% урона.': 'All spells are cold and slow the target; 50% chance to freeze; +40% damage to slowed enemies.',
    'Контроль-маг. Против врагов с сопротивлением холоду (призраки, лич) — плохо.': 'A control mage. Bad against enemies that resist cold (ghosts, the lich).',
    'Лезвие не тает даже в огне. Огонь от этого гаснет.': 'The blade does not melt even in fire. The fire goes out instead.',
    'Случайный аффикс +1 тир': 'Random affix +1 tier', 'Новый аффикс': 'New affix', 'Все аффиксы +1 тир': 'All affixes +1 tier',
    'Справедливость': 'Justice', 'Стойкость': 'Fortitude', 'Мудрость': 'Wisdom', 'Удача': 'Luck',
    'Магическая эссенция': 'Magic Essence',
    // расходники и материалы
    'Камень заточки I': 'Enhancement Stone I', 'Для заточки до +5.': 'For enhancing up to +5.',
    'Камень заточки II': 'Enhancement Stone II', 'Для заточки с +6 до +10.': 'For enhancing from +6 to +10.',
    'Камень заточки III': 'Enhancement Stone III', 'Для заточки с +11 до +15.': 'For enhancing from +11 to +15.',
    'Свиток защиты': 'Protection Scroll', 'Спасает вещь от поломки при заточке.': 'Saves the item from breaking when enhancing.',
    'Свиток перековки': 'Reforging Scroll', 'Нужен чародейке для перековки свойств.': 'The enchantress needs it to reforge properties.',
    'Малое зелье здоровья': 'Minor Health Potion', '+15% здоровья': '+15% health', '+25% здоровья': '+25% health', 'Большое зелье здоровья': 'Greater Health Potion', '+40% здоровья': '+40% health',
    'Зелье здоровья': 'Health Potion',
    'Малое зелье ресурса': 'Minor Resource Potion', '+25% маны, ярости или энергии': '+25% mana, rage or energy', 'Зелье ресурса': 'Resource Potion',
    '+40% маны, ярости или энергии': '+40% mana, rage or energy', 'Большое зелье ресурса': 'Greater Resource Potion', '+60% маны, ярости или энергии': '+60% mana, rage or energy',
    '+15% здоровья в бою.': '+15% health in battle.', '+25% здоровья в бою. Варит алхимик.': '+25% health in battle. Brewed by the alchemist.',
    '+40% здоровья в бою. Варит алхимик.': '+40% health in battle. Brewed by the alchemist.',
    '+25% ресурса в бою.': '+25% resource in battle.', '+40% ресурса в бою. Варит алхимик.': '+40% resource in battle. Brewed by the alchemist.',
    '+60% ресурса в бою. Варит алхимик.': '+60% resource in battle. Brewed by the alchemist.',
    'Эликсир силы': 'Elixir of Strength', '+12% всего урона на 8 побед.': '+12% all damage for 8 victories.',
    'Эликсир удачи': 'Elixir of Luck', '+30% находки и +25% золота на 8 побед.': '+30% item find and +25% gold for 8 victories.',
    'Эликсир стойкости': 'Elixir of Fortitude', '+10% здоровья и +10% сопротивления огню, холоду и яду на 8 побед.': '+10% health and +10% fire, cold and poison resistance for 8 victories.',
    'Зверобой': "St. John's Wort", 'Растёт на Лесной опушке.': 'Grows on the Forest Edge.',
    'Паучья железа': 'Spider Gland', 'Лесная опушка.': 'Forest Edge.',
    'Волчья шкура': 'Wolf Pelt', 'Глухой лес.': 'Deep Forest.',
    'Мох лесного духа': 'Forest Spirit Moss', 'Гоблинское варево': 'Goblin Brew', 'Гоблинская стоянка.': 'Goblin Camp.',
    'Шаманский корень': 'Shaman Root', 'Перо гарпии': 'Harpy Feather', 'Старый тракт.': 'Old Road.',
    'Краденые специи': 'Stolen Spices', 'Рунная пыль': 'Rune Dust', 'Каменные холмы.': 'Stone Hills.',
    'Сердце голема': 'Golem Heart', 'Костная мука': 'Bone Meal', 'Затопленный склеп.': 'Flooded Crypt.', 'Эктоплазма': 'Ectoplasm',
    'латы и металлическое оружие': 'plate armor and metal weapons',
    'Железная руда': 'Iron Ore', 'Железный слиток': 'Iron Ingot', 'Стальной слиток': 'Steel Ingot', 'Рунный слиток': 'Runic Ingot', 'Мифрил': 'Mithril',
    'Драконья сталь': 'Dragon Steel', 'Древний металл': 'Ancient Metal',
    'кожаная броня, пояса и луки': 'leather armor, belts and bows',
    'Сыромятная кожа': 'Rawhide', 'Выделанная кожа': 'Cured Leather', 'Дублёная кожа': 'Tanned Leather', 'Теневая кожа': 'Shadow Leather',
    'Эльфийская замша': 'Elven Suede', 'Драконья шкура': 'Dragon Hide', 'Древняя шкура': 'Ancient Hide',
    'тканевая броня и кушаки': 'cloth armor and sashes',
    'Отрез ткани': 'Cloth Scrap', 'Льняная ткань': 'Linen Cloth', 'Шёлк': 'Silk', 'Зачарованный шёлк': 'Enchanted Silk', 'Звёздная парча': 'Starlit Brocade',
    'Драконий шёлк': 'Dragon Silk', 'Древнее полотно': 'Ancient Cloth',
    'хитиновая броня': 'chitin armor',
    'Хитиновые пластины': 'Chitin Plates', 'Жучиный панцирь': 'Beetle Carapace', 'Роговые пластины': 'Horn Plates', 'Скорпионий хитин': 'Scorpion Chitin',
    'Королевский панцирь': 'Royal Carapace', 'Драконья чешуя': 'Dragon Scales', 'Древний панцирь': 'Ancient Carapace',
    'Кузнечное дело': 'Blacksmithing', 'Ковка, разбор и ремонт. Открывает тиры ковки, повышает шанс хорошей редкости и снижает цену ремонта.': 'Forging, salvaging and repair. Unlocks forging tiers, raises the chance of good rarity and lowers repair prices.',
    'Алхимия': 'Alchemy', 'Варка зелий и эликсиров. Открывает рецепты и даёт шанс сварить вдвое больше.': 'Brewing potions and elixirs. Unlocks recipes and gives a chance to brew double.',
    'Камни заточки и свитки из трофеев охоты. Открывает рецепты и даёт шанс начертить вдвое больше.': 'Enhancement stones and scrolls from hunt trophies. Unlocks recipes and gives a chance to inscribe double.',
  });

  // ---------- монстры ----------
  const mon = (en, ...forms) => { for (const f of forms) o[f] = en; };
  const verb = (en, ...forms) => { for (const f of forms) o[f] = en; };
  Object.assign(o, {
    'Бешеный укус': 'Frenzied Bite', 'Ядовитый укус': 'Venomous Bite', 'Жало': 'Sting', 'Таран': 'Ram', 'Рваная рана': 'Ragged Wound', 'Вой': 'Howl',
    'Хлёст терновника': 'Thorn Lash', 'Возрождение': 'Regrowth', '{A} {a:оброс|обросла} свежим мхом {heal} {hp}.': '{A} grows fresh moss {heal} {hp}.',
    'Стена щитов': 'Shield Wall', 'Тёмная искра': 'Dark Spark', 'Порча': 'Hex', 'Подлый удар': 'Dirty Strike', 'Пике': 'Dive', 'Каменный кулак': 'Stone Fist',
    'Окаменение': 'Petrify', 'Валун': 'Boulder', 'Костяной треск': 'Bone Rattle', 'Трепет': 'Dread', 'Пожирание': 'Devour', 'Стенание': 'Wail',
    'Похищение жизни': 'Life Drain', 'Ледяная стрела': 'Frost Bolt', 'Удар щитом': 'Shield Bash', 'Залп': 'Volley',
    'Деревянный и терпеливый. Сдачи не даёт.': 'Wooden and patient. Never hits back.',
    'Юркая и злая. Уворачивается чаще, чем хотелось бы.': 'Quick and vicious. Dodges more often than you would like.',
    'Ядовит. Отравленные раны ноют ещё несколько ходов.': 'Venomous. Poisoned wounds ache for several more turns.',
    'Толстокожий и упрямый. Таран сбивает с ног.': 'Thick-skinned and stubborn. The ram knocks you down.',
    'Кусает до крови. Раны потом долго кровоточат.': 'Bites until blood flows. The wounds bleed for a long time.',
    'Хлещет терновником и зарастает раны мхом. Боится огня.': 'Lashes with thorns and covers wounds with moss. Fears fire.',
    'Живёт в лесу, носит лохмотья и ржавый хлам, снятый с чужих.': 'Lives in the forest, wearing rags and rusty junk taken from others.',
    'Ставит капканы на волков, а стреляет во всех подряд. Вблизи хрупок.': 'Sets traps for wolves, but shoots at everyone. Fragile up close.',
    'Гоблины ездят на нём верхом. Без седока он только злее. Панцирь держит удар, магию — хуже.': 'Goblins ride it. Without a rider it is only angrier. The carapace holds against blows, less so against magic.',
    'Прикрывается щитом и ждёт, пока вы устанете.': 'Hides behind a shield and waits for you to tire.',
    'Колдует и насылает порчу. Магию не заблокировать.': 'Casts spells and curses. Magic cannot be blocked.',
    'Бьёт исподтишка и прикрывается щитом.': 'Strikes from the shadows and covers with a shield.',
    'Стреляет метко и часто. Хрупок вблизи.': 'Shoots accurately and often. Fragile up close.',
    'Быстрая и вёрткая. Атакует с неба.': 'Fast and nimble. Attacks from the sky.',
    'Панцирь крепче камня, жало сочится ядом. Магия берёт его легче, чем оружие.': 'A carapace harder than stone, a stinger oozing poison. Magic works on it better than weapons.',
    'Чертит руны на камнях холмов и шепчет им. Колдует больно, вблизи хрупок.': 'Carves runes on the hill stones and whispers to them. Casts painfully, fragile up close.',
    'Почти неуязвим для оружия. Магия справляется лучше.': 'Nearly invulnerable to weapons. Magic does better.',
    'Огромный, медленный, оглушает валунами.': 'Huge, slow, stuns with boulders.',
    'Питается тем, что осталось в склепе. Укус гноится ядом.': 'Feeds on what is left in the crypt. The bite festers with venom.',
    'Яд ему нипочём. Стучит костями, ослабляя защиту.': 'Poison means nothing to it. Rattles its bones, weakening defense.',
    'Пожирает плоть и затягивает раны.': 'Devours flesh and closes its wounds.',
    'Ледяные стоны замедляют, а прикосновение крадёт жизнь.': 'Icy moans slow you down, and its touch steals life.',
    'Старый секач со шрамами от десятка охотников.': 'An old boar scarred by a dozen hunters.',
    'Сердце Глухого леса. Терновник вместо костей.': 'The heart of the Deep Forest. Thorns instead of bones.',
    'Самый крупный и самый злой гоблин стоянки.': 'The biggest and meanest goblin of the camp.',
    'Хозяин Старого тракта.': 'Master of the Old Road.',
    'Валун, который иногда встаёт и уходит.': 'A boulder that sometimes gets up and walks away.',
    'Хозяин Затопленного склепа.': 'Master of the Flooded Crypt.',
  });
  mon('Training Dummy', 'Учебный манекен', 'Учебного манекена', 'Учебному манекену');
  mon('Forest Rat', 'Лесная крыса', 'Лесной крысы', 'Лесной крысе', 'Лесную крысу');
  mon('Forest Spider', 'Лесной паук', 'Лесного паука', 'Лесному пауку');
  mon('Boar', 'Кабан', 'Кабана', 'Кабану');
  mon('Grey Wolf', 'Серый волк', 'Серого волка', 'Серому волку');
  mon('Forest Spirit', 'Лесной дух', 'Лесного духа', 'Лесному духу');
  mon('Forest Vagrant', 'Лесной бродяга', 'Лесного бродяги', 'Лесному бродяге', 'Лесного бродягу');
  mon('Poacher', 'Браконьер', 'Браконьера', 'Браконьеру');
  mon('Riding Beetle', 'Ездовой жук', 'Ездового жука', 'Ездовому жуку');
  mon('Goblin Warrior', 'Гоблин-воин', 'Гоблина-воина', 'Гоблину-воину');
  mon('Goblin Shaman', 'Гоблин-шаман', 'Гоблина-шамана', 'Гоблину-шаману');
  mon('Bandit', 'Разбойник', 'Разбойника', 'Разбойнику');
  mon('Bandit Archer', 'Разбойник-лучник', 'Разбойника-лучника', 'Разбойнику-лучнику');
  mon('Harpy', 'Гарпия', 'Гарпии', 'Гарпию');
  mon('Stone Scorpion', 'Каменный скорпион', 'Каменного скорпиона', 'Каменному скорпиону');
  mon('Runic Cultist', 'Рунный культист', 'Рунного культиста', 'Рунному культисту');
  mon('Stone Golem', 'Каменный голем', 'Каменного голема', 'Каменному голему');
  mon('Stone Troll', 'Каменный тролль', 'Каменного тролля', 'Каменному троллю');
  mon('Carrion Beetle', 'Трупный жук', 'Трупного жука', 'Трупному жуку');
  mon('Skeleton', 'Скелет', 'Скелета', 'Скелету');
  mon('Ghoul', 'Упырь', 'Упыря', 'Упырю');
  mon('Ghost', 'Призрак', 'Призрака', 'Призраку');
  mon('Boar Leader', 'Вожак кабанов', 'Вожака кабанов', 'Вожаку кабанов');
  mon('Ancient Spirit', 'Древний дух', 'Древнего духа', 'Древнему духу');
  mon('Goblin Chieftain', 'Вождь гоблинов', 'Вождя гоблинов', 'Вождю гоблинов');
  mon('Warlord', 'Атаман', 'Атамана', 'Атаману');
  mon('Troll Elder', 'Тролль-старейшина', 'Тролля-старейшины', 'Троллю-старейшине', 'Тролля-старейшину');
  mon('Lich', 'Лич', 'Лича', 'Личу');
  verb('bites', 'укусил', 'укусила'); verb('snaps at', 'цапнул', 'цапнула'); verb('slashes with claws', 'полоснул когтями', 'полоснула когтями');
  verb('stings', 'ужалил', 'ужалила'); verb('lashes with a leg', 'хлестнул лапой', 'хлестнула лапой');
  verb('butts', 'боднул', 'боднула'); verb('gores with a tusk', 'поддел клыком', 'поддела клыком'); verb('slams into', 'врезался в', 'врезалась в');
  verb('rips with fangs', 'рванул клыками', 'рванула клыками'); verb('swipes with a paw', 'ударил лапой', 'ударила лапой');
  verb('butts with a horn', 'боднул рогом', 'боднула рогом'); verb('crushes', 'придавил', 'придавила');
  verb('jabs with a spear', 'ткнул копьём', 'ткнула копьём'); verb('pecks', 'клюнул', 'клюнула');
  verb('snaps a pincer at', 'щёлкнул клешнёй по', 'щёлкнула клешнёй по'); verb('squeezes with pincers', 'стиснул клешнями', 'стиснула клешнями');
  verb('punches', 'ударил кулаком', 'ударила кулаком'); verb('pounds with a huge fist', 'ударил кулачищем', 'ударила кулачищем');
  verb('hurls aside', 'отшвырнул', 'отшвырнула'); verb('gnaws into', 'вгрызся в', 'вгрызлась в'); verb('clacks mandibles at', 'щёлкнул жвалами по', 'щёлкнула жвалами по');
  verb('latches onto', 'вцепился в', 'вцепилась в');

  // ---------- классы, умения, характеристики, места ----------
  Object.assign(o, {
    'Воин': 'Warrior', 'Меч и щит. Держит удар, блокирует, отвечает контратаками.': 'Sword and shield. Takes hits, blocks, answers with counterattacks.',
    'Берсерк': 'Berserker', 'Двуручное оружие. Огромный урон, вампиризм, жизнь на грани.': 'Two-handed weapons. Huge damage, lifesteal, life on the edge.',
    'Охотник': 'Hunter', 'Лук и арбалет. Криты, скорость, уклонение и яд.': 'Bow and crossbow. Crits, speed, evasion and poison.',
    'Маг': 'Mage', 'Посох или жезл со сферой. Стихии, контроль, магические щиты.': 'Staff or wand with an orb. Elements, control, magic shields.',
    'Ярость': 'Rage', 'Энергия': 'Energy',
    // умения
    'Боевой клич': 'Battle Cry', 'Рассекающий удар': 'Cleaving Strike', 'Несокрушимость': 'Indestructible', 'Возмездие': 'Retribution', 'Казнь': 'Execution',
    'Безрассудный удар': 'Reckless Strike', 'Кровавое безумие': 'Blood Frenzy', 'Вихрь': 'Whirlwind', 'Устрашающий рёв': 'Fearsome Roar', 'Кровавая баня': 'Bloodbath',
    'Неистовство': 'Fury', 'Прицельный выстрел': 'Aimed Shot', 'Отравленная стрела': 'Poisoned Arrow', 'Уход в тень': 'Fade into Shadow', 'Метка охотника': "Hunter's Mark",
    'Смертельный выстрел': 'Deadly Shot', 'Огненная стрела': 'Fire Arrow', 'Ледяная волна': 'Frost Wave', 'Магический щит': 'Magic Shield', 'Цепная молния': 'Chain Lightning',
    'Метеор': 'Meteor', 'Прилив маны': 'Mana Surge',
    'Удар на {}% атаки, {}% шанс оглушить на ход.': 'A strike for {1}% of attack, {2}% chance to stun for a turn.',
    '+{}% физической атаки на 3 хода.': '+{}% physical attack for 3 turns.',
    'Удар на {}% атаки, вызывает кровотечение.': 'A strike for {}% of attack, causes bleeding.',
    'Щит на {}% здоровья на 3 хода.': 'A shield for {}% of health for 3 turns.',
    '2 хода отвечает на каждый удар контратакой на {}% атаки.': 'For 2 turns, answers every hit with a counterattack for {}% of attack.',
    'Удар на {}% атаки, вдвое сильнее по цели ниже 30% здоровья.': 'A strike for {}% of attack, twice as strong against a target below 30% health.',
    'Удар на {}% атаки, ценой 5% своего здоровья.': 'A strike for {}% of attack, at the cost of 5% of your health.',
    '+{}% вампиризма на 3 хода.': '+{}% lifesteal for 3 turns.',
    'Три удара по {}% атаки.': 'Three strikes of {}% attack each.',
    'Враг теряет {}% атаки на 3 хода.': 'The enemy loses {}% attack for 3 turns.',
    'Удар на {}% атаки, лечит на половину нанесённого урона.': 'A strike for {}% of attack, heals for half of the damage dealt.',
    '4 хода: +{}% урона и +20% скорости.': '4 turns: +{}% damage and +20% speed.',
    'Выстрел на {}% атаки, не промахивается.': 'A shot for {}% of attack, never misses.',
    'Выстрел и яд: {}% атаки каждый ход, 3 хода.': 'A shot and poison: {}% of attack each turn for 3 turns.',
    '2 хода +{}% к шансу уклонения, следующий выстрел критический.': 'For 2 turns +{}% evasion chance, the next shot is a critical.',
    'Три выстрела по {}% атаки.': 'Three shots of {}% attack each.',
    'Цель получает +{}% урона 4 хода.': 'The target takes +{}% damage for 4 turns.',
    'Гарантированный крит на {}% атаки.': 'A guaranteed crit for {}% of attack.',
    'Огонь: {}% маг. атаки.': 'Fire: {}% of magic attack.',
    'Холод: {}% маг. атаки, замедление, {}% шанс заморозить.': 'Cold: {1}% of magic attack, slow, {2}% chance to freeze.',
    'Три разряда по {}% маг. атаки.': 'Three bolts of {}% magic attack each.',
    'Огонь: {}% маг. атаки и горение 3 хода.': 'Fire: {}% of magic attack and burning for 3 turns.',
    'Восстанавливает {}% маны, следующее заклинание +50% урона.': 'Restores {}% mana, the next spell deals +50% damage.',
    // пассивки
    'Закалка': 'Hardening', 'Мастер щита': 'Shield Master', 'Шипастая броня': 'Spiked Armor', 'Второе дыхание': 'Second Wind', 'Владение оружием': 'Weapon Mastery',
    'Боевой задор': 'Battle Ardor', 'Непоколебимость': 'Steadfastness', 'Чутьё бойца': "Fighter's Instinct", 'Грубая сила': 'Brute Force', 'Жажда крови': 'Bloodthirst',
    'На грани': 'On the Edge', 'Толстая шкура': 'Thick Hide', 'Затаённая злоба': 'Hidden Malice', 'Свирепость': 'Ferocity', 'Мясник': 'Butcher', 'Неудержимость': 'Unstoppable',
    'Зоркий глаз': 'Keen Eye', 'Острые наконечники': 'Sharp Arrowheads', 'Лёгкий шаг': 'Light Step', 'Токсиколог': 'Toxicologist', 'Выживальщик': 'Survivalist',
    'Быстрая рука': 'Quick Hand', 'Хищник': 'Predator', 'Твёрдая рука': 'Steady Hand', 'Тайное знание': 'Arcane Knowledge', 'Сила чар': 'Spell Power', 'Пиромантия': 'Pyromancy',
    'Касание стужи': 'Touch of Frost', 'Медитация': 'Meditation', 'Барьер маны': 'Mana Barrier', 'Сосредоточение': 'Concentration', 'Стихийная защита': 'Elemental Ward',
    '+{}% защиты': '+{}% defense', '+{}% блока со щитом': '+{}% block with a shield', 'Шипы: {}% защиты возвращается атакующему': 'Thorns: {}% of defense is returned to the attacker',
    '+{}% здоровья каждый ход': '+{}% health every turn', '+{}% физической атаки': '+{}% physical attack', '+{} ярости за удар': '+{} rage per hit',
    '−{}% получаемого урона': '−{}% damage taken', '{}% шанс контратаки после блока или уклонения': '{}% chance to counterattack after a block or dodge',
    '+{}% вампиризма': '+{}% lifesteal', '+{}% урона, пока здоровье ниже 50%': '+{}% damage while health is below 50%', '+{}% здоровья': '+{}% health',
    'Бой начинается с {} ярости': 'Battle starts with {} rage', '+{}% шанса крита': '+{}% crit chance', '+{}% крит. урона': '+{}% crit damage', '+{}% скорости': '+{}% speed',
    '+{}% уклонения': '+{}% evasion', '+{}% урона ядов и кровотечений': '+{}% poison and bleed damage', '+{} энергии каждый ход': '+{} energy every turn',
    '+{}% урона по зверям и людям': '+{}% damage to beasts and humans', '+{}% точности': '+{}% accuracy', '+{}% маны': '+{}% mana', '+{}% магической атаки': '+{}% magic attack',
    '+{}% урона огнём': '+{}% fire damage', '{}% шанс замедлить врага заклинанием': '{}% chance to slow the enemy with a spell', '+{} маны каждый ход': '+{} mana every turn',
    '+{}% ко всем сопротивлениям': '+{}% to all resistances',
    // характеристики и свойства (названия строк)
    'Сила': 'Strength', 'Ловкость': 'Agility', 'Живучесть': 'Vitality', 'Все характеристики': 'All stats', 'Физическая атака': 'Physical attack', 'Магическая атака': 'Magic attack',
    'Защита': 'Defense', 'Магическая защита': 'Magic defense', 'Здоровье': 'Health', 'Шанс крита': 'Crit chance', 'Крит. урон': 'Crit damage', 'Блок': 'Block', 'Вампиризм': 'Lifesteal',
    'Здоровье за ход': 'Health per turn', 'Мана за ход': 'Mana per turn', 'Сокращение перезарядки': 'Cooldown reduction', 'Снижение урона': 'Damage reduction', 'Весь урон': 'All damage',
    'Шипы от защиты': 'Thorns from defense', 'Урон по зверям': 'Damage to beasts', 'Урон по нежити': 'Damage to undead', 'Урон по гоблинам': 'Damage to goblins', 'Урон по людям': 'Damage to humans',
    'Урон по конструктам': 'Damage to constructs', 'Урон огнём': 'Fire damage', 'Урон холодом': 'Cold damage', 'Урон ядом': 'Poison damage', 'Сопротивление огню': 'Fire resistance',
    'Сопротивление холоду': 'Cold resistance', 'Сопротивление яду': 'Poison resistance', 'Шанс оглушить': 'Stun chance', 'Шанс кровотечения': 'Bleed chance', 'Шанс замедлить': 'Slow chance',
    'Уровень всех умений': 'All skill levels', 'Опыт': 'Experience', 'Золото': 'Gold', 'Находка предметов': 'Item find', 'Ярость за удар': 'Rage per hit', 'Ресурс в начале боя': 'Starting resource',
    'Ресурс за ход': 'Resource per turn', 'Урон при здоровье < 50%': 'Damage at health < 50%', 'Урон ядов и кровотечений': 'Poison and bleed damage', 'Урон огненных заклинаний': 'Fire spell damage',
    'Шанс контратаки': 'Counterattack chance', 'Начертание': 'Inscription',
    'Оружие': 'Weapon', 'Левая рука': 'Off-hand', 'Голова': 'Head', 'Тело': 'Body', 'Руки': 'Hands', 'Ноги': 'Feet', 'Уникальный': 'Unique',
    'Костяной щит': 'Bone Shield', 'Метка добычи': "Hunter's Quarry",
    '{}{}млрд': '{1}{2}B', '{}{}кк': '{1}{2}M', '{}{}к': '{1}{2}K',
    // места и жители
    'Пыльный Брод': 'Dusty Ford', 'Деревня на краю леса. Тут можно перевести дух, продать добычу и подлатать снаряжение.': 'A village on the edge of the forest. A place to catch your breath, sell loot and mend gear.',
    'Лесная опушка': 'Forest Edge', 'Светлый подлесок за частоколом. В траве шуршат крысы, между деревьями блестит паутина.': 'Bright undergrowth beyond the palisade. Rats rustle in the grass, cobwebs glisten between the trees.',
    'Глухой лес': 'Deep Forest', 'Ели смыкаются над головой, и днём здесь сумрачно. Волки охотятся стаей.': 'Spruces close overhead and it is gloomy even by day. Wolves hunt in packs.',
    'Гоблинская стоянка': 'Goblin Camp', 'Дым от костров, кости и ржавые котлы. Шаманы бормочут заклинания над варевом.': 'Campfire smoke, bones and rusty cauldrons. Shamans mutter spells over the brew.',
    'Старый тракт': 'Old Road', 'Заброшенная дорога через холмы. Купцы давно здесь не ездят — на тракте хозяйничают разбойники.': 'An abandoned road through the hills. Merchants stopped coming long ago — bandits rule the road.',
    'Каменные холмы': 'Stone Hills', 'Валуны размером с избу. Говорят, один из них иногда встаёт и уходит. Между камней шуршат скорпионы.': 'Boulders the size of a hut. They say one of them sometimes gets up and walks off. Scorpions rustle between the stones.',
    'Затопленный склеп': 'Flooded Crypt', 'Руины склепа наполовину под водой. Из тёмных арок тянет холодом и тихим шёпотом.': 'The ruins of a crypt, half underwater. Cold and quiet whispers drift from the dark arches.',
    'Лавка Марфы': "Marfa's Shop", 'Зелья, камни заточки и свитки.': 'Potions, enhancement stones and scrolls.', 'Проходи, не стесняйся. Всё свежее, почти не ржавое.': "Come in, don't be shy. Everything's fresh, hardly rusty.",
    'Скупщик Ефим': 'Buyer Yefim', 'Купит всё, что вы принесли с охоты.': 'Buys everything you brought back from the hunt.', 'Показывай, что притащил. Только не торгуйся — не люблю.': "Show me what you dragged in. Just don't haggle — I hate it.",
    'Мастерская улица': 'Workshop Row', 'Заточка, ранги, перековка, ковка, начертание и ремонт.': 'Enhancing, ranks, reforging, forging, inscription and repair.',
    'Здесь кузнецы и чародеи принимают заказы. Выбирай мастера по делу.': 'Smiths and enchanters take orders here. Pick the master for the job.',
    'Алхимик Зоряна': 'Alchemist Zoryana', 'Зелья и эликсиры из материалов охоты.': 'Potions and elixirs from hunt materials.', 'Принеси травы да железы — сварю такое, что мёртвого поднимет. Ну, почти.': "Bring herbs and glands — I'll brew something that raises the dead. Well, almost.",
    'Торговый ряд': 'Market Row', 'Рынок игроков: купить и выставить вещи.': 'Player market: buy and list items.', 'Тут торгуют такие же охотники, как ты. Цену ставит продавец, рынок берёт свои 5%.': 'Hunters just like you trade here. The seller sets the price, the market takes its 5%.',
    'Личный сундук': 'Personal Chest', 'Хранилище на 300 ячеек (вещи и ресурсы), общее для всех ваших героев.': 'Storage for 300 slots (items and resources), shared by all your heroes.',
    'Тяжёлая крышка со скрипом поднимается.': 'The heavy lid rises with a creak.',
    'Обычная': 'Normal', 'Кошмар': 'Nightmare', 'Ад': 'Hell', 'Пытка I': 'Torment I', 'Пытка II': 'Torment II', 'Пытка III': 'Torment III', 'Пытка IV': 'Torment IV', 'Пытка V': 'Torment V',
  });
  PC.i18n.add(o);
})();
