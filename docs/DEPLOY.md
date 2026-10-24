# Свой сервер (grindhall.ru / grindhall.online)

Клиент — статические файлы, бэкенд в Supabase, поэтому серверу нужен только nginx. GitHub Pages продолжает работать.

## Первая установка (один раз, PuTTY, root)
1. DNS обоих доменов (и `www`): A-запись на IP сервера.
2. `git clone https://github.com/Grafffin/Pocket-Combats-Remaaster /opt/grindhall-src && sh /opt/grindhall-src/deploy/setup-server.sh you@mail.com`
   Скрипт ставит certbot, кладёт `/etc/nginx/conf.d/grindhall.conf` (чужие сайты не трогает), выкладывает игру и выпускает HTTPS для доменов, которые уже смотрят на сервер. Если DNS не готов, запусти его повторно позже.
3. Supabase → Authentication → URL Configuration: добавить оба домена в Site URL / Redirect URLs.

## Обновление
`sh /opt/grindhall-src/deploy/update.sh` — берёт main и ставит ту же версию сборки, что у серверной функции `game` (первые 10 символов коммита). Запускать после того, как отработал workflow Pages, иначе версия клиента и функции разойдётся и общий бой не пустит.

## Язык
Без сохранённого выбора `*.online` открывается на английском, остальные на русском; выбор в Меню → Настройки главнее.
