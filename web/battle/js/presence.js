// Присутствие: кто сейчас на локации (Supabase Realtime Presence, канал loc:<id>). Только для вошедших; в таблицы не пишет.
(function () {
  'use strict';
  const { $, escapeHtml: esc } = PC.kit;
  const auth = PC.auth;
  const SHOW = 50;

  const pres = { players: [], loc: null };
  PC.presence = pres;
  let channel = null, key = null;

  function meta(c) {
    return { id: auth.user.id, nick: c.nick, level: c.level, job: c.job, busy: !$('#battle').hidden };
  }

  function collect() {
    const st = channel.presenceState();
    pres.players = Object.values(st).map((arr) => arr[arr.length - 1]).filter(Boolean)
      .sort((a, b) => (b.level - a.level) || String(a.nick).localeCompare(String(b.nick)));
    draw();
  }

  function leave() {
    if (channel) { auth.client.removeChannel(channel); channel = null; }
    pres.players = []; pres.loc = null; key = null;
  }

  function join(c) {
    leave();
    pres.loc = c.location;
    const ch = auth.client.channel(`loc:${c.location}`, { config: { presence: { key: auth.user.id } } });
    channel = ch;
    ch.on('presence', { event: 'sync' }, () => { if (channel === ch) collect(); })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED' && channel === ch) { key = JSON.stringify(meta(c)); ch.track(meta(c)); }
      });
    draw();
  }

  // HTML блока «Игроки здесь»; пустая строка — игрок не вошёл (офлайн)
  pres.html = function () {
    if (!auth || !auth.client || !auth.user) return '';
    const list = pres.players.slice(0, SHOW).map((p) => {
      const me = p.id === auth.user.id;
      const cls = PC.data.classes[p.job];
      return `<div class="player${me ? ' me' : ''}${p.busy ? ' busy' : ''}"><b>${esc(p.nick)}</b><span class="meta">${cls ? cls.title : ''} · ${p.level} ур.${p.busy ? ' · в бою' : ''}</span></div>`;
    }).join('');
    const more = pres.players.length > SHOW ? `<p class="hint">и ещё ${pres.players.length - SHOW}</p>` : '';
    return `<div class="card section" id="players-card"><h3>Игроки здесь <span class="note">${pres.players.length}</span></h3>
      <div class="player-list">${list || '<p class="hint">Пока никого</p>'}</div>${more}</div>`;
  };

  function draw() {
    const el = $('#players-card');
    if (el) el.outerHTML = pres.html();
  }

  // Раз в секунду сверяем локацию и данные героя
  setInterval(() => {
    const c = PC.app && PC.app.state.char;
    if (!auth.client || !auth.user || !c || !c.nick) { if (channel) leave(); return; }
    if (c.transit) { if (channel) leave(); return; }
    if (pres.loc !== c.location || !channel) { join(c); return; }
    const k = JSON.stringify(meta(c));
    if (!document.hidden) draw();   // страховка: карточка могла быть перерисована хабом без свежих данных
    if (key !== k) { key = k; channel.track(meta(c)); }
  }, 1000);

  window.addEventListener('pc-auth', () => { if (!auth.user) leave(); });
})();
