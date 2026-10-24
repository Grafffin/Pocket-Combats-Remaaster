-- Pocket Combats: рынок ресурсов теперь работает с сумкой (ресурсы лежат стаками) и позволяет покупать часть лота.
-- Выполнить один раз: Supabase → SQL Editor → New query → вставить весь файл → Run. (Нужны 0001–0015.)
--
-- Что меняется относительно 0015:
-- * Ресурсы берутся из сумки героя (стаки {stack, count}, до 200 в ячейке) и в неё же возвращаются; остаток из старого
--   поля materials (если был) считается и тратится первым. Любой ресурс можно выставить, не только кузнечные.
-- * Лот можно купить частично: у лота остаётся qty, растут sold_qty и pending (выручка к получению за вычетом комиссии 5%).
-- * Выставить сразу несколько ресурсов — market_mat_list_many (одна транзакция).
-- * Уже выставленные по 0015 лоты переносятся как есть (проданные: sold_qty = qty, выручка в pending).

alter table public.market_mat_listings drop constraint if exists market_mat_listings_mat_check;
alter table public.market_mat_listings add constraint market_mat_listings_mat_check check (mat ~ '^[a-z0-9_]{1,40}$');
alter table public.market_mat_listings drop constraint if exists market_mat_listings_qty_check;
alter table public.market_mat_listings add constraint market_mat_listings_qty_check check (qty between 0 and 1000000);
alter table public.market_mat_listings add column if not exists sold_qty int not null default 0;
alter table public.market_mat_listings add column if not exists pending bigint not null default 0;

update public.market_mat_listings
   set sold_qty = qty, pending = case when claimed then 0 else qty::bigint * unit - fee end
 where status = 'sold' and sold_qty = 0;

-- ---------- Внутренние помощники для сумки героя (jsonb) ----------

-- Сколько штук ресурса у героя: остаток в materials + все стаки в сумке.
create or replace function public.market_bag_count(p_data jsonb, p_mat text)
returns int language sql immutable as $$
  select coalesce((p_data->'materials'->>p_mat)::numeric, 0)::int
       + coalesce((select sum((e.it->>'count')::int) from jsonb_array_elements(p_data->'bag') e(it) where e.it->>'stack' = p_mat), 0)::int;
$$;

-- Забрать n штук: сначала остаток из materials, затем самые маленькие стаки. Нет столько — исключение no_mat.
create or replace function public.market_bag_take(p_data jsonb, p_mat text, p_qty int)
returns jsonb language plpgsql immutable as $$
declare
  v_left int := p_qty; v_have int; v_legacy int; v_bag jsonb; r record; v_d int;
begin
  if public.market_bag_count(p_data, p_mat) < p_qty then raise exception 'no_mat'; end if;
  v_have := coalesce((p_data->'materials'->>p_mat)::numeric, 0)::int;
  v_legacy := least(v_have, v_left);
  if v_legacy > 0 then
    p_data := jsonb_set(p_data, array['materials', p_mat], to_jsonb(v_have - v_legacy));
    v_left := v_left - v_legacy;
  end if;
  v_bag := p_data->'bag';
  for r in
    select (e.ord - 1)::int as idx, (e.it->>'count')::int as cnt
      from jsonb_array_elements(v_bag) with ordinality e(it, ord)
     where e.it->>'stack' = p_mat
     order by cnt asc, e.ord
  loop
    exit when v_left <= 0;
    v_d := least(v_left, r.cnt);
    if v_d = r.cnt then
      v_bag := jsonb_set(v_bag, array[r.idx::text], 'null'::jsonb);
    else
      v_bag := jsonb_set(v_bag, array[r.idx::text], jsonb_build_object('stack', p_mat, 'count', r.cnt - v_d));
    end if;
    v_left := v_left - v_d;
  end loop;
  return jsonb_set(p_data, '{bag}', v_bag);
end $$;

-- Положить n штук: добить неполные стаки (200), остальное — в свободные ячейки. Не влезло — исключение bag_full.
create or replace function public.market_bag_add(p_data jsonb, p_mat text, p_qty int)
returns jsonb language plpgsql immutable as $$
declare
  v_left int := p_qty; v_bag jsonb := p_data->'bag'; r record; v_d int;
