-- Pocket Combats, шаг 6 (часть 1): совместные бои до 10 игроков.
-- Выполнить один раз: Supabase → SQL Editor → New query → вставить весь файл → Run. (Сначала должен быть применён 0004.)
-- Пока файл не применён, игра работает как раньше: бои одиночные, кнопки «Вступить» нет.
--
-- Модель: у боя есть общий запас здоровья монстра (monster_hp). Каждый участник дерётся в своём окне
-- и раз в несколько секунд присылает нанесённый урон (battle_hit); сервер уменьшает общий запас.
-- Когда кто-то вступает (join_battle), запас растёт на 60% от базового здоровья монстра.

alter table public.battles
  add column if not exists diff         int    not null default 0,
  add column if not exists base_hp      bigint,
  add column if not exists monster_max  bigint,
  add column if not exists monster_hp   bigint,
  add column if not exists total_damage bigint not null default 0,
  add column if not exists updated_at   timestamptz not null default now();

alter table public.battle_members
  add column if not exists damage bigint not null default 0;

-- Вступить в чужой бой. Возвращает строку боя (клиент берёт из неё монстра и общий запас здоровья).
create or replace function public.join_battle(p_battle uuid, p_nick text, p_level int, p_job text)
returns public.battles language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  b  public.battles;
  n  int;
  add_hp bigint;
begin
  if me is null then raise exception 'not_authenticated'; end if;
  select * into b from public.battles where id = p_battle for update;
  if not found or b.status <> 'running' or b.monster_hp is null or b.monster_hp <= 0 then
    raise exception 'battle_closed';
  end if;
  if exists (select 1 from public.battle_members where battle_id = p_battle and user_id = me) then
    return b;
  end if;
  select count(*) into n from public.battle_members where battle_id = p_battle;
  if n >= b.max_players then raise exception 'battle_full'; end if;
  -- игрок может быть только в одном бою
  delete from public.battle_members where user_id = me;
  insert into public.battle_members (battle_id, user_id, nick, level, job)
    values (p_battle, me, left(coalesce(p_nick, '?'), 40), greatest(1, coalesce(p_level, 1)), p_job);
  add_hp := (b.base_hp * 6) / 10;
  update public.battles
     set monster_max = monster_max + add_hp, monster_hp = monster_hp + add_hp, updated_at = now()
   where id = p_battle returning * into b;
  return b;
end $$;

-- Нанести урон монстру (damage может быть 0 — просто получить свежее состояние).
create or replace function public.battle_hit(p_battle uuid, p_damage bigint)
returns table (monster_hp bigint, monster_max bigint, status text, my_damage bigint, total_damage bigint, members int)
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  b  public.battles;
  dmg bigint;
begin
  if not exists (select 1 from public.battle_members m where m.battle_id = p_battle and m.user_id = me) then
    raise exception 'not_member';
  end if;
  select * into b from public.battles where id = p_battle for update;
  if not found then raise exception 'battle_closed'; end if;
  dmg := least(greatest(coalesce(p_damage, 0), 0), coalesce(b.base_hp, 0));   -- за один присест больше базового здоровья не снять
  if b.status = 'running' and dmg > 0 then
    update public.battle_members m set damage = m.damage + dmg where m.battle_id = p_battle and m.user_id = me;
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

-- Выйти из боя (погиб, сбежал, закрыл игру). Пустой бой удаляется.
create or replace function public.leave_battle(p_battle uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from public.battle_members where battle_id = p_battle and user_id = auth.uid();
  delete from public.battles b where b.id = p_battle
    and not exists (select 1 from public.battle_members m where m.battle_id = b.id);
end $$;

grant execute on function public.join_battle(uuid, text, int, text) to authenticated;
grant execute on function public.battle_hit(uuid, bigint) to authenticated;
grant execute on function public.leave_battle(uuid) to authenticated;
