-- Pocket Combats: рынок между игроками.
-- Выполнить один раз: Supabase → SQL Editor → New query → вставить весь файл → Run. (Нужны 0001–0011.)
--
-- Как устроено:
-- * Все сделки — только через функции ниже (security definer). Каждая одной транзакцией блокирует строку героя
--   (characters) и лот, сверяет rev (клиент перед вызовом сохраняет прогресс) и меняет героя на сервере.
--   Клиент получает новую версию героя в ответе.
-- * Вещь при выставлении вынимается из серверной копии сумки и уходит в лот. Чужого героя функции не трогают:
--   выручку продавец забирает сам (market_claim), поэтому его несохранённый прогресс не затирается.
-- * Защита от дюпа: market_owner помнит, у кого сейчас вещь, прошедшая через рынок. Сохранение героя,
--   в котором лежит вещь, выставленная на рынок или проданная другому, отклоняется (item_on_market).
-- * Комиссия рынка 5% с продажи (уходит из игры). Лот висит 3 дня, потом его можно только забрать.

create table if not exists public.market_listings (
  id          bigint generated always as identity primary key,
  seller_id   uuid not null references auth.users (id) on delete cascade,
  seller_nick text not null,
  item        jsonb not null,
  item_uid    text not null,
  price       bigint not null check (price between 10 and 1000000000),
  fee         bigint not null default 0,
  status      text not null default 'active' check (status in ('active', 'sold', 'cancelled')),
  buyer_id    uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '3 days',
  sold_at     timestamptz,
  claimed     boolean not null default false,
  -- поля для поиска, сервер считает их сам из item
  type        text not null,
  rarity      int not null,
  quality     int not null,
  tier        int not null,
  ilvl        int not null,
  cls         text,
  enhance     int not null default 0,
  rank        int not null default 0,
  affixes     text[] not null default '{}',   -- id положительных свойств
  special     text[] not null default '{}',   -- особые свойства: id легендарных, 'u:<уник>', 'v:<знак>'
  has_neg     boolean not null default false,
  constraint market_item_size check (pg_column_size(item) < 20000)
);

create index if not exists market_active_idx on public.market_listings (created_at desc) where status = 'active';
create index if not exists market_price_idx on public.market_listings (price) where status = 'active';
create index if not exists market_seller_idx on public.market_listings (seller_id, created_at desc);
create index if not exists market_affixes_idx on public.market_listings using gin (affixes);
create index if not exists market_special_idx on public.market_listings using gin (special);

alter table public.market_listings enable row level security;
drop policy if exists "market_select" on public.market_listings;
create policy "market_select" on public.market_listings
  for select to authenticated using (status = 'active' or seller_id = auth.uid() or buyer_id = auth.uid());
-- вставка, изменение и удаление — только функциями ниже
revoke insert, update, delete on public.market_listings from anon, authenticated;

-- У кого сейчас вещь, прошедшая через рынок: null — лежит в лоте.
create table if not exists public.market_owner (
  uid   text primary key,
  owner uuid
);
alter table public.market_owner enable row level security;
revoke all on public.market_owner from anon, authenticated;

-- Есть ли в сохранении вещи, которые сейчас не принадлежат этому игроку.
create or replace function public.market_foreign_items(p_user uuid, p_data jsonb, p_stash jsonb)
returns boolean language sql stable security definer set search_path = public as $$
  with uids as (
    select x->>'uid' as uid from jsonb_array_elements(case when jsonb_typeof(p_data->'bag') = 'array' then p_data->'bag' else '[]'::jsonb end) x
     where jsonb_typeof(x) = 'object'
    union all
    select x->>'uid' from jsonb_each(case when jsonb_typeof(p_data->'equipment') = 'object' then p_data->'equipment' else '{}'::jsonb end) e(k, x)
     where jsonb_typeof(x) = 'object'
    union all
    select x->>'uid' from jsonb_array_elements(case when jsonb_typeof(p_stash->'items') = 'array' then p_stash->'items' else '[]'::jsonb end) x
     where jsonb_typeof(x) = 'object'
  )
  select exists (select 1 from uids u join public.market_owner o on o.uid = u.uid where o.owner is distinct from p_user);
