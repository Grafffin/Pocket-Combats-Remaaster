// Общие мелочи интерфейса: выборка элементов, иконки тактик, аватары, нижняя шторка.
(function () {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const icon = (t) => `<svg><use href="#i-${t}"/></svg>`;

  function avatar(f) {
    if (f.icon) return `<div class="ava"><img src="${f.icon}" alt="" onerror="this.replaceWith(document.createTextNode('${f.emoji || '?'}'))"></div>`;
    if (f.emoji) return `<div class="ava">${f.emoji}</div>`;
    return `<div class="ava letter">${f.name.charAt(0).toUpperCase()}</div>`;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function plural(n, one, few, many) {
    const m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
    return many;
  }

  // Шторка: содержимое и обработчик кликов задаёт тот, кто её открыл
  let sheetHandler = null;
  function openSheet(title, html, onClick) {
    $('#sheet-title').textContent = title;
    $('#sheet-body').innerHTML = html;
    sheetHandler = onClick || null;
    $('#sheet').hidden = false;
  }
  function closeSheet() {
    $('#sheet').hidden = true;
    sheetHandler = null;
  }
  $('#sheet').addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) return closeSheet();
    if (sheetHandler) sheetHandler(e);
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheet(); });

  function storage(key, fallback) {
    return {
      load() {
        try { return JSON.parse(localStorage.getItem(key) || 'null') || fallback; } catch (e) { return fallback; }
      },
      save(value) {
        try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* без хранилища живём в памяти */ }
      },
      clear() {
        try { localStorage.removeItem(key); } catch (e) { /* нечего чистить */ }
      },
    };
  }

  PC.kit = { $, icon, avatar, escapeHtml, plural, openSheet, closeSheet, storage };
})();
