// Общий мир монстров: состояние слотов локации (таблица world_mobs) делят все игроки.
// Монстр слота детерминирован (см. world.js), здесь синхронизируются только «мёртв до», «занят до» и цикл возрождения.
// Если миграция 0006 не применена, всё молча отключается и у каждого остаются свои монстры.
(function () {
  'use strict';
  const auth = PC.auth, W = PC.world;
  const S = { off: false };
  PC.worldSync = S;

  const online = () => !S.off && auth && auth.client && auth.user;
  function failed(error) {
    if (!error) return false;
    if (error.code === '42P01' || error.code === 'PGRST205' || error.code === 'PGRST202' || /does not exist|schema cache/i.test(error.message || '')) S.off = true;
    return true;
  }

  S.push = function (loc, mob, patch) {
    if (!online()) return;
    auth.client.rpc('world_set', { p_loc: loc, p_slot: mob.slot, p_cycle: mob.cycle, p_dead: patch.dead_until == null ? null : patch.dead_until, p_busy: patch.busy_until == null ? null : patch.busy_until })
      .then(({ error }) => failed(error), () => {});
  };

  // Накладывает состояние слотов с сервера на монстров локации героя
  function apply(c, loc, rows) {
    const data = PC.data, st = c.world && c.world[loc];
    if (!st || !data.locations[loc] || data.locations[loc].safe) return;
    const tick = W.tickOf(Date.now());
    const mine = PC.app.state.fight && PC.app.state.fight.uid;
    const byslot = {};
    for (const r of rows) byslot[r.slot] = r;
    st.mobs.forEach((m, i) => {
      const r = byslot[m.slot];
      if (!r) return;
      if (r.cycle > m.cycle) { m = st.mobs[i] = W.rollMob(data.locations[loc], loc, m.slot, r.cycle); }
      else if (r.cycle < m.cycle) { S.push(loc, m, { dead_until: m.deadUntil, busy_until: m.busy ? (m.busySince || tick) + W.BUSY_TICKS : null }); return; }
      if (r.dead_until != null && m.deadUntil == null) { m.deadUntil = Number(r.dead_until); m.busy = false; }
      if (m.deadUntil == null && m.uid !== mine) {
        if (r.busy_until != null && Number(r.busy_until) > tick) { m.busy = true; m.busySince = Number(r.busy_until) - W.BUSY_TICKS; }
        else m.busy = false;
      }
    });
  }

  let busy = false, lastLoc = null;
  async function pull() {
    const c = PC.app && PC.app.state.char;
    if (!online() || busy || !c || !c.nick || c.transit) return;
    const loc = c.location;
    busy = true;
    try {
      const { data, error } = await auth.client.from('world_mobs').select('slot,cycle,dead_until,busy_until').eq('location_id', loc);
      if (failed(error)) return;
      const now = PC.app.state.char;
      if (now && now.location === loc && !now.transit) { W.locState(PC.data, now, loc, null); apply(now, loc, data || []); }
    } catch (e) { /* не критично */ }
    finally { busy = false; }
  }
  setInterval(pull, 3000);
  setInterval(() => {   // смена локации замечается быстро
    const c = PC.app && PC.app.state.char;
    if (c && c.location !== lastLoc) { lastLoc = c.location; pull(); }
  }, 1000);
})();