$$;
revoke all on function public.market_foreign_items(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.market_foreign_items(uuid, jsonb, jsonb) to authenticated;

-- Проверка сохранения из 0007 + рынок. Изменения, которые делают функции рынка (они работают от владельца
-- базы, а не от игрока), лимиты скорости не проверяют: выручка с продажи может быть большой.
create or replace function public.characters_validate()
returns trigger language plpgsql as $$
declare
  lvl_new numeric; lvl_old numeric; gold_new numeric; gold_old numeric;
  mins numeric;
begin
  if new.data is null then return new; end if;
  lvl_new  := coalesce((new.data->>'level')::numeric, 1);
  gold_new := coalesce((new.data->>'gold')::numeric, 0);
  if lvl_new < 1 or lvl_new > 40 then raise exception 'bad_level'; end if;
  if gold_new < 0 or gold_new > 1000000000000 then raise exception 'bad_gold'; end if;
  if current_user not in ('authenticated', 'anon') then return new; end if;
  if tg_op = 'UPDATE' and old.data is not null then
    mins     := least(extract(epoch from (now() - old.updated_at)) / 60, 1440);
    lvl_old  := coalesce((old.data->>'level')::numeric, 1);
    gold_old := coalesce((old.data->>'gold')::numeric, 0);
    if lvl_new > lvl_old + 5 + 2 * mins then raise exception 'level_too_fast'; end if;
    if gold_new > gold_old + 200000 + 50000 * mins then raise exception 'gold_too_fast'; end if;
  end if;
  if public.market_foreign_items(new.user_id, new.data, new.stash) then raise exception 'item_on_market'; end if;
  return new;
end $$;

-- Внутреннее: герой игрока под блокировкой, со сверкой версии.
create or replace function public.market_lock_char(p_rev int)
returns public.characters language plpgsql security definer set search_path = public as $$
declare ch public.characters;
begin
  if auth.uid() is null then raise exception 'not_auth'; end if;
  select * into ch from public.characters where user_id = auth.uid() for update;
  if not found or ch.data is null then raise exception 'no_hero'; end if;
  if p_rev is null or ch.rev <> p_rev then raise exception 'stale'; end if;
  if jsonb_typeof(ch.data->'bag') <> 'array' then raise exception 'no_hero'; end if;
  return ch;
end $$;
revoke all on function public.market_lock_char(int) from public, anon, authenticated;

-- Внутреннее: индекс свободной ячейки сумки (или -1).
create or replace function public.market_free_slot(p_data jsonb)
returns int language sql immutable as $$
  select coalesce((select (e.ord - 1)::int from jsonb_array_elements(p_data->'bag') with ordinality e(it, ord)
                    where e.it = 'null'::jsonb order by e.ord limit 1), -1);
$$;

-- Выставить вещь из сумки.
create or replace function public.market_list(p_uid text, p_price bigint, p_rev int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  ch public.characters; v_idx int; v_it jsonb; v_nick text; v_id bigint;
  v_aff jsonb; v_leg jsonb;
begin
  if p_price is null or p_price < 10 or p_price > 1000000000 then raise exception 'bad_price'; end if;
  ch := public.market_lock_char(p_rev);
  if (select count(*) from public.market_listings where seller_id = ch.user_id and status = 'active') >= 20 then
    raise exception 'too_many';
  end if;
  if exists (select 1 from public.market_listings where seller_id = ch.user_id and created_at > now() - interval '2 seconds') then
    raise exception 'too_fast';
  end if;
  select (e.ord - 1)::int, e.it into v_idx, v_it
    from jsonb_array_elements(ch.data->'bag') with ordinality e(it, ord)
   where jsonb_typeof(e.it) = 'object' and e.it->>'uid' = p_uid limit 1;
  if v_idx is null then raise exception 'no_item'; end if;
  if coalesce((v_it->>'locked')::boolean, false) then raise exception 'locked'; end if;
  if v_it->>'type' is null or jsonb_typeof(v_it->'rarity') <> 'number' or jsonb_typeof(v_it->'tier') <> 'number' then
    raise exception 'bad_item';
  end if;
  v_it := v_it - 'locked' - 'fresh';
  v_aff := case when jsonb_typeof(v_it->'affixes') = 'array' then v_it->'affixes' else '[]'::jsonb end;
  v_leg := case when jsonb_typeof(v_it->'legendary') = 'array' then v_it->'legendary' else '[]'::jsonb end;
  select nick into v_nick from public.profiles where id = ch.user_id;

  insert into public.market_listings (seller_id, seller_nick, item, item_uid, price, type, rarity, quality, tier, ilvl, cls,
                                      enhance, rank, affixes, special, has_neg)
  values (ch.user_id, coalesce(v_nick, 'Игрок'), v_it, p_uid, p_price,
          v_it->>'type', (v_it->>'rarity')::numeric::int, round(coalesce((v_it->>'quality')::numeric, 0))::int,
          (v_it->>'tier')::numeric::int, coalesce((v_it->>'ilvl')::numeric, 1)::int, v_it->>'cls',
          coalesce((v_it->>'enhance')::numeric, 0)::int, coalesce((v_it->>'rank')::numeric, 0)::int,
          coalesce((select array_agg(distinct a->>'id') from jsonb_array_elements(v_aff) a
                     where a->>'id' is not null and not coalesce((a->>'neg')::boolean, false)), '{}'),
          coalesce((select array_agg(distinct x) from (
                      select l #>> '{}' as x from jsonb_array_elements(v_leg) l
                      union all select 'u:' || (v_it->>'unique') where v_it->>'unique' is not null
                      union all select 'v:' || (v_it->>'virtue') where v_it->>'virtue' is not null) s
                     where x is not null), '{}'),
          exists (select 1 from jsonb_array_elements(v_aff) a where coalesce((a->>'neg')::boolean, false)))
  returning id into v_id;

  insert into public.market_owner (uid, owner) values (p_uid, null) on conflict (uid) do update set owner = null;
  update public.characters set data = jsonb_set(data, array['bag', v_idx::text], 'null'::jsonb)
   where user_id = ch.user_id returning * into ch;

  -- старые закрытые лоты больше не нужны
  delete from public.market_listings
   where (status = 'cancelled' or (status = 'sold' and claimed)) and created_at < now() - interval '30 days';
  return jsonb_build_object('char', ch.data, 'rev', ch.rev, 'id', v_id);
end $$;

-- Купить лот: золото списывается, вещь — в свободную ячейку сумки.
create or replace function public.market_buy(p_id bigint, p_rev int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare ch public.characters; l public.market_listings; v_gold numeric; v_idx int;
begin
  ch := public.market_lock_char(p_rev);
  select * into l from public.market_listings where id = p_id for update;
  if not found or l.status <> 'active' then raise exception 'gone'; end if;
  if l.expires_at <= now() then raise exception 'expired'; end if;
  if l.seller_id = ch.user_id then raise exception 'own'; end if;
  v_gold := coalesce((ch.data->>'gold')::numeric, 0);
  if v_gold < l.price then raise exception 'no_gold'; end if;
  v_idx := public.market_free_slot(ch.data);
  if v_idx < 0 then raise exception 'bag_full'; end if;

  update public.market_listings
     set status = 'sold', buyer_id = ch.user_id, sold_at = now(), fee = (price * 5) / 100
   where id = p_id;
  update public.market_owner set owner = ch.user_id where uid = l.item_uid;
  update public.characters
     set data = jsonb_set(jsonb_set(data, '{gold}', to_jsonb(v_gold - l.price)), array['bag', v_idx::text], l.item || '{"fresh":true}'::jsonb)
   where user_id = ch.user_id returning * into ch;
  return jsonb_build_object('char', ch.data, 'rev', ch.rev, 'item', l.item, 'price', l.price);
end $$;

-- Снять свой лот (в том числе истёкший): вещь возвращается в сумку.
create or replace function public.market_cancel(p_id bigint, p_rev int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare ch public.characters; l public.market_listings; v_idx int;
begin
  ch := public.market_lock_char(p_rev);
  select * into l from public.market_listings where id = p_id and seller_id = ch.user_id for update;
  if not found or l.status <> 'active' then raise exception 'gone'; end if;
  v_idx := public.market_free_slot(ch.data);
  if v_idx < 0 then raise exception 'bag_full'; end if;
  update public.market_listings set status = 'cancelled' where id = p_id;
  update public.market_owner set owner = ch.user_id where uid = l.item_uid;
  update public.characters set data = jsonb_set(data, array['bag', v_idx::text], l.item)
   where user_id = ch.user_id returning * into ch;
  return jsonb_build_object('char', ch.data, 'rev', ch.rev, 'item', l.item);
end $$;

-- Забрать выручку со всех проданных лотов (за вычетом комиссии).
create or replace function public.market_claim(p_rev int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare ch public.characters; v_sum numeric;
begin
  ch := public.market_lock_char(p_rev);
  with c as (
    update public.market_listings set claimed = true
     where seller_id = ch.user_id and status = 'sold' and not claimed
    returning price - fee as net)
  select coalesce(sum(net), 0) into v_sum from c;
  if v_sum > 0 then
    update public.characters
       set data = jsonb_set(data, '{gold}', to_jsonb(coalesce((data->>'gold')::numeric, 0) + v_sum))
     where user_id = ch.user_id returning * into ch;
  end if;
  return jsonb_build_object('char', ch.data, 'rev', ch.rev, 'gold', v_sum);
end $$;

-- Поиск по активным лотам. Пустые фильтры передавать как null.
-- p_affixes — нужны все перечисленные свойства, p_special — хотя бы одно из особых.
create or replace function public.market_search(
  p_types text[] default null, p_rarities int[] default null,
  p_qmin int default null, p_qmax int default null,
  p_tmin int default null, p_tmax int default null,
  p_cls text[] default null, p_affixes text[] default null, p_special text[] default null,
  p_no_neg boolean default false, p_enh_min int default null, p_rank_min int default null,
  p_pmin bigint default null, p_pmax bigint default null,
  p_sort text default 'new', p_limit int default 30, p_offset int default 0)
returns setof public.market_listings language sql stable set search_path = public as $$
  select * from public.market_listings l
   where l.status = 'active' and l.expires_at > now()
     and (p_types is null or l.type = any (p_types))
     and (p_rarities is null or l.rarity = any (p_rarities))
     and (p_qmin is null or l.quality >= p_qmin)
     and (p_qmax is null or l.quality <= p_qmax)
     and (p_tmin is null or l.tier >= p_tmin)
     and (p_tmax is null or l.tier <= p_tmax)
     and (p_cls is null or l.cls = any (p_cls))
     and (p_affixes is null or l.affixes @> p_affixes)
     and (p_special is null or l.special && p_special)
     and (not coalesce(p_no_neg, false) or not l.has_neg)
     and (p_enh_min is null or l.enhance >= p_enh_min)
     and (p_rank_min is null or l.rank >= p_rank_min)
     and (p_pmin is null or l.price >= p_pmin)
     and (p_pmax is null or l.price <= p_pmax)
   order by
     case when p_sort = 'price' then l.price end asc,
     case when p_sort = 'price_desc' then l.price end desc,
     case when p_sort = 'quality' then l.quality end desc,
     case when p_sort = 'tier' then l.tier end desc,
     l.created_at desc
   limit least(greatest(coalesce(p_limit, 30), 1), 50) offset greatest(coalesce(p_offset, 0), 0);
$$;

revoke all on function public.market_list(text, bigint, int) from public, anon;
revoke all on function public.market_buy(bigint, int) from public, anon;
revoke all on function public.market_cancel(bigint, int) from public, anon;
revoke all on function public.market_claim(int) from public, anon;
revoke all on function public.market_search(text[], int[], int, int, int, int, text[], text[], text[], boolean, int, int, bigint, bigint, text, int, int) from public, anon;
grant execute on function public.market_list(text, bigint, int) to authenticated;
grant execute on function public.market_buy(bigint, int) to authenticated;
grant execute on function public.market_cancel(bigint, int) to authenticated;
grant execute on function public.market_claim(int) to authenticated;
grant execute on function public.market_search(text[], int[], int, int, int, int, text[], text[], text[], boolean, int, int, bigint, bigint, text, int, int) to authenticated;
