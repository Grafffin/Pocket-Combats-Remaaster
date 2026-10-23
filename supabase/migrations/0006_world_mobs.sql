-- Pocket Combats, шаг 6 (часть 2): общий мир монстров на локации.
-- Выполнить один раз: Supabase → SQL Editor → New query → вставить весь файл → Run.
-- Пока файл не применён, у каждого игрока свои монстры (как раньше); игра не ломается.
--
-- Монстр слота определяется локацией, номером слота и «циклом» (счётчик возрождений), поэтому у всех он один и тот же.
-- В таблице хранится только состояние слота: текущий цикл, когда монстр погибнет/возродится и занят ли он.

create table if not exists public.world_mobs (
  location_id text not null check (location_id ~ '^[a-z0-9_]{1,40}$'),
  slot        int  not null check (slot between 0 and 99),
  cycle       int  not null default 0,
  dead_until  bigint,          -- номер тика, до которого монстр мёртв
  busy_until  bigint,          -- номер тика, до которого монстр занят боем
  updated_at  timestamptz not null default now(),
  primary key (location_id, slot)
);

alter table public.world_mobs enable row level security;
drop policy if exists "world_mobs_select" on public.world_mobs;
create policy "world_mobs_select" on public.world_mobs for select to authenticated using (true);
-- записывать можно только через функцию ниже

create or replace function public.world_set(p_loc text, p_slot int, p_cycle int, p_dead bigint, p_busy bigint)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  insert into public.world_mobs as w (location_id, slot, cycle, dead_until, busy_until)
    values (p_loc, p_slot, greatest(p_cycle, 0), p_dead, p_busy)
  on conflict (location_id, slot) do update
    set cycle = excluded.cycle, dead_until = excluded.dead_until, busy_until = excluded.busy_until, updated_at = now()
    where w.cycle < excluded.cycle
       or (w.cycle = excluded.cycle and (w.dead_until is null or excluded.dead_until is not null));
end $$;

grant execute on function public.world_set(text, int, int, bigint, bigint) to authenticated;
