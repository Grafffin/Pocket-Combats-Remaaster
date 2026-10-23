-- Pocket Combats, шаг 4: чат (история сообщений).
-- Выполнить один раз: Supabase → SQL Editor → New query → вставить весь файл → Run.
-- Пока файл не применён, чат работает, но без истории (сообщения видны только тем, кто онлайн).

create table if not exists public.chat_messages (
  id          bigserial primary key,
  channel     text not null,                 -- 'global' или 'loc:<id локации>'
  user_id     uuid not null references auth.users (id) on delete cascade,
  nick        text not null,
  body        text not null,
  created_at  timestamptz not null default now(),
  constraint chat_body_len check (char_length(body) between 1 and 300),
  constraint chat_channel_fmt check (channel = 'global' or channel ~ '^loc:[a-z0-9_]{1,40}$')
);
create index if not exists chat_messages_channel_idx on public.chat_messages (channel, id desc);

alter table public.chat_messages enable row level security;

drop policy if exists "chat_select" on public.chat_messages;
create policy "chat_select" on public.chat_messages
  for select to authenticated using (true);

drop policy if exists "chat_insert_own" on public.chat_messages;
create policy "chat_insert_own" on public.chat_messages
  for insert to authenticated with check (user_id = auth.uid());

-- Ник берётся из профиля (подделать нельзя), забаненным писать нельзя, не чаще 1 сообщения в 1.5 с.
create or replace function public.chat_before_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare p record;
begin
  select nick, banned into p from public.profiles where id = new.user_id;
  if p.nick is null then raise exception 'no profile'; end if;
  if p.banned then raise exception 'banned'; end if;
  if exists (select 1 from public.chat_messages
             where user_id = new.user_id and created_at > now() - interval '1.5 seconds') then
    raise exception 'too fast';
  end if;
  new.nick := p.nick;
  new.body := btrim(new.body);
  new.created_at := now();
  return new;
end $$;

drop trigger if exists chat_before_insert on public.chat_messages;
create trigger chat_before_insert before insert on public.chat_messages
  for each row execute function public.chat_before_insert();

-- Храним последние 200 сообщений на канал.
create or replace function public.chat_trim()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from public.chat_messages
   where channel = new.channel
     and id <= (select id from public.chat_messages where channel = new.channel
                order by id desc offset 200 limit 1);
  return null;
end $$;

drop trigger if exists chat_trim on public.chat_messages;
create trigger chat_trim after insert on public.chat_messages
  for each row execute function public.chat_trim();
