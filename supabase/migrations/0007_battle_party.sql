-- Pocket Combats: показ всех участников общего боя (здоровье и ресурс каждого).
-- Выполнить один раз: Supabase → SQL Editor → New query → вставить весь файл → Run. (После 0005.)
-- Пока файл не применён, бой работает, просто союзники в нём не отображаются.

alter table public.battle_members
  add column if not exists hp      bigint,
  add column if not exists hp_max  bigint,
  add column if not exists res     int,
  add column if not exists res_max int,
  add column if not exists res_color text;

-- Как battle_hit, но заодно записывает своё здоровье и ресурс для остальных участников.
create or replace function public.battle_hit(
  p_battle uuid, p_damage bigint, p_hp bigint, p_hp_max bigint, p_res int, p_res_max int, p_res_color text)
returns table (monster_hp bigint, monster_max bigint, status text, my_damage bigint, total_damage bigint, members int)
language plpgsql security definer set search_path = public as $$
begin
  update public.battle_members m
     set hp = p_hp, hp_max = p_hp_max, res = p_res, res_max = p_res_max, res_color = left(p_res_color, 20)
   where m.battle_id = p_battle and m.user_id = auth.uid();
  return query select * from public.battle_hit(p_battle, p_damage);
end $$;

grant execute on function public.battle_hit(uuid, bigint, bigint, bigint, int, int, text) to authenticated;
