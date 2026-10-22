// Экономика: цены, лавка, скупщик, заточка у кузнеца. Без DOM — меняет объект персонажа.
(function (root) {
  'use strict';
  const PC = root.PC || (root.PC = {});
  const P = PC.progression;

  const RARITY_VALUE = [1, 1.6, 2.5];
  const SELL_SHARE = 0.25;

  // Цена в лавке. Вещи дорожают с уровнем: 1 ур. — 15, 3 — 87, 5 — 196, 7 — 337.
  function priceOf(data, id) {
    if (data.prices[id] != null) return data.prices[id];
    return Math.round(15 * Math.pow(data.items[id].level, 1.6));
  }

  function itemValue(data, item) {
    return priceOf(data, item.id) * RARITY_VALUE[item.rarity || 0] * (1 + 0.3 * (item.upgrade || 0));
  }

  const sellPrice = (data, item) => Math.max(1, Math.floor(itemValue(data, item) * SELL_SHARE));

  function buy(data, char, id) {
    const price = priceOf(data, id);
    if (char.gold < price) return { ok: false, reason: 'Не хватает золота' };
    if (data.consumables[id]) {
      char.potions[id] = (char.potions[id] || 0) + 1;
    } else {
      if (char.backpack.length >= P.BACKPACK_SIZE) return { ok: false, reason: 'Рюкзак полон' };
      char.backpack.push(P.makeItem(id));
    }
    char.gold -= price;
    return { ok: true, price };
  }

  function sell(data, char, uid) {
    const idx = char.backpack.findIndex((it) => it.uid === uid);
    if (idx < 0) return { ok: false, reason: 'Предмета нет в рюкзаке' };
    const price = sellPrice(data, char.backpack[idx]);
    char.backpack.splice(idx, 1);
    char.gold += price;
    return { ok: true, price };
  }

  // Продать всё обычное и не заточенное — то, что обычно и есть хлам
  function sellJunk(data, char) {
    let total = 0, count = 0;
    for (const it of [...char.backpack]) {
      if ((it.rarity || 0) > 0 || (it.upgrade || 0) > 0) continue;
      total += sell(data, char, it.uid).price;
      count++;
    }
    return { total, count };
  }

  // ---------- Заточка ----------

  function findItem(char, uid) {
    for (const [slot, it] of Object.entries(char.equipment)) if (it && it.uid === uid) return { item: it, slot };
    const it = char.backpack.find((x) => x.uid === uid);
    return it ? { item: it, slot: null } : null;
  }

  function refineInfo(data, item) {
    const cur = item.upgrade || 0;
    const r = data.refine;
    if (cur >= r.max) return { maxed: true, current: cur };
    const target = cur + 1;
    return {
      maxed: false,
      current: cur,
      target,
      chance: r.chance[target],
      cost: Math.max(5, Math.round(priceOf(data, item.id) * r.costFactor * target)),
      risky: target > r.safe,
    };
  }

  // Возвращает { ok, outcome: 'success' | 'failed' | 'broken' }
  function refine(data, char, uid, rng) {
    const found = findItem(char, uid);
    if (!found) return { ok: false, reason: 'Предмет не найден' };
    const info = refineInfo(data, found.item);
    if (info.maxed) return { ok: false, reason: 'Заточка на максимуме' };
    if (char.gold < info.cost) return { ok: false, reason: 'Не хватает золота' };
    char.gold -= info.cost;
    if (rng.chance(info.chance)) {
      found.item.upgrade = info.target;
      return { ok: true, outcome: 'success', info };
    }
    if (!info.risky) return { ok: true, outcome: 'failed', info };
    if (found.slot) delete char.equipment[found.slot];
    else char.backpack.splice(char.backpack.indexOf(found.item), 1);
    return { ok: true, outcome: 'broken', info };
  }

  PC.economy = { priceOf, itemValue, sellPrice, buy, sell, sellJunk, refineInfo, refine, findItem };
  if (typeof module !== 'undefined') module.exports = PC;
})(typeof window !== 'undefined' ? window : globalThis);
