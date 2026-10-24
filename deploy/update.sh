#!/bin/sh
# Выкладка игры на свой сервер: берёт свежий main, ставит ту же версию сборки, что у серверной функции
# (первые 10 символов коммита, как в .github/workflows/pages.yml), и переключает сайт на новый каталог.
# Запуск: sh deploy/update.sh   (нужны git и права на запись в /var/www/grindhall)
set -eu
SRC=${SRC:-/opt/grindhall-src}
WWW=${WWW:-/var/www/grindhall}
REPO=${REPO:-https://github.com/Grafffin/Pocket-Combats-Remaaster}

if [ -d "$SRC/.git" ]; then git -C "$SRC" fetch -q origin main && git -C "$SRC" reset -q --hard origin/main
else git clone -q --depth 1 --branch main "$REPO" "$SRC"; fi
V=$(git -C "$SRC" rev-parse HEAD | cut -c1-10)

REL="$WWW/releases/$V"
rm -rf "$REL"; mkdir -p "$REL"
cp -r "$SRC/web/battle/." "$REL/"
rm -rf "$REL/tools"
sed -i "s/__BUILD__/$V/" "$REL/js/version.js"
sed -i -E "s#(src=\"js/[a-z0-9-]+\.js)\"#\1?v=$V\"#; s#href=\"style\.css\"#href=\"style.css?v=$V\"#" "$REL/index.html"
grep -q "?v=$V" "$REL/index.html" || { echo "версия не проставилась, выкладка отменена" >&2; exit 1; }

ln -sfn "$REL" "$WWW/current.new" && mv -T "$WWW/current.new" "$WWW/current"
# старые выкладки: оставляем три последние
ls -1dt "$WWW"/releases/* | tail -n +4 | xargs -r rm -rf
echo "Готово: версия $V"
