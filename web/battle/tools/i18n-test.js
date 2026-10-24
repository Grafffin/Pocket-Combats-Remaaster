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

// Язык не должен влиять на бой: тот же бой по-русски и по-английски даёт те же ходы, лог (по числу строк), здоровье и состояние генератора
['monsters', 'world', 'economy'].forEach((f) => f);
const realTr = PC.i18n.tr;
function battle(seed, monsterId, level, tr) {
  PC.i18n.tr = tr;
  const c = PC.progression.newCharacter(PC.data, { nick: 'Тест', gender: 'm', job: Object.keys(PC.data.classes)[0] });
  c.level = level;
  const b = new PC.Battle({ player: PC.progression.toFighter(PC.data, c), monster: PC.monsters.monsterAt(monsterId, level), seed, data: PC.data });
  while (!b.ended && b.turn < 40) b.submit(b.autoAction(b.player));
  return { turn: b.turn, log: b.log.length, hp: Math.round(b.player.hp), mon: Math.round(b.monster.hp), cs: PC.lockstep ? PC.lockstep.checksum(b) : '', text: b.log.map((l) => l.text).join('\n') };
}
if (PC.lockstep === undefined) require(path.join(dir, 'lockstep.js'));
let enText = '';
for (const [id, lvl, seed] of [['rat', 1, 7], ['spider', 3, 11], ['wolf', 8, 5], ['goblin_warrior', 12, 21], ['harpy', 18, 33]]) {
  if (!PC.data.monsters[id]) continue;
  const ru = battle(seed, id, lvl, (x) => x), en = battle(seed, id, lvl, realTr);
  assert.deepStrictEqual({ ...en, text: 0 }, { ...ru, text: 0 }, `бой ${id} разошёлся между языками`);
  enText += en.text;
}
PC.i18n.tr = realTr;
const strip = (t) => t.replace(/<ch[^>]*>[^<]*<\/ch>/g, '').replace(/<skill>[^<]*<\/skill>/g, '').replace(/Тест/g, '');
const bad = strip(enText).split('\n').filter((l) => /[А-Яа-яЁё]/.test(l));
assert.deepStrictEqual(bad.slice(0, 8), [], 'в английском журнале боя остался русский текст вне имён');
void (!/[А-Яа-яЁё]/.test(enText.replace(/<ch[^>]*>[^<]*<\/ch>/g, '').replace(/<skill>[^<]*<\/skill>/g, '').replace(/Тест/g, '')), 'в английском журнале боя остался русский текст вне имён');
console.log('ok   бой одинаков на русском и английском (ходы, лог, здоровье, генератор, контрольная сумма)');
console.log('\ni18n-test: ok');
