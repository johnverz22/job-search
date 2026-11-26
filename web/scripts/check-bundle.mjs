// Fails if the JavaScript needed to render the search screen (`/`) exceeds the budget, or if DOMPurify leaks into it.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const BUDGET_KB = 150;
const dist = new URL('../dist/', import.meta.url).pathname;
const html = readFileSync(join(dist, 'index.html'), 'utf8');
const refs = new Set([...html.matchAll(/(?:src|href)="\/(assets\/[^"]+\.js)"/g)].map((m) => m[1]));
// The search screen is a lazy route that always loads on "/", so it counts as initial.
for (const f of readdirSync(join(dist, 'assets'))) if (/^SearchPage-.*\.js$/.test(f)) refs.add(`assets/${f}`);

// Follow static imports (shared chunks such as format/ui) so the figure is what the browser really downloads for "/".
for (const ref of [...refs]) {
  const walk = (file) => {
    const code = readFileSync(join(dist, file), 'utf8');
    for (const m of code.matchAll(/(?:from|import)\s*["']\.\/([^"']+\.js)["']/g)) {
      const dep = `assets/${m[1]}`;
      if (!refs.has(dep)) { refs.add(dep); walk(dep); }
    }
  };
  walk(ref);
}

let total = 0;
const leaked = [];
for (const ref of refs) {
  const src = readFileSync(join(dist, ref));
  const gz = gzipSync(src).length;
  total += gz;
  if (/DOMPurify|isSupported.*removeAllHooks/.test(src.toString())) leaked.push(ref);
  console.log(`${(gz / 1024).toFixed(1).padStart(7)} kB gz  ${ref}`);
}
console.log(`initial JS: ${(total / 1024).toFixed(1)} kB gz (budget ${BUDGET_KB})`);
if (leaked.length) { console.error(`DOMPurify is in the initial bundle: ${leaked.join(', ')}`); process.exit(1); }
if (total > BUDGET_KB * 1024) { console.error('over budget'); process.exit(1); }
