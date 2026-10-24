// Язык интерфейса: русский (исходный) и английский. Данные и логика игры остаются русскими и одинаковыми у всех
// (так сервер и общий бой сверяют одно и то же), переводится только то, что видит игрок:
//  - готовый текст на экране переводит словарь js/lang/en-*.js (ключ — русский текст, подстановки {}), см. tr();
//  - шаблоны журнала боя переводит движок перед подстановкой (engine.fill), порядок и число случайных выборов не меняются;
//  - склонение чисел — plural() в ui-kit.js.
// Язык хранится в этом браузере (localStorage pc-lang), смена перезагружает страницу. Русский словари не грузит вовсе.
(function (root) {
  'use strict';
  const PC = root.PC || (root.PC = {});
  const KEY = 'pc-lang';
  const CYR = /[А-Яа-яЁё]/;
  const FILES = ['en-ui.js', 'en-data.js', 'en-log.js'];
  let lang = 'ru';
  try { if (root.localStorage.getItem(KEY) === 'en') lang = 'en'; } catch (e) { /* без хранилища — русский */ }

  const dict = new Map(), pats = [], cache = new Map();
  const norm = (s) => s.replace(/\s+/g, ' ').trim();
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // Ключ без {} — точное совпадение; с {} — шаблон, где {} — любой текст (его тоже переводим, он может быть и пустым).
  // В английской части подстановки идут по порядку ({}), либо по номеру ({1}, {2}) — если порядок слов другой.
  // Две подряд ({}{}) работают как одна: первая пустая, вторая забирает весь текст.
  const BOUND = /(?<=[.!?])\s+(?=[А-ЯЁ«"(])/;   // граница предложений
  function add(obj) {
    for (const [k, v] of Object.entries(obj)) {
      const key = norm(k);
      if (!key.includes('{}')) { dict.set(key, v); continue; }
      const chunks = key.split('{}');
      // «… до +7. {}»: после последней подстановки пробел необязателен (пустая подстановка, текст обрезан по краям)
      const tail = chunks.length > 1 && chunks[chunks.length - 1] === '' && /\s$/.test(chunks[chunks.length - 2]);
      if (tail) chunks[chunks.length - 2] = chunks[chunks.length - 2].replace(/\s+$/, '');
      // подряд идущие {}{}: первая берёт число в начале (если оно есть), следующие — остальной текст («8» и « — их больше…»)
      const rx = (cs) => {
        const n = cs.length - 1;
        let out = esc(cs[0]);
        for (let i = 0; i < n; i++) out += (cs[i + 1] === '' && i + 1 < n ? '([+−-]?[\\d.,]*)' : '(.*?)') + esc(cs[i + 1]);
        return out;
      };
      const src = tail ? `${rx(chunks.slice(0, -1))}(?:\\s(.*))?` : rx(chunks);
      pats.push({
        re: new RegExp(`^${src}$`),
        en: v, probe: chunks.reduce((a, b) => (b.length > a.length ? b : a), ''), lit: chunks.join('').length,
        multi: BOUND.test(key),
      });
    }
    pats.sort((a, b) => b.lit - a.lit);   // конкретнее — раньше
    cache.clear();
  }

  function fill(en, caps) {
    let i = 0;
    return en.replace(/\{(\d*)\}/g, (_, n) => (n ? caps[Number(n) - 1] : caps[i++]) ?? '').replace(/ {2,}/g, ' ').trim();
  }

  // «меч» → «Sword» по записи «Меч» и наоборот: регистр первой буквы сохраняем
  function caseVariant(core) {
    const c = core[0], low = c === c.toLowerCase();
    const alt = (low ? c.toUpperCase() : c.toLowerCase()) + core.slice(1);
    const v = dict.get(alt);
    if (v === undefined || !v) return v;
    if (low) return /^[A-Z][a-z]/.test(v) ? v[0].toLowerCase() + v.slice(1) : v;
    return v[0].toUpperCase() + v.slice(1);
  }

  // Разделители по убыванию «крупности»: режем по самому крупному из имеющихся, остальное разберёт рекурсия
  const SEPS = [' · ', ' — ', '; ', ': ', ', ', ' / ', ' | '];
  const CORE = /^([^А-Яа-яЁё]*)([А-Яа-яЁё][\s\S]*[А-Яа-яЁё][.!?…]?|[А-Яа-яЁё])([^А-Яа-яЁё]*)$/;
  const quotes = (s) => s.replace(/«/g, '“').replace(/»/g, '”');
  function compute(core) {
    let d = dict.get(core);
    if (d !== undefined) return d;
    d = caseVariant(core);
    if (d !== undefined) return d;
    const multi = BOUND.test(core);
    for (const p of pats) {
      if (p.multi !== multi) continue;
      if (!core.includes(p.probe)) continue;
      const m = p.re.exec(core);
      if (m) return fill(p.en, m.slice(1).map(tr));
    }
    // кавычки, скобки и значки по краям: «Проходи…», «✦ Гром небесный», «→ Лесная опушка»
    const light = /^([«“"'✦★→←·•\s(\[]*)([\s\S]*?)([»”"')\]\s]*)$/.exec(core);
    if (light && (light[1] || light[3]) && light[2]) return quotes(light[1]) + tr(light[2]) + quotes(light[3]);
    // «Кузнец · Описание из двух предложений»: сначала крупные части
    if (multi && core.includes(' · ')) return core.split(' · ').map(tr).join(' · ');
    // несколько предложений: самые длинные подряд идущие группы, которые есть в словаре целиком, остальное — по одному
    if (multi) {
      const sent = core.split(BOUND), out = [];
      for (let i = 0; i < sent.length;) {
        let j = sent.length, hit;
        for (; j > i + 1; j--) { hit = dict.get(sent.slice(i, j).join(' ')); if (hit !== undefined) break; }
        if (j > i + 1 && hit !== undefined) { out.push(hit); i = j; } else { out.push(tr(sent[i])); i++; }
      }
      return out.join(' ');
    }
    // конец с точкой: «Камень заточки III.» → «Enhancement Stone III.»
    if (/\.$/.test(core)) { const x = tr(core.slice(0, -1)); if (!CYR.test(x)) return `${x}.`; }
    // составной текст: «Атака · Защита», «Название: описание» — переводим части, разделитель оставляем
    for (const sep of SEPS) {
      const parts = core.split(sep);
      if (parts.length > 1) return parts.map(tr).join(sep);
    }
    // количество и приписки в конце: «Камень заточки I ×2», «Меч +3», «Зелье (5)»
    const tailQ = /^([\s\S]*?[А-Яа-яЁёIVX])((?:\s*(?:[×xх]\s*\d[\d.,]*|[+−]\d[\d.,]*%?|\([^)]*\)|\d[\d.,]*\s*💰))+)$/.exec(core);
    if (tailQ) { const x = tr(tailQ[1]); if (!CYR.test(x)) return x + tailQ[2]; }
    // числа и знаки по краям: «+4 физическая атака», «Урон оружия +21»
    const m = CORE.exec(core);
    if (m && (m[1] || m[3])) return quotes(m[1]) + tr(m[2]) + quotes(m[3]);
    // отдельные слова (названия вещей из прилагательного и основы): только если известны все слова, иначе не трогаем
    const words = core.match(/[А-Яа-яЁё]+(?:-[А-Яа-яЁё]+)*/g) || [];
    const known = words.map((w) => dict.get(w) ?? dict.get(w.toLowerCase()));
    if (words.length && known.every((x) => x !== undefined)) {
      let i = 0;
      return core.replace(/[А-Яа-яЁё]+(?:-[А-Яа-яЁё]+)*/g, (w) => {
        const x = known[i++];
        return /^[А-ЯЁ]/.test(w) && /^[a-z]/.test(x) ? x[0].toUpperCase() + x.slice(1) : x;
      }).replace(/\s{2,}/g, ' ');
    }
    return core;
  }

  // Перевод одной строки (с сохранением пробелов по краям); русский язык — строка как есть
  function tr(raw) {
    if (lang !== 'en' || typeof raw !== 'string' || !CYR.test(raw)) return raw;
    const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(raw);
    let out = cache.get(m[2]);
    if (out === undefined) {
      out = compute(norm(m[2]));
      if (cache.size > 6000) cache.clear();
      cache.set(m[2], out);
    }
    return m[1] + out + m[3];
  }

  // Склонение: по-русски три формы (1 игрок, 2 игрока, 5 игроков), по-английски две
  function plural(n, one, few, many) {
    if (lang === 'en') return tr(Math.abs(n) === 1 ? one : many);
    return null;
  }

  // ---------- Перевод экрана ----------
  const ATTRS = ['title', 'placeholder', 'aria-label', 'alt', 'data-title'];
  const SKIP = new Set(['SCRIPT', 'STYLE', 'TEXTAREA']);
  function fixNode(n) {
    if (n.nodeType === 3) {
      const v = n.nodeValue;
      if (CYR.test(v)) { const t = tr(v); if (t !== v) n.nodeValue = t; }
    } else if (n.nodeType === 1) {
      if (SKIP.has(n.tagName) || n.hasAttribute('data-notr')) return;
      for (const a of ATTRS) {
        const v = n.getAttribute(a);
        if (v && CYR.test(v)) { const t = tr(v); if (t !== v) n.setAttribute(a, t); }
      }
      for (let c = n.firstChild; c; c = c.nextSibling) fixNode(c);
    }
  }
  function start() {
    document.documentElement.lang = 'en';
    document.title = tr(document.title);
    fixNode(document.body);
    const obs = new MutationObserver((recs) => {
      for (const r of recs) {
        if (r.type === 'childList') r.addedNodes.forEach(fixNode);
        else if (r.type === 'characterData') fixNode(r.target);
        else if (r.type === 'attributes') {
          const v = r.target.getAttribute(r.attributeName);
          if (v && CYR.test(v)) { const t = tr(v); if (t !== v) r.target.setAttribute(r.attributeName, t); }
        }
      }
      obs.takeRecords();   // свои правки текста не разбираем повторно
    });
    obs.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  }

  const i18n = PC.i18n = {
    get lang() { return lang; }, locale: lang === 'en' ? 'en-US' : 'ru-RU',
    add, tr, t: tr, plural, dict, pats,
    set(l) {
      try { root.localStorage.setItem(KEY, l === 'en' ? 'en' : 'ru'); } catch (e) { /* не сохранилось — останется прежний */ }
      root.location.reload();
    },
    // Окно выбора языка (кнопка «Настройки» в меню)
    openSettings() {
      const { openModal, closeModal } = PC.kit;
      const b = (l, name) => `<button class="btn ${lang === l ? 'primary' : ''}" data-lang="${l}" data-notr>${name}</button>`;
      openModal('Настройки', `<h3 style="margin-top:0">Язык / Language</h3>
        <div class="row-actions">${b('ru', 'Русский')}${b('en', 'English')}</div>
        <p class="hint">Страница перезагрузится. / The page will reload.</p>`, (e) => {
        const x = e.target.closest('[data-lang]');
        if (!x || x.dataset.lang === lang) return;
        closeModal();
        i18n.set(x.dataset.lang);
      });
    },
  };

  if (lang === 'en' && typeof window !== 'undefined') {
    // системные окна (confirm/alert) — не DOM, переводим сами
    for (const k of ['confirm', 'alert']) { const orig = window[k].bind(window); window[k] = (m) => orig(tr(String(m))); }
  }
  if (lang === 'en' && typeof document !== 'undefined') {
    // словари грузятся синхронно во время разбора страницы, до первого экрана
    for (const f of FILES) document.write(`<script src="js/lang/${f}"><\/script>`);
    document.addEventListener('DOMContentLoaded', start);
  }
  if (typeof module !== 'undefined') module.exports = PC;
})(typeof window !== 'undefined' ? window : globalThis);
