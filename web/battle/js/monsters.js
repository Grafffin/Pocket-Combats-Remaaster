// Монстры (GDD §6–7): архетип × уровень → характеристики по формуле. Так зоны легко добавлять.
(function (root) {
  'use strict';
  const PC = root.PC || (root.PC = {});
  const data = PC.data || (PC.data = {});

  // ---------- Умения монстров ----------
  // Без ресурса: только перезарядка. run(b, a, t)
  const monsterSkills = {
    bite_frenzy: { name: 'Бешеный укус', cd: 3, run: (b, a, t) => { b.attack(a, t, { mult: 0.7 }); b.attack(a, t, { mult: 0.7 }); } },
    venom_bite: { name: 'Ядовитый укус', cd: 3, run: (b, a, t) => { if (b.attack(a, t, { mult: 0.9 }).hit) b.applyDot(t, a, 'poison', 0.25, 3); } },
    gore: { name: 'Таран', cd: 4, run: (b, a, t) => { const r = b.attack(a, t, { mult: 1.5 }); if (r.hit && b.roll(0.3)) b.applyStun(t, a); } },
    rend: { name: 'Рваная рана', cd: 3, run: (b, a, t) => { if (b.attack(a, t, { mult: 1.1 }).hit) b.applyDot(t, a, 'bleed', 0.25, 3); } },
    howl: { name: 'Вой', cd: 5, run: (b, a) => b.buff(a, { id: 'howl', name: 'Вой', turns: 3, mods: { atkPct: 0.3 } }) },
    thorn_lash: { name: 'Хлёст терновника', cd: 2, run: (b, a, t) => b.spell(a, t, { mult: 1.2, element: 'poison' }) },
    regrowth: { name: 'Возрождение', cd: 5, run: (b, a) => b.heal(a, Math.round(a.maxHp * (a.boss ? 0.06 : 0.12)), '{A} {a:оброс|обросла} свежим мхом {heal} {hp}.') },
    shield_wall: { name: 'Стена щитов', cd: 5, run: (b, a) => b.buff(a, { id: 'shield_wall', name: 'Стена щитов', turns: 2, mods: { defPct: 0.5 } }) },
    dark_spark: { name: 'Тёмная искра', cd: 1, run: (b, a, t) => b.spell(a, t, { mult: 1.3 }) },
    hex: { name: 'Порча', cd: 5, run: (b, a, t) => b.debuff(t, a, { id: 'hex', name: 'Порча', turns: 3, mods: { atkPct: -0.2, matkPct: -0.2 } }) },
    dirty_strike: { name: 'Подлый удар', cd: 3, run: (b, a, t) => b.attack(a, t, { mult: 1.3, unblockable: true }) },
    shield_bash_m: { name: 'Удар щитом', cd: 4, run: (b, a, t) => { const r = b.attack(a, t, { mult: 0.8, unblockable: true }); if (r.hit && b.roll(0.4)) b.applyStun(t, a); } },
    volley_m: { name: 'Залп', cd: 3, run: (b, a, t) => { b.attack(a, t, { mult: 0.7 }); b.attack(a, t, { mult: 0.7 }); } },
    dive: { name: 'Пике', cd: 3, run: (b, a, t) => b.attack(a, t, { mult: 1.6 }) },
    stone_fist: { name: 'Каменный кулак', cd: 3, run: (b, a, t) => { const r = b.attack(a, t, { mult: 1.4 }); if (r.hit && b.roll(0.25)) b.applyStun(t, a); } },
    harden: { name: 'Окаменение', cd: 5, run: (b, a) => b.buff(a, { id: 'harden', name: 'Окаменение', turns: 3, mods: { defPct: 0.6 } }) },
    boulder: { name: 'Валун', cd: 4, run: (b, a, t) => { const r = b.attack(a, t, { mult: 1.8 }); if (r.hit && b.roll(0.35)) b.applyStun(t, a); } },
    bone_rattle: { name: 'Костяной треск', cd: 5, run: (b, a, t) => b.debuff(t, a, { id: 'rattle', name: 'Трепет', turns: 3, mods: { defPct: -0.25 } }) },
    devour: { name: 'Пожирание', cd: 3, run: (b, a, t) => { const r = b.attack(a, t, { mult: 1.2 }); if (r.dmg) b.heal(a, Math.round(r.dmg * 0.5)); } },
    wail: { name: 'Стенание', cd: 3, run: (b, a, t) => { b.spell(a, t, { mult: 1.1, element: 'cold' }); if (t.hp > 0) b.applyChill(t, a); } },
    life_drain: { name: 'Похищение жизни', cd: 3, run: (b, a, t) => { const r = b.spell(a, t, { mult: 1.4 }); if (r.dmg) b.heal(a, Math.round(r.dmg * 0.5)); } },
    frost_bolt_m: { name: 'Ледяная стрела', cd: 2, run: (b, a, t) => { b.spell(a, t, { mult: 1.6, element: 'cold' }); if (t.hp > 0 && b.roll(0.3)) b.applyChill(t, a); } },
  };

  // ---------- Архетипы ----------
  // kind — тип для аффиксов «урон по …». m — множители к базовой кривой. caster — бьёт магией.
  const monsters = {
    dummy: {
      name: 'Учебный манекен', gender: 'm', forms: { gen: 'Учебного манекена', dat: 'Учебному манекену', acc: 'Учебный манекен' },
      kind: 'construct', art: 'monsters/dummy', emoji: '🪵', ai: 'idle',
      m: { hp: 1.5, atk: 0, def: 0.3, eva: 0 }, exp: 0.1, gold: 0,
      blurb: 'Деревянный и терпеливый. Сдачи не даёт.',
    },
    rat: {
      name: 'Лесная крыса', gender: 'f', forms: { gen: 'Лесной крысы', dat: 'Лесной крысе', acc: 'Лесную крысу' },
      kind: 'beast', art: 'monsters/rat', emoji: '🐀',
      m: { hp: 0.8, atk: 0.85, eva: 1.6, speed: 1.08 },
      skills: ['bite_frenzy'],
      verbs: [{ m: 'укусил', f: 'укусила', c: 'acc' }, { m: 'цапнул', f: 'цапнула', c: 'acc' }, { m: 'полоснул когтями', f: 'полоснула когтями', p: 'по', c: 'dat' }],
      blurb: 'Юркая и злая. Уворачивается чаще, чем хотелось бы.',
    },
    spider: {
      name: 'Лесной паук', gender: 'm', forms: { gen: 'Лесного паука', dat: 'Лесному пауку', acc: 'Лесного паука' },
      kind: 'beast', art: 'monsters/spider', emoji: '🕷️',
      m: { hp: 0.9, atk: 0.9, res: { poisonRes: 50 } },
      skills: ['venom_bite'],
      verbs: [{ m: 'укусил', f: 'укусила', c: 'acc' }, { m: 'ужалил', f: 'ужалила', c: 'acc' }, { m: 'хлестнул лапой', f: 'хлестнула лапой', p: 'по', c: 'dat' }],
      blurb: 'Ядовит. Отравленные раны ноют ещё несколько ходов.',
    },
    boar: {
      name: 'Кабан', gender: 'm', forms: { gen: 'Кабана', dat: 'Кабану', acc: 'Кабана' },
      kind: 'beast', art: 'monsters/boar', emoji: '🐗',
      m: { hp: 1.3, atk: 1.0, def: 1.3, eva: 0.6, speed: 0.95 },
      skills: ['gore'],
      verbs: [{ m: 'боднул', f: 'боднула', c: 'acc' }, { m: 'поддел клыком', f: 'поддела клыком', c: 'acc' }, { m: 'врезался в', f: 'врезалась в', c: 'acc' }],
      blurb: 'Толстокожий и упрямый. Таран сбивает с ног.',
    },
    wolf: {
      name: 'Серый волк', gender: 'm', forms: { gen: 'Серого волка', dat: 'Серому волку', acc: 'Серого волка' },
      kind: 'beast', art: 'monsters/wolf', emoji: '🐺',
      m: { hp: 1.0, atk: 1.05, eva: 1.2, speed: 1.05 },
      skills: ['rend', 'howl'],
      verbs: [{ m: 'укусил', f: 'укусила', c: 'acc' }, { m: 'рванул клыками', f: 'рванула клыками', c: 'acc' }, { m: 'ударил лапой', f: 'ударила лапой', p: 'по', c: 'dat' }],
      blurb: 'Кусает до крови. Раны потом долго кровоточат.',
    },
    forest_spirit: {
      name: 'Лесной дух', gender: 'm', forms: { gen: 'Лесного духа', dat: 'Лесному духу', acc: 'Лесного духа' },
      kind: 'construct', art: 'monsters/forest_spirit', emoji: '🌿', caster: true, element: 'poison',
      m: { hp: 1.1, atk: 0.95, def: 0.8, mdef: 1.4, res: { poisonRes: 75, fireRes: -30 } },
      skills: ['thorn_lash', 'regrowth'],
      blurb: 'Хлещет терновником и зарастает раны мхом. Боится огня.',
    },
    goblin_warrior: {
      name: 'Гоблин-воин', gender: 'm', forms: { gen: 'Гоблина-воина', dat: 'Гоблину-воину', acc: 'Гоблина-воина' },
      kind: 'goblin', art: 'monsters/goblin_warrior', emoji: '👺', shield: true,
      m: { hp: 1.1, atk: 1.0, def: 1.3, block: 15 },
      skills: ['shield_wall'],
      verbs: [{ m: 'рубанул', f: 'рубанула', p: 'по', c: 'dat' }, { m: 'ткнул копьём', f: 'ткнула копьём', c: 'acc' }],
      blurb: 'Прикрывается щитом и ждёт, пока вы устанете.',
    },
    goblin_shaman: {
      name: 'Гоблин-шаман', gender: 'm', forms: { gen: 'Гоблина-шамана', dat: 'Гоблину-шаману', acc: 'Гоблина-шамана' },
      kind: 'goblin', art: 'monsters/goblin_shaman', emoji: '🧙', caster: true,
      m: { hp: 0.85, atk: 1.05, def: 0.7, mdef: 1.5 },
      skills: ['dark_spark', 'hex'],
      blurb: 'Колдует и насылает порчу. Магию не заблокировать.',
    },
    bandit: {
      name: 'Разбойник', gender: 'm', forms: { gen: 'Разбойника', dat: 'Разбойнику', acc: 'Разбойника' },
      kind: 'human', art: 'monsters/bandit', emoji: '🧔', shield: true,
      m: { hp: 1.1, atk: 1.05, def: 1.2, block: 18, crit: 2 },
      skills: ['dirty_strike', 'shield_bash_m'],
      blurb: 'Бьёт исподтишка и прикрывается щитом.',
    },
    bandit_archer: {
      name: 'Разбойник-лучник', gender: 'm', forms: { gen: 'Разбойника-лучника', dat: 'Разбойнику-лучнику', acc: 'Разбойника-лучника' },
      kind: 'human', art: 'monsters/bandit_archer', emoji: '🏹', weaponType: 'bow',
      m: { hp: 0.85, atk: 1.15, def: 0.8, eva: 1.3, crit: 2.5 },
      skills: ['volley_m'],
      blurb: 'Стреляет метко и часто. Хрупок вблизи.',
    },
    harpy: {
      name: 'Гарпия', gender: 'f', forms: { gen: 'Гарпии', dat: 'Гарпии', acc: 'Гарпию' },
      kind: 'beast', art: 'monsters/harpy', emoji: '🦅',
      m: { hp: 0.9, atk: 1.05, eva: 1.6, speed: 1.12 },
      skills: ['dive'],
      verbs: [{ m: 'полоснул когтями', f: 'полоснула когтями', p: 'по', c: 'dat' }, { m: 'клюнул', f: 'клюнула', c: 'acc' }],
      blurb: 'Быстрая и вёрткая. Атакует с неба.',
    },
    golem: {
      name: 'Каменный голем', gender: 'm', forms: { gen: 'Каменного голема', dat: 'Каменному голему', acc: 'Каменного голема' },
      kind: 'construct', art: 'monsters/golem', emoji: '🗿',
      m: { hp: 1.4, atk: 1.0, def: 2.0, mdef: 0.6, eva: 0.3, speed: 0.85, res: { poisonRes: 75 } },
      skills: ['stone_fist', 'harden'],
      verbs: [{ m: 'ударил кулаком', f: 'ударила кулаком', p: 'по', c: 'dat' }, { m: 'придавил', f: 'придавила', c: 'acc' }],
      blurb: 'Почти неуязвим для оружия. Магия справляется лучше.',
    },
    stone_troll: {
      name: 'Каменный тролль', gender: 'm', forms: { gen: 'Каменного тролля', dat: 'Каменному троллю', acc: 'Каменного тролля' },
      kind: 'construct', art: 'monsters/stone_troll', emoji: '🪨',
      m: { hp: 1.5, atk: 1.15, def: 1.4, eva: 0.4, speed: 0.9 },
      skills: ['boulder'],
      verbs: [{ m: 'ударил кулачищем', f: 'ударила кулачищем', p: 'по', c: 'dat' }, { m: 'отшвырнул', f: 'отшвырнула', c: 'acc' }],
      blurb: 'Огромный, медленный, оглушает валунами.',
    },
    skeleton: {
      name: 'Скелет', gender: 'm', forms: { gen: 'Скелета', dat: 'Скелету', acc: 'Скелета' },
      kind: 'undead', art: 'monsters/skeleton', emoji: '💀',
      m: { hp: 1.0, atk: 1.0, def: 1.1, res: { poisonRes: 75, coldRes: 40 } },
      skills: ['bone_rattle'],
      blurb: 'Яд ему нипочём. Стучит костями, ослабляя защиту.',
    },
    ghoul: {
      name: 'Упырь', gender: 'm', forms: { gen: 'Упыря', dat: 'Упырю', acc: 'Упыря' },
      kind: 'undead', art: 'monsters/ghoul', emoji: '🧟',
      m: { hp: 1.2, atk: 1.1, speed: 1.02, res: { poisonRes: 60 } },
      skills: ['devour'],
      verbs: [{ m: 'вцепился в', f: 'вцепилась в', c: 'acc' }, { m: 'полоснул когтями', f: 'полоснула когтями', p: 'по', c: 'dat' }],
      blurb: 'Пожирает плоть и затягивает раны.',
    },
    wraith: {
      name: 'Призрак', gender: 'm', forms: { gen: 'Призрака', dat: 'Призраку', acc: 'Призрака' },
      kind: 'undead', art: 'monsters/wraith', emoji: '👻', caster: true, element: 'cold',
      m: { hp: 0.85, atk: 1.1, def: 0.6, mdef: 1.4, eva: 1.5, res: { coldRes: 75, poisonRes: 75 } },
      skills: ['wail', 'life_drain'],
      blurb: 'Ледяные стоны замедляют, а прикосновение крадёт жизнь.',
    },
    // Боссы — те же архетипы с усилением
    boar_king: { base: 'boar', name: 'Вожак кабанов', forms: { gen: 'Вожака кабанов', dat: 'Вожаку кабанов', acc: 'Вожака кабанов' }, boss: true, blurb: 'Старый секач со шрамами от десятка охотников.' },
    ancient_spirit: { base: 'forest_spirit', name: 'Древний дух', forms: { gen: 'Древнего духа', dat: 'Древнему духу', acc: 'Древнего духа' }, boss: true, blurb: 'Сердце Глухого леса. Терновник вместо костей.' },
    goblin_chief: { base: 'goblin_warrior', name: 'Вождь гоблинов', forms: { gen: 'Вождя гоблинов', dat: 'Вождю гоблинов', acc: 'Вождя гоблинов' }, boss: true, skills: ['shield_wall', 'shield_bash_m'], blurb: 'Самый крупный и самый злой гоблин стоянки.' },
    ataman: { base: 'bandit', name: 'Атаман', forms: { gen: 'Атамана', dat: 'Атаману', acc: 'Атамана' }, boss: true, skills: ['dirty_strike', 'shield_bash_m', 'howl'], blurb: 'Хозяин Старого тракта.' },
    troll_elder: { base: 'stone_troll', name: 'Тролль-старейшина', forms: { gen: 'Тролля-старейшины', dat: 'Троллю-старейшине', acc: 'Тролля-старейшину' }, boss: true, skills: ['boulder', 'harden'], blurb: 'Валун, который иногда встаёт и уходит.' },
    lich: {
      name: 'Лич', gender: 'm', forms: { gen: 'Лича', dat: 'Личу', acc: 'Лича' },
      kind: 'undead', art: 'monsters/lich', emoji: '☠️', caster: true, element: 'cold', boss: true,
      m: { hp: 1.0, atk: 1.15, def: 0.9, mdef: 1.6, res: { coldRes: 75, poisonRes: 75 } },
      skills: ['frost_bolt_m', 'life_drain', 'bone_rattle'],
      blurb: 'Хозяин Затопленного склепа.',
    },
  };

  // Боссы наследуют архетип
  for (const [id, m] of Object.entries(monsters)) {
    m.id = id;
    if (m.base) {
      const base = monsters[m.base];
      monsters[id] = { ...base, ...m, m: { ...base.m, ...(m.m || {}) }, skills: m.skills || base.skills };
    }
  }

  // ---------- Базовая кривая ----------
  // Подобрана симуляцией против персонажа своего уровня с типичной для зоны экипировкой (tools/sim.js)
  const curve = {
    hp: (L) => 40 + 24 * L + 1.3 * L * L,
    atk: (L) => (8 + 4.5 * L + 0.06 * L * L) * 1.2,
    def: (L) => 3 + 2.6 * L,
    mdef: (L) => 2 + 2 * L,
    acc: (L) => 60 + 4 * L,
    eva: (L) => 20 + 3.5 * L,
    speed: (L) => 95 + 0.5 * L,
  };
  const BOSS = { hp: 2.6, atk: 1.08, def: 1.2, mdef: 1.2 };

  // Шаблон бойца для движка: монстр на конкретном уровне
  function monsterAt(id, L) {
    const m = monsters[id];
    const k = (key) => (m.m && m.m[key] != null ? m.m[key] : 1) * (m.boss && BOSS[key] ? BOSS[key] : 1);
    const SC = PC.stats.SCALE;
    const atk = curve.atk(L) * k('atk') * SC;
    const stats = {
      level: L,
      maxHp: Math.round(curve.hp(L) * k('hp') * SC),
      atk: Math.round(atk), matk: Math.round(atk * 0.9),
      weaponMin: 0, weaponMax: Math.round(atk * 0.3),
      def: Math.round(curve.def(L) * k('def') * SC), mdef: Math.round(curve.mdef(L) * k('mdef') * SC),
      acc: Math.round(curve.acc(L)), eva: Math.round(curve.eva(L) * k('eva')),
      speed: Math.round(curve.speed(L) * k('speed')),
      crit: 5 * k('crit'), critDmg: 150,
      block: m.shield ? (m.m.block || 15) : 0, shield: !!m.shield,
      caster: !!m.caster, element: m.element || null,
      ...(m.m.res || {}),
    };
    return {
      name: m.name, forms: m.forms, gender: m.gender, kind: m.kind, boss: !!m.boss,
      art: m.art, emoji: m.emoji, verbs: m.verbs, ai: m.ai, weaponType: m.weaponType || (m.caster ? 'staff' : 'fist'),
      monsterSkills: m.skills || [], stats,
    };
  }

  // Награда за победу
  const rewards = {
    exp: (id, L) => Math.round((10 + 6 * L + 0.4 * L * L) * (monsters[id].exp != null ? monsters[id].exp : 1) * (monsters[id].boss ? 5 : 1)),
    gold: (id, L) => (monsters[id].gold === 0 ? [0, 0] : [Math.round((2 + L * 1.5) * (monsters[id].boss ? 6 : 1)), Math.round((5 + L * 2.5) * (monsters[id].boss ? 8 : 1))]),
  };

  Object.assign(data, { monsters, monsterSkills, monsterCurve: curve });
  PC.monsters = { monsterAt, rewards, curve };
  if (typeof module !== 'undefined') module.exports = PC;
})(typeof window !== 'undefined' ? window : globalThis);
