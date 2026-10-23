// Вход, регистрация и гостевой вход через Supabase. Игра работает и без входа («Играть офлайн»).
(function () {
  'use strict';
  const { $, toast, storage } = PC.kit;
  const cfg = window.PC_CONFIG;
  const offlineFlag = storage('pc-offline-v1', false);

  const auth = { client: null, user: null, profile: null, ready: false };
  PC.auth = auth;

  if (window.supabase && cfg) {
    auth.client = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
      auth: { persistSession: true, autoRefreshToken: true, storageKey: 'pc-auth-v1' },
    });
  }

  const ERR = {
    'Invalid login credentials': 'Неверная почта или пароль',
    'User already registered': 'Эта почта уже зарегистрирована',
    'Email not confirmed': 'Почта не подтверждена',
    'Anonymous sign-ins are disabled': 'Гостевой вход отключён в настройках Supabase',
  };
  const errText = (e) => ERR[e && e.message] || (e && e.message) || 'Не удалось выполнить запрос';

  async function loadProfile() {
    auth.profile = null;
    if (!auth.user) return;
    const { data } = await auth.client.from('profiles').select('nick,is_guest').eq('id', auth.user.id).maybeSingle();
    auth.profile = data || null;
  }

  const announce = () => window.dispatchEvent(new Event('pc-auth'));
  function setOverlay(on) { $('#auth').hidden = !on; }
  function setMsg(t, bad = true) { const m = $('#auth-msg'); m.textContent = t || ''; m.classList.toggle('bad', bad); }
  function busy(on) { for (const b of document.querySelectorAll('#auth button, #auth input')) b.disabled = on; }

  let mode = 'login';
  function setMode(m) {
    mode = m;
    $('#auth-nick-field').hidden = m !== 'register';
    $('#auth-submit').textContent = m === 'register' ? 'Зарегистрироваться' : 'Войти';
    $('#auth-switch').textContent = m === 'register' ? 'Уже есть аккаунт? Войти' : 'Нет аккаунта? Регистрация';
    $('#auth-pass').autocomplete = m === 'register' ? 'new-password' : 'current-password';
    setMsg('');
  }

  async function run(fn) {
    busy(true); setMsg('');
    try {
      const { error } = await fn();
      if (error) return setMsg(errText(error));
      const { data } = await auth.client.auth.getSession();
      auth.user = data.session ? data.session.user : null;
      if (!auth.user) return setMsg('Проверьте почту: нужно подтвердить адрес', false);
      await loadProfile();
      offlineFlag.save(false);
      setOverlay(false);
      announce();
      toast(`Вы вошли как ${auth.profile ? auth.profile.nick : 'игрок'}`);
    } catch (e) { setMsg(errText(e)); } finally { busy(false); }
  }

  function submit(e) {
    e.preventDefault();
    const email = $('#auth-email').value.trim(), password = $('#auth-pass').value;
    if (!email || password.length < 6) return setMsg('Почта и пароль (не короче 6 символов)');
    if (mode === 'login') return run(() => auth.client.auth.signInWithPassword({ email, password }));
    const nick = $('#auth-nick').value.trim();
    if (nick.length < 2 || nick.length > 16) return setMsg('Ник от 2 до 16 символов');
    return run(() => auth.client.auth.signUp({ email, password, options: { data: { nick } } }));
  }

  auth.signOut = async function () {
    if (auth.client) await auth.client.auth.signOut();
    auth.user = auth.profile = null;
    offlineFlag.save(false);
    setMode('login'); setOverlay(true);
    announce();
  };
  auth.open = () => { setMode('login'); setOverlay(true); };

  window.addEventListener('DOMContentLoaded', async () => {
    $('#auth-form').addEventListener('submit', submit);
    $('#auth-switch').addEventListener('click', () => setMode(mode === 'login' ? 'register' : 'login'));
    $('#auth-guest').addEventListener('click', () => run(() => auth.client.auth.signInAnonymously()));
    $('#auth-offline').addEventListener('click', () => { offlineFlag.save(true); setOverlay(false); });
    setMode('login');
    if (!auth.client) { $('#auth-msg').textContent = 'Нет связи с сервером — доступна офлайн-игра'; $('#auth-form').hidden = true; $('#auth-guest').hidden = true; }
    else {
      try {
        const { data } = await auth.client.auth.getSession();
        auth.user = data.session ? data.session.user : null;
        await loadProfile();
      } catch (e) { /* нет сети: остаёмся без входа */ }
    }
    auth.ready = true;
    announce();
    setOverlay(!auth.user && !offlineFlag.load());
  });
})();
