// Игроки на локации и обмен между ними (правила и защита — docs/TRADE.md, trade.js). Только для вошедших.
// Карточка игрока по тапу в списке «Игроки здесь», окно обмена 8 + 8 ячеек и поле золота, приглашения.
(function () {
  'use strict';
  const { $, art, toast, openModal, closeModal, escapeHtml: esc, fmtNum } = PC.kit;
  const { data, items: I } = PC;
  const auth = PC.auth;
  const SLOTS = 8, REST = 3000;   // пауза после чужой правки, пока «Подтвердить» не активно

  const ERR = {
    no_item: 'Этой вещи уже нет в сумке', locked: 'Вещь заперта — снимите замок', no_gold: 'Не хватает золота',
    bag_full: 'Не хватает места в сумке', partner_bag_full: 'У партнёра нет места в сумке', changed: 'Предложение изменилось — проверьте и подтвердите заново',
    closed: 'Обмен уже закрыт', busy: 'Вы или игрок уже в другом обмене', not_here: 'Вы и партнёр должны стоять на одной локации',
    empty: 'Предложите хоть что-то', not_accepted: 'Партнёр ещё не принял обмен', bad_args: 'Не получилось', stale: 'Данные обновились, попробуйте ещё раз',
    no_trades: 'Обмен пока недоступен', not_yours: 'Это чужой обмен', no_trade: 'Обмен не найден', open: 'Обмен ещё идёт', version: 'Вышла новая версия игры',
    offline: 'Нет связи с сервером', not_auth: 'Нужно войти в игру', server: 'Ошибка сервера, попробуйте ещё раз',
  };
  const T = { row: null, draft: null, view: false, dirty: false, sending: false, resend: false, timer: null, restUntil: 0, edit: null, known: new Map(), nicks: new Map(), banner: null, dismissed: null };
  const me = () => auth.user && auth.user.id;
  const sideOf = (r) => (r.a === me() ? 'a' : 'b');
  const otherSide = (s) => (s === 'a' ? 'b' : 'a');
  const on = () => !!(auth && auth.client && auth.user && PC.cloud && PC.cloud.trades);

  // ---------- Карточка игрока ----------

  const STAT_ROWS = [['hp', 'Здоровье'], ['atk', 'Атака'], ['matk', 'Магия'], ['def', 'Защита'], ['mdef', 'Маг. защита'], ['speed', 'Скорость'], ['crit', 'Крит, %']];

  function openPlayer(id) {
    const p = PC.presence.players.find((x) => x.id === id);
    if (!p) return;
    T.nicks.set(p.id, p.nick);
    const cls = data.classes[p.job];
    const mine = p.id === me();
    const st = p.st || {};
    const stats = STAT_ROWS.filter(([k]) => st[k] != null).map(([k, name]) => `<div class="pc-stat"><span>${name}</span><b>${fmtNum(st[k])}</b></div>`).join('');
    const why = mine ? '' : !on() ? 'Обмен пока недоступен' : p.busy ? 'Игрок сейчас в бою' : T.row && T.row.state === 'open' ? 'У вас уже идёт обмен' : '';
    openModal(esc(p.nick), `<div class="pc-head"><span class="ava" style="width:48px;height:48px">${art(cls && cls.art ? cls.art : '', '🙂')}</span>
        <div><b>${cls ? cls.title : ''}</b><div class="meta">${p.level} уровень${p.busy ? ' · в бою' : ''}</div></div></div>
      <div class="pc-stats">${stats}</div>
      ${p.score ? `<p class="meta">Боевая оценка: <b>${fmtNum(p.score)}</b></p>` : ''}
      ${mine ? '<p class="hint">Это вы.</p>' : `<div class="row-actions"><button class="btn primary" data-act="trade" ${why ? 'disabled' : ''}>Обмен</button></div>${why ? `<p class="hint">${why}</p>` : ''}`}`, (e) => {
      if (!e.target.closest('[data-act="trade"]')) return;
      invite(p);
    });
  }

  async function invite(p) {
    try {
      const r = await PC.cloud.act('tradeOpen', { to: p.id });
      closeModal();
      toast(`Приглашение отправлено: ${p.nick}`, 'good');
      onRow(r.trade);
    } catch (e) { toast(ERR[e.message] || 'Не получилось', 'bad'); }
  }

  // ---------- Живые обновления сделок ----------

  let channels = [], pollTimer = null, polled = 0;
  function watch() {
    if (!on()) return;
    if (!channels.length) {
      for (const col of ['a', 'b']) {
        const ch = auth.client.channel(`trade-${col}-${me()}`).on('postgres_changes', { event: '*', schema: 'public', table: 'game_trades', filter: `${col}=eq.${me()}` }, (m) => { if (m.new && m.new.id) onRow(m.new); }).subscribe();
        channels.push(ch);
      }
    }
    if (!pollTimer) pollTimer = setInterval(poll, 1500);
  }
  function unwatch() {
    for (const ch of channels) auth.client.removeChannel(ch);
    channels = []; clearInterval(pollTimer); pollTimer = null; T.row = null; T.known.clear(); hideBanner();
  }
  // Опрос на случай, если Realtime не включён: редко в покое, часто пока открыто окно
  async function poll() {
    if (!on() || document.hidden) return;
    const gap = T.view ? 1200 : 20000;
    if (Date.now() - polled < gap) return;
    polled = Date.now();
    const { data: rows, error } = await auth.client.from('game_trades').select('*').or(`a.eq.${me()},b.eq.${me()}`).order('updated_at', { ascending: false }).limit(6);
    if (error || !rows) return;
    for (const r of rows.reverse()) onRow(r);
  }

  function onRow(r) {
    if (!r || !on() || (r.a !== me() && r.b !== me())) return;
    const known = T.known.get(r.id);
    if (known != null && r.ver < known) return;   // запоздавший ответ
    T.known.set(r.id, r.ver);
    const s = sideOf(r);
    if (r.state !== 'open') {
      if (!r[`claimed_${s}`]) claim(r);
      else if (T.row && T.row.id === r.id) {
        // завершил сделку тот, кто подтвердил вторым: своё он забрал сразу
        finished(r);
        T.row = null; if (T.view) closeView(); hideBanner();
      }
      return;
    }
    if (!r.accepted) {
      if (r.b === me()) showInvite(r);
      else T.row = r;
      return;
    }
    hideBanner();
    const fresh = !T.row || T.row.id !== r.id || r.ver !== T.row.ver;
    const partnerChanged = T.row && T.row.id === r.id && JSON.stringify(T.row[`offer_${otherSide(s)}`]) !== JSON.stringify(r[`offer_${otherSide(s)}`]);
    T.row = r;
    if (partnerChanged) T.restUntil = Date.now() + REST;
    if (T.view) { if (fresh) { if (!T.dirty) T.draft = null; render(); } } else if (T.dismissed !== r.id && modalFree()) openView();
    else showBanner(`Обмен с ${nick(r[otherSide(s)])} идёт`, 'Открыть', () => openView());
  }

  const modalFree = () => $('#modal').hidden;

  // Итог сделки показываем один раз, как бы ни пришли события (Realtime, опрос, ответ на сбор)
  const told = new Set();
  function finished(r) {
    if (told.has(r.id)) return;
    told.add(r.id);
    if (r.state === 'done') toast('Обмен завершён: вещи в сумке', 'good'); else toast('Обмен отменён, ваше вернулось в сумку');
  }

  // Забрать своё из закрытой сделки: полученное (done) или залог обратно (cancel); повторять можно безопасно
  const claiming = new Set();
  async function claim(r) {
    if (claiming.has(r.id)) return;
    claiming.add(r.id);
    try {
      const res = await PC.cloud.act('tradeClaim', { id: r.id });
      const row = res && res.trade ? res.trade : r;
      T.known.set(row.id, row.ver);
      if (T.row && T.row.id === r.id) { T.row = null; if (T.view) closeView(); }
      hideBanner();
      finished(r);
      PC.app.render();
    } catch (e) { toast(e.message === 'bag_full' ? 'Освободите место в сумке: вещи из обмена ждут вас' : (ERR[e.message] || 'Не получилось забрать вещи из обмена'), 'bad'); } finally { claiming.delete(r.id); }
  }

  // ---------- Приглашение и баннер ----------

  function showBanner(text, btn, fn, extra) {
    hideBanner();
    const b = document.createElement('div');
    b.className = 'trade-banner';
    b.innerHTML = `<span>${esc(text)}</span><button class="btn small primary" data-b="ok">${btn}</button>${extra ? '<button class="btn small" data-b="no">Отказать</button>' : ''}`;
    b.addEventListener('click', (e) => {
      const k = e.target.closest('[data-b]');
      if (!k) return;
      hideBanner();
      if (k.dataset.b === 'ok') fn(); else extra();
    });
    $('#app').appendChild(b);
    T.banner = b;
  }
  function hideBanner() { if (T.banner) { T.banner.remove(); T.banner = null; } }
  function showInvite(r) {
    if (T.banner && T.banner.dataset.id === r.id) return;
    nickOf(r.a).then((n) => {
      showBanner(`${n} предлагает обмен`, 'Принять', () => accept(r), () => decline(r));
      if (T.banner) T.banner.dataset.id = r.id;
    });
  }
  async function accept(r) {
    try { const res = await PC.cloud.act('tradeAccept', { id: r.id }); T.row = res.trade; T.known.set(res.trade.id, res.trade.ver); openView(); } catch (e) { toast(ERR[e.message] || 'Не получилось', 'bad'); }
  }
  async function decline(r) {
    try { const res = await PC.cloud.act('tradeCancel', { id: r.id }); T.known.set(res.trade.id, res.trade.ver); } catch (e) { toast(ERR[e.message] || 'Не получилось', 'bad'); }
  }

  async function nickOf(uid) {
    if (T.nicks.has(uid)) return T.nicks.get(uid);
    const p = PC.presence.players.find((x) => x.id === uid);
    if (p) { T.nicks.set(uid, p.nick); return p.nick; }
    const { data: row } = await auth.client.from('profiles').select('nick').eq('id', uid).maybeSingle();
    const n = row && row.nick ? row.nick : 'Игрок';
    T.nicks.set(uid, n);
    return n;
  }
  const nick = (uid) => T.nicks.get(uid) || 'Игрок';

  // ---------- Окно обмена ----------

  function openView() {
    if (!T.row) return;
    T.view = true; T.draft = null; T.dirty = false; T.dismissed = null;
    Promise.all([nickOf(T.row.a), nickOf(T.row.b)]).then(render);
    render();
  }
  function closeView() { T.view = false; T.edit = null; clearTimeout(T.timer); if (!$('#modal').hidden && $('#modal-title').dataset.trade) closeModal(); }

  const entryOf = (x) => (x.stack ? { stack: x.stack, count: x.count } : { uid: x.uid });
  // Черновик моего предложения: то, что лежит в залоге, плюс правки до отправки
  function draft() {
    if (!T.draft) { const o = T.row[`offer_${sideOf(T.row)}`]; T.draft = { items: JSON.parse(JSON.stringify(o.items)), gold: o.gold }; }
    return T.draft;
  }
  // Сколько ресурса доступно для предложения: в сумке + то, что уже в залоге (отправка сначала вернёт залог)
  function available(id) {
    const o = T.row[`offer_${sideOf(T.row)}`].items.find((x) => x.stack === id);
    return I.matCount(data, PC.app.state.char, id) + (o ? o.count : 0);
  }

  function offerCells(items, mine) {
    const cells = [];
    for (let i = 0; i < SLOTS; i++) {
      const x = items[i];
      cells.push(x ? (x.stack ? PC.itemUI.stackTile(x, { attrs: `data-${mine ? 'mine' : 'their'}="${i}"` }) : PC.itemUI.tile(x, { attrs: `data-${mine ? 'mine' : 'their'}="${i}"` })) : '<div class="tile empty"></div>');
    }
    return `<div class="trade-grid">${cells.join('')}</div>`;
  }

  function render() {
    const r = T.row;
    if (!r || !T.view) return;
    const s = sideOf(r), o = otherSide(s), d = draft(), their = r[`offer_${o}`];
    const c = PC.app.state.char;
    const usedUid = new Set(d.items.filter((x) => !x.stack).map((x) => x.uid)), usedStack = new Set(d.items.filter((x) => x.stack).map((x) => x.stack));
    // ресурсы в сумке показываем уже за вычетом черновика: сервер подтвердит чуть позже
    const left = {};
    for (const x of d.items) if (x.stack) left[x.stack] = available(x.stack) - x.count;
    const bag = c.bag.map((it, i) => (!it ? '<div class="tile empty"></div>'
      : it.stack ? (() => {
        if (left[it.stack] == null) return PC.itemUI.stackTile(it, { attrs: `data-bag="${i}"` });
        const shown = Math.max(0, Math.min(it.count, left[it.stack]));
        left[it.stack] -= shown;
        return shown ? PC.itemUI.stackTile({ stack: it.stack, count: shown }, { cls: 'cant', attrs: `data-bag="${i}"` }) : '<div class="tile empty"></div>';
      })()
        : PC.itemUI.tile(it, { cls: usedUid.has(it.uid) || it.locked ? 'cant' : '', attrs: `data-bag="${i}"` }))).join('');
    // обновление от партнёра перерисовывает окно: недописанное число в поле и фокус не теряем
    const ae = document.activeElement;
    const typing = ae && ae.matches && ae.matches('#modal [data-gold], #modal [data-qty]') ? { k: ae.hasAttribute('data-gold') ? '[data-gold]' : '[data-qty]', v: ae.value } : null;
    const myOk = r[`ok_${s}`], theirOk = r[`ok_${o}`];
    const rest = Math.max(0, T.restUntil - Date.now());
    const busy = T.dirty || T.sending;
    const edit = T.edit != null && d.items[T.edit] && d.items[T.edit].stack ? d.items[T.edit] : null;
    openModal(`Обмен с ${esc(nick(r[o]))}`, `
      <div class="trade-side"><b>Вы предлагаете</b>${offerCells(d.items, true)}
        <label class="trade-gold">💰 <input type="number" inputmode="numeric" min="0" max="${Math.min(c.gold + r[`offer_${s}`].gold, 1e9)}" value="${d.gold}" data-gold> <span class="meta">есть ${fmtNum(c.gold + r[`offer_${s}`].gold)}</span></label>
        ${edit ? `<div class="trade-edit"><span class="meta">${esc(data.materials[edit.stack].name)}: сколько</span><input type="number" inputmode="numeric" min="1" max="${available(edit.stack)}" value="${edit.count}" data-qty>
          <button class="btn small primary" data-act="qty">ОК</button><button class="btn small" data-act="rm">Убрать</button></div>` : ''}
      </div>
      <div class="trade-side their ${theirOk ? 'ok' : ''}"><b>${esc(nick(r[o]))} предлагает</b>${offerCells(their.items, false)}
        <div class="trade-gold">💰 <b>${fmtNum(their.gold)}</b></div>
        <p class="meta">${theirOk ? 'Партнёр подтвердил ✓' : 'Партнёр ещё не подтвердил'} · тап по вещи — осмотреть</p></div>
      <div class="row-actions"><button class="btn" data-act="cancel">Отменить обмен</button>
        <button class="btn primary" data-act="confirm" ${busy || (!myOk && rest) ? 'disabled' : ''}>${myOk ? 'Вы подтвердили — отменить' : rest ? `Подтвердить (${Math.ceil(rest / 1000)})` : 'Подтвердить'}</button></div>
      <p class="hint">${busy ? 'Сохраняю предложение…' : 'Любая правка сбрасывает подтверждения обоих. Проверьте вещи партнёра, прежде чем подтверждать.'}</p>
      <div class="bag-tools" style="padding:6px 0 0"><b>Ваша сумка</b><span class="meta grow">тап — предложить, удержание — осмотреть</span></div>
      <div class="bag-grid modal-grid">${bag}</div>`, handler, { onClose: () => {
        T.dismissed = T.row ? T.row.id : null; T.view = false; clearTimeout(T.timer);
        const r = T.row;
        if (r && r.state === 'open' && r.accepted) showBanner(`Обмен с ${nick(r[otherSide(sideOf(r))])} идёт`, 'Открыть', () => openView());
      } });
    $('#modal-title').dataset.trade = '1';
    if (typing) { const el = $('#modal').querySelector(typing.k); if (el) { el.value = typing.v; el.focus(); } }
    if (rest) { clearTimeout(T.restTimer); T.restTimer = setTimeout(() => { if (T.view) render(); }, Math.min(rest, 1000)); }
  }

  // Удержание на вещи — осмотр (в окне обмена тап занят действием)
  let press = null;
  $('#modal').addEventListener('pointerdown', (e) => {
    const el = e.target.closest('[data-bag]');
    if (!T.view || !el) return;
    press = { i: Number(el.dataset.bag), x: e.clientX, y: e.clientY, long: false };
    press.timer = setTimeout(() => { press.long = true; inspect(PC.app.state.char.bag[press.i]); }, 450);
  });
  $('#modal').addEventListener('pointermove', (e) => { if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 10) { clearTimeout(press.timer); press = null; } });
  $('#modal').addEventListener('pointerup', () => { if (press) { clearTimeout(press.timer); press.up = true; } });
  $('#modal').addEventListener('contextmenu', (e) => { if (T.view && e.target.closest('[data-bag]')) e.preventDefault(); });

  function inspect(item) {
    if (!item) return;
    if (item.stack) return PC.itemUI.openInfo(item.stack);
    const back = () => { if (T.row) { T.view = true; render(); } };
    T.view = false;
    PC.itemUI.openItem(PC.app.state.char, item, 'chat', '<button class="btn wide" data-act="back">Назад</button>', (act) => { if (act === 'back') back(); });
  }

  function handler(e) {
    const r = T.row;
    if (!r) return;
    const d = draft();
    if (e.type === 'change' && e.target.matches('[data-gold]')) {
      const max = Math.min(PC.app.state.char.gold + r[`offer_${sideOf(r)}`].gold, 1e9);
      d.gold = Math.max(0, Math.min(max, Math.floor(Number(e.target.value) || 0)));
      return changed();
    }
    const bagEl = e.target.closest('[data-bag]');
    if (bagEl) {
      if (press && press.long) { press = null; return; }
      press = null;
      const it = PC.app.state.char.bag[Number(bagEl.dataset.bag)];
      if (!it) return;
      if (d.items.length >= SLOTS) return toast('Всего 8 ячеек', 'bad');
      if (it.stack) {
        if (d.items.some((x) => x.stack === it.stack)) return toast('Этот ресурс уже в предложении: тап по нему — изменить количество');
        d.items.push({ stack: it.stack, count: Math.min(available(it.stack), it.count) });
      } else {
        if (it.locked) return toast('Вещь заперта: снимите замок в карточке', 'bad');
        if (d.items.some((x) => x.uid === it.uid)) return;
        d.items.push(JSON.parse(JSON.stringify(it)));
      }
      return changed();
    }
    const mineEl = e.target.closest('[data-mine]');
    if (mineEl) {
      const i = Number(mineEl.dataset.mine), x = d.items[i];
      if (!x) return;
      if (x.stack) { T.edit = i; return render(); }
      d.items.splice(i, 1);
      return changed();
    }
    const theirEl = e.target.closest('[data-their]');
    if (theirEl) { const x = r[`offer_${otherSide(sideOf(r))}`].items[Number(theirEl.dataset.their)]; if (x) inspect(x); return; }
    const a = e.target.closest('[data-act]');
    if (!a || a.disabled) return;
    if (a.dataset.act === 'qty') {
      const x = d.items[T.edit], q = Math.floor(Number($('#modal [data-qty]').value) || 0);
      if (x) x.count = Math.max(1, Math.min(available(x.stack), q));
      T.edit = null;
      return changed();
    }
    if (a.dataset.act === 'rm') { d.items.splice(T.edit, 1); T.edit = null; return changed(); }
    if (a.dataset.act === 'cancel') { PC.cloud.act('tradeCancel', { id: r.id }).then((res) => { onRow(res.trade); }, (er) => toast(ERR[er.message] || 'Не получилось', 'bad')); return; }
    if (a.dataset.act === 'confirm') {
      const mine = r[`ok_${sideOf(r)}`];
      const p = mine ? PC.cloud.act('tradeUnconfirm', { id: r.id }) : PC.cloud.act('tradeConfirm', { id: r.id, ver: r.ver });
      p.then((res) => onRow(res.trade), (er) => { toast(ERR[er.message] || 'Не получилось', 'bad'); poll(); });
    }
  }

  // Правка предложения: показываем сразу, на сервер уходит после короткой паузы одним запросом
  function changed() {
    T.dirty = true;
    render();
    clearTimeout(T.timer);
    T.timer = setTimeout(send, 0);
  }
  async function send() {
    if (T.sending) { T.resend = true; return; }
    const r = T.row, d = T.draft;
    if (!r || !d) return;
    T.sending = true; T.resend = false;
    try {
      const res = await PC.cloud.act('tradeOffer', { id: r.id, items: d.items.map(entryOf), gold: d.gold });
      T.known.set(res.trade.id, res.trade.ver);
      T.row = res.trade;
      if (!T.resend) { T.dirty = false; T.draft = null; }
    } catch (e) {
      toast(ERR[e.message] || 'Не получилось', 'bad');
      T.dirty = false; T.draft = null;
    } finally {
      T.sending = false;
      if (T.resend) send(); else if (T.view) render();
    }
  }

  // ---------- Включение ----------

  // Любое окно поверх обмена (карточка вещи, герой…) при закрытии возвращает окно обмена; крестик самого обмена — нет
  window.addEventListener('pc-modal-closed', () => {
    setTimeout(() => {
      const r = T.row;
      if (r && on() && r.state === 'open' && r.accepted && T.dismissed !== r.id && modalFree()) openView();
    }, 0);
  });

  // Обмен без правок дольше TTL закрывает сервер по запросу: просим его, пока он не закрыт (сроки считает сервер, часы телефона лишь повод спросить)
  setInterval(() => {
    const r = T.row;
    if (!r || !on() || r.state !== 'open' || T.expiring === r.id + r.ver) return;
    if (Date.now() - Date.parse(r.updated_at) < PC.trade.T.TTL + 4000) return;
    T.expiring = r.id + r.ver;
    PC.cloud.act('tradeClaim', { id: r.id }).then((res) => { onRow(res.trade); }, () => { setTimeout(() => { T.expiring = null; }, 15000); });
  }, 3000);

  // Ушёл с локации (переход, поражение, возврат в деревню) — обмен отменяется, залог возвращается
  setInterval(() => {
    const r = T.row, c = PC.app && PC.app.state.char;
    if (!r || !c || !on() || r.state !== 'open' || T.leaving === r.id) return;
    if (!c.transit && c.location === r.loc) return;
    T.leaving = r.id;
    PC.cloud.act('tradeCancel', { id: r.id }).then((res) => { toast('Вы ушли с локации — обмен отменён'); onRow(res.trade); }, () => { T.leaving = null; });
  }, 700);

  window.addEventListener('pc-auth', () => { if (!auth.user) unwatch(); });
  setInterval(() => { if (on() && !channels.length) watch(); if (!on() && channels.length) unwatch(); }, 2000);

  PC.tradeUI = { openPlayer, on };
})();
