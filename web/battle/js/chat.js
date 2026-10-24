// Выдвижной чат: вкладки «Локация» и «Общий». Доставка — Realtime Broadcast, история — таблица chat_messages
// (миграция 0003). Без таблицы чат работает без истории. Только для вошедших.
(function () {
  'use strict';
  const { $, escapeHtml: esc, toast } = PC.kit;
  const auth = PC.auth;
  const KEEP = 100, LOAD = 50, GAP = 1500;
  const ICON = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"><path d="M4 5h16v11H11l-5 4v-4H4z"/><path d="M8 9.5h8M8 12.5h5"/></svg>';

  const chat = { open: false, tab: 'loc', unread: { loc: 0, global: 0 } };
  PC.chat = chat;
  chat.share = (item) => share(item);
  chat.canShare = () => canChat();
  const msgs = { loc: [], global: [] };
  const chans = { loc: null, global: null };
  let locId = null, root = null, lastSend = 0, noHistory = false;

  // Вещи в сообщении: в тексте «[Название]», снимок вещи едет рядом (items) и живёт, пока вкладка открыта.
  // История в базе хранит только текст, поэтому старые «[вещи]» не открываются.
  const MAX_ITEMS = 3;
  let keySeq = 0;
  const shared = new Map();      // «[Название]» → снимок вещи для набираемого сообщения
  let prevText = '';
  const D = () => PC.data;
  // Снимок от другого игрока не доверяем: показываем только то, что разбирается как вещь
  function sane(it) {
    const d = D();
    return !!(it && typeof it === 'object' && !it.stack && typeof it.type === 'string' && d.types[it.type] && Number.isInteger(it.rarity) && d.rarities[it.rarity]
      && Array.isArray(it.affixes) && Number.isInteger(it.tier) && Number.isInteger(it.ilvl) && Number.isFinite(it.enhance || 0));
  }
  function tokenRanges(text) {
    const out = [];
    for (const t of shared.keys()) {
      for (let i = text.indexOf(t); i >= 0; i = text.indexOf(t, i + t.length)) out.push([i, i + t.length, t]);
    }
    return out.sort((a, b) => a[0] - b[0]);
  }
  // Любая правка внутри «[Вещи]» — стираем её целиком: нельзя оставить обрубок или подделать название
  function guardInput(inp) {
    const now = inp.value, prev = prevText;
    if (now !== prev && shared.size) {
      let pre = 0;
      while (pre < prev.length && pre < now.length && prev[pre] === now[pre]) pre++;
      let suf = 0;
      while (suf < prev.length - pre && suf < now.length - pre && prev[prev.length - 1 - suf] === now[now.length - 1 - suf]) suf++;
      const editEnd = prev.length - suf, delta = now.length - prev.length;
      const cuts = [];
      for (const [a, b] of tokenRanges(prev)) {
        const touched = pre < b && editEnd > a || (pre > a && pre < b);
        if (!touched) continue;
        // уцелевшие куски вещи в новой строке: левый [a, min(b, pre)), правый [max(a, editEnd), b) со сдвигом
        if (a < Math.min(b, pre)) cuts.push([a, Math.min(b, pre)]);
        if (Math.max(a, editEnd) < b) cuts.push([Math.max(a, editEnd) + delta, b + delta]);
      }
      if (cuts.length) {
        let v = now;
        for (const [a, b] of cuts.sort((x, y) => y[0] - x[0])) v = v.slice(0, a) + v.slice(b);
        inp.value = v;
      }
    }
    prevText = inp.value;
    for (const t of [...shared.keys()]) if (!inp.value.includes(t)) shared.delete(t);
  }
  // Кнопка «Поделиться» в карточке вещи
  function share(item) {
    if (!canChat()) return toast('Чат доступен после входа в аккаунт', 'bad');
    if (!root) build();
    const inp = $('#chat-in');
    const tok = `[${PC.items.name(D(), item)}]`;
    if (shared.size >= MAX_ITEMS && !shared.has(tok)) return toast(`В одном сообщении не больше ${MAX_ITEMS} вещей`, 'bad');
    if (inp.value.length + tok.length + 1 > 300) return toast('Сообщение слишком длинное', 'bad');
    shared.set(tok, JSON.parse(JSON.stringify(item)));
    inp.value = `${inp.value}${inp.value && !/\s$/.test(inp.value) ? ' ' : ''}${tok} `;
    prevText = inp.value;
    setOpen(true);
    setTimeout(() => { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); }, 60);
  }
  // Текст сообщения: «[Название]» из снимков — ссылки на карточку вещи
  function bodyHtml(m) {
    let rest = String(m.body), out = '';
    const items = Array.isArray(m.items) ? m.items : [];
    const toks = items.map((it, i) => ({ t: `[${PC.items.name(D(), it)}]`, i }));
    while (rest) {
      let at = -1, hit = null;
      for (const k of toks) { const p = rest.indexOf(k.t); if (p >= 0 && (at < 0 || p < at)) { at = p; hit = k; } }
      if (!hit) { out += esc(rest); break; }
      out += esc(rest.slice(0, at)) + `<button class="chat-item rc${items[hit.i].rarity}" data-ci="${m.key}:${hit.i}">${esc(hit.t)}</button>`;
      rest = rest.slice(at + hit.t.length);
    }
    return out;
  }
  function openShared(ref) {
    const [key, i] = ref.split(':');
    const m = [...msgs.loc, ...msgs.global].find((x) => String(x.key) === key);
    const it = m && m.items && m.items[Number(i)];
    if (!it) return;
    try { PC.itemUI.openItem(PC.app.state.char, it, 'chat', '', null); } catch (e) { toast('Не удалось показать вещь', 'bad'); }
  }

  const name = (t) => (t === 'global' ? 'global' : `loc:${locId}`);
  const canChat = () => !!(auth && auth.client && auth.user && locId);

  function build() {
    root = document.createElement('div');
    root.id = 'chat';
    root.hidden = true;
    root.innerHTML = `<button class="chat-fab" id="chat-fab" aria-label="Чат">${ICON}<span class="chat-badge" id="chat-badge" hidden></span></button>
      <div class="chat-panel" id="chat-panel">
        <div class="chat-head">
          <button class="chat-tab" data-t="loc">Локация <i data-b="loc"></i></button>
          <button class="chat-tab" data-t="global">Общий <i data-b="global"></i></button>
          <button class="chat-x" id="chat-x" aria-label="Закрыть">×</button>
        </div>
        <div class="chat-log" id="chat-log"></div>
        <form class="chat-form" id="chat-form" autocomplete="off">
          <input id="chat-in" maxlength="300" placeholder="Сообщение" enterkeyhint="send">
          <button type="submit">Отпр.</button>
        </form>
      </div>`;
    $('#app').appendChild(root);
    $('#chat-fab').onclick = () => { if (fabMoved) { fabMoved = false; return; } setOpen(!chat.open); };
    fabDrag($('#chat-fab'));
    window.addEventListener('resize', () => placeFab());
    $('#chat-x').onclick = () => setOpen(false);
    for (const b of root.querySelectorAll('.chat-tab')) b.onclick = () => { chat.tab = b.dataset.t; chat.unread[chat.tab] = 0; render(); };
    $('#chat-form').onsubmit = (e) => { e.preventDefault(); send(); };
    $('#chat-in').addEventListener('input', (e) => guardInput(e.target));
    $('#chat-log').addEventListener('click', (e) => { const b = e.target.closest('[data-ci]'); if (b) openShared(b.dataset.ci); });
  }

  // Иконку чата можно перенести: удержание 450 мс, затем тянем; позиция запоминается и всегда остаётся внутри экрана
  const FAB = 44, EDGE = 6, FAB_KEY = 'pc.chatFab';
  let fabMoved = false;
  const fabPos = () => { try { const v = JSON.parse(localStorage.getItem(FAB_KEY)); return v && typeof v.x === 'number' && typeof v.y === 'number' ? v : null; } catch (e) { return null; } };
  function placeFab(pos = fabPos()) {
    const fab = $('#chat-fab'), app = $('#app');
    if (!fab || !app) return;
    if (!pos) { fab.style.left = fab.style.top = ''; fab.style.right = ''; fab.style.bottom = ''; return; }
    const W = app.clientWidth, H = app.clientHeight;
    const x = Math.min(Math.max(pos.x * W, EDGE), W - FAB - EDGE), y = Math.min(Math.max(pos.y * H, EDGE), H - FAB - EDGE);
    fab.style.left = `${x}px`; fab.style.top = `${y}px`; fab.style.right = 'auto'; fab.style.bottom = 'auto';
  }
  function fabDrag(fab) {
    let st = null;
    fab.addEventListener('pointerdown', (e) => {
      st = { id: e.pointerId, x: e.clientX, y: e.clientY, on: false };
      st.timer = setTimeout(() => { st.on = true; fabMoved = true; fab.classList.add('moving'); if (navigator.vibrate) navigator.vibrate(15); }, 450);
    });
    fab.addEventListener('pointermove', (e) => {
      if (!st) return;
      if (!st.on) { if (Math.hypot(e.clientX - st.x, e.clientY - st.y) > 8) { clearTimeout(st.timer); st = null; } return; }
      e.preventDefault();
      const r = $('#app').getBoundingClientRect();
      st.pos = { x: (e.clientX - r.left - FAB / 2) / r.width, y: (e.clientY - r.top - FAB / 2) / r.height };
      placeFab(st.pos);
    });
    const end = () => {
      if (!st) return;
      clearTimeout(st.timer);
      fab.classList.remove('moving');
      if (st.on && st.pos) { try { localStorage.setItem(FAB_KEY, JSON.stringify(st.pos)); } catch (e) { /* не сохранилось — не страшно */ } }
      // click после pointerup гасим флагом fabMoved; если окно не двигали, флаг сбрасываем
      if (!st.on) fabMoved = false; else setTimeout(() => { fabMoved = false; }, 350);
      st = null;
    };
    fab.addEventListener('pointerup', end);
    fab.addEventListener('pointercancel', end);
    fab.addEventListener('contextmenu', (e) => e.preventDefault());
    fab.addEventListener('touchmove', (e) => { if (st && st.on) e.preventDefault(); }, { passive: false });
    placeFab();
  }

  function setOpen(on) {
    chat.open = on;
    if (on) chat.unread[chat.tab] = 0;
    render();
    if (on) { const l = $('#chat-log'); if (l) l.scrollTop = l.scrollHeight; }
  }

  function render() {
    if (!root) return;
    root.hidden = !canChat();
    root.classList.toggle('open', chat.open);
    for (const b of root.querySelectorAll('.chat-tab')) b.classList.toggle('on', b.dataset.t === chat.tab);
    for (const k of ['loc', 'global']) {
      const i = root.querySelector(`i[data-b="${k}"]`);
      i.textContent = chat.unread[k] > 9 ? '9+' : chat.unread[k] || '';
      i.hidden = !chat.unread[k];
    }
    const total = chat.unread.loc + chat.unread.global;
    const bd = $('#chat-badge');
    bd.textContent = total > 9 ? '9+' : total; bd.hidden = !total || chat.open;
    const log = $('#chat-log');
    const atEnd = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
    const list = msgs[chat.tab];
    const me = auth.user && auth.user.id;
    log.innerHTML = (list.length ? list.map((m) =>
      `<div class="chat-msg${m.user_id === me ? ' me' : ''}"><b>${esc(m.nick)}</b> ${bodyHtml(m)}</div>`).join('')
      : `<p class="hint">${noHistory ? 'История недоступна, видны только новые сообщения' : 'Пока тихо'}</p>`);
    if (atEnd) log.scrollTop = log.scrollHeight;
  }

  function push(tab, m) {
    if (msgs[tab].some((x) => x.id && m.id && x.id === m.id)) return;
    m.key = ++keySeq;
    msgs[tab].push(m);
    if (msgs[tab].length > KEEP) msgs[tab].shift();
    if (!(chat.open && chat.tab === tab) && m.user_id !== auth.user.id) chat.unread[tab]++;
    render();
  }

  async function history(tab) {
    const ch = name(tab);
    const { data, error } = await auth.client.from('chat_messages').select('id,user_id,nick,body')
      .eq('channel', ch).order('id', { ascending: false }).limit(LOAD);
    if (name(tab) !== ch) return;
    if (error) { noHistory = true; render(); return; }
    noHistory = false;
    const fresh = msgs[tab].filter((m) => !m.id || !data.some((d) => d.id === m.id));
    // вещи из живых сообщений в базе не хранятся — переносим к одноимённой записи истории
    const live = new Map(msgs[tab].filter((m) => m.id && m.items && m.items.length).map((m) => [m.id, m.items]));
    for (const d of data) { d.key = ++keySeq; if (live.has(d.id)) d.items = live.get(d.id); }
    msgs[tab] = data.reverse().concat(fresh.filter((m) => !m.id));
    render();
  }

  function subscribe(tab) {
    const ch = auth.client.channel(`chat:${name(tab)}`, { config: { broadcast: { self: true } } });
    chans[tab] = ch;
    ch.on('broadcast', { event: 'msg' }, ({ payload }) => {
      if (chans[tab] !== ch || !payload || typeof payload.body !== 'string') return;
      const items = Array.isArray(payload.items) ? payload.items.slice(0, MAX_ITEMS).filter(sane) : [];
      push(tab, { id: payload.id, user_id: payload.user_id, nick: String(payload.nick).slice(0, 16), body: payload.body.slice(0, 300), items });
    }).subscribe();
    history(tab);
  }

  function drop(tab) {
    if (chans[tab]) { auth.client.removeChannel(chans[tab]); chans[tab] = null; }
    msgs[tab] = [];
  }

  async function send() {
    const inp = $('#chat-in');
    const body = inp.value.trim().slice(0, 300);
    if (!body || !canChat()) return;
    // к сообщению прикладываем только те вещи, чьи «[названия]» остались в тексте
    const items = [...shared].filter(([t]) => body.includes(t)).map(([, it]) => it);
    const now = Date.now();
    if (now - lastSend < GAP) return toast('Не так быстро');
    lastSend = now;
    inp.value = ''; prevText = ''; shared.clear();
    const tab = chat.tab, ch = chans[tab];
    let row = { user_id: auth.user.id, nick: (auth.profile && auth.profile.nick) || PC.app.state.char.nick, body };
    const { data, error } = await auth.client.from('chat_messages').insert({ channel: name(tab), user_id: auth.user.id, body })
      .select('id,user_id,nick,body').single();
    if (data) row = data;
    else if (error && /too fast|banned/.test(error.message || '')) return toast(/banned/.test(error.message) ? 'Вам запрещено писать' : 'Не так быстро');
    else if (error) noHistory = true; // таблицы нет: шлём без записи
    if (ch) ch.send({ type: 'broadcast', event: 'msg', payload: items.length ? { ...row, items } : row });
  }

  // Раз в секунду сверяем локацию героя
  setInterval(() => {
    const c = PC.app && PC.app.state.char;
    const id = auth.client && auth.user && c && c.nick && !c.transit ? c.location : null;
    if (id === locId) return;
    if (!root) build();
    drop('loc');
    if (!id && chans.global) drop('global');
    locId = id;
    if (id) {
      subscribe('loc');
      if (!chans.global) subscribe('global');
    }
    render();
  }, 1000);

  window.addEventListener('pc-auth', () => {
    if (!auth.user) { locId = null; drop('loc'); drop('global'); chat.open = false; render(); }
  });
})();
