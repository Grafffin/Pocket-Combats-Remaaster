// Validates the asset set: index.json paths exist, every SVG is well-formed XML,
// root <svg> has xmlns + viewBox and no width/height, size limits, stat icons are currentColor-only.
// Usage: node check.js
const fs = require('fs');
const path = require('path');
const ROOT = __dirname;
const index = JSON.parse(fs.readFileSync(path.join(ROOT, 'index.json'), 'utf8'));
const VIEWBOX = { classes: '0 0 128 128', monsters: '0 0 128 128', npcs: '0 0 128 128', locations: '0 0 640 240', items: '0 0 64 64', materials: '0 0 64 64', stats: '0 0 24 24' };
let errors = 0, total = 0, count = 0;
const err = (f, m) => { errors++; console.log(`FAIL ${f}: ${m}`); };

function parseXml(src) {
  // minimal well-formedness check: tags, attributes, nesting, entities
  const stack = [];
  let i = 0, root = null, rootAttrs = null, rootDone = false;
  const nameRe = /^[A-Za-z_][\w.:-]*/;
  while (i < src.length) {
    const lt = src.indexOf('<', i);
    const text = src.slice(i, lt < 0 ? src.length : lt);
    if (/&(?!(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/.test(text)) throw new Error('bad entity in text');
    if (lt < 0) { if (text.trim()) throw new Error('text after root'); break; }
    if (!stack.length && text.trim()) throw new Error('text outside root');
    if (src.startsWith('<!--', lt)) { const e = src.indexOf('-->', lt); if (e < 0) throw new Error('open comment'); i = e + 3; continue; }
    if (src.startsWith('<?', lt)) { const e = src.indexOf('?>', lt); if (e < 0) throw new Error('open PI'); i = e + 2; continue; }
    if (src[lt + 1] === '/') {
      const e = src.indexOf('>', lt); const nm = src.slice(lt + 2, e).trim();
      const top = stack.pop(); if (top !== nm) throw new Error(`mismatched </${nm}> (expected </${top}>)`);
      if (!stack.length) rootDone = true;
      i = e + 1; continue;
    }
    let j = lt + 1; const m = src.slice(j).match(nameRe); if (!m) throw new Error('bad tag name at ' + lt);
    const tag = m[0]; j += tag.length; const attrs = {};
    for (;;) {
      const ws = src.slice(j).match(/^\s*/)[0]; j += ws.length;
      if (src[j] === '>') { j++; stack.push(tag); break; }
      if (src.startsWith('/>', j)) { j += 2; break; }
      if (!ws) throw new Error(`missing space before attribute in <${tag}>`);
      const an = src.slice(j).match(nameRe); if (!an) throw new Error(`bad attribute in <${tag}>`);
      j += an[0].length;
      if (src[j] !== '=') throw new Error(`attribute ${an[0]} without value`);
      const q = src[j + 1]; if (q !== '"' && q !== "'") throw new Error(`unquoted attribute ${an[0]}`);
      const e = src.indexOf(q, j + 2); const val = src.slice(j + 2, e);
      if (val.includes('<') || /&(?!(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/.test(val)) throw new Error(`bad char in ${an[0]}`);
      if (an[0] in attrs) throw new Error(`duplicate attribute ${an[0]} in <${tag}>`);
      attrs[an[0]] = val; j = e + 1;
    }
    if (!root) { root = tag; rootAttrs = attrs; } else if (rootDone) throw new Error('multiple root elements');
    if (!stack.length) rootDone = true;
    i = j;
  }
  if (stack.length) throw new Error('unclosed <' + stack.join('><') + '>');
  return { root, rootAttrs };
}

for (const [grp, entries] of Object.entries(index)) {
  for (const [key, rel] of Object.entries(entries)) {
    const f = path.join(ROOT, rel);
    if (!fs.existsSync(f)) { err(rel, 'missing file'); continue; }
    const src = fs.readFileSync(f, 'utf8');
    count++; total += Buffer.byteLength(src);
    if (src.length > 20480) err(rel, `too large (${src.length} bytes)`);
    let r;
    try { r = parseXml(src); } catch (e) { err(rel, 'XML: ' + e.message); continue; }
    if (r.root !== 'svg') err(rel, 'root is not <svg>');
    if (r.rootAttrs.xmlns !== 'http://www.w3.org/2000/svg') err(rel, 'missing xmlns');
    if ('width' in r.rootAttrs || 'height' in r.rootAttrs) err(rel, 'root has width/height');
    const vb = rel.startsWith('ui/slots/') ? '0 0 64 64' : rel === 'ui/logo.svg' ? '0 0 320 96' : VIEWBOX[grp];
    if (r.rootAttrs.viewBox !== vb) err(rel, `viewBox "${r.rootAttrs.viewBox}" != "${vb}"`);
    // every url(#id) must be defined in the same file
    const ids = new Set([...src.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
    for (const m of src.matchAll(/url\(#([^)]+)\)/g)) if (!ids.has(m[1])) err(rel, 'undefined reference #' + m[1]);
    if (grp === 'stats') {
      if (/stroke|Gradient|<image|<text/.test(src)) err(rel, 'stat icon must be fill-only, no gradients/strokes/text');
      for (const m of src.matchAll(/fill="([^"]+)"/g)) if (m[1] !== 'currentColor') err(rel, 'non-currentColor fill ' + m[1]);
    }
    if (rel.startsWith('ui/slots/')) {
      for (const m of src.matchAll(/(?:fill|stroke)="([^"]+)"/g)) if (!['currentColor', 'none'].includes(m[1])) err(rel, 'slot uses colour ' + m[1]);
    }
    if (/<text\b/.test(src)) err(rel, 'contains <text>');
  }
}
// files on disk that are not in the index
for (const dir of fs.readdirSync(ROOT, { withFileTypes: true }).filter((d) => d.isDirectory())) {
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  for (const f of walk(path.join(ROOT, dir.name))) {
    const rel = path.relative(ROOT, f).split(path.sep).join('/');
    if (!Object.values(index).some((o) => Object.values(o).includes(rel))) err(rel, 'not listed in index.json');
  }
}
console.log(`${count} files, ${(total / 1024).toFixed(1)} KB total, ${errors} error(s)`);
process.exit(errors ? 1 : 0);
