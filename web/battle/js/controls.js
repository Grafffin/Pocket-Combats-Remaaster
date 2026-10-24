// Свои поля вместо браузерных: выпадающий список (шторка с вариантами) и числовое поле с кнопками.
// Ничего не нужно менять в разметке окон: любой <select> и <input type="number"> подхватывается сам (MutationObserver),
// а обработчики окон продолжают слушать обычные события change/input на исходном элементе.
//   <select data-title="Заголовок шторки">      — заголовок шторки; без него берётся текст ближайшей подписи
//   <input type="number" data-steps="1,5" data-max="123">  — шаги кнопок (по умолчанию 1,5) и MAX (кнопка только если задан)
(function () {
  'use strict';
  const { escapeHtml } = PC.kit;

  const fire = (el, type) => el.dispatchEvent(new Event(type, { bubbles: true }));

  // ---------- Выпадающий список ----------

  let picker = null;
  function closePicker() { if (picker) { picker.remove(); picker = null; } }

  function openPicker(select) {
    closePicker();
    const near = (sel) => { const n = select.closest(sel); return n ? n : null; };
    const lab = near('label'), blk = near('.mf-block'), tg = near('.toggle');
    const label = select.dataset.title || (lab && lab.firstChild && lab.firstChild.textContent.trim()) ||
      (blk && blk.querySelector('h4') && blk.querySelector('h4').firstChild.textContent.trim()) ||
      (tg && tg.querySelector('span') && tg.querySelector('span').textContent.trim()) || 'Выбор';
    const opts = [...select.options].map((o, i) => `<button class="pick-opt ${i === select.selectedIndex ? 'on' : ''}" data-i="${i}" ${o.disabled ? 'disabled' : ''}><span>${escapeHtml(o.textContent)}</span><i class="pick-mark"></i></button>`).join('');
    picker = document.createElement('div');
    picker.className = 'picker';
    picker.innerHTML = `<div class="picker-back"></div><div class="picker-sheet" role="listbox"><div class="picker-head"><b>${escapeHtml(label)}</b><button class="icon-btn picker-x" aria-label="Закрыть">×</button></div><div class="picker-list">${opts}</div></div>`;
    document.body.appendChild(picker);
    const on = picker.querySelector('.pick-opt.on');
    if (on) on.scrollIntoView({ block: 'center' });
    picker.addEventListener('click', (e) => {
      if (e.target.closest('.picker-back, .picker-x')) return closePicker();
      const b = e.target.closest('.pick-opt');
      if (!b || b.disabled) return;
      select.selectedIndex = Number(b.dataset.i);
      syncSelect(select);
      closePicker();
      fire(select, 'input');
      fire(select, 'change');
    });
  }
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePicker(); });

  function syncSelect(select) {
    const face = select.parentNode && select.parentNode.querySelector('.csel-face');
    if (face) face.textContent = select.options[select.selectedIndex] ? select.options[select.selectedIndex].textContent : '';
  }

  function enhanceSelect(select) {
    if (select.dataset.csel) return;
    select.dataset.csel = '1';
    const wrap = document.createElement('div');
    wrap.className = 'csel';
    if (select.hasAttribute('style')) wrap.setAttribute('style', select.getAttribute('style'));
    select.parentNode.insertBefore(wrap, select);
    wrap.appendChild(select);
    wrap.insertAdjacentHTML('beforeend', '<span class="csel-face"></span><i class="csel-arrow"></i>');
    syncSelect(select);
    wrap.addEventListener('click', () => { if (!select.disabled) openPicker(select); });
  }

  // ---------- Числовое поле ----------

  function enhanceNumber(input) {
    if (input.dataset.cnum) return;
    input.dataset.cnum = '1';
    const steps = (input.dataset.steps || '1,5').split(',').map(Number).filter((n) => n > 0);
    const small = steps[0] || 1, big = steps[1] || small * 5;
    const wrap = document.createElement('div');
    wrap.className = 'cnum';
    input.parentNode.insertBefore(wrap, input);
    const btn = (label, cls, act) => `<button type="button" class="cnum-btn ${cls}" data-cn="${act}">${label}</button>`;
    wrap.innerHTML = `${btn(`−${big}`, '', 'b-')}${btn(`−${small}`, '', 's-')}<span class="cnum-field"></span>${btn(`+${small}`, '', 's+')}${btn(`+${big}`, '', 'b+')}${input.dataset.max !== undefined ? btn('MAX', 'max', 'max') : ''}`;
    wrap.querySelector('.cnum-field').appendChild(input);

    const bounds = () => {
      const min = input.min !== '' ? Number(input.min) : 0;
      const max = input.dataset.max !== undefined && input.dataset.max !== '' ? Number(input.dataset.max) : (input.max !== '' ? Number(input.max) : Infinity);
      return [min, max];
    };
    const apply = (v) => {
      const [min, max] = bounds();
      input.value = String(Math.max(min, Math.min(max, Math.floor(v) || 0)));
      fire(input, 'input');
      fire(input, 'change');
    };
    const act = (a) => {
      const cur = Math.floor(Number(input.value)) || 0;
      if (a === 'b-') apply(cur - big); else if (a === 's-') apply(cur - small);
      else if (a === 's+') apply(cur + small); else if (a === 'b+') apply(cur + big);
      else if (a === 'max') apply(bounds()[1]);
    };
    // Нажатие — один шаг, удержание — повтор
    let hold = null;
    const stop = () => { clearTimeout(hold); clearInterval(hold); hold = null; };
    wrap.addEventListener('pointerdown', (e) => {
      const b = e.target.closest('.cnum-btn');
      if (!b || b.dataset.cn === 'max') return;
      e.preventDefault();
      act(b.dataset.cn);
      hold = setTimeout(() => { hold = setInterval(() => act(b.dataset.cn), 90); }, 420);
    });
    for (const t of ['pointerup', 'pointerleave', 'pointercancel']) wrap.addEventListener(t, stop);
    wrap.addEventListener('click', (e) => {
      const b = e.target.closest('.cnum-btn');
      if (b && b.dataset.cn === 'max') act('max');
    });
    input.addEventListener('blur', () => { if (input.value !== '') apply(Number(input.value)); });
  }

  function enhance(root) {
    if (root.nodeType !== 1) return;
    if (root.matches('select')) enhanceSelect(root);
    else if (root.matches('input[type="number"]')) enhanceNumber(root);
    for (const el of root.querySelectorAll('select:not([data-csel]), input[type="number"]:not([data-cnum])')) {
      if (el.matches('select')) enhanceSelect(el); else enhanceNumber(el);
    }
  }

  new MutationObserver((list) => { for (const m of list) for (const n of m.addedNodes) enhance(n); })
    .observe(document.body, { childList: true, subtree: true });
  enhance(document.body);

  PC.kit.closePicker = closePicker;
})();
