// Рынок между игроками: поиск лотов с фильтрами, выставление вещей из сумки, свои лоты и выручка.
// Все сделки — функции сервера (миграция 0012) через PC.cloud.call: вещь и золото меняются на сервере одной транзакцией.
(function () {
  'use strict';
  const { data, items: I } = PC;
  const { $, $$, art, escapeHtml, fmtNum, openModal, closeModal, toast, storage } = PC.kit;
  const { tile, nameHtml, cardHtml } = PC.itemUI;
  const app = PC.app, auth = PC.auth;

  const PAGE = 30;
  const FEE = 5;            // % комиссии с продажи, как в 0012
  const MAX_LOTS = 20;
  const MIN_PRICE = 10;
  const DAY = 86400000;

  const ERRORS = {
    not_auth: 'Рынок доступен после входа в аккаунт',
    offline: 'Нет связи с сервером',
    not_saved: 'Не удалось сохранить прогресс, попробуйте ещё раз',
    stale: 'Герой изменился на другом устройстве: загружена свежая версия, повторите',
    gone: 'Лот уже продан или снят',
    expired: 'Срок лота истёк',
    own: 'Это ваш лот',
    no_gold: 'Не хватает золота',
    bag_full: 'Сумка полна: освободите ячейку',
    locked: 'Вещь под замком',
    no_item: 'Вещи нет в сумке',
    bad_price: `Цена от ${MIN_PRICE} до 1 000 000 000`,
    too_many: `Не больше ${MAX_LOTS} лотов одновременно`,
    too_fast: 'Слишком часто, подождите пару секунд',
    no_hero: 'Герой ещё не сохранён в облаке',
    bad_mat: 'Такой ресурс на рынок не принимается',
    bad_qty: 'Количество от 1 до 1 000 000',
    no_mat: 'Не хватает ресурса',
  };
  function errText(e) {
    const msg = (e && e.message) || '';
    if (/market_\w+|Could not find the function|PGRST202|does not exist/.test(msg) && !/^\w+$/.test(msg)) return 'Рынок ещё не включён на сервере';
    const key = Object.keys(ERRORS).find((k) => msg.includes(k));
    return key ? ERRORS[key] : 'Не получилось, попробуйте ещё раз';
  }

  // ---------- Фильтры ----------

  const KINDS = [['weapon', 'Оружие'], ['offhand', 'Левая рука'], ['head', 'Голова'], ['body', 'Тело'], ['hands', 'Руки'],
    ['feet', 'Ноги'], ['belt', 'Пояс'], ['amulet', 'Амулет'], ['ring', 'Кольцо']];
  const SORTS = [['new', 'Сначала новые'], ['price', 'Сначала дешёвые'], ['price_desc', 'Сначала дорогие'], ['quality', 'По качеству'], ['tier', 'По тиру']];
  const AFFIX_GROUPS = [['attack', 'Атака'], ['defense', 'Защита'], ['resource', 'Ресурсы'], ['primary', 'Характеристики'], ['utility', 'Добыча'], ['class', 'Умения']];
  const MAX_Q = data.qualities.length - 1;

  const blank = () => ({ kinds: [], cls: [], rarities: [], qmin: 0, qmax: MAX_Q, tmin: 1, tmax: data.MAX_TIER, enh: 0, rank: 0,
    pmin: '', pmax: '', affixes: [], special: [], noNeg: false, fit: false, sort: 'new' });
  const filterStore = storage('pc-market-filter-v1', null);
  const st = { tab: 'search', view: 'list', f: { ...blank(), ...(filterStore.load() || {}) }, lots: [], more: false, loading: false, mine: null, busy: false, msg: '',
    mats: { sel: '', lots: [], mine: null, loading: false, msg: '', form: { mat: '', qty: 1, unit: 0 } } };
  const FORGE = Object.keys(data.materials).filter((id) => data.materials[id].forge);
  const saveFilter = () => filterStore.save(st.f);

  function affixName(id) {
    const a = data.affixes[id];
    if (id === 'skillLvl') return 'Уровень умения';
    if (id === 'skillDmg') return 'Урон умения';
    const def = data.statDefs[a.stat];
    return def ? `${def.name}${a.pct ? ' %' : ''}` : id;
  }
  // Особые свойства: легендарные эффекты (у уников — те же эффекты), уникальные вещи и знаки-добродетели
  function specialName(tok) {
    const [k, id] = tok.split(':');
    if (k === 'L') return data.legendaries[id].name;
    if (k === 'u') return data.uniques[id].name;
    return `Знак: ${data.virtues[id].name}`;
  }
  // Легендарный эффект ищется и на обычных вещах, и на униках, у которых он фиксированный
  function specialTokens(list) {
    const out = new Set();
    for (const tok of list) {
      const [k, id] = tok.split(':');
      if (k !== 'L') { out.add(tok); continue; }
      out.add(id);
      for (const [uid, u] of Object.entries(data.uniques)) if ((u.effects || []).includes(id)) out.add(`u:${uid}`);
    }
    return [...out];
  }

  const fitsType = (c, id) => {
    const t = data.types[id];
    return (!t.cls || t.cls.includes(c.job)) && (!t.armor || t.armor === data.classes[c.job].armor);
  };

  function activeCount(f) {
    const b = blank();
    let n = 0;
    for (const k of ['kinds', 'cls', 'rarities', 'affixes', 'special']) if (f[k].length) n++;
    if (f.qmin !== b.qmin || f.qmax !== b.qmax) n++;
    if (f.tmin !== b.tmin || f.tmax !== b.tmax) n++;
    for (const k of ['enh', 'rank', 'noNeg', 'fit']) if (f[k]) n++;
    if (f.pmin !== '' || f.pmax !== '') n++;
    return n;
  }

  function searchParams(offset) {
    const f = st.f, c = app.state.char;
    const all = Object.keys(data.types);
    let types = all.filter((id) => !f.kinds.length || f.kinds.includes(data.types[id].kind));
    if (f.fit) types = types.filter((id) => fitsType(c, id));
    let tmax = f.tmax;
    if (f.fit) tmax = Math.min(tmax, I.maxTierFor(data, c.level));
    const q = data.qualities;
    const num = (v) => (v === '' || v == null || !Number.isFinite(Number(v)) ? null : Math.max(0, Math.floor(Number(v))));
    return {
      p_types: types.length === all.length ? null : (types.length ? types : ['-']),
      p_rarities: f.rarities.length ? f.rarities : null,
      p_qmin: f.qmin > 0 ? q[f.qmin].min : null,
      p_qmax: f.qmax < MAX_Q ? q[f.qmax + 1].min - 1 : null,
      p_tmin: f.tmin > 1 ? f.tmin : null,
      p_tmax: tmax < data.MAX_TIER ? tmax : null,
      p_cls: f.cls.length ? f.cls : null,
      p_affixes: f.affixes.length ? f.affixes : null,
      p_special: f.special.length ? specialTokens(f.special) : null,
      p_no_neg: !!f.noNeg,
      p_enh_min: f.enh || null,
      p_rank_min: f.rank || null,
      p_pmin: num(f.pmin),
      p_pmax: num(f.pmax),
      p_sort: f.sort,
      p_limit: PAGE + 1,
      p_offset: offset,
    };
  }

  async function search(more) {
    if (st.loading) return;
    st.loading = true;
    const offset = more ? st.lots.length : 0;
    if (!more) { st.lots = []; st.more = false; }
    refresh();
    try {
      const { data: rows, error } = await auth.client.rpc('market_search', searchParams(offset));
      if (error) throw error;
      st.more = rows.length > PAGE;
      st.lots = st.lots.concat(rows.slice(0, PAGE));
      st.msg = '';
    } catch (e) { st.msg = errText(e); }
    st.loading = false;
    refresh();
  }

  async function loadMine() {
    try {
      const { data: rows, error } = await auth.client.from('market_listings')
        .select('id,item,price,fee,status,claimed,created_at,expires_at,sold_at')
        .eq('seller_id', auth.user.id).in('status', ['active', 'sold'])
        .order('created_at', { ascending: false }).limit(60);
      if (error) throw error;
      st.mine = rows;
      st.msg = '';
    } catch (e) { st.mine = []; st.msg = errText(e); }
    refresh();
  }

  // Ресурсы кузницы: свои лоты (без вещей) и предложения
  async function searchMats() {
    const m = st.mats;
    if (m.loading) return;
    m.loading = true; refresh();
    try {
      const { data: rows, error } = await auth.client.rpc('market_mat_search', { p_mat: m.sel || null, p_sort: 'price', p_limit: PAGE, p_offset: 0 });
      if (error) throw error;
      m.lots = rows; m.msg = '';
    } catch (e) { m.lots = []; m.msg = errText(e); }
    m.loading = false; refresh();
  }

  async function loadMatMine() {
    try {
      const { data: rows, error } = await auth.client.from('market_mat_listings')
        .select('id,mat,qty,unit,fee,status,claimed,created_at,expires_at')
        .eq('seller_id', auth.user.id).in('status', ['active', 'sold'])
        .order('created_at', { ascending: false }).limit(40);
      if (error) throw error;
      st.mats.mine = rows;
    } catch (e) { st.mats.mine = []; }
    refresh();
  }

  // Сделка: блокируем кнопки, пока сервер не ответит
  async function deal(fn, args) {
    if (st.busy) return null;
    st.busy = true;
    $$('#modal-body button').forEach((b) => { b.disabled = true; });
    try { return await PC.cloud.call(fn, args); } catch (e) { toast(errText(e), 'bad'); return null; } finally { st.busy = false; }
  }

  // ---------- Отрисовка ----------

  const isOpen = () => !$('#modal').hidden && $('#modal').dataset.market === '1';
  const left = (iso) => {
    const ms = new Date(iso).getTime() - Date.now();
    if (ms <= 0) return 'срок истёк';
    const h = Math.ceil(ms / 3600000);
    return h >= 24 ? `ещё ${Math.ceil(ms / DAY)} дн.` : `ещё ${h} ч`;
  };

  function propsShort(item) {
    const aff = item.affixes.filter((a) => !a.neg).map((a) => affixName(a.id));
    const neg = item.affixes.some((a) => a.neg) ? '<span class="neg">есть минус</span>' : '';
    const leg = item.legendary.map((id) => `<span class="leg">${data.legendaries[id].name}</span>`);
    if (item.unique) leg.unshift('<span class="leg">Уникальная</span>');
    if (item.virtue) leg.push(`<span style="color:${data.virtues[item.virtue].color}">${data.virtues[item.virtue].name}</span>`);
    return [...leg, ...aff.map(escapeHtml), neg].filter(Boolean).join(' · ');
  }

  function lotRow(l, actions) {
    const it = l.item;
    const q = Math.round(it.quality);
    return `<div class="lot" data-lot="${l.id}">
      ${tile(it, { can: I.canEquip(data, app.state.char, it).ok })}
      <div class="lot-txt"><b>${nameHtml(it)}</b>
        <div class="meta">${data.rarities[it.rarity].name} · кач. ${q}% · ур. ${I.reqLevel(data, it)}${l.seller_nick ? ` · ${escapeHtml(l.seller_nick)}` : ''}</div>
        <div class="lot-props">${propsShort(it) || '<span class="meta">без свойств</span>'}</div></div>
      <div class="lot-side">${actions}</div>
    </div>`;
  }

  function tabsHtml() {
    const pay = (st.mine || []).filter((l) => l.status === 'sold' && !l.claimed).length + (st.mats.mine || []).filter((l) => l.status === 'sold' && !l.claimed).length;
    const t = (id, name) => `<button class="${st.tab === id ? 'on' : ''}" data-mtab="${id}">${name}</button>`;
    return `<div class="seg market-seg">${t('search', 'Поиск')}${t('sell', 'Продать')}${t('mats', 'Ресурсы')}${t('mine', `Мои лоты${pay ? ' <i class="dot-badge"></i>' : ''}`)}</div>`;
  }

  function searchHtml() {
    const c = app.state.char;
    const n = activeCount(st.f);
    const head = `<div class="market-tools">
      <button class="btn small ${n ? 'primary' : ''}" data-act="filters">Фильтры${n ? ` · ${n}` : ''}</button>
      <select data-sort>${SORTS.map(([id, name]) => `<option value="${id}" ${st.f.sort === id ? 'selected' : ''}>${name}</option>`).join('')}</select>
      <button class="icon-btn" data-act="refresh" title="Обновить" aria-label="Обновить">${refreshIcon}</button></div>
      <p class="meta">У вас ${fmtNum(c.gold)} 💰 · свободно в сумке: ${c.bag.filter((x) => !x).length}</p>`;
    const rows = st.lots.map((l) => lotRow(l, l.seller_id === auth.user.id
      ? '<span class="meta">ваш лот</span>'
      : `<button class="btn small primary" data-buy="${l.id}" ${c.gold < l.price ? 'disabled' : ''}>${fmtNum(l.price)} 💰</button>`)).join('');
    const empty = st.loading ? '<p class="empty-note">Ищем…</p>' : `<p class="empty-note">${st.msg || 'Ничего не нашлось'}</p>`;
    return `${head}<div class="list">${rows || empty}</div>
      ${st.more ? `<div class="row-actions"><button class="btn" data-act="more" ${st.loading ? 'disabled' : ''}>Показать ещё</button></div>` : ''}`;
  }

  function chips(key, list) {
    return `<div class="chips">${list.map(([v, name, color]) => `<button class="chip-btn ${st.f[key].includes(v) ? 'on' : ''}" data-chip="${key}" data-v="${v}"
      ${color ? `style="--chip:${color}"` : ''}>${name}</button>`).join('')}</div>`;
  }
  const opt = (list, cur) => list.map(([v, name]) => `<option value="${v}" ${String(cur) === String(v) ? 'selected' : ''}>${name}</option>`).join('');
  const block = (title, body, note = '') => `<div class="mf-block"><h4>${title}${note ? ` <small>${note}</small>` : ''}</h4>${body}</div>`;

  function filtersHtml() {
    const f = st.f;
    const qs = data.qualities.map((q, i) => [i, q.name]);
    const tiers = Array.from({ length: data.MAX_TIER }, (_, i) => [i + 1, `T${i + 1} · ур. ${data.TIER_LEVEL[i + 1]}`]);
    const affixes = AFFIX_GROUPS.map(([g, name]) => {
      const list = Object.keys(data.affixes).filter((id) => data.affixes[id].group === g).map((id) => [id, affixName(id)]);
      return list.length ? `<div class="mf-sub">${name}</div>${chips('affixes', list)}` : '';
    }).join('');
    const special = [
      ...Object.entries(data.legendaries).map(([id, l]) => [`L:${id}`, l.name, data.rarities[4].color]),
      ...Object.entries(data.uniques).map(([id, u]) => [`u:${id}`, u.name, data.rarities[7].color]),
      ...Object.entries(data.virtues).map(([id, v]) => [`v:${id}`, `Знак: ${v.name}`, v.color]),
    ];
    return `<div class="market-filters">
      <label class="mf-toggle"><input type="checkbox" data-flag="fit" ${f.fit ? 'checked' : ''}> Только то, что я могу надеть</label>
      ${block('Вид вещи', chips('kinds', KINDS))}
      ${block('Класс', chips('cls', Object.entries(data.classes).map(([id, c]) => [id, c.title])), 'под кого настроена вещь')}
      ${block('Редкость', chips('rarities', data.rarities.map((r, i) => [i, r.name, r.color])))}
      ${block('Качество', `<div class="mf-range"><select data-num="qmin">${opt(qs, f.qmin)}</select><span>—</span><select data-num="qmax">${opt(qs, f.qmax)}</select></div>`)}
      ${block('Тир', `<div class="mf-range"><select data-num="tmin">${opt(tiers, f.tmin)}</select><span>—</span><select data-num="tmax">${opt(tiers, f.tmax)}</select></div>`)}
      ${block('Заточка и ранг', `<div class="mf-range"><select data-num="enh">${opt(Array.from({ length: 16 }, (_, i) => [i, i ? `от +${i}` : 'Заточка любая']), f.enh)}</select>
        <select data-num="rank">${opt(Array.from({ length: 6 }, (_, i) => [i, i ? `от ${'★'.repeat(i)}` : 'Ранг любой']), f.rank)}</select></div>`)}
      ${block('Цена, 💰', `<div class="mf-range"><input type="number" inputmode="numeric" min="0" placeholder="от" data-price="pmin" value="${escapeHtml(f.pmin)}"><span>—</span>
        <input type="number" inputmode="numeric" min="0" placeholder="до" data-price="pmax" value="${escapeHtml(f.pmax)}"></div>`)}
      ${block('Свойства', affixes, 'нужны все выбранные')}
      <label class="mf-toggle"><input type="checkbox" data-flag="noNeg" ${f.noNeg ? 'checked' : ''}> Без отрицательных свойств</label>
      ${block('Особые свойства', chips('special', special), 'хотя бы одно из выбранных')}
    </div>
    <div class="row-actions market-apply"><button class="btn" data-act="reset">Сбросить</button><button class="btn primary" data-act="apply">Показать</button></div>`;
  }

  function sellHtml() {
    const c = app.state.char;
    const active = (st.mine || []).filter((l) => l.status === 'active').length;
    const cells = c.bag.map((it, i) => (it
      ? (it.stack ? PC.itemUI.stackTile(it, { cls: 'cant' }) : tile(it, { attrs: `data-sell="${i}"`, cls: it.locked ? 'cant' : '' }))
      : '<div class="tile empty"></div>')).join('');
    return `<p class="meta">Выберите вещь из сумки. Надетые и запертые вещи не продаются. Лотов: ${st.mine ? active : '…'} из ${MAX_LOTS}.
      Комиссия рынка ${FEE}% с продажи, лот висит 3 дня.</p><div class="bag-grid modal-grid">${cells}</div>`;
  }

  function mineHtml() {
    if (!st.mine) return '<p class="empty-note">Загружаем…</p>';
    const pay = st.mine.filter((l) => l.status === 'sold' && !l.claimed).reduce((s, l) => s + l.price - l.fee, 0)
      + (st.mats.mine || []).filter((l) => l.status === 'sold' && !l.claimed).reduce((s, l) => s + l.qty * l.unit - l.fee, 0);
    const now = Date.now();
    const rows = st.mine.map((l) => {
      let side;
      if (l.status === 'sold') side = `<span class="meta">${l.claimed ? 'продано' : 'продано, ждёт'}</span><b>${fmtNum(l.price - l.fee)} 💰</b>`;
      else if (new Date(l.expires_at).getTime() <= now) side = `<span class="meta">срок истёк</span><button class="btn small" data-cancel="${l.id}">Забрать</button>`;
      else side = `<b>${fmtNum(l.price)} 💰</b><span class="meta">${left(l.expires_at)}</span><button class="btn small" data-cancel="${l.id}">Снять</button>`;
      return lotRow(l, side);
    }).join('');
    return `${pay ? `<div class="flash good market-pay">Выручка к получению: ${fmtNum(pay)} 💰<button class="btn small primary" data-act="claim">Забрать</button></div>` : ''}
      ${st.msg ? `<div class="flash bad">${st.msg}</div>` : ''}
      <div class="list">${rows || '<p class="empty-note">Вы ещё ничего не выставляли</p>'}</div>
      <p class="meta">Лоты ресурсов — во вкладке «Ресурсы»; выручка за них забирается здесь же.</p>`;
  }

  // ---------- Вкладка «Ресурсы» ----------

  const matName = (id) => data.materials[id].name;
  function matLotRow(l, side) {
    const m = data.materials[l.mat];
    return `<div class="lot" data-matlot="${l.id}"><div class="tile">${art(m.art, '•')}</div>
      <div class="lot-txt"><b>${m.name} ×${fmtNum(l.qty)}</b>
        <div class="meta">${fmtNum(l.unit)} 💰 за штуку${l.seller_nick ? ` · ${escapeHtml(l.seller_nick)}` : ''}</div></div>
      <div class="lot-side">${side}</div></div>`;
  }

  function matsHtml() {
    const c = app.state.char, m = st.mats, f = m.form;
    const chipsHtml = ['', ...FORGE].map((id) => `<button class="chip-btn ${m.sel === id ? 'on' : ''}" data-mchip="${id}">${id ? matName(id) : 'Все'}</button>`).join('');
    const sellOpts = FORGE.map((id) => `<option value="${id}" ${f.mat === id ? 'selected' : ''}>${matName(id)} (есть ${fmtNum(c.materials[id] || 0)})</option>`).join('');
    const net = (v) => fmtNum(v - Math.floor(v * FEE / 100));
    const total = Math.max(0, Math.floor(f.qty)) * Math.max(0, Math.floor(f.unit));
    const offers = m.lots.map((l) => matLotRow(l, l.seller_id === auth.user.id
      ? '<span class="meta">ваш лот</span>'
      : `<button class="btn small primary" data-matbuy="${l.id}" ${c.gold < l.qty * l.unit ? 'disabled' : ''}>${fmtNum(l.qty * l.unit)} 💰</button>`)).join('');
    const mine = (m.mine || []).map((l) => {
      const expired = new Date(l.expires_at).getTime() <= Date.now();
      const side = l.status === 'sold' ? `<span class="meta">${l.claimed ? 'продано' : 'продано, ждёт'}</span><b>${fmtNum(l.qty * l.unit - l.fee)} 💰</b>`
        : `<b>${fmtNum(l.qty * l.unit)} 💰</b><span class="meta">${expired ? 'срок истёк' : left(l.expires_at)}</span><button class="btn small" data-matcancel="${l.id}">${expired ? 'Забрать' : 'Снять'}</button>`;
      return matLotRow(l, side);
    }).join('');
    return `<p class="meta">Камни заточки, свитки, руда, кожа и эссенция. Лот продаётся целиком, цена задаётся за штуку. Комиссия ${FEE}%, лот висит 3 дня. У вас ${fmtNum(c.gold)} 💰.</p>
      <div class="mf-block"><h4>Продать</h4><div class="sell-form">
        <label>Ресурс<select data-mf="mat"><option value="">Выберите…</option>${sellOpts}</select></label>
        <label>Количество<input type="number" inputmode="numeric" min="1" data-mf="qty" value="${f.qty}"></label>
        <label>Цена за штуку, 💰<input type="number" inputmode="numeric" min="1" data-mf="unit" value="${f.unit || ''}" placeholder="${f.mat ? `в лавке ${fmtNum(data.materials[f.mat].price)}` : ''}"></label>
        <p class="meta">Всего ${fmtNum(total)} 💰, после комиссии вы получите ${net(total)} 💰.</p>
        <div class="row-actions"><button class="btn primary" data-act="mat-list">Выставить</button></div></div></div>
      <div class="mf-block"><h4>Предложения</h4><div class="chips">${chipsHtml}</div>
        <div class="list">${offers || `<p class="empty-note">${m.loading ? 'Ищем…' : (m.msg || 'Предложений нет')}</p>`}</div></div>
      ${mine ? `<div class="mf-block"><h4>Мои лоты ресурсов</h4><div class="list">${mine}</div></div>` : ''}`;
  }

  async function buyMat(id) {
    const l = st.mats.lots.find((x) => String(x.id) === id);
    if (!l) return;
    const res = await deal('market_mat_buy', { p_id: l.id });
    if (res) { toast(`Куплено: ${matName(l.mat)} ×${fmtNum(l.qty)} за ${fmtNum(res.price)} 💰`, 'good'); st.mats.lots = st.mats.lots.filter((x) => x.id !== l.id); }
    refresh();
  }

  async function listMat() {
    const f = st.mats.form, qty = Math.floor(Number(f.qty)), unit = Math.floor(Number(f.unit));
    if (!f.mat) return toast('Выберите ресурс', 'bad');
    if (!(qty >= 1 && qty <= (app.state.char.materials[f.mat] || 0))) return toast(ERRORS.no_mat, 'bad');
    if (!(unit >= 1 && qty * unit <= 1e9)) return toast(ERRORS.bad_price, 'bad');
    const res = await deal('market_mat_list', { p_mat: f.mat, p_qty: qty, p_unit: unit });
    if (res) { toast(`Выставлено: ${matName(f.mat)} ×${fmtNum(qty)}`, 'good'); st.mats.form = { mat: '', qty: 1, unit: 0 }; loadMatMine(); searchMats(); }
    refresh();
  }

  async function cancelMat(id) {
    const res = await deal('market_mat_cancel', { p_id: id });
    if (res) toast(`Вернулось: ${matName(res.mat)} ×${fmtNum(res.qty)}`, 'good');
    loadMatMine(); searchMats();
  }

  function render() {
    if (st.view === 'card') return;
    const body = st.view === 'filters' ? filtersHtml()
      : `${tabsHtml()}${{ search: searchHtml, sell: sellHtml, mats: matsHtml, mine: mineHtml }[st.tab]()}`;
    const title = st.view === 'filters' ? 'Фильтры рынка' : 'Рынок';
    const keep = isOpen() ? $('#modal .modal').scrollTop : 0;
    openModal(title, body, onClick, { cls: 'market-modal', onClose: () => { $('#modal').dataset.market = ''; } });
    $('#modal').dataset.market = '1';
    $('#modal .modal').scrollTop = keep;
  }

  // Ответ сервера пришёл: перерисовываем, только если рынок ещё открыт
  function refresh() { if (isOpen()) render(); }

  function show(view, tab) {
    st.view = view;
    if (tab) st.tab = tab;
    $('#modal .modal').scrollTop = 0;
    render();
  }

  // Окно вещи поверх рынка; «Назад» возвращает к списку
  function openCard(item, actions, onAct) {
    st.view = 'card';
    openModal(nameHtml(item), `${cardHtml(app.state.char, item, 'market')}<div class="row-actions"><button class="btn" data-act="back">Назад</button>${actions}</div>`, (e) => {
      if (e.target.closest('[data-act="back"]')) return show('list');
      onAct(e);
    }, { cls: item.rarity >= 3 ? `rar-${item.rarity}` : '', onClose: () => { st.view = 'list'; $('#modal').dataset.market = ''; } });
    $('#modal').dataset.market = '1';
  }

  function openLot(l) {
    const c = app.state.char;
    const mine = l.seller_id === auth.user.id;
    const info = `<p class="meta lot-info">Продавец: ${escapeHtml(l.seller_nick)} · ${left(l.expires_at)}</p>`;
    openCard(l.item, mine ? '' : `<button class="btn primary" data-act="buy" ${c.gold < l.price ? 'disabled' : ''}>Купить за ${fmtNum(l.price)} 💰</button>`, (e) => {
      if (e.target.closest('[data-act="buy"]')) buy(l);
    });
    $('#modal-body .item-card').insertAdjacentHTML('beforeend', info);
  }

  async function buy(l) {
    const res = await deal('market_buy', { p_id: l.id });
    if (res) {
      toast(`Куплено: ${I.name(data, l.item)} за ${fmtNum(l.price)} 💰`, 'good');
      st.lots = st.lots.filter((x) => x.id !== l.id);
    } else if (st.view === 'card') return openLot(l);
    show('list');
  }

  function suggestPrice(item) { return Math.max(MIN_PRICE, I.sellPrice(data, item) * 3); }

  function openSellForm(index, price) {
    const item = app.state.char.bag[index];
    if (!item) return show('list');
    const p = price || suggestPrice(item);
    const net = (v) => fmtNum(v - Math.floor(v * FEE / 100));
    openCard(item, `<button class="btn primary" data-act="list">Выставить</button>`, (e) => {
      if (e.target.closest('[data-act="list"]')) list(item, index);
    });
    $('#modal-body .row-actions').insertAdjacentHTML('beforebegin', `<div class="sell-form">
      <label>Цена за вещь, 💰<input type="number" inputmode="numeric" min="${MIN_PRICE}" max="1000000000" id="market-price" value="${p}"></label>
      <p class="meta" id="market-net">Скупщик даст ${fmtNum(I.sellPrice(data, item))} 💰. После комиссии ${FEE}% вы получите ${net(p)} 💰.</p></div>`);
    $('#market-price').addEventListener('input', (e) => {
      const v = Math.floor(Number(e.target.value)) || 0;
      $('#market-net').textContent = `Скупщик даст ${fmtNum(I.sellPrice(data, item))} 💰. После комиссии ${FEE}% вы получите ${net(Math.max(0, v))} 💰.`;
    });
  }

  async function list(item, index) {
    const price = Math.floor(Number($('#market-price').value));
    if (!(price >= MIN_PRICE && price <= 1e9)) return toast(ERRORS.bad_price, 'bad');
    const res = await deal('market_list', { p_uid: item.uid, p_price: price });
    if (!res) return openSellForm(index, price);
    toast(`Выставлено: ${I.name(data, item)} за ${fmtNum(price)} 💰`, 'good');
    show('list', 'sell');
    loadMine();
  }

  async function cancel(id) {
    const res = await deal('market_cancel', { p_id: id });
    if (res) toast(`Вещь вернулась в сумку: ${I.name(data, res.item)}`, 'good');
    loadMine();
  }

  async function claim() {
    const res = await deal('market_claim', {});
    if (res && res.gold > 0) toast(`Получено ${fmtNum(res.gold)} 💰`, 'good');
    loadMine(); loadMatMine();
  }

  function onClick(e) {
    if (st.busy) return;
    const t = e.target;
    if (e.type === 'change') {
      if (t.matches('[data-sort]')) { st.f.sort = t.value; saveFilter(); return search(false); }
      if (t.matches('[data-num]')) {
        st.f[t.dataset.num] = Number(t.value);
        if (st.f.qmin > st.f.qmax) st.f[t.dataset.num === 'qmin' ? 'qmax' : 'qmin'] = Number(t.value);
        if (st.f.tmin > st.f.tmax) st.f[t.dataset.num === 'tmin' ? 'tmax' : 'tmin'] = Number(t.value);
        return render();
      }
      if (t.matches('[data-mf]')) {
        const f = st.mats.form;
        f[t.dataset.mf] = t.dataset.mf === 'mat' ? t.value : Number(t.value);
        if (t.dataset.mf !== 'mat') return;   // числа без перерисовки: иначе тап по «Выставить» теряется
        if (t.value && !f.unit) f.unit = data.materials[t.value].price;
        return render();
      }
      if (t.matches('[data-price]')) { st.f[t.dataset.price] = t.value; return; }
      if (t.matches('[data-flag]')) { st.f[t.dataset.flag] = t.checked; return; }
      return;
    }
    const chip = t.closest('[data-chip]');
    if (chip) {   // без перерисовки: окно не прыгает при выборе десятка фильтров
      const key = chip.dataset.chip;
      const v = key === 'rarities' ? Number(chip.dataset.v) : chip.dataset.v;
      const arr = st.f[key];
      const i = arr.indexOf(v);
      if (i >= 0) arr.splice(i, 1); else arr.push(v);
      chip.classList.toggle('on', i < 0);
      return;
    }
    const tab = t.closest('[data-mtab]');
    if (tab) {
      st.tab = tab.dataset.mtab;
      if (st.tab !== 'search' || !st.lots.length) st.msg = '';
      render();
      if (st.tab === 'mine' || st.tab === 'sell') loadMine();
      if (st.tab === 'mine' || st.tab === 'mats') loadMatMine();
      if (st.tab === 'mats') searchMats();
      return;
    }
    const sell = t.closest('[data-sell]');
    if (sell) {
      const it = app.state.char.bag[Number(sell.dataset.sell)];
      if (it && it.locked) return toast(ERRORS.locked, 'bad');
      return openSellForm(Number(sell.dataset.sell));
    }
    const b = t.closest('[data-buy]');
    if (b) { const l = st.lots.find((x) => String(x.id) === b.dataset.buy); if (l && !b.disabled) buy(l); return; }
    const mc = t.closest('[data-mchip]');
    if (mc) { st.mats.sel = mc.dataset.mchip; return searchMats(); }
    const mb = t.closest('[data-matbuy]');
    if (mb) { if (!mb.disabled) buyMat(mb.dataset.matbuy); return; }
    const mx = t.closest('[data-matcancel]');
    if (mx) return cancelMat(Number(mx.dataset.matcancel));
    const cn = t.closest('[data-cancel]');
    if (cn) return cancel(Number(cn.dataset.cancel));
    const a = t.closest('[data-act]');
    if (a) {
      const act = a.dataset.act;
      if (act === 'filters') return show('filters');
      if (act === 'refresh') return search(false);
      if (act === 'more') return search(true);
      if (act === 'claim') return claim();
      if (act === 'mat-list') return listMat();
      if (act === 'reset') { st.f = { ...blank(), sort: st.f.sort }; saveFilter(); return render(); }
      if (act === 'apply') { $$('[data-price]').forEach((i) => { st.f[i.dataset.price] = i.value; }); saveFilter(); show('list', 'search'); return search(false); }
      return;
    }
    const row = t.closest('[data-lot]');
    if (row && st.tab === 'search') { const l = st.lots.find((x) => String(x.id) === row.dataset.lot); if (l) openLot(l); return; }
    if (row && st.tab === 'mine') { const l = st.mine.find((x) => String(x.id) === row.dataset.lot); if (l) openCard(l.item, '', () => {}); }
  }

  const refreshIcon = '<svg class="ico" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/></svg>';

  function open() {
    if (!auth.client || !auth.user) {
      return openModal('Рынок', '<p>Рынок общий для всех игроков, поэтому работает только с аккаунтом.</p><p class="meta">Войдите или играйте гостем через меню «Аккаунт».</p>');
    }
    st.view = 'list';
    st.msg = '';
    render();
    search(false);
    loadMine();
    loadMatMine();
  }

  PC.marketUI = { open };
})();
