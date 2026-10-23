-- Pocket Combats: история завершённых боёв (у каждого участника своя запись).
-- Выполнить один раз: Supabase → SQL Editor → New query → вставить весь файл → Run.
-- Пока файл не применён, игра работает как раньше, просто история не сохраняется.

create table if not exists public.battle_history (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  location_id   text,
  monster_id    text not null,
  monster_level int  not null,
  diff          int  not null default 0,
  result        text not null check (result in ('win','lose','fled')),
  turns         int  not null default 0,
  my_damage     bigint,
  total_damage  bigint,
  members       text[] not null default '{}',   -- ники участников
  log           jsonb  not null default '[]',   -- последние строки лога боя
  ended_at      timestamptz not null default now()
);
create index if not exists battle_history_user_idx on public.battle_history (user_id, ended_at desc);

alter table public.battle_history enable row level security;
drop policy if exists "history_select_own" on public.battle_history;
create policy "history_select_own" on public.battle_history for select to authenticated using (user_id = auth.uid());
drop policy if exists "history_insert_own" on public.battle_history;
create policy "history_insert_own" on public.battle_history for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "history_delete_own" on public.battle_history;
create policy "history_delete_own" on public.battle_history for delete to authenticated using (user_id = auth.uid());
