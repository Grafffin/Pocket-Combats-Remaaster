-- Pocket Combats, шаг 1: профили игроков.
-- Выполнить один раз: Supabase → SQL Editor → New query → вставить весь файл → Run.

create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  nick        text not null,
  is_guest    boolean not null default false,
  banned      boolean not null default false,
  created_at  timestamptz not null default now(),
  last_seen   timestamptz not null default now(),
  constraint profiles_nick_len check (char_length(nick) between 2 and 16)
);
create unique index if not exists profiles_nick_key on public.profiles (lower(nick));

alter table public.profiles enable row level security;

-- Профили видят все вошедшие (нужны для списка игроков и чата).
drop policy if exists "profiles_select" on public.profiles;
create policy "profiles_select" on public.profiles
  for select to authenticated using (true);

-- Менять можно только свой ник; banned и is_guest клиент менять не может.
drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
revoke update on public.profiles from authenticated;
grant update (nick, last_seen) on public.profiles to authenticated;

-- Профиль создаётся автоматически при регистрации и гостевом входе.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  want text := nullif(btrim(new.raw_user_meta_data ->> 'nick'), '');
  final text;
begin
  if want is null or char_length(want) not between 2 and 16
     or exists (select 1 from public.profiles where lower(nick) = lower(want)) then
    -- Гость или занятый/некорректный ник: подбираем свободное имя.
    loop
      final := 'Гость' || (1000 + floor(random() * 9000))::int;
      exit when not exists (select 1 from public.profiles where lower(nick) = lower(final));
    end loop;
  else
    final := want;
  end if;
  insert into public.profiles (id, nick, is_guest)
  values (new.id, final, coalesce(new.is_anonymous, false));
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users for each row execute function public.handle_new_user();
