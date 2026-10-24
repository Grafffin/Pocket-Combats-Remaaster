// Листание глобальных вкладок (Мир ↔ Герой ↔ Сумка) свайпом влево-вправо.
// Вкладка идёт за пальцем, на краю тянется с сопротивлением, при отпускании либо уезжает и сменяется следующей, либо возвращается.
(function () {
  'use strict';
  const { $ } = PC.kit;
  const ORDER = ['world', 'hero', 'bag'];
  const body = $('#hub-body');
  const DIST = 70, FAST = 0.5, LOCK = 1.4;   // путь для срабатывания (px), быстрый взмах (px/мс), на сколько горизонталь должна превосходить вертикаль
  let g = null;

  // Свайп не нужен, когда экран занят чем-то другим или палец на элементе, которому нужны жесты
  const blocked = (e) => e.touches.length !== 1
    || !PC.app || !ORDER.includes(PC.app.state.tab)
    || !$('#modal').hidden || !$('#sheet').hidden || document.querySelector('#chat.open, .drag-ghost')
    || e.target.closest('input, textarea, select, [data-noswipe]');

  body.addEventListener('touchstart', (e) => {
    if (blocked(e)) { g = null; return; }
    const t = e.touches[0];
    g = { x: t.clientX, y: t.clientY, dx: 0, mode: null, at: performance.now() };
  }, { passive: true });

  body.addEventListener('touchmove', (e) => {
    if (!g) return;
    const t = e.touches[0], dx = t.clientX - g.x, dy = t.clientY - g.y;
    if (!g.mode) {
      if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
      g.mode = Math.abs(dx) > Math.abs(dy) * LOCK ? 'h' : 'v';
      if (g.mode === 'h') {
        g.i = ORDER.indexOf(PC.app.state.tab);
        g.el = $(`#tab-${PC.app.state.tab}`);
        g.el.style.transition = 'none';
      }
    }
    if (g.mode !== 'h') return;
    g.dx = dx;
    const edge = (dx > 0 && g.i === 0) || (dx < 0 && g.i === ORDER.length - 1);
    const shift = dx * (edge ? 0.2 : 0.75);
    g.el.style.transform = `translateX(${shift}px)`;
    g.el.style.opacity = String(1 - Math.min(0.55, Math.abs(shift) / 320));
  }, { passive: true });

  function reset(el, animate) {
    if (!el) return;
    el.style.transition = animate ? 'transform .18s ease-out, opacity .18s ease-out' : '';
    el.style.transform = ''; el.style.opacity = '';
    if (animate) setTimeout(() => { el.style.transition = ''; }, 200);
  }

  function end() {
    const s = g;
    g = null;
    if (!s || s.mode !== 'h') return;
    const dt = Math.max(1, performance.now() - s.at);
    const next = s.i + (s.dx < 0 ? 1 : -1);
    const go = (Math.abs(s.dx) > DIST || (Math.abs(s.dx) > 35 && Math.abs(s.dx) / dt > FAST)) && next >= 0 && next < ORDER.length;
    if (!go) return reset(s.el, true);
    reset(s.el, false);
    PC.app.setTab(ORDER[next]);
    const el = $(`#tab-${ORDER[next]}`);
    el.classList.remove('slide-l', 'slide-r');
    void el.offsetWidth;   // перезапуск анимации
    el.classList.add(s.dx < 0 ? 'slide-l' : 'slide-r');   // свайп влево — новая вкладка приезжает справа
    el.addEventListener('animationend', () => el.classList.remove('slide-l', 'slide-r'), { once: true });
  }
  body.addEventListener('touchend', end, { passive: true });
  body.addEventListener('touchcancel', () => { const s = g; g = null; if (s && s.el) reset(s.el, true); }, { passive: true });
})();
