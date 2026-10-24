// Edge Function «game»: единственное место, где меняется герой (серверная правда, docs/SERVER_AUTHORITY.md).
// Клиент шлёт { op, args, rev, v }: операцию, её аргументы, версию героя (characters.rev) и версию сборки.
// Ответ: { char, stash, rev, result } или { error } (stale — вместе с актуальным героем).
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import './game.js';
import { run, GameError } from './ops.js';

const PC = (globalThis as any).PC;
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  // браузер помнит разрешение и не делает лишний запрос OPTIONS перед каждым действием (экономит круг до сервера)
  'Access-Control-Max-Age': '7200',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Таблица боёв (миграция 0013) применена: пока нет, клиент считает бои по-старому
let fightsChecked = 0, fightsOk = false;
async function fightsReady() {
  if (Date.now() - fightsChecked < 60000) return fightsOk;
  const { error } = await db.from('game_fights').select('id').limit(1);
  fightsOk = !error;
  fightsChecked = Date.now();
  return fightsOk;
}
// Таблица обменов (миграция 0017) применена: пока нет, кнопки обмена в игре скрыты
let tradesChecked = 0, tradesOk = false;
async function tradesReady() {
  if (Date.now() - tradesChecked < 60000) return tradesOk;
  const { error } = await db.from('game_trades').select('id').limit(1);
  tradesOk = !error;
  tradesChecked = Date.now();
  return tradesOk;
}
// Доступ к базе для правил обмена (web/battle/js/trade.js): запись героя и сделки — одна транзакция trade_commit
const tradeIo = {
  async hero(u: string) {
    const { data, error } = await db.from('characters').select('data,stash,rev').eq('user_id', u).maybeSingle();
    if (error) throw error;
    return data;
  },
  async trade(id: string) {
    const { data, error } = await db.from('game_trades').select('*').eq('id', id).maybeSingle();
    if (error) throw error;
    return data;
  },
  async create(a: string, b: string, loc: string) {
    const { data, error } = await db.rpc('trade_create', { p_a: a, p_b: b, p_loc: loc });
    if (error) {
      if (/busy/.test(error.message)) throw new PC.trade.TradeError('busy');
      throw error;
    }
    return data;
  },
  async commit(c: { uid: string; tradeId: string; ver: number; patch: unknown; char: unknown; stash: unknown; rev: number }) {
    const { data, error } = await db.rpc('trade_commit', {
      p_user: c.uid, p_trade: c.tradeId, p_ver: c.ver, p_patch: c.patch, p_data: c.char, p_stash: c.stash, p_rev: c.rev,
    });
    if (error) {
      if (/stale/.test(error.message)) throw new PC.trade.TradeError('stale');
      throw error;
    }
    return data;
  },
};
const FIGHT_OPS = new Set(['fightJoin', 'fightEnd']);
const LOC = /^[a-z0-9_]{1,40}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Проверенный сервером авторизации токен помним несколько минут: иначе каждое действие ждёт лишний запрос
// к auth (~100–300 мс). Токен живёт час, поэтому выход из аккаунта действует не позже чем через AUTH_TTL.
const AUTH_TTL = 5 * 60000;
const authCache = new Map<string, { uid: string; until: number }>();
async function userOf(jwt: string) {
  if (!jwt) return null;
  const hit = authCache.get(jwt);
  if (hit && hit.until > Date.now()) return hit.uid;
  const { data, error } = await db.auth.getUser(jwt);
  if (error || !data.user) return null;
  if (authCache.size > 5000) authCache.clear();
  authCache.set(jwt, { uid: data.user.id, until: Date.now() + AUTH_TTL });
  return data.user.id;
}

