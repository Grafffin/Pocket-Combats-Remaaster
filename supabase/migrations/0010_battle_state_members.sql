-- Pocket Combats: расчёт общего боя может перейти от хозяина к другому участнику (если хозяин закрыл страницу).
-- Выполнить один раз: Supabase → SQL Editor → New query → вставить весь файл → Run. (После 0009.)
-- Без этого файла бой продолжается у остальных, но список «Бои» перестаёт обновлять здоровье монстра, когда считает не первый хозяин.

create or replace function public.battle_state(p_battle uuid, p_hp bigint, p_max bigint, p_finished boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.battles b
     set monster_hp = greatest(0, p_hp),
         monster_max = greatest(1, p_max),
         status = case when p_finished then 'finished' else b.status end,
         updated_at = now()
   where b.id = p_battle
     and exists (select 1 from public.battle_members m where m.battle_id = b.id and m.user_id = auth.uid());
end $$;

grant execute on function public.battle_state(uuid, bigint, bigint, boolean) to authenticated;
