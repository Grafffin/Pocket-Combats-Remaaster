-- Pocket Combats: рынок ресурсов кузницы (камни заточки, свитки, руда, кожа, эссенция).
-- Выполнить один раз: Supabase → SQL Editor → New query → вставить весь файл → Run. (Нужны 0001–0014.)
--
-- Как устроено (так же, как рынок вещей из 0012):
-- * Лот — N штук одного ресурса по цене за штуку; покупается целиком. Ресурсы при выставлении списываются у героя
--   на сервере и уходят в лот, при покупке или снятии лота зачисляются на сервере. Клиент героя писать не может (0014).
-- * Все сделки — только функциями ниже: одной транзакцией блокируют строку героя и лот, сверяют rev.
-- * Комиссия рынка 5% с продажи, лот висит 3 дня, до 20 лотов ресурсов одновременно.
-- * market_claim забирает выручку и за вещи, и за ресурсы.
-- Пока миграция не применена, клиент показывает вкладку ресурсов с сообщением «Рынок ещё не включён».

create table if not exists public.market_mat_listings (
  id          bigint generated always as identity primary key,
  seller_id   uuid not null references auth.users (id) on delete cascade,
  seller_nick text not null,
  mat         text not null check (mat in ('stone1', 'stone2', 'stone3', 'protect', 'reroll', 'ore', 'leather', 'essence')),
  qty         int not null check (qty between 1 and 1000000),
  unit        bigint not null check (unit between 1 and 1000000000),
  fee         bigint not null default 0,
  status      text not null default 'active' check (status in ('active', 'sold', 'cancelled')),
  buyer_id    uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '3 days',
  sold_at     timestamptz,
  claimed     boolean not null default false,
  constraint market_mat_total check (qty::bigint * unit <= 1000000000)
);

create index if not exists market_mat_active_idx on public.market_mat_listings (mat, unit) where status = 'active';
create index if not exists market_mat_seller_idx on public.market_mat_listings (seller_id, created_at desc);

alter table public.market_mat_listings enable row level security;
drop policy if exists "market_mat_select" on public.market_mat_listings;
create policy "market_mat_select" on public.market_mat_listings
  for select to authenticated using (status = 'active' or seller_id = auth.uid() or buyer_id = auth.uid());
revoke insert, update, delete on public.market_mat_listings from anon, authenticated;