begin
  for r in
    select (e.ord - 1)::int as idx, (e.it->>'count')::int as cnt
      from jsonb_array_elements(v_bag) with ordinality e(it, ord)
     where e.it->>'stack' = p_mat and (e.it->>'count')::int < 200
     order by e.ord
  loop
    exit when v_left <= 0;
    v_d := least(v_left, 200 - r.cnt);
    v_bag := jsonb_set(v_bag, array[r.idx::text], jsonb_build_object('stack', p_mat, 'count', r.cnt + v_d));
    v_left := v_left - v_d;
  end loop;
  for r in
    select (e.ord - 1)::int as idx
      from jsonb_array_elements(v_bag) with ordinality e(it, ord)
     where e.it = 'null'::jsonb
     order by e.ord
  loop
    exit when v_left <= 0;
    v_d := least(v_left, 200);
    v_bag := jsonb_set(v_bag, array[r.idx::text], jsonb_build_object('stack', p_mat, 'count', v_d));
    v_left := v_left - v_d;
  end loop;
  if v_left > 0 then raise exception 'bag_full'; end if;
  return jsonb_set(p_data, '{bag}', v_bag);
end $$;

revoke all on function public.market_bag_count(jsonb, text) from public, anon, authenticated;
revoke all on function public.market_bag_take(jsonb, text, int) from public, anon, authenticated;
revoke all on function public.market_bag_add(jsonb, text, int) from public, anon, authenticated;

-- ---------- Сделки ----------

drop function if exists public.market_mat_list(text, int, bigint, int);
drop function if exists public.market_mat_buy(bigint, int);

