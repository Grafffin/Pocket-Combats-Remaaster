// Проверка английского перевода (js/lang/en-*.js): без браузера.
//  1. подстановки {} в русском ключе и в переводе согласованы; токены движка, которые тратят случайность
//     ({Ger} {ger} {adv} {verb}), сохранены поровну — иначе бой у англоязычного игрока разойдётся с остальными;
//  2. в английском тексте нет кириллицы;
//  3. все русские строки игровых данных (названия, описания, фразы журнала) переводятся целиком.
// Запуск: node web/battle/tools/i18n-test.js [--list]   (--list печатает все непереведённые строки)
const path = require('path');
const fs = require('fs');
const assert = require('assert');
const dir = path.join(__dirname, '..', 'js');
globalThis.localStorage = { getItem: () => 'en', setItem() {} };
require(path.join(dir, 'i18n.js'));
const PC = globalThis.PC;
const files = fs.readdirSync(path.join(dir, 'lang')).filter((f) => f.endsWith('.js')).sort();
const collected = new Map();
const realAdd = PC.i18n.add;
PC.i18n.add = (obj) => { for (const [k, v] of Object.entries(obj)) collected.set(k, v); realAdd(obj); };
for (const f of files) require(path.join(dir, 'lang', f));
PC.i18n.add = realAdd;
for (const f of ['version', 'data', 'classes', 'stats', 'items-data', 'monsters', 'world-data', 'engine', 'items', 'progression', 'economy', 'world']) require(path.join(dir, `${f}.js`));
PC.i18n.runLater && PC.i18n.runLater();

const CYR = /[А-Яа-яЁё]/;
const ph = (s) => (s.match(/\{\d*\}/g) || []).length;
const rngTokens = (s) => (s.match(/\{(Ger|ger|adv|verb)\}/g) || []).sort().join('');
const baseTokens = (s) => (s.match(/\{(?:[AB]|dmg|hp|skill|heal)(?:\.[a-z]+)?\}/g) || []).map((t) => t.replace(/\.[a-z]+/, '')).sort().join('');
const problems = [];
for (const [k, v] of collected) {
  if (typeof v !== 'string') { problems.push(`не строка: ${k}`); continue; }
  if (CYR.test(v)) problems.push(`кириллица в переводе: «${k}» → «${v}»`);
  const numbered = [...v.matchAll(/\{(\d+)\}/g)].map((m) => Number(m[1]));
  const n = (k.match(/\{\}/g) || []).length;
  if (numbered.length ? numbered.some((i) => i < 1 || i > n) : (v.match(/\{\}/g) || []).length > n) problems.push(`подстановки не сходятся: «${k}» → «${v}»`);
  if (rngTokens(k) !== rngTokens(v)) problems.push(`токены случайности не сохранены: «${k}» → «${v}»`);
  if (baseTokens(k) !== baseTokens(v)) problems.push(`токены движка не сохранены: «${k}» → «${v}»`);
}
assert.deepStrictEqual(problems.slice(0, 30), [], `ошибки перевода (${problems.length})`);
console.log(`ok   словарь: ${collected.size} записей, подстановки и токены боя согласованы`);

// Все строки игровых данных должны переводиться
const missing = new Set();
const seen = new Set();
(function walk(v, depth) {
  if (depth > 8 || v == null) return;
  if (typeof v === 'string') { if (CYR.test(v)) { const w = v.replace(/\/[mfn]$|\/pl$/, ''); if (CYR.test(PC.i18n.tr(w))) missing.add(v); } return; }
  if (typeof v !== 'object' || seen.has(v)) return;
  seen.add(v);
  for (const x of Object.values(v)) walk(x, depth + 1);
})(PC.data, 0);
if (process.argv.includes('--list')) console.log([...missing].join('\n'));
assert.strictEqual(missing.size, 0, `не переведено строк игровых данных: ${missing.size} (запустите с --list)\n${[...missing].slice(0, 15).join('\n')}`);
console.log('ok   все строки игровых данных переводятся');
console.log('\ni18n-test: ok');
