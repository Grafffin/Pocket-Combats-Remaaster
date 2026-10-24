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

  // Вызывается после каждого локального сохранения.
  cloud.touch = function () {
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
    if (cloud.status !== 'ok' || !auth.user) return;
    if (pushing) { again = true; return; }
    pushing = true;
    try {
      const { data, stash } = snapshot();
      let res;
      if (!meta.rev) res = await auth.client.from('characters').insert({ user_id: auth.user.id, data, stash }).select('rev');
      else res = await auth.client.from('characters').update({ data, stash }).eq('user_id', auth.user.id).eq('rev', meta.rev).select('rev');
      if (res.error && res.error.code === '23505') return conflict();
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
    if (meta.dirty || !meta.rev) await push();
    if (meta.dirty || !meta.rev || cloud.status !== 'ok') throw new Error('not_saved');
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

  async function sync() {
    if (syncing || !auth.client || !auth.user) return;
    syncing = true;
    try { await pull(false); } catch (e) { fail(e); } finally { syncing = false; }
  }
  cloud.sync = sync;

  window.addEventListener('pc-auth', () => {
    clearTimeout(timer);
    if (auth.user) sync(); else cloud.status = 'off';
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden && meta.dirty) push(); });
  window.addEventListener('pagehide', () => { if (meta.dirty) push(); });
  window.addEventListener('DOMContentLoaded', () => { if (auth.ready && auth.user) sync(); });
})();
