// Счётчик кадров в правом верхнем углу (диагностика: где проседает fps). Не влияет на игру.
(function () {
  'use strict';
  const el = document.createElement('div');
  el.id = 'fps';
  el.textContent = 'FPS …';
  document.body.appendChild(el);
  let frames = 0, last = performance.now(), worst = 0, prev = last;
  function tick(t) {
    frames++;
    worst = Math.max(worst, t - prev);   // самый долгий кадр за период
    prev = t;
    if (t - last >= 500) {
      const fps = Math.round(frames * 1000 / (t - last));
      el.textContent = `FPS ${fps} · ${Math.round(worst)} мс`;
      el.className = fps >= 50 ? 'ok' : fps >= 30 ? 'mid' : 'low';
      frames = 0; worst = 0; last = t;
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
})();
