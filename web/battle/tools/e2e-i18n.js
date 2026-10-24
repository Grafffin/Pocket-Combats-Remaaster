// Обход экранов игры в английском режиме: ищет текст, оставшийся по-русски (узлы и атрибуты title/placeholder/aria-label/alt).
// Запуск: NODE_PATH=$(npm root -g) node web/battle/tools/e2e-i18n.js   (Playwright и Chromium); код возврата 1, если что-то осталось
const path = require('path'), http = require('http'), fs = require('fs');
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const found = new Map();   // строка → где найдена
const all = new Set();     // всё показанное (для DUMP=файл: просмотр качества перевода глазами)
(async () => {
  await new Promise((r) => srv.listen(0, r));
  const D = PC.data, I = PC.items, P = PC.progression, rng = PC.makeRng(5);
  const hero = P.newCharacter(D, { nick: 'Tester', job: Object.keys(D.classes)[0] });
  hero.level = 12; hero.gold = 50000; hero.location = D.HOME; hero.statPoints = 3; hero.skillPoints = 2;
  for (let i = 0; i < 16; i++) { const it = I.generate(D, { ilvl: 12, tier: 2, rarityFloor: i % 7, cls: hero.job }, rng); I.bagAdd(hero, it); }
  for (const id of ['ore', 'ore2', 'leather', 'cloth', 'chitin', 'herb_stjohn', 'spider_gland', 'stone1', 'stone2', 'protect', 'reroll', 'essence']) I.matAdd(D, hero, id, 9);
  I.generate && Object.keys(D.uniques || {}).slice(0, 2).forEach((id) => { try { I.bagAdd(hero, I.generateUnique(D, id, { ilvl: 12 }, rng)); } catch (e) { /* уников может не быть */ } });
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium' });
  const page = await (await b.newContext({ viewport: { width: 375, height: 812 }, hasTouch: true })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(`localStorage.setItem('pc-lang','en'); localStorage.setItem('pc-character-v3', ${JSON.stringify(JSON.stringify(hero))})`);
  await page.goto(`http://localhost:${srv.address().port}/battle/index.html`);
  await page.waitForFunction(() => window.PC && PC.app && PC.app.state.char);
  await page.evaluate(() => { document.querySelector('#auth') && (document.querySelector('#auth').hidden = true); });
  await sleep(300);
  const scan = async (where) => {
    await sleep(120);
    const list = await page.evaluate(() => {
      const CYR = /[А-Яа-яЁё]/, out = [];
      const walk = (n) => {
        if (n.nodeType === 3) { if (CYR.test(n.nodeValue)) out.push(n.nodeValue.trim()); else if (n.nodeValue.trim().length > 2 && n.parentElement && n.parentElement.offsetParent !== null) out.push('\u0001' + n.nodeValue.trim()); return; }
        if (n.nodeType !== 1 || n.hasAttribute('data-notr') || ['SCRIPT', 'STYLE'].includes(n.tagName)) return;
        for (const a of ['title', 'placeholder', 'aria-label', 'alt', 'data-title']) { const v = n.getAttribute(a); if (v && CYR.test(v)) out.push(`[${a}] ${v}`); }
        n.childNodes.forEach(walk);
      };
      walk(document.body);
      return out;
    });
    for (const s of list) { if (s[0] === '\u0001') all.add(s.slice(1)); else if (!found.has(s)) found.set(s, where); }
  };
  const ev = (fn, arg) => page.evaluate(fn, arg);
  const closeAll = () => ev(() => { try { PC.kit.closeModal(); PC.kit.closeSheet(); } catch (e) { /* уже закрыто */ } });

  // вкладки
  for (const t of ['world', 'hero', 'bag']) { await ev((x) => PC.app.setTab(x), t); await scan(`вкладка ${t}`); }
  // справка по характеристикам и терминам
  await ev(() => PC.app.setTab('hero'));
  const infos = await ev(() => [...new Set([...document.querySelectorAll('[data-info]')].map((e) => e.dataset.info))]);
  for (const id of infos.slice(0, 60)) { await ev((x) => PC.itemUI.openInfo(x), id); await scan(`справка ${id}`); await closeAll(); }
  // навыки и пассивки
  const skillBtns = await ev(() => [...document.querySelectorAll('#tab-hero [data-skill], #tab-hero [data-passive], #tab-hero [data-stat]')].length);
  // карточки вещей
  const items = await ev(() => PC.app.state.char.bag.filter((x) => x && !x.stack).map((x) => x.uid));
  for (const uid of items) { await ev((u) => { const c = PC.app.state.char; PC.itemUI.openItem(c, c.bag.find((x) => x && x.uid === u), 'bag', '<button class="btn">x</button>', null); }, uid); await scan('карточка вещи'); await ev(() => { PC.kit.prefs.lens = true; }); await ev((u) => { const c = PC.app.state.char; PC.itemUI.openItem(c, c.bag.find((x) => x && x.uid === u), 'bag', '', null); }, uid); await scan('карточка вещи с лупой'); await ev(() => { PC.kit.prefs.lens = false; }); await closeAll(); }
  // ресурсы
  for (const id of ['ore', 'ore2', 'leather', 'cloth', 'chitin', 'herb_stjohn', 'spider_gland', 'stone1', 'protect', 'essence', 'hp_potion_1', 'elixir_power']) { await ev((x) => PC.itemUI.openInfo(x), id); await scan(`ресурс ${id}`); await closeAll(); }
  // кузница
  for (const sub of ['enhance', 'rank', 'inherit', 'reroll', 'craft', 'scribe', 'repair']) { await ev((x) => PC.app.setTab('forge', x), sub); await scan(`кузница ${sub}`); }
  // меню и окна
  await ev(() => PC.app.setTab('world'));
  for (const npc of ['shop', 'buyer', 'workshop', 'alchemist', 'market', 'stash']) {
    await ev((x) => { const e = document.querySelector(`[data-npc="${x}"]`); e && e.click(); }, npc); await scan(`житель ${npc}`); await closeAll();
  }
  await ev(() => document.querySelector('#tabs [data-tab="menu"]').click()); await scan('меню');
  for (const m of ['account', 'history', 'settings']) { await closeAll(); await ev(() => document.querySelector('#tabs [data-tab="menu"]').click()); await ev((x) => { const e = document.querySelector(`[data-menu="${x}"]`); e && e.click(); }, m); await scan(`меню ${m}`); }
  await closeAll();
  // монстр
  await ev(() => PC.app.setTab('world'));
  await ev(() => { const e = document.querySelector('[data-mobinfo]'); e && e.click(); }); await scan('карточка монстра'); await closeAll();
  // сумка: разбор оптом, продажа
  await ev(() => PC.app.setTab('bag'));
  await ev(() => { const e = document.querySelector('[data-act="mass"]'); e && e.click(); }); await scan('разбор оптом'); await closeAll();

  // случайные нажатия: кнопки и ссылки на вкладках и в окнах, пока не наберётся достаточно состояний (тосты, итоги действий, подсказки)
  let seed = Number(process.env.SEED || 12345);
  const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
  const monkey = async (where, n) => {
    for (let i = 0; i < n; i++) {
      const picked = await page.evaluate((r) => {
        const root = !document.querySelector('#modal').hidden ? document.querySelector('#modal') : !document.querySelector('#sheet').hidden ? document.querySelector('#sheet') : document.querySelector('#hub-body');
        const cand = [...root.querySelectorAll('button:not([disabled]), [data-info], [data-npc], [data-sub], [data-pick], [data-mobinfo], [data-recipe], [data-press]')]
          .filter((e) => e.offsetParent !== null && !/(delete|logout|signout|leave|attack|mass-sell|remove)/i.test(e.dataset.act || e.dataset.menu || ''));
        if (!cand.length) return false;
        const e = cand[Math.floor(r * cand.length)];
        e.click();
        return true;
      }, rand());
      if (!picked) break;
      await sleep(90);
      await scan(`${where} (случайно ${i})`);
      if (rand() < 0.3) await closeAll();
    }
  };
  for (const t of ['hero', 'bag', 'world']) { await ev((x) => PC.app.setTab(x), t); await monkey(`вкладка ${t}`, 40); await closeAll(); }
  for (const sub of ['enhance', 'rank', 'reroll', 'craft', 'scribe', 'repair']) { await ev((x) => PC.app.setTab('forge', x), sub); await monkey(`кузница ${sub}`, 30); await closeAll(); }
  for (const npc of ['shop', 'alchemist', 'buyer', 'stash']) { await ev(() => PC.app.setTab('world')); await ev((x) => { const e = document.querySelector(`[data-npc="${x}"]`); e && e.click(); }, npc); await monkey(`житель ${npc}`, 25); await closeAll(); }

  // бой
  await ev(() => { PC.app.state.char.location = 'forest_edge'; PC.app.state.char.restTick = 0; PC.app.setTab('world'); });
  await sleep(1200);
  await ev(() => { const e = [...document.querySelectorAll('[data-attack]')].find((x) => !x.disabled); e && e.click(); });
  await sleep(800); await scan('начало боя');
  for (let i = 0; i < 12; i++) {
    await ev(() => { const s = document.querySelector('#skillbar button:not([disabled])'); s && s.click(); });
    await sleep(700); await scan('бой');
    if (await ev(() => !document.querySelector('#result').hidden)) break;
  }
  await ev(() => { const e = document.querySelector('#auto-btn'); e && e.click(); });
  for (let i = 0; i < 40; i++) { if (await ev(() => !document.querySelector('#result').hidden)) break; await sleep(800); await scan('автобой'); }
  await scan('итог боя');
  await ev(() => { const e = document.querySelector('#auto-settings'); e && e.click(); }); await scan('настройки автобоя');

  await b.close(); srv.close();
  if (process.env.DUMP) fs.writeFileSync(process.env.DUMP, [...all].sort().join('\n'));
  console.log(`найдено русских строк: ${found.size}`);
  for (const [s, w] of found) console.log(`  [${w}] ${JSON.stringify(s)}`);
  if (errors.length) console.log('ошибки страницы:', errors.slice(0, 5));
  process.exit(found.size || errors.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
