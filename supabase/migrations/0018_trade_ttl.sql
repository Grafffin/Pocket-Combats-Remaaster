-- Pocket Combats, шаг 18: обмен закрывается через 2 минуты без правок (раньше 15).
-- Выполнить один раз ПОСЛЕ 0017: Supabase → SQL Editor → New query → вставить весь файл → Run.
-- Без этого файла игра работает, но после зависшего обмена новый начать можно только через 15 минут.

create or replace function public.trade_create(p_a uuid, p_b uuid, p_loc text)
returns public.game_trades language plpgsql security definer set search_path = public as $$
declare r public.game_trades;
begin
  if p_a = p_b then raise exception 'bad_args'; end if;
  perform pg_advisory_xact_lock(hashtext(least(p_a, p_b)::text || greatest(p_a, p_b)::text));
  if exists (select 1 from public.game_trades
              where state = 'open' and updated_at > now() - interval '2 minutes'
                and (a in (p_a, p_b) or b in (p_a, p_b))) then
    raise exception 'busy';
  end if;
  insert into public.game_trades (a, b, loc) values (p_a, p_b, p_loc) returning * into r;
  return r;
end $$;
revoke all on function public.trade_create(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.trade_create(uuid, uuid, text) to service_role;
