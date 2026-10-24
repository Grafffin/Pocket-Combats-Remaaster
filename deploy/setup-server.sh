#!/bin/sh
# Первая установка игры на сервер с nginx (Ubuntu/Debian). Запускать от root:
#   sh setup-server.sh you@mail.com
# Существующие сайты не трогает: добавляет отдельный конфиг для grindhall.ru и grindhall.online.
# HTTPS (certbot) выпускается, только когда домены уже указывают на этот сервер.
set -eu
EMAIL=${1:?укажите почту для сертификата: sh setup-server.sh you@mail.com}
DOMAINS="grindhall.ru www.grindhall.ru grindhall.online www.grindhall.online"
CONF=/etc/nginx/conf.d/grindhall.conf
DIR=$(cd "$(dirname "$0")" && pwd)

command -v nginx >/dev/null || { echo "nginx не найден" >&2; exit 1; }
apt-get update -qq
apt-get install -y -qq git certbot python3-certbot-nginx >/dev/null

mkdir -p /var/www/grindhall/releases
sh "$DIR/update.sh"

if [ -f "$CONF" ]; then cp "$CONF" "$CONF.bak.$(date +%s)"; fi
cat > "$CONF" <<'N'
server {
    listen 80;
    listen [::]:80;
    server_name grindhall.ru www.grindhall.ru grindhall.online www.grindhall.online;
    root /var/www/grindhall/current;
    index index.html;

    gzip on;
    gzip_types text/css application/javascript application/json image/svg+xml text/plain application/xml;

    # страница и сервис-воркер всегда из сети, скрипты с ?v= и картинки можно кэшировать
    location = /index.html { add_header Cache-Control "no-cache"; }
    location = /sw.js      { add_header Cache-Control "no-cache"; }
    location /assets/      { add_header Cache-Control "public, max-age=86400"; }
    location ~* \.(js|css)$ { add_header Cache-Control "public, max-age=31536000, immutable"; }
    location / { try_files $uri $uri/ =404; }
}
N
nginx -t
systemctl reload nginx
echo "HTTP-сайт включён. Проверяю, что домены смотрят на этот сервер…"

MYIP=$(curl -s4 https://api.ipify.org || true)
OK=""
for d in $DOMAINS; do
  IP=$(getent ahostsv4 "$d" | awk 'NR==1{print $1}')
  if [ "$IP" = "$MYIP" ]; then OK="$OK -d $d"; else echo "  $d -> ${IP:-нет записи} (ждём $MYIP), пропускаю"; fi
done
if [ -n "$OK" ]; then
  # shellcheck disable=SC2086
  certbot --nginx --non-interactive --agree-tos -m "$EMAIL" --redirect $OK
  echo "HTTPS включён."
else
  echo "DNS ещё не готов. Когда домены заработают, запустите скрипт ещё раз."
fi
