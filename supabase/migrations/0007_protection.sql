-- Pocket Combats, шаг 7: защита от подделки прогресса и спама.
-- Выполнить один раз: Supabase → SQL Editor → New query → вставить весь файл → Run. (Нужны 0001–0006.)
-- Пока файл не применён, игра работает как раньше. После применения лимиты щадящие: обычная игра их не касается.

-- 1. Сохранение героя: уровень в пределах игры и не растёт быстрее порога, золото тоже.
create or replace function public.characters_validate()
returns trigger language plpgsql as $$
declare
  lvl_new numeric; lvl_old numeric; gold_new numeric; gold_old numeric;
  mins numeric;
begin
  if new.data is null then return new; end if;
  lvl_new  := coalesce((new.data->>'level')::numeric, 1);
  gold_new := coalesce((new.data->>'gold')::numeric, 0);
  if lvl_new < 1 or lvl_new > 40 then raise exception 'bad_level'; end if;
  if gold_new < 0 or gold_new > 1000000000000 then raise exception 'bad_gold'; end if;
  if tg_op = 'UPDATE' and old.data is not null then
    mins     := least(extract(epoch from (now() - old.updated_at)) / 60, 1440);
    lvl_old  := coalesce((old.data->>'level')::numeric, 1);
    gold_old := coalesce((old.data->>'gold')::numeric, 0);
    if lvl_new > lvl_old + 5 + 2 * mins then raise exception 'level_too_fast'; end if;
    if gold_new > gold_old + 200000 + 50000 * mins then raise exception 'gold_too_fast'; end if;
  end if;
  return new;
end $$;

drop trigger if exists characters_validate on public.characters;
create trigger characters_validate before insert or update on public.characters
  for each row execute function public.characters_validate();

-- 2. Бой: удар не чаще раза в секунду, за один удар нельзя снять больше базового здоровья монстра
--    (и пропорционально прошедшему времени с прошлого удара).
alter table public.battle_members add column if not exists last_hit_at timestamptz;

create or replace function public.battle_hit(p_battle uuid, p_damage bigint)
returns table (monster_hp bigint, monster_max bigint, status text, my_damage bigint, total_damage bigint, members int)
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  b  public.battles;
  mem public.battle_members;
  dmg bigint;
  secs numeric;
begin
  select * into mem from public.battle_members m where m.battle_id = p_battle and m.user_id = me;
  if not found then raise exception 'not_member'; end if;
  select * into b from public.battles where id = p_battle for update;
  if not found then raise exception 'battle_closed'; end if;
  secs := extract(epoch from (now() - coalesce(mem.last_hit_at, mem.joined_at)));
  dmg := greatest(coalesce(p_damage, 0), 0);
  if secs < 1 and mem.last_hit_at is not null then
    dmg := 0;                                                          -- слишком часто: урон не засчитывается
  else
    dmg := least(dmg, coalesce(b.base_hp, 0), ((coalesce(b.base_hp, 0) * greatest(secs, 1)) / 3)::bigint);
  end if;
  if b.status = 'running' and dmg > 0 then
    update public.battle_members m set damage = m.damage + dmg, last_hit_at = now()
     where m.battle_id = p_battle and m.user_id = me;
    update public.battles x
       set monster_hp = greatest(0, x.monster_hp - dmg),
           total_damage = x.total_damage + dmg,
           status = case when x.monster_hp - dmg <= 0 then 'finished' else x.status end,
           updated_at = now()
     where x.id = p_battle returning * into b;
  elsif b.status = 'running' then
    update public.battles x set updated_at = now() where x.id = p_battle;
  end if;
  return query
    select b.monster_hp, b.monster_max, b.status,
           (select m.damage from public.battle_members m where m.battle_id = p_battle and m.user_id = me),
           b.total_damage,
           (select count(*)::int from public.battle_members m where m.battle_id = p_battle);
end $$;

grant execute on function public.battle_hit(uuid, bigint) to authenticated;

-- 3. Чат: не больше 20 сообщений в минуту и без повторов одного текста подряд.
create or replace function public.chat_before_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare p record; last_body text;
begin
  select nick, banned into p from public.profiles where id = new.user_id;
  if p.nick is null then raise exception 'no profile'; end if;
  if p.banned then raise exception 'banned'; end if;
  new.body := btrim(new.body);
  if char_length(new.body) = 0 then raise exception 'empty'; end if;
  if exists (select 1 from public.chat_messages
             where user_id = new.user_id and created_at > now() - interval '1.5 seconds') then
    raise exception 'too fast';
  end if;
  if (select count(*) from public.chat_messages
       where user_id = new.user_id and created_at > now() - interval '1 minute') >= 20 then
    raise exception 'too fast';
  end if;
  select body into last_body from public.chat_messages
   where user_id = new.user_id order by id desc limit 1;
  if last_body = new.body and exists (select 1 from public.chat_messages
       where user_id = new.user_id and created_at > now() - interval '30 seconds') then
    raise exception 'duplicate';
  end if;
  new.nick := p.nick;
  new.created_at := now();
  return new;
end $$;

-- 4. Создание боёв: не чаще одного раза в 2 секунды (иначе можно забить таблицу).
create or replace function public.battles_throttle()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.battles where owner_id = new.owner_id and started_at > now() - interval '2 seconds') then
    raise exception 'too fast';
  end if;
  return new;
end $$;

drop trigger if exists battles_throttle on public.battles;
create trigger battles_throttle before insert on public.battles
  for each row execute function public.battles_throttle();

-- 5. Закрытые бои старше суток вычищаем при создании нового (дёшево, без cron).
create or replace function public.battles_cleanup()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from public.battles where started_at < now() - interval '1 day';
  return null;
end $$;

drop trigger if exists battles_cleanup on public.battles;
create trigger battles_cleanup after insert on public.battles
  for each statement execute function public.battles_cleanup();
