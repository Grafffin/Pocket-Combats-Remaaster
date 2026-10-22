// Мир: перемещение между локациями по таймеру и засады агрессивных монстров. Без DOM.
// Время передаётся снаружи (now, мс), чтобы переход переживал перезагрузку страницы, а сервер мог считать то же самое.
(function (root) {
  'use strict';
  const PC = root.PC || (root.PC = {});

  const here = (data, char) => data.locations[char.location];

  function startTravel(data, char, to, now) {
    if (char.transit) return { ok: false, reason: 'Вы уже в пути' };
    const seconds = here(data, char).routes[to];
    if (seconds == null) return { ok: false, reason: 'Туда отсюда не пройти' };
    char.transit = { from: char.location, to, start: now, end: now + seconds * 1000 };
    return { ok: true, seconds };
  }

  // Отмена — персонаж остаётся там, откуда вышел
  function cancelTravel(char) {
    char.transit = null;
  }

  function travelProgress(char, now) {
    const t = char.transit;
    if (!t) return null;
    return { ...t, progress: Math.min(1, (now - t.start) / (t.end - t.start)), left: Math.max(0, t.end - now) };
  }

  // Агрессивные монстры, не слишком слабые для персонажа, могут напасть сразу по прибытии
  function rollAmbush(data, char, rng) {
    const loc = here(data, char);
    if (loc.safe) return null;
    const candidates = loc.monsters.filter((id) => {
      const m = data.monsters[id];
      return m.aggressive && m.level >= char.level - 2;
    });
    if (!candidates.length || !rng.chance(data.AMBUSH_CHANCE)) return null;
    return rng.pick(candidates);
  }

  // Завершает переход, если время вышло. Возвращает { arrived, ambush } или null, если ещё в пути.
  function completeTravel(data, char, now, rng) {
    const t = char.transit;
    if (!t || now < t.end) return null;
    char.location = t.to;
    char.transit = null;
    return { arrived: t.to, ambush: rollAmbush(data, char, rng) };
  }

  PC.world = { here, startTravel, cancelTravel, travelProgress, completeTravel, rollAmbush };
  if (typeof module !== 'undefined') module.exports = PC;
})(typeof window !== 'undefined' ? window : globalThis);
