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
    if (found.item.locked) return { ok: false, reason: 'Вещь под замком' };
    const price = I().sellPrice(data, found.item);
    char.bag[found.index] = null;
    char.gold += price;
    return { ok: true, price };
  }

  // Продать отмеченные вещи
  function sellMany(data, char, uids) {
    let total = 0, count = 0;
    for (const uid of uids) {
      const r = sell(data, char, uid);
      if (r.ok) { total += r.price; count++; }
    }
    return { total, count };
  }

  // ---------- Алхимия ----------

  function canBrew(data, char, recipe, times = 1) {
    if (char.gold < recipe.gold * times) return false;
    return Object.entries(recipe.need).every(([k, n]) => (char.materials[k] || 0) >= n * times);
  }

  function brew(data, char, index, times = 1) {
    const r = data.recipes[index];
    if (!r || !canBrew(data, char, r, times)) return { ok: false, reason: 'Не хватает материалов или золота' };
    char.gold -= r.gold * times;
    for (const [k, n] of Object.entries(r.need)) char.materials[k] -= n * times;
    char.materials[r.out] = (char.materials[r.out] || 0) + r.n * times;
    return { ok: true, out: r.out, count: r.n * times };
  }

  // Выпить эликсир: действие на несколько побед, повторное — продлевает
  function drink(data, char, id) {
    const e = data.elixirs[id];
    if (!e || !(char.materials[id] > 0)) return { ok: false, reason: 'Нет такого эликсира' };
    char.materials[id]--;
    char.buffs = char.buffs || {};
    char.buffs[id] = (char.buffs[id] || 0) + e.battles;
    return { ok: true, battles: char.buffs[id] };
  }

  // Продать материал (травы и прочее) скупщику
  function sellMaterial(data, char, id, count) {
    const m = data.materials[id];
    const n = Math.min(count, char.materials[id] || 0);
    if (!m || !m.price || n <= 0) return { ok: false, reason: 'Нечего продать' };
    const price = Math.max(1, Math.floor(m.price / 2)) * n;
    char.materials[id] -= n;
    char.gold += price;
    return { ok: true, price };
  }

  PC.economy = { priceOf, buy, sell, sellMany, canBrew, brew, drink, sellMaterial };
  if (typeof module !== 'undefined') module.exports = PC;
})(typeof window !== 'undefined' ? window : globalThis);
