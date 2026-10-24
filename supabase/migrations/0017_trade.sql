-- Pocket Combats, шаг 17: обмен между игроками (docs/TRADE.md).
-- Выполнить один раз ПОСЛЕ 0014: Supabase → SQL Editor → New query → вставить весь файл → Run.
-- Пока файл не применён, игра работает как раньше, кнопка «Обмен» в карточке игрока не показывается.
-- Сделка — строка game_trades: предложенные вещи и золото уходят из героя в «залог» (offer_a / offer_b) и до конца
-- сделки нигде больше не лежат, поэтому их нельзя продать или потратить второй раз. Пишет в таблицу только
-- серверная функция game (сервисный ключ), игрок может лишь читать свои сделки (для живых обновлений).

create table if not exists public.game_trades (
  id          uuid primary key default gen_random_uuid(),
  a           uuid not null references auth.users (id) on delete cascade,   -- кто пригласил
  b           uuid not null references auth.users (id) on delete cascade,   -- кого пригласили
  loc         text not null,
  state       text not null default 'open' check (state in ('open', 'done', 'cancel')),
  accepted    boolean not null default false,       -- b принял приглашение
  ver         integer not null default 0,           -- растёт на каждую правку: подтверждение действует только на ту версию, что игрок видел
  offer_a     jsonb not null default '{"items":[],"gold":0}',
  offer_b     jsonb not null default '{"items":[],"gold":0}',
  ok_a        boolean not null default false,
  ok_b        boolean not null default false,
  claimed_a   boolean not null default false,       -- сторона уже забрала своё (чужой залог при «done», свой при «cancel»)
  claimed_b   boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint trade_not_self check (a <> b),
  constraint trade_size check (pg_column_size(offer_a) < 100000 and pg_column_size(offer_b) < 100000)
);
create index if not exists game_trades_a on public.game_trades (a, state);
create index if not exists game_trades_b on public.game_trades (b, state);

alter table public.game_trades enable row level security;
revoke all on public.game_trades from anon, authenticated;
grant select on public.game_trades to authenticated;
drop policy if exists "trades_select_own" on public.game_trades;
create policy "trades_select_own" on public.game_trades for select to authenticated using (a = auth.uid() or b = auth.uid());

-- Живые обновления: партнёр сразу видит изменения предложения
do $$ begin
  alter publication supabase_realtime add table public.game_trades;
exception when duplicate_object or undefined_object then null;
end $$;

-- Новая сделка: у игрока не может быть двух открытых (не старше 15 минут) сразу
create or replace function public.trade_create(p_a uuid, p_b uuid, p_loc text)
returns public.game_trades language plpgsql security definer set search_path = public as $$
declare r public.game_trades;
begin
  if p_a = p_b then raise exception 'bad_args'; end if;
  perform pg_advisory_xact_lock(hashtext(least(p_a, p_b)::text || greatest(p_a, p_b)::text));
  if exists (select 1 from public.game_trades
              where state = 'open' and updated_at > now() - interval '15 minutes'
                and (a in (p_a, p_b) or b in (p_a, p_b))) then
    raise exception 'busy';
  end if;
  insert into public.game_trades (a, b, loc) values (p_a, p_b, p_loc) returning * into r;
  return r;
end $$;
revoke all on function public.trade_create(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.trade_create(uuid, uuid, text) to service_role;

-- Одна транзакция: сделка (только если версия та же, что видела функция) и, если нужно, герой (только если rev тот же).
-- Либо меняется всё, либо ничего: вещь не может ни пропасть, ни размножиться между героем и залогом.
create or replace function public.trade_commit(p_user uuid, p_trade uuid, p_ver integer, p_patch jsonb,
                                               p_data jsonb, p_stash jsonb, p_rev integer)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.game_trades; nrev integer;
begin
  select * into r from public.game_trades where id = p_trade for update;
  if not found or r.ver <> p_ver then raise exception 'stale'; end if;
  if p_data is not null then
    update public.characters set data = p_data, stash = p_stash where user_id = p_user and rev = p_rev returning rev into nrev;
    if not found then raise exception 'stale'; end if;
  end if;
  update public.game_trades set
    state     = coalesce(p_patch->>'state', state),
    accepted  = coalesce((p_patch->>'accepted')::boolean, accepted),
    offer_a   = coalesce(p_patch->'offer_a', offer_a),
    offer_b   = coalesce(p_patch->'offer_b', offer_b),
    ok_a      = coalesce((p_patch->>'ok_a')::boolean, ok_a),
    ok_b      = coalesce((p_patch->>'ok_b')::boolean, ok_b),
    claimed_a = coalesce((p_patch->>'claimed_a')::boolean, claimed_a),
    claimed_b = coalesce((p_patch->>'claimed_b')::boolean, claimed_b),
    ver = ver + 1, updated_at = now()
   where id = p_trade returning * into r;
  return jsonb_build_object('trade', to_jsonb(r), 'rev', nrev);
end $$;
revoke all on function public.trade_commit(uuid, uuid, integer, jsonb, jsonb, jsonb, integer) from public, anon, authenticated;
grant execute on function public.trade_commit(uuid, uuid, integer, jsonb, jsonb, jsonb, integer) to service_role;

-- Старые закрытые сделки, из которых всё уже забрали, чистим при желании вручную:
--   delete from public.game_trades where state <> 'open' and claimed_a and claimed_b and updated_at < now() - interval '7 days';
