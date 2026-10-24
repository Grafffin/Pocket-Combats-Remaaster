#!/bin/sh
# Копирует игровой код клиента в функцию (перед деплоем, после подстановки версии в version.js).
set -e
here=$(dirname "$0")
src="$here/../../../web/battle/js"
rm -rf "$here/_game" && mkdir -p "$here/_game"
for f in version data classes stats items-data monsters world-data engine items progression economy world actions trade; do
  cp "$src/$f.js" "$here/_game/$f.js"
done
