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
  const soon = () => { clearTimeout(loadTimer); loadTimer = setTimeout(load, 1200); };

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
  // extra: { hp, diff } — здоровье монстра и сложность, чтобы другие могли вступить
  B.start = async function (c, mob, extra) {
    if (!online()) return;
    try {
      await B.end();
      const cl = auth.client;
      const row = { location_id: c.location, owner_id: auth.user.id, monster_id: mob.id, monster_level: mob.level };
      let res = B.coop && extra ? await cl.from('battles').insert({ ...row, diff: extra.diff || 0, base_hp: extra.hp, monster_max: extra.hp, monster_hp: extra.hp }).select('id').single() : null;
      if (!res || noColumn(res.error)) { if (res) B.coop = false; res = await cl.from('battles').insert(row).select('id').single(); }
      const { data, error } = res;
      if (missing(error) || error) return;
      mine = data.id;
      openParty(mine);
      await cl.from('battle_members').insert({ battle_id: mine, user_id: auth.user.id, nick: c.nick, level: c.level, job: c.job });
      soon();
    } catch (e) { console.warn('battle publish', e); }
  };

  // Выйти из своего боя (в совместном бой остаётся у остальных) и убрать свои зависшие бои
  B.end = async function () {
    const was = mine;
    mine = null;
    closeParty();
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
    await B.end();
    const { data, error } = await auth.client.rpc('join_battle', { p_battle: id, p_nick: c.nick, p_level: c.level, p_job: c.job });
    if (error) {
      if (noColumn(error) || missing(error) || error.code === 'PGRST202') { B.coop = false; return { error: 'Совместные бои ещё не включены на сервере' }; }
      const m = error.message || '';
      return { error: /battle_full/.test(m) ? 'В бою уже 10 игроков' : /battle_closed/.test(m) ? 'Бой уже закончился' : 'Не удалось вступить в бой' };
    }
    mine = data.id;
    openParty(mine);
    soon();
    return data;
  };

  // Общий запас здоровья монстра: отправить нанесённый урон (и своё состояние), получить свежее состояние и список союзников
  B.sync = async function (damage, v) {
    if (!mine || !online()) return null;
    const cl = auth.client, args = { p_battle: mine, p_damage: Math.max(0, Math.round(damage || 0)) };
    let res = B.party !== false && v ? await cl.rpc('battle_hit', { ...args, p_hp: Math.round(v.hp), p_hp_max: Math.round(v.hpMax), p_res: Math.round(v.res), p_res_max: Math.round(v.resMax), p_res_color: v.resColor || '' }) : null;
    if (res && res.error && res.error.code === 'PGRST202') { B.party = false; res = null; }
    if (!res) res = await cl.rpc('battle_hit', args);
    if (res.error) return null;
    const r = Array.isArray(res.data) ? res.data[0] : res.data;
    if (!r) return null;
    return { hp: Number(r.monster_hp), max: Number(r.monster_max), status: r.status, my: Number(r.my_damage), total: Number(r.total_damage), members: r.members };
  };
  // ---- Союзники в общем бою: мгновенно через Realtime (вступление/выход) и broadcast (здоровье, остаток монстра) ----
  let pch = null;
  const party = new Map(), cbs = { party: null, mon: null };
  const emit = () => { if (cbs.party) cbs.party([...party.values()].filter((x) => x.user_id !== auth.user.id)); };
  async function loadParty(id) {
    if (B.party === false || !online()) return;
    const q = await auth.client.from('battle_members').select('user_id,nick,level,job,hp,hp_max,res,res_max,res_color').eq('battle_id', id);
    if (q.error) { if (noColumn(q.error)) B.party = false; return; }
    const ids = new Set((q.data || []).map((x) => x.user_id));
    for (const k of [...party.keys()]) if (!ids.has(k)) party.delete(k);
    for (const r of q.data || []) {
      const old = party.get(r.user_id);
      party.set(r.user_id, old && old.hp_max ? { ...r, hp: old.hp, hp_max: old.hp_max, res: old.res, res_max: old.res_max, res_color: old.res_color } : r);
    }
    emit();
  }
  function openParty(id) {
    closeParty();
    if (B.party === false || !online()) return;
    pch = auth.client.channel(`bparty:${id}`, { config: { broadcast: { self: false } } })
      .on('broadcast', { event: 'vit' }, ({ payload }) => { party.set(payload.user_id, { ...(party.get(payload.user_id) || {}), ...payload }); emit(); })
      .on('broadcast', { event: 'mon' }, ({ payload }) => { if (cbs.mon) cbs.mon(payload); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'battle_members', filter: `battle_id=eq.${id}` }, () => loadParty(id))
      .subscribe((st) => { if (st === 'SUBSCRIBED') loadParty(id); });
    loadParty(id);
  }
  function closeParty() {
    if (pch) { auth.client.removeChannel(pch); pch = null; }
    party.clear();
  }
  B.listen = (p, m) => { cbs.party = p; cbs.mon = m; };
  // Своё состояние и остаток монстра — остальным участникам сразу
  B.pushVitals = function (v, c) {
    if (!pch || !v) return;
    pch.send({ type: 'broadcast', event: 'vit', payload: { user_id: auth.user.id, nick: c.nick, level: c.level, job: c.job, hp: Math.round(v.hp), hp_max: Math.round(v.hpMax), res: Math.round(v.res), res_max: Math.round(v.resMax), res_color: v.resColor || '' } });
  };
  B.pushMonster = (r) => { if (pch && r) pch.send({ type: 'broadcast', event: 'mon', payload: { hp: r.hp, max: r.max, status: r.status } }); };
  B.inBattle = () => !!mine;

  // ---- История боёв: по записи на участника, таблица battle_history (миграция 0008) ----
  // info: { location, monsterId, level, diff, result, turns, my, total, log: [{type,text}] }
  const plain = (t) => String(t || '').replace(/<[^>]*>/g, '');
  B.record = async function (c, info) {
    if (!online() || B.hist === false) return;
    try {
      const names = [c.nick, ...[...party.values()].filter((x) => x.user_id !== auth.user.id).map((x) => x.nick)].filter(Boolean);
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
        .select('hp,hp_max,res,res_max,battles!inner(id,monster_id,monster_level,diff,monster_hp,monster_max,status,updated_at)')
        .eq('user_id', auth.user.id).eq('battles.status', 'running').gt('battles.monster_hp', 0).gt('battles.updated_at', since).limit(1);
      if (error || !data || !data.length) return null;
      const m = data[0], b = m.battles;
      if (!PC.data.monsters[b.monster_id]) return null;
      mine = b.id;
      openParty(mine);
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
