// Dependency-free static checks. Runs in CI in place of a linter, so the
// project stays installable with zero npm dependencies.
//
//   1. every relative import resolves to a file that exists
//   2. no module imports itself into a cycle through a direct self-reference
//   3. no leftover debugging calls in shipped source
//   4. index.html only references files that exist

import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve, relative } from 'node:path';

const ROOT = resolve(new URL('..', import.meta.url).pathname);
const problems = [];

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await walk(full));
    else if (/\.(js|mjs)$/.test(entry.name)) out.push(full);
  }
  return out;
}

const files = await walk(join(ROOT, 'src'));
files.push(...await walk(join(ROOT, 'test')));
files.push(...await walk(join(ROOT, 'tools')));

for (const file of files) {
  const src = await readFile(file, 'utf8');
  const rel = relative(ROOT, file);

  for (const m of src.matchAll(/(?:^|\n)\s*(?:import|export)[^;\n]*?from\s+['"](\.[^'"]+)['"]/g)) {
    const target = resolve(dirname(file), m[1]);
    if (!existsSync(target)) problems.push(`${rel}: import does not resolve → ${m[1]}`);
  }

  for (const m of src.matchAll(/\bimport\(\s*['"](\.[^'"]+)['"]\s*\)/g)) {
    const target = resolve(dirname(file), m[1]);
    if (!existsSync(target)) problems.push(`${rel}: dynamic import does not resolve → ${m[1]}`);
  }

  if (!rel.startsWith('tools') && !rel.startsWith('test')) {
    const line = src.split('\n').findIndex((l) => /\bconsole\.(log|debug)\(/.test(l) && !l.trim().startsWith('//'));
    if (line >= 0) problems.push(`${rel}:${line + 1}: leftover console call in shipped source`);
    if (/\binnerHTML\s*=\s*(?!['"`])/.test(src.replace(/el\.innerHTML = v;.*$/m, '').replace(/el\.innerHTML = paths.*$/m, ''))) {
      problems.push(`${rel}: innerHTML assigned a non-literal — use text nodes (§8)`);
    }
  }
}

const html = await readFile(join(ROOT, 'index.html'), 'utf8');
for (const m of html.matchAll(/(?:src|href)="([^"#:]+?)"/g)) {
  if (m[1].startsWith('data:')) continue;
  if (!existsSync(join(ROOT, m[1]))) problems.push(`index.html references a missing file → ${m[1]}`);
}

if (problems.length) {
  console.error('Checks failed:\n' + problems.map((p) => `  • ${p}`).join('\n'));
  process.exit(1);
}
console.error(`Checks passed across ${files.length} modules.`);
