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
const FIGHT_OPS = new Set(['fightJoin', 'fightEnd']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
    if (op === 'ping') return json({ result: { build: PC.BUILD, fights: await fightsReady() } });

    const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    const { data: auth, error: authError } = await db.auth.getUser(jwt);
    if (authError || !auth.user) return json({ error: 'not_auth' }, 401);
    const uid = auth.user.id;

    const { data: row, error } = await db.from('characters').select('data,stash,rev').eq('user_id', uid).maybeSingle();
    if (error) throw error;
    const current = () => ({ char: row ? row.data : null, stash: row ? row.stash : null, rev: row ? row.rev : 0 });
    if (rev != null && (row ? row.rev : 0) !== rev) return json({ error: 'stale', ...current() }, 409);

    // Запись боя (seed, монстр, снимок хозяина) — для вступления и итога боя
    let fight = null;
    if (FIGHT_OPS.has(op) && args && typeof args.id === 'string' && UUID.test(args.id)) {
      const f = await db.from('game_fights').select('data').eq('id', args.id.toLowerCase()).maybeSingle();
      if (f.error) throw f.error;
      fight = f.data ? f.data.data : null;
    }
    const ctx: Record<string, unknown> = { now: Date.now(), rng: PC.makeRng(seed()), uid, fight };
    const out = run(op, args, row, ctx);
    if (!out.changed) return json({ ...current(), result: out.result });

    // Запись только при неизменной версии: параллельный запрос или старый клиент — stale
    const res = row
      ? await db.from('characters').update({ data: out.char, stash: out.stash }).eq('user_id', uid).eq('rev', row.rev).select('rev')
      : await db.from('characters').insert({ user_id: uid, data: out.char, stash: out.stash }).select('rev');
    if (res.error && res.error.code !== '23505') throw res.error;
    if (res.error || !res.data || !res.data.length) return json({ error: 'stale', ...current() }, 409);
    const rec = ctx.saveFight as { id: string } | undefined;
    if (rec) {
      const ins = await db.from('game_fights').insert({ id: rec.id, owner: uid, data: rec });
      if (ins.error) console.error('game_fights insert', ins.error);
      if (Math.random() < 0.05) await db.from('game_fights').delete().lt('created_at', new Date(Date.now() - 86400000).toISOString());
    }
    return json({ char: out.char, stash: out.stash, rev: res.data[0].rev, result: out.result });
  } catch (e) {
    if (e instanceof GameError) return json({ error: e.message }, 400);
    console.error(e);
    return json({ error: 'server' }, 500);
  }
});
