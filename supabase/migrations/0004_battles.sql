-- Pocket Combats, шаг 5: список боёв на локации (battles, battle_members).
-- Выполнить один раз: Supabase → SQL Editor → New query → вставить весь файл → Run.
-- Пока файл не применён, игра работает как раньше, вкладка «Бои» просто пустая.

create table if not exists public.battles (
  id             uuid primary key default gen_random_uuid(),
  location_id    text not null check (location_id ~ '^[a-z0-9_]{1,40}$'),
  owner_id       uuid not null references auth.users (id) on delete cascade,
  monster_id     text not null,
  monster_level  int  not null check (monster_level between 1 and 999),
  status         text not null default 'running' check (status in ('running','finished')),
  max_players    int  not null default 10 check (max_players between 1 and 10),
  started_at     timestamptz not null default now()
);
create index if not exists battles_loc_idx on public.battles (location_id, started_at desc);
create unique index if not exists battles_one_running_per_owner on public.battles (owner_id) where status = 'running';

create table if not exists public.battle_members (
  battle_id  uuid not null references public.battles (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  nick       text not null,
  level      int  not null,
  job        text,
  joined_at  timestamptz not null default now(),
  primary key (battle_id, user_id)
);

alter table public.battles enable row level security;
alter table public.battle_members enable row level security;

drop policy if exists "battles_select" on public.battles;
create policy "battles_select" on public.battles for select to authenticated using (true);
drop policy if exists "battles_insert_own" on public.battles;
create policy "battles_insert_own" on public.battles for insert to authenticated with check (owner_id = auth.uid());
drop policy if exists "battles_delete_own" on public.battles;
create policy "battles_delete_own" on public.battles for delete to authenticated using (owner_id = auth.uid());

drop policy if exists "members_select" on public.battle_members;
create policy "members_select" on public.battle_members for select to authenticated using (true);
-- Пока бой одиночный: добавлять участников может только владелец боя (вступление чужих — следующий шаг, RPC join_battle).
drop policy if exists "members_insert_owner" on public.battle_members;
create policy "members_insert_owner" on public.battle_members for insert to authenticated
  with check (user_id = auth.uid() and exists (select 1 from public.battles b where b.id = battle_id and b.owner_id = auth.uid()));

alter publication supabase_realtime add table public.battles;
alter publication supabase_realtime add table public.battle_members;
