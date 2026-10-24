-- Pocket Combats, шаг 14: героя меняет только сервер (docs/SERVER_AUTHORITY.md, последний этап).
-- Выполнить один раз ПОСЛЕ 0013: Supabase → SQL Editor → New query → вставить весь файл → Run.
-- После него клиент не может записать героя и сундук напрямую: только через функцию game (сервисный ключ)
-- и функции рынка market_* (security definer). Читать своего героя игрок по-прежнему может.

revoke insert, update, delete on public.characters from anon, authenticated;
drop policy if exists "characters_insert_own" on public.characters;
drop policy if exists "characters_update_own" on public.characters;
