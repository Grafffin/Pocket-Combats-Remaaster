// Общие мелочи интерфейса: выборка элементов, картинки из assets, шторка, тосты, хранилище.
(function () {
  'use strict';
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];

  // Картинка из web/battle/assets; если файла нет — запасной символ
  function art(path, fallback = '', cls = '') {
    if (!path) return `<span class="fallback ${cls}">${fallback}</span>`;
    const fb = String(fallback).replace(/'/g, '');
    return `<img class="${cls}" src="assets/${path}.svg" alt="" loading="lazy" onerror="this.outerHTML='<span class=&quot;fallback&quot;>${fb}</span>'">`;
  }
  const statIcon = (key) => {
    const def = PC.data.statDefs[key];
    return def ? `<img class="stat-ico" src="assets/stats/${def.icon}.svg" alt="" onerror="this.remove()">` : '';
  };

  function avatar(f, size) {
    return `<div class="ava" ${size ? `style="width:${size}px;height:${size}px"` : ''}>${art(f.art, f.emoji || (f.name || '?').charAt(0))}</div>`;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function plural(n, one, few, many) {
    const en = PC.i18n && PC.i18n.plural(n, one, few, many);
    if (en != null) return en;
    const m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
    return many;
  }

  const fmtNum = (n) => (n >= 10000 ? `${Math.round(n / 1000)}к` : String(Math.round(n)));

  // Шторка: содержимое и обработчик кликов задаёт тот, кто её открыл.
  // modal: шторку нельзя закрыть мимо кнопок.
  let sheetHandler = null;
  let sheetModal = false;
  let sheetOnClose = null;
  function openSheet(title, html, onClick, { modal = false, onClose = null } = {}) {
    sheetModal = modal;
    sheetOnClose = onClose;
    $('#sheet').classList.remove('over-modal', 'centered');
    $('#sheet-title').textContent = title;
    $('#sheet-body').innerHTML = html;
    sheetHandler = onClick || null;
    $('#sheet').hidden = false;
  }
  function closeSheet() {
    $('#sheet').hidden = true;
    sheetHandler = null;
    const cb = sheetOnClose;
    sheetOnClose = null;
    if (cb) cb();
  }
  $('#sheet').addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) return sheetModal ? undefined : closeSheet();
    if (sheetHandler) sheetHandler(e);
  });
  $('#sheet').addEventListener('change', (e) => { if (sheetHandler) sheetHandler(e); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !sheetModal && !$('#sheet').hidden) closeSheet(); });

  // Окно по центру экрана (как в EHT) — для предметов, ресурсов и подтверждений.
  // tools — html кнопок в шапке рядом с крестиком.
  let modalHandler = null;
  let modalOnClose = null;
  function openModal(title, html, onClick, { tools = '', onClose = null, cls = '' } = {}) {
    $('#modal .modal').className = `modal ${cls}`;
    $('#modal-title').innerHTML = title;
    $('#modal-tools').innerHTML = tools;
    $('#modal-body').innerHTML = html;
    modalHandler = onClick || null;
    modalOnClose = onClose;
    $('#modal').hidden = false;
  }
  function closeModal() {
    if ($('#modal').hidden) return;
    $('#modal').hidden = true;
    modalHandler = null;
    const cb = modalOnClose;
    modalOnClose = null;
    if (cb) cb();
    window.dispatchEvent(new Event('pc-modal-closed'));   // обмен возвращает своё окно, если его закрыло чужое
  }
  $('#modal').addEventListener('click', (e) => {
    if (e.target.closest('[data-mclose]')) return closeModal();
    if (modalHandler) modalHandler(e);
  });
  $('#modal').addEventListener('change', (e) => { if (modalHandler) modalHandler(e); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

  // Настройки интерфейса на этом устройстве: лупа, свёрнутые блоки
  const prefsStore = storage('pc-ui-prefs', { lens: false, collapsed: {} });
  const prefs = prefsStore.load();
  const savePrefs = () => prefsStore.save(prefs);

  function toast(text, kind = '') {
    const el = document.createElement('div');
    el.className = `toast ${kind}`;
    el.innerHTML = text;
    $('#toasts').appendChild(el);
    setTimeout(() => { el.style.transition = 'opacity .3s'; el.style.opacity = '0'; }, 2600);
    setTimeout(() => el.remove(), 3000);
  }

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

  PC.kit = { $, $$, art, statIcon, avatar, escapeHtml, plural, fmtNum, openSheet, closeSheet, openModal, closeModal, prefs, savePrefs, toast, storage };
})();
