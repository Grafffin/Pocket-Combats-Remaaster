// Проверка листания вкладок свайпом (Мир ↔ Герой ↔ Сумка) в браузере с мобильным экраном: настоящие touch-события.
// Запуск: NODE_PATH=$(npm root -g) node web/battle/tools/e2e-swipe.js
const path = require('path'), http = require('http'), fs = require('fs'), assert = require('assert');
const { chromium } = require('playwright');
const root = path.join(__dirname, '..', '..');
for (const f of ['version', 'data', 'classes', 'stats', 'items-data', 'monsters', 'world-data', 'engine', 'items', 'progression', 'economy', 'world', 'actions']) require(path.join(root, 'battle', 'js', `${f}.js`));
const PC = globalThis.PC;
const srv = http.createServer((q, r) => {
  fs.readFile(path.join(root, decodeURIComponent(q.url.split('?')[0])), (e, b) => {
    if (e) { r.writeHead(404); return r.end(); }
    r.writeHead(200, { 'content-type': { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' }[path.extname(q.url.split('?')[0])] || 'application/octet-stream' });
    r.end(b);
  });
});
(async () => {
  await new Promise((r) => srv.listen(0, r));
  const c = PC.progression.newCharacter(PC.data, { nick: 'Свайп', job: Object.keys(PC.data.classes)[0] });
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium' });
  const p = await (await b.newContext({ viewport: { width: 375, height: 812 }, hasTouch: true })).newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  await p.addInitScript(`localStorage.setItem('pc-character-v3', ${JSON.stringify(JSON.stringify(c))})`);
  await p.goto(`http://localhost:${srv.address().port}/battle/index.html`);
  await p.waitForFunction(() => window.PC && PC.app && PC.app.state.char);
  const tab = () => p.evaluate(() => PC.app.state.tab);
  // настоящие touch-события: dx, dy — смещение пальца; ms — длительность жеста
  const swipe = (dx, dy, ms = 120, sel = '#hub-body', y0 = 300) => p.evaluate(async ([dx, dy, ms, sel, y0]) => {
    const el = document.querySelector(sel), x0 = dx > 0 ? 60 : 320;
    const mk = (type, x, y) => new TouchEvent(type, { bubbles: true, cancelable: true, touches: type === 'touchend' ? [] : [new Touch({ identifier: 1, target: el, clientX: x, clientY: y })], changedTouches: [new Touch({ identifier: 1, target: el, clientX: x, clientY: y })] });
    el.dispatchEvent(mk('touchstart', x0, y0));
    const n = 6;
    for (let i = 1; i <= n; i++) { await new Promise((r) => setTimeout(r, ms / n)); el.dispatchEvent(mk('touchmove', x0 + dx * i / n, y0 + dy * i / n)); }
    el.dispatchEvent(mk('touchend', x0 + dx, y0 + dy));
    await new Promise((r) => setTimeout(r, 350));
  }, [dx, dy, ms, sel, y0]);

  assert.strictEqual(await tab(), 'world');
  await swipe(-160, 10); assert.strictEqual(await tab(), 'hero', 'влево: Мир → Герой');
  await swipe(-160, 10); assert.strictEqual(await tab(), 'bag', 'влево: Герой → Сумка');
  await swipe(-160, 10); assert.strictEqual(await tab(), 'bag', 'дальше Сумки вкладки нет');
  await swipe(160, -10); assert.strictEqual(await tab(), 'hero', 'вправо: Сумка → Герой');
  await swipe(160, 10); assert.strictEqual(await tab(), 'world', 'вправо: Герой → Мир');
  await swipe(160, 10); assert.strictEqual(await tab(), 'world', 'левее Мира вкладки нет');
  await swipe(-30, 0, 400); assert.strictEqual(await tab(), 'world', 'короткий медленный жест не переключает');
  await swipe(-60, 0, 60); assert.strictEqual(await tab(), 'hero', 'короткий, но быстрый взмах переключает');
  await swipe(-20, 200); assert.strictEqual(await tab(), 'hero', 'вертикальная прокрутка не переключает');
  await p.evaluate(() => PC.app.setTab('world'));
  // окно открыто — вкладки не листаются
  await p.evaluate(() => PC.kit.openModal('Окно', '<p>тест</p>'));
  await swipe(-160, 0); assert.strictEqual(await tab(), 'world', 'при открытом окне свайп не работает');
  await p.evaluate(() => PC.kit.closeModal());
  // кнопки снизу тоже анимируют въезд: вперёд — справа, назад — слева
  await p.evaluate(() => { PC.app.setTab('world'); });
  await p.evaluate(() => document.querySelector('#tabs [data-tab="bag"]').click());
  assert.ok(await p.evaluate(() => document.querySelector('#tab-bag').classList.contains('slide-l')), 'кнопка «Сумка» вперёд: въезд справа');
  await p.waitForTimeout(350);
  await p.evaluate(() => document.querySelector('#tabs [data-tab="hero"]').click());
  assert.ok(await p.evaluate(() => document.querySelector('#tab-hero').classList.contains('slide-r')), 'кнопка «Герой» назад: въезд слева');
  await p.waitForTimeout(350);
  await p.evaluate(() => PC.app.setTab('world'));
  await p.waitForTimeout(350);
  // анимация входа
  await swipe(-160, 0, 120);
  assert.deepStrictEqual(await p.evaluate(() => document.querySelector('#tab-hero').className), 'tab', 'класс анимации снят после неё');
  assert.deepStrictEqual(errors, [], 'нет ошибок в странице');
  console.log('ok   листание вкладок свайпом: порядок, края, жесты, блокировки');
  await b.close(); srv.close();
})().catch((e) => { console.error(e); process.exit(1); });
