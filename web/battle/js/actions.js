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
  const sortItems = (list) => list.filter(Boolean).sort((x, y) =>
    ((SORT_KIND[D().types[x.type].kind] ?? 9) - (SORT_KIND[D().types[y.type].kind] ?? 9)) || (y.rarity - x.rarity) || (I().power(D(), y) - I().power(D(), x)));

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
      I().moveInBag(c, bagIndex(c, a.from), bagIndex(c, a.to));
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
      const c = hero(S), list = sortItems(c.bag);
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

  PC.actions = { list: actions, ActionError, STASH_SIZE, STASH_PAGE, SORT_KIND, sortItems };
  if (typeof module !== 'undefined') module.exports = PC;
})(typeof window !== 'undefined' ? window : globalThis);
