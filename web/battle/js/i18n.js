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

  // Ключ без {} — точное совпадение; с {} — шаблон, где {} — любой текст (его тоже переводим).
  // В английской части подстановки идут по порядку ({}), либо по номеру ({1}, {2}) — если порядок слов другой.
  function add(obj) {
    for (const [k, v] of Object.entries(obj)) {
      const key = norm(k);
      if (!key.includes('{}')) { dict.set(key, v); continue; }
      const chunks = key.split('{}');
      pats.push({
        re: new RegExp(`^${chunks.map(esc).join('(.+?)')}$`),
        en: v, probe: chunks.reduce((a, b) => (b.length > a.length ? b : a), ''), lit: chunks.join('').length,
      });
    }
    pats.sort((a, b) => b.lit - a.lit);   // конкретнее — раньше
    cache.clear();
  }

  function fill(en, caps) {
    let i = 0;
    return en.replace(/\{(\d*)\}/g, (_, n) => (n ? caps[Number(n) - 1] : caps[i++]) ?? '');
  }

  const SEP = /( · |; |, | — |: | \/ | \| |\. )/;
  function compute(core) {
    const d = dict.get(core);
    if (d !== undefined) return d;
    for (const p of pats) {
      if (!core.includes(p.probe)) continue;
      const m = p.re.exec(core);
      if (m) return fill(p.en, m.slice(1).map(tr));
    }
    // составной текст: «Атака · Защита», «Название: описание» — переводим части, разделители оставляем
    const parts = core.split(SEP);
    if (parts.length > 1) return parts.map((p, i) => (i % 2 ? p : tr(p))).join('');
    // отдельные слова (названия вещей собираются из прилагательного и основы)
    return core.replace(/[А-Яа-яЁё]+(?:-[А-Яа-яЁё]+)*/g, (w) => {
      const x = dict.get(w) ?? dict.get(w.toLowerCase());
      if (x !== undefined) return /^[А-ЯЁ]/.test(w) && /^[a-z]/.test(x) ? x[0].toUpperCase() + x.slice(1) : x;
      return w;
    });
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

  if (lang === 'en' && typeof document !== 'undefined') {
    // словари грузятся синхронно во время разбора страницы, до первого экрана
    for (const f of FILES) document.write(`<script src="js/lang/${f}"><\/script>`);
    document.addEventListener('DOMContentLoaded', start);
  }
  if (typeof module !== 'undefined') module.exports = PC;
})(typeof window !== 'undefined' ? window : globalThis);
