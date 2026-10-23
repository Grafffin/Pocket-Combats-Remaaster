// Бои на локации: вкладка «Бои» под монстрами (таблицы battles, battle_members).
// Пока бой считает клиент создателя; здесь только публикация боя и список «кто с кем дерётся».
// Если миграция 0004 не применена, всё молча отключается и игра работает как раньше.
(function () {
  'use strict';
  const { $, escapeHtml: esc } = PC.kit;
  const auth = PC.auth;
  const STALE_MS = 3 * 60 * 1000;   // брошенные бои (закрыли вкладку) через 3 минуты не показываем

  const B = { list: [], loc: null, off: false, coop: true };
  PC.battles = B;
  let mine = null, channel = null, loadTimer = null;

  const online = () => !B.off && auth && auth.client && auth.user;
  const noColumn = (error) => !!error && (error.code === '42703' || error.code === 'PGRST204' || /column .* does not exist|Could not find .* column/i.test(error.message || ''));
  function missing(error) {
    if (error && (error.code === '42P01' || error.code === 'PGRST205' || /does not exist|schema cache/i.test(error.message || ''))) B.off = true;
    return !!error;
  }

  async function load() {
    if (!online() || !B.loc) return;
    const loc = B.loc;
    const since = new Date(Date.now() - STALE_MS).toISOString();
    const base = 'id,owner_id,monster_id,monster_level,max_players,started_at,battle_members(user_id,nick,level)';
    const q = (cols, stamp) => auth.client.from('battles').select(cols)
      .eq('location_id', loc).eq('status', 'running').gt(stamp, since).order('started_at', { ascending: false }).limit(30);
    let { data, error } = B.coop ? await q(base + ',diff,monster_hp,monster_max,updated_at', 'updated_at') : { data: null, error: null };
    if (!B.coop || noColumn(error)) { B.coop = false; ({ data, error } = await q(base, 'started_at')); }
    if (missing(error) || loc !== B.loc) return;
    B.list = data || [];
    draw();
  }
  // не сбрасываем таймер при каждом событии: в оживлённой локации обновление иначе откладывалось бы бесконечно
  const soon = () => { if (!loadTimer) loadTimer = setTimeout(() => { loadTimer = null; load(); }, 1200); };

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

  // Публикация своего боя — сразу при нажатии «Напасть», до первого хода (вызывается из startFight).
  // extra: { hp, diff, id } — здоровье монстра, сложность и id боя, чтобы другие могли вступить
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  B.start = async function (c, mob, extra) {
    if (!online()) return;
    const prev = mine, id = extra && extra.id;
    mine = id || null;   // бой «наш» с момента нажатия: B.end, вызванный до конца записи, его тоже закроет
    const cl = auth.client;
    try {
      // Прежний бой покидаем параллельно, не задерживая запись нового
      if (prev && prev !== id && B.coop) cl.rpc('leave_battle', { p_battle: prev }).then(null, () => {});
      if (!B.coop) await cl.from('battles').delete().eq('owner_id', auth.user.id);
      const row = { location_id: c.location, owner_id: auth.user.id, monster_id: mob.id, monster_level: mob.level };
      if (id) row.id = id;
      const full = B.coop && extra ? { ...row, diff: extra.diff || 0, base_hp: extra.hp, monster_max: extra.hp, monster_hp: extra.hp } : null;
      const insert = async () => {
        let res = full ? await cl.from('battles').insert(full).select('id').single() : null;
        if (!res || noColumn(res.error)) { if (res) B.coop = false; res = await cl.from('battles').insert(row).select('id').single(); }
        return res;
      };
      let res = await insert();
      for (let attempt = 0; attempt < 2 && res.error; attempt++) {
        const e = res.error;
        if (e.code === '23505') {   // без миграции 0011 прежний «идущий» бой хозяина мешает новому: убираем свои брошенные бои
          const stale = new Date(Date.now() - STALE_MS).toISOString();
          await cl.from('battles').delete().eq('owner_id', auth.user.id).eq('status', 'running').lt('updated_at', stale);
        } else if (/too fast/.test(e.message || '')) {   // защита 0007: не чаще боя в 2 с (быстрый повтор после бегства)
          await sleep(2100);
        } else break;
        res = await insert();
      }
      const { data, error } = res;
      if (missing(error) || error) { if (error) console.warn('battle publish', error); if (mine === id) mine = null; return; }
      if (id && mine !== id) { cl.rpc('leave_battle', { p_battle: data.id }).then(null, () => {}); return; }   // бой уже кончился, пока писали
      mine = data.id;
      await cl.from('battle_members').insert({ battle_id: mine, user_id: auth.user.id, nick: c.nick, level: c.level, job: c.job });
      if (mine !== data.id) cl.rpc('leave_battle', { p_battle: data.id }).then(null, () => {});
      soon();
    } catch (e) { console.warn('battle publish', e); }
  };

  // Выйти из своего боя (в совместном бой остаётся у остальных) и убрать свои зависшие бои
  B.end = async function () {
    const was = mine;
    mine = null;
    if (!online()) return;
    try {
      if (was && B.coop) await auth.client.rpc('leave_battle', { p_battle: was });
      await auth.client.from('battles').delete().eq('owner_id', auth.user.id).eq('status', 'running').is('monster_hp', null);
      if (!B.coop) await auth.client.from('battles').delete().eq('owner_id', auth.user.id);
    } catch (e) { /* не критично */ }
    soon();
  };

  // Вступить в чужой бой. Возвращает { id, monster_id, monster_level, diff, monster_hp, monster_max } или { error }.
  B.join = async function (c, id) {
    if (!online() || !B.coop) return { error: 'Совместные бои недоступны' };
    B.end();   // не ждём: прежние свои бои убираются параллельно со вступлением
    const { data, error } = await auth.client.rpc('join_battle', { p_battle: id, p_nick: c.nick, p_level: c.level, p_job: c.job });
    if (error) {
      if (noColumn(error) || error.code === 'PGRST202' || error.code === '42883') { B.coop = false; return { error: 'Совместные бои ещё не включены на сервере' }; }
      const m = error.message || '';
      return { error: /battle_full/.test(m) ? 'В бою уже 10 игроков' : /battle_closed/.test(m) ? 'Бой уже закончился' : 'Не удалось вступить в бой' };
    }
    mine = data.id;
    soon();
    return data;
  };

  // ---- Канал общего боя: все участники и хозяин шлют друг другу сообщения (см. lockstep.js) ----
  // Возвращает { send, ready, close }; ready — промис, когда подписка на канал готова.
  B.channel = function (id, onMessage) {
    const ch = auth.client.channel(`bls:${id}`, { config: { broadcast: { self: false } } });
    let up = null;
    const ready = new Promise((resolve) => { up = resolve; setTimeout(() => resolve(false), 5000); });
    ch.on('broadcast', { event: 'ls' }, ({ payload }) => onMessage(payload))
      .subscribe((st) => { if (st === 'SUBSCRIBED') up(true); });
    return {
      send: (m) => { try { ch.send({ type: 'broadcast', event: 'ls', payload: m }); } catch (e) { /* не критично */ } },
      ready,
      close: () => { try { auth.client.removeChannel(ch); } catch (e) { /* не критично */ } },
    };
  };

  // Хозяин сообщает базе состояние боя: для списка «Бои» (здоровье монстра) и чтобы бой не считался брошенным
  B.state = async function (id, hp, max, finished) {
    if (!online() || !id) return;
    try {
      if (B.stateRpc !== false) {
        const { error } = await auth.client.rpc('battle_state', { p_battle: id, p_hp: Math.round(hp), p_max: Math.round(max), p_finished: !!finished });
        if (!error) return;
        if (error.code === 'PGRST202') B.stateRpc = false;
      }
      await auth.client.rpc('battle_hit', { p_battle: id, p_damage: 0 });   // без миграции 0009 — хотя бы «жив»
    } catch (e) { /* не критично */ }
  };
  B.canCoop = () => !!online() && B.coop;
  B.inBattle = () => !!mine;
  B.mineId = () => mine;

  // ---- История боёв: по записи на участника, таблица battle_history (миграция 0008) ----
  // info: { location, monsterId, level, diff, result, turns, my, total, log: [{type,text}] }
  const plain = (t) => String(t || '').replace(/<[^>]*>/g, '');
  B.record = async function (c, info) {
    if (!online() || B.hist === false) return;
    try {
      const names = (info.members && info.members.length ? info.members : [c.nick]).filter(Boolean);
      const log = (info.log || []).slice(-80).map((e) => ({ k: e.type, t: plain(e.text) }));
      const { error } = await auth.client.from('battle_history').insert({
        user_id: auth.user.id, location_id: info.location, monster_id: info.monsterId, monster_level: info.level, diff: info.diff || 0,
        result: info.result, turns: info.turns || 0, my_damage: info.my == null ? null : Math.round(info.my), total_damage: info.total == null ? null : Math.round(info.total),
        members: names, log,
      });
      if (error && (missing(error) || error.code === '42P01')) B.hist = false;
    } catch (e) { /* не критично */ }
  };
  B.history = async function () {
    if (!online() || B.hist === false) return null;
    const { data, error } = await auth.client.from('battle_history')
      .select('id,monster_id,monster_level,diff,result,turns,my_damage,total_damage,members,log,ended_at').order('ended_at', { ascending: false }).limit(30);
    if (error) { if (missing(error)) B.hist = false; return null; }
    return data || [];
  };

  B.html = function () {
    if (!online()) return '';
    const rows = B.list.map((b) => {
      const m = PC.data.monsters[b.monster_id];
      const ms = b.battle_members || [];
      const names = ms.length ? ms.map((x) => `<b>${esc(x.nick)}</b>`).join(', ') : '…';
      const you = ms.some((x) => x.user_id === auth.user.id);
      const pct = b.monster_max ? Math.max(1, Math.round((b.monster_hp / b.monster_max) * 100)) : null;
      const canJoin = !you && B.coop && b.monster_hp > 0 && ms.length < b.max_players;
      return `<div class="battle-row${you ? ' me' : ''}"><div>${names} <span class="vs">→</span> ${esc(m ? m.name : b.monster_id)} <span class="meta">${b.monster_level} ур.${pct != null ? ` · ${pct}% HP` : ''}</span></div>
        <span class="meta">${ms.length}/${b.max_players}</span>${canJoin ? `<button class="btn small" data-act="join-battle" data-battle="${b.id}">Вступить</button>` : ''}</div>`;
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

  // Обновление страницы не выводит из боя: участник остаётся в базе, а при загрузке игра возвращает в бой.
  // Брошенный бой (не заходили дольше STALE_MS) не возвращаем.
  B.resume = async function (c) {
    if (!online() || !B.coop || mine) return null;
    try {
      const since = new Date(Date.now() - STALE_MS).toISOString();
      const { data, error } = await auth.client.from('battle_members')
        .select('hp,hp_max,res,res_max,battles!inner(id,owner_id,monster_id,monster_level,diff,monster_hp,monster_max,status,updated_at)')
        .eq('user_id', auth.user.id).eq('battles.status', 'running').gt('battles.monster_hp', 0).gt('battles.updated_at', since).limit(1);
      if (error || !data || !data.length) return null;
      const m = data[0], b = m.battles;
      if (!PC.data.monsters[b.monster_id]) return null;
      mine = b.id;
      soon();
      return { ...b, resume: { hp: m.hp, hpMax: m.hp_max, res: m.res } };
    } catch (e) { return null; }
  };
  let resumeTried = false;
  setInterval(() => {
    const app = PC.app, c = app && app.state.char;
    if (resumeTried || !auth.user || !c || !c.nick || c.transit || !app.resumeFight || app.state.fight || mine) return;
    resumeTried = true;
    B.resume(c).then((row) => { if (row && !app.state.fight && !app.resumeFight(row)) B.end(); });
  }, 1000);
  window.addEventListener('pc-auth', () => { if (!auth.user) watch(null); });
})();
