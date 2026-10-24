-- Pocket Combats, шаг 13: бои с наградой от сервера (docs/SERVER_AUTHORITY.md).
-- Выполнить один раз: Supabase → SQL Editor → New query → вставить весь файл → Run.
-- Пока файл не применён, бои считаются по-старому, игра работает.
-- Запись боя пишет и читает только серверная функция game (сервисный ключ): seed, монстр, снимок бойца хозяина.
-- По ней функция проверяет историю боя, которую сдают участники, и сама начисляет награду.

create table if not exists public.game_fights (
  id          uuid primary key,
  owner       uuid not null references auth.users (id) on delete cascade,
  data        jsonb not null,
  created_at  timestamptz not null default now()
);
create index if not exists game_fights_created on public.game_fights (created_at);

alter table public.game_fights enable row level security;
revoke all on public.game_fights from anon, authenticated;
