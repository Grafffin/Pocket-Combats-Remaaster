// Версия сборки. При выкладке на GitHub Pages сюда подставляется коммит (см. .github/workflows/pages.yml):
// в общий бой пускаем только игроков с одинаковым кодом, иначе бой у них посчитается по-разному.
(function (root) {
  const PC = root.PC || (root.PC = {});
  PC.BUILD = '__BUILD__';
})(typeof window !== 'undefined' ? window : globalThis);