-- Выставить сразу несколько ресурсов: p_items = [{"mat":"stone1","qty":10,"unit":25}, …] (до 10 штук).
create or replace function public.market_mat_list_many(p_items jsonb, p_rev int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  ch public.characters; it jsonb; v_mat text; v_qty int; v_unit bigint; v_nick text; v_data jsonb; v_n int;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' then raise exception 'bad_args'; end if;
  v_n := jsonb_array_length(p_items);
  if v_n < 1 or v_n > 10 then raise exception 'bad_args'; end if;
  ch := public.market_lock_char(p_rev);
  if (select count(*) from public.market_mat_listings where seller_id = ch.user_id and status = 'active') + v_n > 20 then
    raise exception 'too_many';
  end if;
  if exists (select 1 from public.market_mat_listings where seller_id = ch.user_id and created_at > now() - interval '2 seconds') then
    raise exception 'too_fast';
  end if;
  select nick into v_nick from public.profiles where id = ch.user_id;
  v_data := ch.data;
  for it in select * from jsonb_array_elements(p_items) loop
    v_mat := it->>'mat'; v_qty := (it->>'qty')::int; v_unit := (it->>'unit')::bigint;
    if v_mat is null or v_mat !~ '^[a-z0-9_]{1,40}$' then raise exception 'bad_mat'; end if;
    if v_qty is null or v_qty < 1 or v_qty > 1000000 then raise exception 'bad_qty'; end if;
    if v_unit is null or v_unit < 1 or v_qty::bigint * v_unit > 1000000000 then raise exception 'bad_price'; end if;
    v_data := public.market_bag_take(v_data, v_mat, v_qty);
    insert into public.market_mat_listings (seller_id, seller_nick, mat, qty, unit)
    values (ch.user_id, coalesce(v_nick, 'Игрок'), v_mat, v_qty, v_unit);
  end loop;
  update public.characters set data = v_data where user_id = ch.user_id returning * into ch;
  delete from public.market_mat_listings
   where (status = 'cancelled' or (status = 'sold' and claimed)) and pending = 0 and created_at < now() - interval '30 days';
  return jsonb_build_object('char', ch.data, 'rev', ch.rev, 'count', v_n);
end $$;

-- Купить p_qty штук из лота: золото списывается, ресурс попадает в сумку.
create or replace function public.market_mat_buy(p_id bigint, p_qty int, p_rev int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  ch public.characters; l public.market_mat_listings; v_gold numeric; v_total bigint; v_fee bigint; v_data jsonb;
begin
  ch := public.market_lock_char(p_rev);
  select * into l from public.market_mat_listings where id = p_id for update;
  if not found or l.status <> 'active' or l.qty < 1 then raise exception 'gone'; end if;
  if l.expires_at <= now() then raise exception 'expired'; end if;
  if l.seller_id = ch.user_id then raise exception 'own'; end if;
  if p_qty is null or p_qty < 1 or p_qty > l.qty then raise exception 'bad_qty'; end if;
  v_total := p_qty::bigint * l.unit;
  v_fee := (v_total * 5) / 100;
  v_gold := coalesce((ch.data->>'gold')::numeric, 0);
  if v_gold < v_total then raise exception 'no_gold'; end if;
  v_data := public.market_bag_add(ch.data, l.mat, p_qty);
  update public.market_mat_listings
     set qty = qty - p_qty, sold_qty = sold_qty + p_qty, fee = fee + v_fee, pending = pending + v_total - v_fee,
         buyer_id = ch.user_id,
         status = case when qty - p_qty = 0 then 'sold' else status end,
         sold_at = case when qty - p_qty = 0 then now() else sold_at end
   where id = p_id;
  update public.characters set data = jsonb_set(v_data, '{gold}', to_jsonb(v_gold - v_total))
   where user_id = ch.user_id returning * into ch;
  return jsonb_build_object('char', ch.data, 'rev', ch.rev, 'mat', l.mat, 'qty', p_qty, 'price', v_total);
end $$;

-- Снять свой лот (в том числе истёкший): остаток возвращается в сумку, уже полученная выручка остаётся к получению.
create or replace function public.market_mat_cancel(p_id bigint, p_rev int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare ch public.characters; l public.market_mat_listings; v_data jsonb;
begin
  ch := public.market_lock_char(p_rev);
  select * into l from public.market_mat_listings where id = p_id and seller_id = ch.user_id for update;
  if not found or l.status <> 'active' then raise exception 'gone'; end if;
  v_data := public.market_bag_add(ch.data, l.mat, l.qty);
  update public.market_mat_listings set status = 'cancelled', qty = 0 where id = p_id;
  update public.characters set data = v_data where user_id = ch.user_id returning * into ch;
  return jsonb_build_object('char', ch.data, 'rev', ch.rev, 'mat', l.mat, 'qty', l.qty);
end $$;

-- Забрать выручку: за вещи и за ресурсы (в том числе по частично проданным лотам). Заменяет функцию из 0015.
create or replace function public.market_claim(p_rev int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare ch public.characters; v_sum numeric; v_mat numeric;
begin
  ch := public.market_lock_char(p_rev);
  with c as (
    update public.market_listings set claimed = true
     where seller_id = ch.user_id and status = 'sold' and not claimed
    returning price - fee as net)
  select coalesce(sum(net), 0) into v_sum from c;
  with prev as (
    select id, pending from public.market_mat_listings where seller_id = ch.user_id and pending > 0 for update),
  c as (
    update public.market_mat_listings l set pending = 0, claimed = (l.status = 'sold')
      from prev where l.id = prev.id
    returning prev.pending as net)
  select coalesce(sum(net), 0) into v_mat from c;
  v_sum := v_sum + v_mat;
  if v_sum > 0 then
    update public.characters
       set data = jsonb_set(data, '{gold}', to_jsonb(coalesce((data->>'gold')::numeric, 0) + v_sum))
     where user_id = ch.user_id returning * into ch;
  end if;
  return jsonb_build_object('char', ch.data, 'rev', ch.rev, 'gold', v_sum);
end $$;

-- Поиск по активным лотам ресурсов: p_mat — один ресурс или null; сортировка price (цена за штуку) или new.
create or replace function public.market_mat_search(
  p_mat text default null, p_sort text default 'price', p_limit int default 30, p_offset int default 0)
returns setof public.market_mat_listings language sql stable set search_path = public as $$
  select * from public.market_mat_listings l
   where l.status = 'active' and l.qty > 0 and l.expires_at > now()
     and (p_mat is null or l.mat = p_mat)
   order by
     case when p_sort = 'price' then l.unit end asc,
     l.created_at desc
   limit least(greatest(coalesce(p_limit, 30), 1), 50) offset greatest(coalesce(p_offset, 0), 0);
$$;

revoke all on function public.market_mat_list_many(jsonb, int) from public, anon;
revoke all on function public.market_mat_buy(bigint, int, int) from public, anon;
revoke all on function public.market_mat_cancel(bigint, int) from public, anon;
revoke all on function public.market_claim(int) from public, anon;
revoke all on function public.market_mat_search(text, text, int, int) from public, anon;
grant execute on function public.market_mat_list_many(jsonb, int) to authenticated;
grant execute on function public.market_mat_buy(bigint, int, int) to authenticated;
grant execute on function public.market_mat_cancel(bigint, int) to authenticated;
grant execute on function public.market_claim(int) to authenticated;
grant execute on function public.market_mat_search(text, text, int, int) to authenticated;
