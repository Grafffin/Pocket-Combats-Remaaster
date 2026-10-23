// Мир: синхронный тик (как в оригинале), ограниченные монстры на локациях, передышка после боя, переходы.
// Без DOM. Время передаётся снаружи (now, мс), чтобы всё переживало перезагрузку, а сервер мог считать то же самое.
(function (root) {
  'use strict';
  const PC = root.PC || (root.PC = {});

  // Единые часы мира: всё происходит на границах тиков — ходы в бою, возрождение монстров, конец передышки
  const TICK_MS = 10000;
  const RESPAWN_TICKS = 1;      // убитый монстр возвращается на следующем тике
  const BUSY_TICKS = 12;        // «в бою» дольше 2 минут — бой брошен (перезагрузка страницы), монстр освобождается

  // Сколько монстров живёт на локации. В ММО будет зависеть от числа игроков на ней.
  const POOL_BASE = 6;
  const POOL_PER_PLAYER = 2;
  const poolSize = (loc, players = 1) => (loc.pool || POOL_BASE) + POOL_PER_PLAYER * Math.max(0, players - 1);

  const tickOf = (now) => Math.floor(now / TICK_MS);
  const tickStart = (tick) => tick * TICK_MS;
  const msToNextTick = (now) => TICK_MS - (now % TICK_MS);

  const here = (data, char) => data.locations[char.location];

  // Уровень конкретного монстра в зоне: случайный внутри диапазона [id, мин, макс]
  const monsterLevel = (entry, rng) => rng.int(entry[1], entry[2]);

  const newUid = () => Math.random().toString(36).slice(2, 10);

  // Монстр слота (slot, cycle) определяется только ими и id локации: у всех игроков на локации он одинаковый
  function hashStr(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
    return h >>> 0;
  }
  function rollMob(loc, locId, slot, cycle) {
    const uid = `${locId}.${slot}.${cycle}`;
    const rng = PC.makeRng(hashStr(uid));
    const entry = rng.pick(loc.monsters);
    return { uid, id: entry[0], level: monsterLevel(entry, rng), deadUntil: null, busy: false, slot, cycle };
  }
  // Сообщить общему миру (worldsync.js) об изменении монстра; без него всё работает локально
  const share = (char, m, patch) => { if (PC.worldSync && m.slot != null) PC.worldSync.push(char.location, m, patch); };

  // Состояние локации: живые и убитые монстры, босс. Хранится в персонаже (в ММО — на сервере).
  function locState(data, char, locId, rng) {
    char.world = char.world || {};
    const loc = data.locations[locId];
    let st = char.world[locId];
    if (!st) {
      const size = loc.safe ? loc.monsters.length : poolSize(loc);
      st = char.world[locId] = { mobs: [] };
      for (let i = 0; i < size; i++) st.mobs.push(loc.safe ? { uid: newUid(), id: loc.monsters[i][0], level: loc.monsters[i][1], deadUntil: null } : rollMob(loc, locId, i, 0));
    } else if (!loc.safe && st.mobs.some((m) => m.slot == null)) {
      st.mobs = st.mobs.map((m, i) => rollMob(loc, locId, i, 0));   // старое сохранение: переходим на общих монстров
    }
    return st;
  }

  // Обработать наступившие тики: возродить монстров, вызвать босса
  function update(data, char, now, rng) {
    const tick = tickOf(now);
    const loc = here(data, char);
    const st = locState(data, char, char.location, rng);
    // Защита от сохранений с другой длиной тика: ничего не может ждать дольше положенного
    if ((char.restTick || 0) > tick + 1) char.restTick = tick + 1;
    for (const m of st.mobs) if (m.deadUntil != null && m.deadUntil > tick + RESPAWN_TICKS) m.deadUntil = tick + RESPAWN_TICKS;
    for (let i = 0; i < st.mobs.length; i++) {
      const m = st.mobs[i];
      if (m.deadUntil != null && tick >= m.deadUntil) {
        st.mobs[i] = loc.safe ? { ...m, deadUntil: null } : rollMob(loc, char.location, m.slot, m.cycle + 1);
        if (!loc.safe) share(char, st.mobs[i], {});
      }
      else if (m.busy && (m.busySince == null || tick - m.busySince > BUSY_TICKS)) m.busy = false;
    }
    if (st.boss && st.boss.busy && (st.boss.busySince == null || tick - st.boss.busySince > BUSY_TICKS)) st.boss.busy = false;
    // Босс появляется после BOSS_KILLS побед в зоне и живёт, пока его не убьют
    if (loc.boss && !st.boss && (char.zoneKills[char.location] || 0) >= data.BOSS_KILLS) {
      st.boss = { uid: newUid(), id: loc.boss[0], level: loc.boss[1], deadUntil: null, boss: true };
    }
    return st;
  }

  const restLeft = (char, now) => Math.max(0, Math.min(TICK_MS, tickStart(char.restTick || 0) - now));
  const canAttack = (char, now) => restLeft(char, now) <= 0;

  // Найти монстра по uid на текущей локации
  function findMob(data, char, uid) {
    const st = locState(data, char, char.location);
    if (st.boss && st.boss.uid === uid) return st.boss;
    return st.mobs.find((m) => m.uid === uid) || null;
  }

  function aliveMobs(data, char) {
    const st = locState(data, char, char.location);
    return st.mobs.filter((m) => m.deadUntil == null && !m.busy);
  }

  // Освободить всех монстров, «застрявших» в бою (например, бой оборван перезагрузкой страницы)
  function releaseAll(char) {
    for (const st of Object.values(char.world || {})) {
      for (const m of st.mobs) m.busy = false;
      if (st.boss) st.boss.busy = false;
    }
  }

  // Начало боя: монстр занят, иначе нельзя
  function engage(data, char, uid, now) {
    if (!canAttack(char, now)) return { ok: false, reason: `Передышка: ${Math.ceil(restLeft(char, now) / 1000)} с` };
    const m = findMob(data, char, uid);
    if (!m || m.deadUntil != null) return { ok: false, reason: 'Этого монстра уже нет — дождитесь возрождения' };
    m.busy = true;
    m.busySince = tickOf(now);
    share(char, m, { busy_until: m.busySince + BUSY_TICKS });
    return { ok: true, mob: m };
  }

  // Конец боя: убитый монстр ждёт возрождения, после любого боя — передышка до следующего тика
  function disengage(data, char, uid, won, now) {
    const st = locState(data, char, char.location);
    const m = findMob(data, char, uid);
    char.restTick = tickOf(now) + 1;
    if (!m) return;
    m.busy = false;
    if (!won) { share(char, m, {}); return; }
    if (m.boss) { delete st.boss; return; }
    m.deadUntil = tickOf(now) + RESPAWN_TICKS;
    share(char, m, { dead_until: m.deadUntil });
  }

  // Монстр для автоохоты: предпочтительно того же вида, боссы — никогда (их бьют вручную)
  function pickForAutoHunt(data, char, preferId, rng) {
    const alive = aliveMobs(data, char);
    if (!alive.length) return null;
    const same = alive.filter((m) => m.id === preferId);
    return rng.pick(same.length ? same : alive);
  }

  // ---------- Сложность мира (общая для всех зон) ----------
  const diffOf = (char) => char.difficulty || 0;
  const diffUnlocked = (char) => char.diffUnlocked || 0;
  const finalZone = (data) => Object.keys(data.locations).find((id) => data.locations[id].final);
  function setDiff(data, char, D) {
    if (D < 0 || D >= data.difficulties.length) return { ok: false, reason: 'Нет такой сложности' };
    if (D > diffUnlocked(char)) {
      const boss = data.monsters[data.locations[finalZone(data)].boss[0]].name;
      return { ok: false, reason: `Откроется после победы над последним боссом (${boss}) на «${data.difficulties[D - 1].name}»` };
    }
    char.difficulty = D;
    return { ok: true };
  }

  // ---------- Переходы ----------

  function startTravel(data, char, to, now) {
    if (char.transit) return { ok: false, reason: 'Вы уже в пути' };
    const seconds = here(data, char).routes[to];
    if (seconds == null) return { ok: false, reason: 'Туда отсюда не пройти' };
    char.transit = { from: char.location, to, start: now, end: now + seconds * 1000 };
    return { ok: true, seconds };
  }

  function cancelTravel(char) { char.transit = null; }

  function travelProgress(char, now) {
    const t = char.transit;
    if (!t) return null;
    return { ...t, progress: Math.min(1, (now - t.start) / (t.end - t.start)), left: Math.max(0, t.end - now) };
  }

  // Завершает переход, если время вышло. Возвращает { arrived } или null, если ещё в пути.
  function completeTravel(data, char, now) {
    const t = char.transit;
    if (!t || now < t.end) return null;
    char.location = t.to;
    char.transit = null;
    return { arrived: t.to };
  }

  PC.world = {
    TICK_MS, RESPAWN_TICKS, BUSY_TICKS, poolSize, releaseAll, diffOf, diffUnlocked, setDiff, finalZone, tickOf, tickStart, msToNextTick,
    here, monsterLevel, hashStr, rollMob, locState, update, restLeft, canAttack, findMob, aliveMobs, engage, disengage, pickForAutoHunt,
    startTravel, cancelTravel, travelProgress, completeTravel,
  };
  if (typeof module !== 'undefined') module.exports = PC;
})(typeof window !== 'undefined' ? window : globalThis);
