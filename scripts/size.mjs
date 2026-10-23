#!/usr/bin/env node
// What the page downloads, and what in it is the weight: builds the client into dist/size with
// source maps, then lists every chunk (minified and gzipped, the entry and three.js first: what
// the page needs to open) and, for the entry, the source folders its bytes come from. Use it
// before and after a change that could grow the first download.
//
//   npm run size               # chunks, and the entry by area (two folders deep)
//   npm run size -- 3 40       # three folders deep, forty lines

import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const [depth = 2, lines = 30] = process.argv.slice(2).map(Number);
const out = join(process.cwd(), 'dist/size');
execFileSync('node_modules/.bin/vite', ['build', '--config', 'client/vite.config.ts', '--sourcemap', '--outDir', out, '--emptyOutDir', '--logLevel', 'error'], { stdio: 'inherit' });

const assets = join(out, 'assets');
const html = readFileSync(join(out, 'index.html'), 'utf8');
// kB of 1,000 bytes, as Vite's own report counts them (its gzip figure runs a percent higher)
const kb = (n) => `${(n / 1000).toFixed(1)} kB`.padStart(10);
const chunks = readdirSync(assets)
  .filter((f) => /\.(js|css)$/.test(f))
  .map((f) => {
    const code = readFileSync(join(assets, f));
    return { f, min: code.length, gz: gzipSync(code).length, first: html.includes(`assets/${f}`) };
  })
  .sort((a, b) => Number(b.first) - Number(a.first) || b.min - a.min);
console.log(`\n${'chunk'.padEnd(40)}${'minified'.padStart(10)}${'gzip'.padStart(10)}`);
for (const c of chunks) console.log(`${(c.first ? '* ' : '  ') + c.f.padEnd(38)}${kb(c.min)}${kb(c.gz)}`);
const first = chunks.filter((c) => c.first);
console.log(`${'* to open the page'.padEnd(40)}${kb(first.reduce((a, c) => a + c.min, 0))}${kb(first.reduce((a, c) => a + c.gz, 0))}`);

// The entry's bytes by source file, from its source map, grouped by folder.
const entry = chunks.find((c) => c.first && c.f.startsWith('index-') && c.f.endsWith('.js'));
if (entry) {
  const code = readFileSync(join(assets, entry.f), 'utf8');
  const map = JSON.parse(readFileSync(join(assets, `${entry.f}.map`), 'utf8'));
  const sizes = attribute(code, map);
  const groups = new Map();
  for (const [src, n] of sizes) {
    const key = src.replace(/^(\.\.\/)+/, '').split('/').slice(0, depth + (src.includes('node_modules') ? 0 : 1)).join('/');
    groups.set(key, (groups.get(key) ?? 0) + n);
  }
  console.log(`\n${entry.f}, by source (minified bytes):`);
  for (const [k, n] of [...groups].sort((a, b) => b[1] - a[1]).slice(0, lines)) console.log(`${kb(n)}  ${k}`);
}

/** Minified bytes per source file: each mapping segment runs to the next one on its line. */
function attribute(code, map) {
  const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const digit = new Map([...B64].map((c, i) => [c, i]));
  const decode = (seg) => {
    const vals = [];
    let shift = 0;
    let value = 0;
    for (const ch of seg) {
      const d = digit.get(ch);
      value += (d & 31) << shift;
      if (d & 32) shift += 5;
      else {
        vals.push(value & 1 ? -(value >>> 1) : value >>> 1);
        value = 0;
        shift = 0;
      }
    }
    return vals;
  };
  const sizes = new Map();
  const codeLines = code.split('\n');
  let src = 0;
  map.mappings.split(';').forEach((line, li) => {
    let col = 0;
    const starts = [];
    for (const seg of line ? line.split(',') : []) {
      const v = decode(seg);
      col += v[0];
      if (v.length >= 4) src += v[1];
      starts.push([col, v.length >= 4 ? map.sources[src] : '(none)']);
    }
    const len = codeLines[li]?.length ?? 0;
    starts.forEach(([c, s], i) => sizes.set(s, (sizes.get(s) ?? 0) + ((starts[i + 1]?.[0] ?? len) - c)));
  });
  return sizes;
}
