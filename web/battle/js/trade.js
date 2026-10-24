// Обмен между игроками (docs/TRADE.md): правила сделки без DOM и без базы, общие для серверной функции и тестов.
// Сделка = строка game_trades. Предложенное уходит из героя в залог (offer_a / offer_b) и лежит только там, пока сделка
// не закрыта: нельзя ни продать, ни потратить второй раз. Каждая сторона сама забирает своё через tradeClaim.
// Серверная запись (герой + сделка) — одна транзакция в trade_commit; io даёт функция game или тест.
(function (root) {
  'use strict';
  const PC = root.PC || (root.PC = {});
  const D = () => PC.data, I = () => PC.items, P = () => PC.progression;

  const T = { SLOTS: 8, MAX_GOLD: 1e9, TTL: 15 * 60000 };
  const OPS = ['tradeOpen', 'tradeAccept', 'tradeCancel', 'tradeOffer', 'tradeUnconfirm', 'tradeConfirm', 'tradeClaim'];
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  class TradeError extends Error {}
  const fail = (code) => { throw new TradeError(code); };
  const clone = (v) => JSON.parse(JSON.stringify(v));
  const other = (s) => (s === 'a' ? 'b' : 'a');
  const emptyOffer = () => ({ items: [], gold: 0 });
  const isEmpty = (o) => !o || (!o.items.length && !o.gold);
  const idOf = (v) => (typeof v === 'string' && UUID.test(v) ? v.toLowerCase() : fail('bad_args'));

  // Сделку и сундук герой видит только в деревне или на любой локации — но обе стороны должны стоять в одном месте
  const here = (c, loc) => !!c && !c.transit && c.location === loc;

  // Положить залог в героя (вещи — в свободные ячейки, ресурсы — в стаки, золото). false — не поместилось, герой не тронут
  function receive(char, offer) {
    const copy = clone(char), data = D();
    for (const it of offer.items) {
      if (it.stack) { if (I().matAdd(data, copy, it.stack, it.count) < it.count) return null; } else if (I().bagAdd(copy, clone(it)) < 0) return null;
    }
    copy.gold += offer.gold;
    return copy;
  }

  // Забрать из героя то, что он предлагает. Только из сумки: надетое и запертое не предлагается; всё берётся из данных героя
  // на сервере, поэтому подделать вещь или её количество нельзя.
  function take(char, list, gold) {
    const data = D();
    if (!Array.isArray(list) || list.length > T.SLOTS) fail('bad_args');
    const seen = new Set(), items = [];
    for (const e of list) {
      if (!e || typeof e !== 'object') fail('bad_args');
      if (typeof e.uid === 'string') {
        if (seen.has(`u:${e.uid}`)) fail('bad_args');
        seen.add(`u:${e.uid}`);
        const i = char.bag.findIndex((x) => x && !x.stack && x.uid === e.uid);
        if (i < 0) fail('no_item');
        if (char.bag[i].locked) fail('locked');
        items.push(char.bag[i]);
        char.bag[i] = null;
      } else if (typeof e.stack === 'string' && Object.prototype.hasOwnProperty.call(data.materials, e.stack)) {
        if (seen.has(`s:${e.stack}`)) fail('bad_args');
        seen.add(`s:${e.stack}`);
        if (!Number.isInteger(e.count) || e.count < 1 || e.count > 1e6) fail('bad_args');
        if (I().matCount(data, char, e.stack) < e.count) fail('no_item');
        I().matTake(data, char, e.stack, e.count);
        items.push({ stack: e.stack, count: e.count });
      } else fail('bad_args');
    }
    if (!Number.isInteger(gold) || gold < 0 || gold > T.MAX_GOLD) fail('bad_args');
    if (gold > char.gold) fail('no_gold');
    char.gold -= gold;
    return { items, gold };
  }

  // io: { hero(uid) → {data, stash, rev}|null, trade(id) → строка|null, create(a, b, loc) → строка,
  //       commit({ uid, tradeId, ver, patch, char, stash, rev }) → { trade, rev } }; commit при расхождении версий бросает TradeError('stale')
  // Возвращает { char, stash, rev, result: { trade } } — как остальные операции функции game.
  async function handle(op, args, io, ctx) {
    const { uid, now } = ctx;
    const data = D();
    const row = await io.hero(uid);
    if (!row || !row.data) fail('no_hero');
    const mine = () => P().migrate(data, clone(row.data));
    const answer = (trade, char, rev) => ({ char: char || row.data, stash: row.stash, rev: rev != null ? rev : row.rev, result: { ok: true, trade } });

    if (op === 'tradeOpen') {
      const to = idOf(args.to);
      if (to === uid) fail('bad_args');
      const me = mine();
      const prow = await io.hero(to);
      const partner = prow && prow.data ? P().migrate(data, clone(prow.data)) : null;
      if (!me.nick || me.transit || !partner || !here(partner, me.location)) fail('not_here');
      return answer(await io.create(uid, to, me.location));
    }

    const trade = await io.trade(idOf(args.id));
    if (!trade) fail('no_trade');
    const me = trade.a === uid ? 'a' : trade.b === uid ? 'b' : fail('not_yours');
    const ot = other(me);
    const expired = trade.state === 'open' && now - Date.parse(trade.updated_at) > T.TTL;
    const st = expired ? 'cancel' : trade.state;
    const base = expired ? { state: 'cancel', ok_a: false, ok_b: false } : {};
    const commit = async (patch, char) => {
      const r = await io.commit({ uid, tradeId: trade.id, ver: trade.ver, patch: { ...base, ...patch }, char: char || null, stash: char ? row.stash : null, rev: row.rev });
      return answer(r.trade, char, r.rev != null ? r.rev : row.rev);
    };
    const open = () => { if (st !== 'open') fail('closed'); };
    // обе стороны на месте: сделка идёт на локации, где началась
    const placed = async () => {
      const prow = await io.hero(trade[ot]);
      const partner = prow && prow.data ? P().migrate(data, clone(prow.data)) : null;
      if (!here(mine(), trade.loc) || !here(partner, trade.loc)) fail('not_here');
      return partner;
    };

    if (op === 'tradeCancel') {
      open();
      return commit({ state: 'cancel', ok_a: false, ok_b: false });
    }
    if (op === 'tradeAccept') {
      open();
      if (me !== 'b' || trade.accepted) fail('bad_args');
      await placed();
      return commit({ accepted: true });
    }
    if (op === 'tradeOffer') {
      open();
      if (!trade.accepted) fail('not_accepted');
      await placed();
      const char = mine();
      // прежний залог возвращаем, затем берём новый: сумма не может превысить то, что у героя есть
      const back = receive(char, trade[`offer_${me}`]);
      if (!back) fail('bag_full');
      const offer = take(back, args.items, args.gold);
      return commit({ [`offer_${me}`]: offer, ok_a: false, ok_b: false }, back);
    }
    if (op === 'tradeUnconfirm') {
      open();
      return commit({ [`ok_${me}`]: false });
    }
    if (op === 'tradeConfirm') {
      open();
      if (!trade.accepted) fail('not_accepted');
      // подтверждение действует только на то предложение, которое игрок видел на экране
      if (args.ver !== trade.ver) fail('changed');
      if (isEmpty(trade.offer_a) && isEmpty(trade.offer_b)) fail('empty');
      const partner = await placed();
      if (!trade[`ok_${ot}`]) return commit({ [`ok_${me}`]: true });
      // второй подтвердил: получаем чужой залог, а место партнёра проверяем заранее, чтобы не оставлять его с невыдачей
      const got = receive(mine(), trade[`offer_${ot}`]);
      if (!got) fail('bag_full');
      if (!receive(partner, trade[`offer_${me}`])) fail('partner_bag_full');
      return commit({ [`ok_${me}`]: true, state: 'done', [`claimed_${me}`]: true }, got);
    }
    if (op === 'tradeClaim') {
      if (st === 'open') fail('open');
      if (trade[`claimed_${me}`]) return answer(trade);
      const got = receive(mine(), trade[st === 'done' ? `offer_${ot}` : `offer_${me}`]);
      if (!got) fail('bag_full');
      return commit({ [`claimed_${me}`]: true }, got);
    }
    return fail('bad_op');
  }

  PC.trade = { T, OPS, TradeError, handle, receive, take };
  if (typeof module !== 'undefined') module.exports = PC;
})(typeof window !== 'undefined' ? window : globalThis);
