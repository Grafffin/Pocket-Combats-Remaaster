// Серверные операции над героем: та же игровая логика (web/battle/js), но со случайностью и временем сервера.
// Без API Deno и Node: вызывается из index.ts и из теста web/battle/tools/server-test.js.
// К моменту вызова игровые файлы уже загружены в globalThis.PC.
const G = () => globalThis.PC;

export class GameError extends Error {}
const fail = (code) => { throw new GameError(code); };

// Каждая операция получает { char, stash } (можно менять на месте), аргументы клиента и ctx { now, rng },
// возвращает результат для клиента. Ошибка игрока — fail('код').
export const ops = {
  ping: () => ({ build: G().BUILD }),
  load: () => ({}),
};
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
  const result = fn(state, args || {}, ctx) || {};
  return { char: state.char, stash: state.stash, result, changed: !READONLY.has(op) && JSON.stringify(state) !== before };
}
