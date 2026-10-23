-- Pocket Combats, шаг 2: облачное сохранение героя и сундука.
-- Выполнить один раз: Supabase → SQL Editor → New query → вставить весь файл → Run.

create table if not exists public.characters (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  data        jsonb,                       -- герой (null = герой удалён)
  stash       jsonb,                       -- общий сундук аккаунта
  rev         integer not null default 1,  -- растёт на каждое сохранение, нужен для защиты от конфликтов
  updated_at  timestamptz not null default now(),
  constraint characters_size check (pg_column_size(data) < 600000 and pg_column_size(stash) < 600000)
);

alter table public.characters enable row level security;

drop policy if exists "characters_select_own" on public.characters;
create policy "characters_select_own" on public.characters
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "characters_insert_own" on public.characters;
create policy "characters_insert_own" on public.characters
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists "characters_update_own" on public.characters;
create policy "characters_update_own" on public.characters
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

revoke update on public.characters from authenticated;
grant update (data, stash) on public.characters to authenticated;

create or replace function public.characters_touch()
returns trigger language plpgsql as $$
begin
  new.rev := old.rev + 1;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists characters_touch on public.characters;
create trigger characters_touch before update on public.characters
  for each row execute function public.characters_touch();
