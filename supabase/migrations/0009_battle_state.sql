-- Pocket Combats: общий бой считает хозяин боя и сообщает базе состояние (для списка «Бои»).
-- Выполнить один раз: Supabase → SQL Editor → New query → вставить весь файл → Run. (После 0005.)
-- Без этого файла бой работает, но в списке «Бои» не обновляется процент здоровья монстра.

create or replace function public.battle_state(p_battle uuid, p_hp bigint, p_max bigint, p_finished boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.battles
     set monster_hp = greatest(0, p_hp),
         monster_max = greatest(1, p_max),
         status = case when p_finished then 'finished' else status end,
         updated_at = now()
   where id = p_battle and owner_id = auth.uid();
end $$;

grant execute on function public.battle_state(uuid, bigint, bigint, boolean) to authenticated;
