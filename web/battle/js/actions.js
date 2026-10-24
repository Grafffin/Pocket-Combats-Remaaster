// Действия игрока над героем вне боя: один список и для клиента (без сервера), и для серверной функции game.
// Каждое действие: (S, args, ctx) => результат, где S = { char, stash } меняется на месте, ctx = { now, rng }.
// Аргументы приходят от клиента, поэтому каждый проверяется здесь: на сервере это единственная защита.
// Без DOM. Подробнее — docs/SERVER_AUTHORITY.md.
(function (root) {
  'use strict';
  const PC = root.PC || (root.PC = {});
  const D = () => PC.data, I = () => PC.items, E = () => PC.economy, P = () => PC.progression, W = () => PC.world;

  const STASH_SIZE = 300, STASH_PAGE = 60;
  const SORT_KIND = { weapon: 0, offhand: 1, head: 2, body: 3, hands: 4, feet: 5, belt: 6, amulet: 7, ring: 8 };

  class ActionError extends Error {}
  const bad = () => { throw new ActionError('bad_args'); };
  const int = (v, min, max) => (Number.isInteger(v) && v >= min && v <= max ? v : bad());
  const str = (v) => (typeof v === 'string' && v.length > 0 && v.length <= 64 ? v : bad());
  const own = (obj, k) => typeof k === 'string' && Object.prototype.hasOwnProperty.call(obj, k);
  const key = (obj, k) => (own(obj, k) ? k : bad());
  const no = (reason) => ({ ok: false, reason });

  const hero = (S) => S.char || bad();
  const bagIndex = (c, v) => int(v, 0, c.bag.length - 1);
  const slotKey = (v) => key(D().slots, v);
  // Торговцы, кузница и сундук — только в деревне
  function village(c) {
    if (c.location !== D().HOME || c.transit) throw new ActionError('not_in_village');
    return c;
  }
  const stashOf = (S) => {
    if (!S.stash || !Array.isArray(S.stash.items)) S.stash = { items: new Array(STASH_SIZE).fill(null) };
    return S.stash;
  };
  // стаки ресурсов — после вещей, по порядку id
  const sortItems = (list) => list.filter(Boolean).sort((x, y) => {
    if (x.stack || y.stack) return (!!x.stack - !!y.stack) || (x.stack < y.stack ? -1 : x.stack > y.stack ? 1 : 0);
    return ((SORT_KIND[D().types[x.type].kind] ?? 9) - (SORT_KIND[D().types[y.type].kind] ?? 9)) || (y.rarity - x.rarity) || (I().power(D(), y) - I().power(D(), x));
  });

  // ---------- Бои (серверная правда наград) ----------
  // Бой выдаёт сервер: seed, монстра и снимок бойца (запись боя rec хранится вне героя, ctx.fight / ctx.saveFight).
  // В конце клиент сдаёт историю боя (lockstep hist: seed, монстр, первый состав, события), сервер переигрывает её
  // тем же движком и сам начисляет опыт, золото, добычу и расход зелий. Подделанная история не сходится и награды не даёт.
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const fightId = (v) => (typeof v === 'string' && UUID.test(v) ? v.toLowerCase() : bad());
  const MAX_EVENTS = 6000;
  const MAX_PLAYERS = 20;
  // Сравнение снимков без учёта порядка ключей
  function canon(v) {
    if (Array.isArray(v)) return `[${v.map(canon).join(',')}]`;
    if (v && typeof v === 'object') return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}`;
    return JSON.stringify(v);
  }
  const same = (a, b) => canon(a) === canon(b);
  const snapshot = (c) => JSON.parse(JSON.stringify(P().toFighter(D(), c)));

  // Закрыть бой без наград и потерь (оборвался, брошен): монстр свободен, передышка до следующего тика
  function dropFight(c, ctx) {
    const f = c.fight;
    if (!f) return;
    if (f.host && f.mob) W().disengage(D(), c, f.mob, false, ctx.now);
    else c.restTick = W().tickOf(ctx.now) + 1;
    c.fight = null;
  }

  // Переиграть историю боя для игрока me. null — история не сходится с записью боя на сервере.
  function replay(rec, hist, me, myTpl) {
    if (!hist || typeof hist !== 'object' || !Array.isArray(hist.roster) || !Array.isArray(hist.ev) || hist.ev.length > MAX_EVENTS) return null;
    if (hist.seed !== rec.seed || !same(hist.monster, rec.monster)) return null;
    if (hist.roster.length !== 1 || hist.roster[0].key !== rec.owner || !same(hist.roster[0].tpl, rec.tpl)) return null;
    if (me !== rec.owner) {
      const j = hist.ev.find((e) => e && e.k === 'j' && e.key === me);
      if (!j || !same(j.tpl, myTpl)) return null;
    }
    let b;
    try {
      b = new PC.Battle({ players: hist.roster, monster: hist.monster, seed: hist.seed, data: D(), localKey: me });
      for (const e of hist.ev) { if (b.ended) break; b.applyEvent(e); }
    } catch (e) { return null; }
    return b.player ? b : null;
  }

  const actions = {
    // ---------- Герой ----------
    create(S, a) {
      if (S.char) return no('Герой уже есть');
      const nick = typeof a.nick === 'string' ? a.nick.trim().slice(0, 16) : '';
      if (!nick) return no('Нужно имя');
      S.char = P().newCharacter(D(), { nick, gender: a.gender === 'f' ? 'f' : 'm', job: key(D().classes, a.job) });
      return { ok: true };
    },
    remove(S) { S.char = null; return { ok: true }; },
    allocate(S, a) {
      const c = hero(S), alloc = {};
      if (!a.alloc || typeof a.alloc !== 'object') bad();
      for (const k of Object.keys(a.alloc)) alloc[key(c.stats, k)] = int(a.alloc[k], 0, 10000);
      return { ok: P().allocate(c, alloc) };
    },
    learnSkill: (S, a) => P().learnSkill(D(), hero(S), key(D().skills, a.id)),
    learnPassive: (S, a) => P().learnPassive(D(), hero(S), key(D().passives, a.id)),
    // Умение в ячейку и обратно; порядок ячеек — приоритет автобоя
    slotToggle(S, a) {
      const c = hero(S), id = key(D().skills, a.id);
      if (c.slots.includes(id)) c.slots = c.slots.filter((x) => x !== id);
      else if (!c.skills[id]) return no('Умение не изучено');
      else if (c.slots.length < D().SKILL_SLOTS) c.slots.push(id);
      else return no(`Все ${D().SKILL_SLOTS} ячейки заняты — сначала уберите умение`);
      return { ok: true };
    },
    slotLeft(S, a) {
      const c = hero(S), i = int(a.i, 1, c.slots.length - 1);
      [c.slots[i - 1], c.slots[i]] = [c.slots[i], c.slots[i - 1]];
      return { ok: true };
    },
    // Настройки автобоя: только известные ключи и того же типа
    settings(S, a) {
      const c = hero(S);
      if (!a.patch || typeof a.patch !== 'object') bad();
      for (const k of Object.keys(a.patch)) {
        const v = a.patch[k];
        if (!own(c.settings, k) || typeof v !== typeof c.settings[k]) bad();
        if (typeof v === 'number' && !(Number.isFinite(v) && v >= -1 && v <= 100)) bad();
        if (typeof v !== 'number' && typeof v !== 'boolean') bad();
        c.settings[k] = v;
      }
      return { ok: true };
    },
    setDiff: (S, a) => W().setDiff(D(), hero(S), int(a.d, 0, D().difficulties.length - 1)),

    // ---------- Сумка ----------
    move(S, a) {
      const c = hero(S);
      I().moveInBag(c, bagIndex(c, a.from), bagIndex(c, a.to), D());
      return { ok: true };
    },
    equip(S, a) {
      const c = hero(S);
      return I().equip(D(), c, bagIndex(c, a.index), a.slot == null ? undefined : slotKey(a.slot));
    },
    unequip(S, a) {
      const c = hero(S);
      return I().unequip(c, slotKey(a.slot), a.index == null ? undefined : bagIndex(c, a.index));
    },
    // Перетаскивание между слотами одного вида (кольца)
    swapSlots(S, a) {
      const c = hero(S), x = slotKey(a.a), y = slotKey(a.b);
      if (D().slots[x].kind !== D().slots[y].kind) return no('Не подходит в этот слот');
      const ex = c.equipment[x], ey = c.equipment[y];
      if (ex) c.equipment[y] = ex; else delete c.equipment[y];
      if (ey) c.equipment[x] = ey; else delete c.equipment[x];
      return { ok: true };
    },
    sortBag(S) {
      const c = hero(S);
      I().compactStacks(D(), c);
      const list = sortItems(c.bag);
      c.bag = [...list, ...new Array(c.bag.length - list.length).fill(null)];
      return { ok: true };
    },
    lock(S, a) {
      const found = I().findItem(hero(S), str(a.uid));
      if (!found) return no('Вещь не найдена');
      found.item.locked = !found.item.locked;
      return { ok: true, locked: found.item.locked };
    },
    salvage: (S, a, ctx) => I().salvage(D(), hero(S), str(a.uid), ctx.rng),
    // Разбор оптом: всё до редкости включительно, кроме заточенных, со звёздами и запертых
    salvageMass(S, a, ctx) {
      const c = hero(S), r = int(a.rarity, 0, 4), got = {};
      const list = c.bag.filter((it) => it && it.rarity <= r && !it.enhance && !it.rank && !it.locked);
      for (const it of list) {
        const res = I().salvage(D(), c, it.uid, ctx.rng);
        for (const [k, v] of Object.entries(res.got || {})) got[k] = (got[k] || 0) + v;
      }
      return { ok: true, count: list.length, got };
    },
    drink: (S, a) => E().drink(D(), hero(S), key(D().elixirs, a.id)),

    // ---------- Торговцы (деревня) ----------
    buy(S, a) {
      const c = village(hero(S)), id = str(a.id);
      if (!D().shopStock.includes(id)) bad();
      return E().buy(D(), c, id, int(a.n, 1, 99));
    },
    sell(S, a) {
      const c = village(hero(S));
      if (!Array.isArray(a.uids) || a.uids.length > 500) bad();
      return { ok: true, ...E().sellMany(D(), c, [...new Set(a.uids.map(str))]) };
    },
    sellMaterial(S, a) {
      const c = village(hero(S));
      return E().sellMaterial(D(), c, key(D().materials, a.id), int(a.n, 1, 1e9));
    },
    brew(S, a) {
      const c = village(hero(S));
      return E().brew(D(), c, int(a.i, 0, D().recipes.length - 1), int(a.n, 1, 99));
    },

    // ---------- Кузница (деревня) ----------
    enhance: (S, a, ctx) => I().enhance(D(), village(hero(S)), str(a.uid), { protect: a.protect === true }, ctx.rng),
    rankUp: (S, a) => I().rankUp(D(), village(hero(S)), str(a.uid), str(a.fodder)),
    inherit: (S, a) => I().inherit(D(), village(hero(S)), str(a.uid), str(a.donor)),
    rerollValue: (S, a, ctx) => I().rerollValue(D(), village(hero(S)), str(a.uid), int(a.idx, 0, 20), ctx.rng),
    rerollAffixes(S, a, ctx) {
      if (!Array.isArray(a.locks) || a.locks.length > 20) bad();
      return I().rerollAffixes(D(), village(hero(S)), str(a.uid), a.locks.map((x) => int(x, 0, 20)), ctx.rng);
    },
    requality: (S, a, ctx) => I().requality(D(), village(hero(S)), str(a.uid), ctx.rng),
    rerollVirtue: (S, a, ctx) => I().rerollVirtue(D(), village(hero(S)), str(a.uid), ctx.rng),
    craft(S, a, ctx) {
      const c = village(hero(S)), type = key(D().types, a.type);
      const kinds = Object.keys(D().slots).map((s) => D().slots[s].kind);
      if (!kinds.some((k) => I().typesFor(D(), k, c.job).some((t) => t.id === type))) bad();
      return I().craft(D(), c, type, int(a.tier, 1, D().TIER_LEVEL.length - 1), ctx.rng);
    },

    // ---------- Переходы ----------
    travel(S, a, ctx) {
      const c = hero(S);
      if (c.fight) return no('Сначала закончите бой');
      return W().startTravel(D(), c, key(D().locations, a.to), ctx.now);
    },
    cancelTravel(S) { W().cancelTravel(hero(S)); return { ok: true }; },
    arrive(S, a, ctx) {
      const r = W().completeTravel(D(), hero(S), ctx.now);
      return r ? { ok: true, ...r } : no('Ещё в пути');
    },

    // ---------- Бои ----------
    // Напасть на монстра локации: сервер сам проверяет передышку и монстра (по своему времени и своему миру)
    fightStart(S, a, ctx) {
      const c = hero(S), id = fightId(a.id);
      if (c.fight) dropFight(c, ctx);
      if (c.transit) W().completeTravel(D(), c, ctx.now);
      if (c.transit) return no('Вы в пути');
      // число игроков на локации задаёт число слотов (+2 за игрока); монстры от этого не дороже и не щедрее
      const players = a.players == null ? undefined : int(a.players, 1, MAX_PLAYERS);
      W().update(D(), c, ctx.now, ctx.rng, players);
      // общий мир (world_mobs): слоты, которые другие игроки убили или возродили, у героя на сервере устарели
      if (Array.isArray(ctx.world)) {
        W().applyShared(D(), c, c.location, ctx.world, ctx.now, null, (m, patch) => PC.worldSync && PC.worldSync.push(c.location, m, patch));
        W().update(D(), c, ctx.now, ctx.rng, players);
      }
      const r = W().engage(D(), c, str(a.uid), ctx.now);
      if (!r.ok) return r;
      const mob = r.mob, diff = W().diffOf(c);
      const monster = JSON.parse(JSON.stringify(PC.monsters.monsterAt(mob.id, mob.level, diff)));
      const tpl = snapshot(c), seed = ctx.rng.int(1, 2147483646);
      ctx.saveFight = { id, owner: ctx.uid, seed, monster, tpl, loc: c.location, mob: { uid: mob.uid, id: mob.id, level: mob.level }, diff, start: ctx.now };
      c.fight = { id, host: true, mob: mob.uid, tpl, start: ctx.now };
      return { ok: true, seed, monster, tpl, mob: { uid: mob.uid, id: mob.id, level: mob.level }, diff };
    },
    // Вступить в чужой бой (или вернуться в свой после обновления страницы)
    fightJoin(S, a, ctx) {
      const c = hero(S), id = fightId(a.id), rec = ctx.fight;
      if (c.fight && c.fight.id === id) return { ok: true, tpl: c.fight.tpl, mob: rec && rec.mob, diff: rec && rec.diff };
      if (!rec || rec.id !== id) return no('Бой уже закончился');
      if (c.transit || c.location !== rec.loc) return no('Бой идёт на другой локации');
      if (!W().canAttack(c, ctx.now)) return no(`Передышка: ${Math.ceil(W().restLeft(c, ctx.now) / 1000)} с`);
      if (c.fight) dropFight(c, ctx);
      const tpl = snapshot(c);
      c.fight = { id, host: false, tpl, start: ctx.now };
      return { ok: true, tpl, mob: rec.mob, diff: rec.diff };
    },
    // Итог боя по его истории: награда, поражение или бегство считаются здесь
    fightEnd(S, a, ctx) {
      const c = hero(S), id = fightId(a.id), rec = ctx.fight, f = c.fight;
      if (!f || f.id !== id) return no('Бой уже закрыт');
      if (!rec || rec.id !== id) { dropFight(c, ctx); return no('Бой не найден на сервере'); }
      const b = replay(rec, a.hist, ctx.uid, f.tpl);
      // ход длится тик мира: бой не может закончиться быстрее, чем прошло его ходов
      if (!b || ctx.now - rec.start < (b.turn - 1) * W().TICK_MS * 0.5) { dropFight(c, ctx); return no('Бой не сошёлся с сервером — без награды'); }
      // вышел из боя (кнопка «Сбежать», событие l) — бегство без потерь, как и раньше; погиб — поражение
      const p = b.player, won = b.ended && b.winner === p, fled = !won && (p.left || p.hp > 0);
      // зелья: списываем выпитое в бою из того, что есть сейчас (а не возвращаем запас из снимка)
      for (const it of p.consumables) {
        const had = (f.tpl.consumables.find((x) => x.id === it.id) || { count: 0 }).count;
        it.count = Math.max(0, I().matCount(D(), c, it.id) - Math.max(0, had - it.count));
      }
      const fight = { monsterId: rec.mob.id, level: rec.mob.level, diff: rec.diff };
      let contrib = null;
      if (won && b.players.length > 1) {
        const r = b.rewardMult(p);
        fight.lootMult = r.mult;
        contrib = { pct: Math.round(r.share * 100), pool: r.pool, n: b.players.length };
      }
      // награда зоны боя: уйти с локации в бою нельзя (travel отказывает), поэтому c.location === rec.loc
      const summary = P().applyBattleResult(D(), c, b, fight, ctx.rng, { fled });
      if (f.host) W().disengage(D(), c, f.mob, won, ctx.now, rec.loc); else c.restTick = W().tickOf(ctx.now) + 1;
      c.fight = null;
      return { ok: true, summary, contrib, turns: b.turn };
    },
    // Бой оборвался (хозяин ушёл, другая версия игры): без наград и без потерь
    fightAbort(S, a, ctx) {
      const c = hero(S), id = fightId(a.id);
      if (c.fight && c.fight.id === id) dropFight(c, ctx);
      return { ok: true };
    },

    // ---------- Сундук (деревня, общий для героев аккаунта) ----------
    stashTake(S, a) {
      const c = village(hero(S)), st = stashOf(S), i = int(a.index, 0, STASH_SIZE - 1);
      const it = st.items[i];
      if (!it) return no('Пусто');
      if (I().bagAdd(c, it) < 0) return no('Сумка полна');
      st.items[i] = null;
      return { ok: true };
    },
    // Положить из сумки: сначала на открытую страницу, потом в любое свободное место
    stashPut(S, a) {
      const c = village(hero(S)), st = stashOf(S), i = bagIndex(c, a.index);
      const from = int(a.page == null ? 0 : a.page, 0, STASH_SIZE / STASH_PAGE - 1) * STASH_PAGE;
      const it = c.bag[i];
      if (!it) return no('Пусто');
      if (it.stack) return no('В сундук кладутся только вещи');
      const pageFree = st.items.findIndex((x, j) => !x && j >= from && j < from + STASH_PAGE);
      const j = pageFree >= 0 ? pageFree : st.items.indexOf(null);
      if (j < 0) return no('Сундук полон');
      st.items[j] = it;
      c.bag[i] = null;
      return { ok: true };
    },
    stashSort(S) {
      const st = stashOf(S), list = sortItems(st.items);
      st.items = [...list, ...new Array(STASH_SIZE - list.length).fill(null)];
      return { ok: true };
    },
  };

  PC.actions = { list: actions, ActionError, STASH_SIZE, STASH_PAGE, SORT_KIND, sortItems, canon };
  if (typeof module !== 'undefined') module.exports = PC;
})(typeof window !== 'undefined' ? window : globalThis);
