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
  const msgs = { loc: [], global: [] };
  const chans = { loc: null, global: null };
  let locId = null, root = null, lastSend = 0, noHistory = false;

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
    $('#chat-fab').onclick = () => setOpen(!chat.open);
    $('#chat-x').onclick = () => setOpen(false);
    for (const b of root.querySelectorAll('.chat-tab')) b.onclick = () => { chat.tab = b.dataset.t; chat.unread[chat.tab] = 0; render(); };
    $('#chat-form').onsubmit = (e) => { e.preventDefault(); send(); };
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
      `<div class="chat-msg${m.user_id === me ? ' me' : ''}"><b>${esc(m.nick)}</b> ${esc(m.body)}</div>`).join('')
      : `<p class="hint">${noHistory ? 'История недоступна, видны только новые сообщения' : 'Пока тихо'}</p>`);
    if (atEnd) log.scrollTop = log.scrollHeight;
  }

  function push(tab, m) {
    if (msgs[tab].some((x) => x.id && m.id && x.id === m.id)) return;
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
    msgs[tab] = data.reverse().concat(fresh.filter((m) => !m.id));
    render();
  }

  function subscribe(tab) {
    const ch = auth.client.channel(`chat:${name(tab)}`, { config: { broadcast: { self: true } } });
    chans[tab] = ch;
    ch.on('broadcast', { event: 'msg' }, ({ payload }) => {
      if (chans[tab] !== ch || !payload || typeof payload.body !== 'string') return;
      push(tab, { id: payload.id, user_id: payload.user_id, nick: String(payload.nick).slice(0, 16), body: payload.body.slice(0, 300) });
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
    const now = Date.now();
    if (now - lastSend < GAP) return toast('Не так быстро');
    lastSend = now;
    inp.value = '';
    const tab = chat.tab, ch = chans[tab];
    let row = { user_id: auth.user.id, nick: (auth.profile && auth.profile.nick) || PC.app.state.char.nick, body };
    const { data, error } = await auth.client.from('chat_messages').insert({ channel: name(tab), user_id: auth.user.id, body })
      .select('id,user_id,nick,body').single();
    if (data) row = data;
    else if (error && /too fast|banned/.test(error.message || '')) return toast(/banned/.test(error.message) ? 'Вам запрещено писать' : 'Не так быстро');
    else if (error) noHistory = true; // таблицы нет: шлём без записи
    if (ch) ch.send({ type: 'broadcast', event: 'msg', payload: row });
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
