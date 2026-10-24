// Облачное сохранение героя и сундука (таблица characters). Локальное сохранение остаётся главным буфером:
// игра работает без входа и до применения миграции, облако просто отключается.
(function () {
  'use strict';
  const { toast, storage } = PC.kit;
  const app = PC.app, auth = PC.auth;
  const metaStore = storage('pc-cloud-v1', {});       // { user, rev, dirty }
  const backupStore = storage('pc-cloud-backup-v1', null);
  const cloud = { status: 'off' };                   // off | ok | error
  PC.cloud = cloud;

  let meta = metaStore.load();
  let timer = null, pushing = false, again = false, syncing = false;
  const saveMeta = () => metaStore.save(meta);
  const snapshot = () => ({ data: app.state.char || null, stash: app.stashApi ? app.stashApi.get() : null });

  // Серверная правда: функция game и бои на сервере выложены — героя меняет только сервер, клиент его не пишет
  // denied — база уже ответила «нет прав» на запись героя (миграция 0014): прямая запись невозможна, больше не пробуем,
  // даже если функция на миг не ответила (например, во время деплоя) и клиент решил, что сервера нет
  let denied = false;
  const locked = () => denied || (cloud.server && cloud.fights);
  Object.defineProperty(cloud, 'locked', { get: locked });

  // Вызывается после каждого локального сохранения.
  cloud.touch = function () {
    if (locked()) return;   // локальная копия — только кэш серверного героя
    meta.dirty = true; saveMeta();
    if (cloud.status === 'ok') schedule();
  };

  function schedule() { clearTimeout(timer); timer = setTimeout(push, 3000); }

  function missingTable(error) {
    return error && (error.code === '42P01' || error.code === 'PGRST205' || /does not exist|schema cache/i.test(error.message || ''));
  }
  function fail(error) {
    cloud.status = missingTable(error) ? 'off' : 'error';
    if (cloud.status === 'error') console.warn('cloud save', error);
  }

  async function push() {
    if (cloud.status !== 'ok' || !auth.user || locked()) return;
    if (pushing) { again = true; return; }
    pushing = true;
    try {
      const { data, stash } = snapshot();
      let res;
      if (!meta.rev) res = await auth.client.from('characters').insert({ user_id: auth.user.id, data, stash }).select('rev');
      else res = await auth.client.from('characters').update({ data, stash }).eq('user_id', auth.user.id).eq('rev', meta.rev).select('rev');
      if (res.error && res.error.code === '23505') return conflict();
      if (res.error && res.error.code === '42501') { denied = true; meta.dirty = false; saveMeta(); return; }
      if (res.error) return fail(res.error);
      if (!res.data || !res.data.length) return conflict();   // кто-то сохранил с другого устройства
      meta.rev = res.data[0].rev;
      if (!again) meta.dirty = false;
      saveMeta();
    } catch (e) { fail(e); } finally {
      pushing = false;
      if (again) { again = false; schedule(); }
    }
  }
  cloud.push = push;

  async function conflict() {
    backupStore.save({ at: Date.now(), ...snapshot() });
    toast('Прогресс изменён на другом устройстве — загружена облачная версия', 'bad');
    meta.rev = 0; meta.dirty = false;
    await pull(true);
  }

  async function pull(forceServer) {
    const { data: row, error } = await auth.client.from('characters').select('data,stash,rev').eq('user_id', auth.user.id).maybeSingle();
    if (error) return fail(error);
    cloud.status = 'ok';
    const sameUser = meta.user === auth.user.id;
    const local = snapshot();
    if (locked()) {
      // героя меняет только сервер: берём его версию, локальный (офлайн) герой уходит в резервную копию
      if (local.data && JSON.stringify(local.data) !== JSON.stringify(row ? row.data : null) && !(sameUser && meta.rev && row && meta.rev <= row.rev)) backupStore.save({ at: Date.now(), ...local });
      meta = { user: auth.user.id, rev: row ? row.rev : 0, dirty: false }; saveMeta();
      if (JSON.stringify(row ? row.data : null) !== JSON.stringify(local.data) || (row && JSON.stringify(row.stash) !== JSON.stringify(local.stash))) {
        app.applyRemote(row ? row.data : null, row ? row.stash : null);
        if (row && row.data) toast('Герой загружен с сервера');
      }
      return;
    }
    if (!row) {
      if (meta.user && !sameUser) {   // локальный герой чужого аккаунта: не переносим его в этот
        backupStore.save({ at: Date.now(), ...local });
        meta = { user: auth.user.id, rev: 0, dirty: false }; saveMeta();
        if (local.data) app.applyRemote(null, null);
        return;
      }
      meta = { user: auth.user.id, rev: 0, dirty: true }; saveMeta();   // разовый импорт локального героя
      if (!forceServer) await push();
      return;
    }
    if (!forceServer && sameUser && meta.dirty && meta.rev === row.rev) { await push(); return; }   // офлайн-прогресс новее
    const differs = JSON.stringify(row.data) !== JSON.stringify(local.data);
    if (differs && local.data && !(sameUser && !meta.dirty)) backupStore.save({ at: Date.now(), ...local });
    meta = { user: auth.user.id, rev: row.rev, dirty: false }; saveMeta();
    if (differs || JSON.stringify(row.stash) !== JSON.stringify(local.stash)) {
      app.applyRemote(row.data, row.stash);
      if (row.data) toast('Герой загружен из облака');
    }
  }

  // Серверная операция над героем (рынок): сначала сохраняем прогресс, затем вызываем функцию с текущей версией.
  // Ответ { char, rev, ... } заменяет локального героя. Ошибка — исключение с кодом сервера в message.
  cloud.call = async function (fn, args) {
    if (!auth.client || !auth.user) throw new Error('not_auth');
    if (cloud.status !== 'ok') await sync();
    if (cloud.status !== 'ok') throw new Error('offline');
    clearTimeout(timer);
    while (pushing) await new Promise((r) => setTimeout(r, 100));
    if (!locked() && (meta.dirty || !meta.rev)) await push();
    if ((!locked() && meta.dirty) || !meta.rev || cloud.status !== 'ok') throw new Error('not_saved');
    const { data: res, error } = await auth.client.rpc(fn, { ...args, p_rev: meta.rev });
    if (error) {
      if (/stale/.test(error.message || '')) await pull(true);
      throw new Error(error.message || 'error');
    }
    if (res && res.char) {
      meta.rev = res.rev; meta.dirty = false; saveMeta();
      app.adoptChar(res.char);
    }
    return res;
  };

  // Операция над героем в серверной функции game (docs/SERVER_AUTHORITY.md): сервер сам применяет действие
  // со своей случайностью и возвращает нового героя. cloud.server — функция выложена и отвечает.
  cloud.server = false;
  cloud.trades = false;   // таблица обменов game_trades есть (миграция 0017): в карточке игрока появляется «Обмен»
  cloud.fights = false;   // таблица боёв game_fights есть: награды за бои тоже считает сервер
  async function invoke(op, args, rev) {
    const t0 = performance.now();
    const { data: res, error } = await auth.client.functions.invoke('game', { body: { op, args, rev, v: PC.BUILD } });
    cloud.lastMs = Math.round(performance.now() - t0);   // отклик функции: показывается в окне обмена для диагностики
    if (!error) { if (res && res.t) cloud.lastT = res.t; return res; }
    let body = null;
    try { body = error.context && await error.context.json(); } catch (e) { body = null; }
    if (body && body.error === 'version') {
      // сервер на другой версии игры: один раз перезагружаем страницу за свежим кодом
      const key = 'pc-reload-build';
      let again = false;
      try { again = sessionStorage.getItem(key) === body.build; sessionStorage.setItem(key, body.build); } catch (e) { again = true; }
      if (!again) { toast('Вышла новая версия игры — обновляем страницу', 'bad'); setTimeout(() => location.reload(), 1200); }
    }
    const err = new Error(body && body.error || 'offline');
    err.body = body;
    throw err;
  }
  // Действия идут строго по очереди: следующее уходит с версией героя, которую вернуло предыдущее.
  // optimistic — клиент уже применил действие сам (hub.js): ответ сервера принимаем, только когда очередь пуста,
  // чтобы не откатывать на экране следующие уже показанные действия; при отказе берём серверного героя.
  let queue = Promise.resolve(), waiting = 0;
  cloud.act = function (op, args, optimistic) {
    waiting++;
    const run = queue.then(() => act(op, args, optimistic)).finally(() => { waiting--; });
    queue = run.catch(() => {});
    return run;
  };
  function adopt(res) {
    meta.rev = res.rev; meta.dirty = false; saveMeta();
    if (app.stashApi && JSON.stringify(res.stash) !== JSON.stringify(app.stashApi.get())) app.stashApi.set(res.stash);
    if (res.char) { if (JSON.stringify(res.char) !== JSON.stringify(app.state.char)) app.adoptChar(res.char); }
    else if (app.state.char) app.applyRemote(null, res.stash);
  }
  async function act(op, args, optimistic) {
    try { return await send(op, args, optimistic); } catch (e) {
      // показанное заранее действие сервер не принял: возвращаем на экран его героя
      if (optimistic && e.message !== 'stale' && e.message !== 'version') {
        try { adopt(await invoke('load', {}, null)); } catch (e2) { if (auth.client && auth.user) pull(true).catch(() => {}); }
      }
      throw e;
    }
  }
  async function send(op, args, optimistic) {
    if (!auth.client || !auth.user) throw new Error('not_auth');
    if (cloud.status !== 'ok') await sync();
    if (cloud.status !== 'ok') throw new Error('offline');
    clearTimeout(timer);
    while (pushing) await new Promise((r) => setTimeout(r, 100));
    if (meta.dirty && !locked()) await push();
    if ((meta.dirty && !locked()) || cloud.status !== 'ok') throw new Error('not_saved');
    let res;
    try { res = await invoke(op, args, meta.rev || 0); } catch (e) {
      if (e.message === 'stale' && e.body) {   // герой изменился на другом устройстве: берём серверного
        meta.rev = e.body.rev; meta.dirty = false; saveMeta();
        app.applyRemote(e.body.char, e.body.stash);
      }
      throw e;
    }
    // показанное заранее сверяем с сервером всегда: он мог отказать ({ ok: false }) без изменения героя
    if (optimistic) { if (waiting > 1) { meta.rev = res.rev; saveMeta(); } else adopt(res); }
    else if (res.rev !== meta.rev) adopt(res);
    return res.result;
  }

  async function sync() {
    if (syncing || !auth.client || !auth.user) return;
    syncing = true;
    // сначала узнаём, выложен ли сервер: от этого зависит, можно ли вообще писать героя с клиента
    if (!cloud.server) {
      try { const r = await invoke('ping', {}); cloud.server = true; cloud.fights = !!(r && r.result && r.result.fights); cloud.trades = !!(r && r.result && r.result.trades); } catch (e) { cloud.server = false; }
    }
    try { await pull(false); } catch (e) { fail(e); } finally { syncing = false; }
  }
  cloud.sync = sync;

  window.addEventListener('pc-auth', () => {
    clearTimeout(timer);
    if (auth.user) sync(); else cloud.status = 'off';
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && meta.dirty) push();
    // вернулись в игру: будим функцию заранее, чтобы первое действие не ждало её холодного старта
    if (!document.hidden && cloud.server && auth.client && auth.user) invoke('ping', {}).catch(() => {});
  });
  window.addEventListener('pagehide', () => { if (meta.dirty) push(); });
  window.addEventListener('DOMContentLoaded', () => { if (auth.ready && auth.user) sync(); });
})();