function seed() {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return a[0] || 1;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'bad_method' }, 405);
  try {
    const { op, args, rev, v } = await req.json();
    // Другой код у клиента и сервера посчитает по-разному: клиент перезагрузит страницу
    if (v !== PC.BUILD) return json({ error: 'version', build: PC.BUILD }, 409);
    if (op === 'ping') return json({ result: { build: PC.BUILD, fights: await fightsReady(), trades: await tradesReady() } });

    const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    const uid = await userOf(jwt);
    if (!uid) return json({ error: 'not_auth' }, 401);

    // Обмен между игроками: свои правила, две записи (герой и сделка) одной транзакцией
    if (PC.trade.OPS.includes(op)) {
      if (!(await tradesReady())) return json({ error: 'no_trades' }, 400);
      try {
        return json(await PC.trade.handle(op, args || {}, tradeIo, { uid, now: Date.now() }));
      } catch (e) {
        if (e instanceof PC.trade.TradeError && e.message === 'stale') {
          const row = await tradeIo.hero(uid);
          return json({ error: 'stale', char: row ? row.data : null, stash: row ? row.stash : null, rev: row ? row.rev : 0 }, 409);
        }
        throw e;
      }
    }

    // Герой и запись боя читаются одновременно
    const fightId = FIGHT_OPS.has(op) && args && typeof args.id === 'string' && UUID.test(args.id) ? args.id.toLowerCase() : null;
    // Нападение: слоты общего мира на локации монстра (uid монстра — «локация.слот.цикл»)
    const mobLoc = op === 'fightStart' && args && typeof args.uid === 'string' ? args.uid.split('.')[0] : '';
    const [{ data: row, error }, f, wm] = await Promise.all([
      db.from('characters').select('data,stash,rev').eq('user_id', uid).maybeSingle(),
      fightId ? db.from('game_fights').select('data').eq('id', fightId).maybeSingle() : null,
      LOC.test(mobLoc) ? db.from('world_mobs').select('slot,cycle,dead_until,busy_until').eq('location_id', mobLoc) : null,
    ]);
    if (error) throw error;
    const current = () => ({ char: row ? row.data : null, stash: row ? row.stash : null, rev: row ? row.rev : 0 });
    if (rev != null && (row ? row.rev : 0) !== rev) return json({ error: 'stale', ...current() }, 409);

    // Запись боя (seed, монстр, снимок хозяина) — для вступления и итога боя
    if (f && f.error) throw f.error;
    const fight = f && f.data ? f.data.data : null;
    const world = wm && !wm.error ? wm.data : null;
    const ctx: Record<string, unknown> = { now: Date.now(), rng: PC.makeRng(seed()), uid, fight, world };
    const out = run(op, args, row, ctx);
    if (!out.changed) return json({ ...current(), result: out.result });

    // Запись только при неизменной версии: параллельный запрос или старый клиент — stale
    const res = row
      ? await db.from('characters').update({ data: out.char, stash: out.stash }).eq('user_id', uid).eq('rev', row.rev).select('rev')
      : await db.from('characters').insert({ user_id: uid, data: out.char, stash: out.stash }).select('rev');
    if (res.error && res.error.code !== '23505') throw res.error;
    if (res.error || !res.data || !res.data.length) return json({ error: 'stale', ...current() }, 409);
    // Общий мир: монстр занят, убит или возродился — видят все игроки на локации. Пишем от имени игрока
    // через world_set (миграция 0006): она не даёт откатить цикл или «оживить» убитого.
    if (out.world.length) {
      const as = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
        auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: `Bearer ${jwt}` } },
      });
      const rs = await Promise.all(out.world.map((w: { loc: string; slot: number; cycle: number; dead: number | null; busy: number | null }) =>
        as.rpc('world_set', { p_loc: w.loc, p_slot: w.slot, p_cycle: w.cycle, p_dead: w.dead, p_busy: w.busy })));
      for (const r of rs) if (r.error) console.error('world_set', r.error);
    }
    const rec = ctx.saveFight as { id: string } | undefined;
    if (rec) {
      const ins = await db.from('game_fights').insert({ id: rec.id, owner: uid, data: rec });
      if (ins.error) console.error('game_fights insert', ins.error);
      if (Math.random() < 0.05) await db.from('game_fights').delete().lt('created_at', new Date(Date.now() - 86400000).toISOString());
    }
    return json({ char: out.char, stash: out.stash, rev: res.data[0].rev, result: out.result });
  } catch (e) {
    if (e instanceof GameError || (PC.trade && e instanceof PC.trade.TradeError)) return json({ error: (e as Error).message }, 400);
    console.error(e);
    return json({ error: 'server' }, 500);
  }
});
