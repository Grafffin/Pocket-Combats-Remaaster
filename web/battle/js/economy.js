// Экономика: лавка (материалы и зелья) и скупщик. Кузница и перековка — в items.js.
(function (root) {
  'use strict';
  const PC = root.PC || (root.PC = {});
  const I = () => PC.items;

  const priceOf = (data, id) => data.materials[id].price;

  function buy(data, char, id, count = 1) {
    const total = priceOf(data, id) * count;
    if (char.gold < total) return { ok: false, reason: 'Не хватает золота' };
    char.gold -= total;
    char.materials[id] = (char.materials[id] || 0) + count;
    return { ok: true, price: total };
  }

  function sell(data, char, uid) {
    const found = I().findItem(char, uid);
    if (!found || found.slot) return { ok: false, reason: 'Сначала снимите вещь' };
    const price = I().sellPrice(data, found.item);
    char.bag[found.index] = null;
    char.gold += price;
    return { ok: true, price };
  }

  // Продать всё не выше заданной редкости, кроме заточенных и повышенных в ранге
  function sellBelow(data, char, maxRarity) {
    let total = 0, count = 0;
    for (const it of char.bag) {
      if (!it || it.rarity > maxRarity || it.enhance || it.rank) continue;
      total += sell(data, char, it.uid).price;
      count++;
    }
    return { total, count };
  }

  PC.economy = { priceOf, buy, sell, sellBelow };
  if (typeof module !== 'undefined') module.exports = PC;
})(typeof window !== 'undefined' ? window : globalThis);