-- Выставить ресурс: количество списывается у героя.
create or replace function public.market_mat_list(p_mat text, p_qty int, p_unit bigint, p_rev int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare ch public.characters; v_have numeric; v_nick text; v_id bigint;
begin
  if p_mat is null or p_mat not in ('stone1', 'stone2', 'stone3', 'protect', 'reroll', 'ore', 'leather', 'essence') then raise exception 'bad_mat'; end if;
  if p_qty is null or p_qty < 1 or p_qty > 1000000 then raise exception 'bad_qty'; end if;
  if p_unit is null or p_unit < 1 or p_qty::bigint * p_unit > 1000000000 then raise exception 'bad_price'; end if;
  ch := public.market_lock_char(p_rev);
  if (select count(*) from public.market_mat_listings where seller_id = ch.user_id and status = 'active') >= 20 then raise exception 'too_many'; end if;
  if exists (select 1 from public.market_mat_listings where seller_id = ch.user_id and created_at > now() - interval '2 seconds') then
    raise exception 'too_fast';
  end if;
  v_have := coalesce((ch.data->'materials'->>p_mat)::numeric, 0);
  if v_have < p_qty then raise exception 'no_mat'; end if;
  select nick into v_nick from public.profiles where id = ch.user_id;
  insert into public.market_mat_listings (seller_id, seller_nick, mat, qty, unit)
  values (ch.user_id, coalesce(v_nick, 'Игрок'), p_mat, p_qty, p_unit) returning id into v_id;
  update public.characters set data = jsonb_set(data, array['materials', p_mat], to_jsonb(v_have - p_qty))
   where user_id = ch.user_id returning * into ch;
  delete from public.market_mat_listings
   where (status = 'cancelled' or (status = 'sold' and claimed)) and created_at < now() - interval '30 days';
  return jsonb_build_object('char', ch.data, 'rev', ch.rev, 'id', v_id);
end $$;

-- Купить лот целиком: золото списывается, ресурс зачисляется герою.
create or replace function public.market_mat_buy(p_id bigint, p_rev int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare ch public.characters; l public.market_mat_listings; v_gold numeric; v_total bigint; v_have numeric;
begin
  ch := public.market_lock_char(p_rev);
  select * into l from public.market_mat_listings where id = p_id for update;
  if not found or l.status <> 'active' then raise exception 'gone'; end if;
  if l.expires_at <= now() then raise exception 'expired'; end if;
  if l.seller_id = ch.user_id then raise exception 'own'; end if;
  v_total := l.qty::bigint * l.unit;
  v_gold := coalesce((ch.data->>'gold')::numeric, 0);
  if v_gold < v_total then raise exception 'no_gold'; end if;
  v_have := coalesce((ch.data->'materials'->>l.mat)::numeric, 0);
  update public.market_mat_listings
     set status = 'sold', buyer_id = ch.user_id, sold_at = now(), fee = (v_total * 5) / 100
   where id = p_id;
  update public.characters
     set data = jsonb_set(jsonb_set(data, '{gold}', to_jsonb(v_gold - v_total)), array['materials', l.mat], to_jsonb(v_have + l.qty))
   where user_id = ch.user_id returning * into ch;
  return jsonb_build_object('char', ch.data, 'rev', ch.rev, 'mat', l.mat, 'qty', l.qty, 'price', v_total);
end $$;

-- Снять свой лот (в том числе истёкший): ресурс возвращается герою.
create or replace function public.market_mat_cancel(p_id bigint, p_rev int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare ch public.characters; l public.market_mat_listings; v_have numeric;
begin
  ch := public.market_lock_char(p_rev);
  select * into l from public.market_mat_listings where id = p_id and seller_id = ch.user_id for update;
  if not found or l.status <> 'active' then raise exception 'gone'; end if;
  v_have := coalesce((ch.data->'materials'->>l.mat)::numeric, 0);
  update public.market_mat_listings set status = 'cancelled' where id = p_id;
  update public.characters set data = jsonb_set(data, array['materials', l.mat], to_jsonb(v_have + l.qty))
   where user_id = ch.user_id returning * into ch;
  return jsonb_build_object('char', ch.data, 'rev', ch.rev, 'mat', l.mat, 'qty', l.qty);
end $$;

-- Забрать выручку со всех проданных лотов: и вещей, и ресурсов (за вычетом комиссии). Заменяет функцию из 0012.
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
  with c as (
    update public.market_mat_listings set claimed = true
     where seller_id = ch.user_id and status = 'sold' and not claimed
    returning qty::bigint * unit - fee as net)
  select coalesce(sum(net), 0) into v_mat from c;
  v_sum := v_sum + v_mat;
  if v_sum > 0 then
    update public.characters
       set data = jsonb_set(data, '{gold}', to_jsonb(coalesce((data->>'gold')::numeric, 0) + v_sum))
     where user_id = ch.user_id returning * into ch;
  end if;
  return jsonb_build_object('char', ch.data, 'rev', ch.rev, 'gold', v_sum);
end $$;

-- Поиск по активным лотам ресурсов. p_mat — один ресурс или null (все); сортировка: price (цена за штуку), new.
create or replace function public.market_mat_search(
  p_mat text default null, p_sort text default 'price', p_limit int default 30, p_offset int default 0)
returns setof public.market_mat_listings language sql stable set search_path = public as $$
  select * from public.market_mat_listings l
   where l.status = 'active' and l.expires_at > now()
     and (p_mat is null or l.mat = p_mat)
   order by
     case when p_sort = 'price' then l.unit end asc,
     l.created_at desc
   limit least(greatest(coalesce(p_limit, 30), 1), 50) offset greatest(coalesce(p_offset, 0), 0);
$$;

revoke all on function public.market_mat_list(text, int, bigint, int) from public, anon;
revoke all on function public.market_mat_buy(bigint, int) from public, anon;
revoke all on function public.market_mat_cancel(bigint, int) from public, anon;
revoke all on function public.market_claim(int) from public, anon;
revoke all on function public.market_mat_search(text, text, int, int) from public, anon;
grant execute on function public.market_mat_list(text, int, bigint, int) to authenticated;
grant execute on function public.market_mat_buy(bigint, int) to authenticated;
grant execute on function public.market_mat_cancel(bigint, int) to authenticated;
grant execute on function public.market_claim(int) to authenticated;
grant execute on function public.market_mat_search(text, text, int, int) to authenticated;
