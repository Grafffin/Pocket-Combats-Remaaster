// Серверные операции над героем: та же игровая логика (web/battle/js), но со случайностью и временем сервера.
// Без API Deno и Node: вызывается из index.ts и из теста web/battle/tools/server-test.js.
// К моменту вызова игровые файлы уже загружены в globalThis.PC.
const G = () => globalThis.PC;

export class GameError extends Error {}
const fail = (code) => { throw new GameError(code); };

// Каждая операция получает { char, stash } (можно менять на месте), аргументы клиента и ctx { now, rng },
// возвращает результат для клиента. Ошибка игрока — fail('код').
// Действия вне боя — общий с клиентом список web/battle/js/actions.js.
export const ops = {
  ping: () => ({ build: G().BUILD }),
  load: () => ({}),
};
for (const [name, fn] of Object.entries(G().actions.list)) {
  ops[name] = (S, args, ctx) => {
    try { return fn(S, args, ctx); } catch (e) { if (e instanceof G().actions.ActionError) fail(e.message); throw e; }
  };
}
export const READONLY = new Set(['ping', 'load']);

const clone = (v) => (v == null ? v : JSON.parse(JSON.stringify(v)));

// row: { data, stash } из таблицы characters (или null). Возвращает новый герой, сундук и признак изменений.
export function run(op, args, row, ctx) {
  const fn = Object.prototype.hasOwnProperty.call(ops, op) ? ops[op] : null;
  if (!fn) fail('bad_op');
  const PC = G();
  const state = {
    char: row && row.data ? PC.progression.migrate(PC.data, clone(row.data)) : null,
    stash: row ? clone(row.stash) : null,
  };
  const before = JSON.stringify(state);
  // изменения общих монстров (world.js → PC.worldSync.push) копятся и пишутся в world_mobs после записи героя
  const world = [], prev = PC.worldSync;
  PC.worldSync = { push: (loc, m, patch) => world.push({ loc, slot: m.slot, cycle: m.cycle, dead: patch.dead_until ?? null, busy: patch.busy_until ?? null }) };
  let result;
  try { result = fn(state, args || {}, ctx) || {}; } finally { PC.worldSync = prev; }
  return { char: state.char, stash: state.stash, result, world, changed: !READONLY.has(op) && JSON.stringify(state) !== before };
}
