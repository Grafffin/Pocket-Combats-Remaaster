// Бои на локации: вкладка «Бои» под монстрами (таблицы battles, battle_members).
// Пока бой считает клиент создателя; здесь только публикация боя и список «кто с кем дерётся».
// Если миграция 0004 не применена, всё молча отключается и игра работает как раньше.
(function () {
  'use strict';
  const { $, escapeHtml: esc } = PC.kit;
  const auth = PC.auth;
  const STALE_MS = 3 * 60 * 1000;   // брошенные бои (закрыли вкладку) через 3 минуты не показываем

  const B = { list: [], loc: null, off: false };
  PC.battles = B;
  let mine = null, channel = null, loadTimer = null;

  const online = () => !B.off && auth && auth.client && auth.user;
  function missing(error) {
    if (error && (error.code === '42P01' || error.code === 'PGRST205' || /does not exist|schema cache/i.test(error.message || ''))) B.off = true;
    return !!error;
  }

  async function load() {
    if (!online() || !B.loc) return;
    const loc = B.loc;
    const since = new Date(Date.now() - STALE_MS).toISOString();
    const { data, error } = await auth.client.from('battles')
      .select('id,owner_id,monster_id,monster_level,max_players,started_at,battle_members(user_id,nick,level)')
      .eq('location_id', loc).eq('status', 'running').gt('started_at', since).order('started_at', { ascending: false }).limit(30);
    if (missing(error) || loc !== B.loc) return;
    B.list = data || [];
    draw();
  }
  const soon = () => { clearTimeout(loadTimer); loadTimer = setTimeout(load, 300); };

  function watch(loc) {
    if (channel) { auth.client.removeChannel(channel); channel = null; }
    B.loc = loc; B.list = [];
    if (!loc || !online()) return draw();
    channel = auth.client.channel(`battles:${loc}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'battles', filter: `location_id=eq.${loc}` }, soon)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'battle_members' }, soon)
      .subscribe();
    load();
  }

  // Публикация своего боя (вызывается при нападении на монстра)
  B.start = async function (c, mob) {
    if (!online()) return;
    try {
      await B.end();
      const cl = auth.client;
      const { data, error } = await cl.from('battles').insert({ location_id: c.location, owner_id: auth.user.id, monster_id: mob.id, monster_level: mob.level }).select('id').single();
      if (missing(error)) return;
      mine = data.id;
      await cl.from('battle_members').insert({ battle_id: mine, user_id: auth.user.id, nick: c.nick, level: c.level, job: c.job });
      soon();
    } catch (e) { console.warn('battle publish', e); }
  };

  B.end = async function () {
    if (!online()) { mine = null; return; }
    try {
      // удаляем и по id, и все свои зависшие бои
      await auth.client.from('battles').delete().eq('owner_id', auth.user.id);
    } catch (e) { /* не критично */ }
    mine = null; soon();
  };

  B.html = function () {
    if (!online()) return '';
    const rows = B.list.map((b) => {
      const m = PC.data.monsters[b.monster_id];
      const ms = b.battle_members || [];
      const names = ms.length ? ms.map((x) => `<b>${esc(x.nick)}</b>`).join(', ') : '…';
      const you = b.owner_id === auth.user.id;
      return `<div class="battle-row${you ? ' me' : ''}"><div>${names} <span class="vs">→</span> ${esc(m ? m.name : b.monster_id)} <span class="meta">${b.monster_level} ур.</span></div>
        <span class="meta">${ms.length}/${b.max_players}</span></div>`;
    }).join('');
    return `<div class="card section" id="battles-card"><h3>Бои <span class="note">${B.list.length}</span></h3>
      <div class="battle-list">${rows || '<p class="hint">Сейчас никто не сражается</p>'}</div></div>`;
  };

  function draw() { const el = $('#battles-card'); if (el) el.outerHTML = B.html(); }

  setInterval(() => {
    const c = PC.app && PC.app.state.char;
    const loc = auth.user && c && c.nick && !c.transit ? c.location : null;
    if (loc !== B.loc || (loc && !channel)) watch(loc);
    else if (loc) load();
  }, 15000);
  setInterval(() => {   // смена локации/входа замечается быстро
    const c = PC.app && PC.app.state.char;
    const loc = auth.user && c && c.nick && !c.transit ? c.location : null;
    if (loc !== B.loc) watch(loc);
  }, 1000);

  window.addEventListener('pagehide', () => { if (mine) B.end(); });
  window.addEventListener('pc-auth', () => { if (!auth.user) watch(null); });
})();
