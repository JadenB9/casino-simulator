#!/usr/bin/env node
// Import the chosen third-party assets from a local staging folder into client/public, and write
// docs/CREDITS.md from the same list. Everything shipped is CC0 or SIL OFL; see CREDITS.md.
//
//   node scripts/assets.mjs <staging folder>
//
// The staging folder holds the original downloads (not in this repo). Outputs are committed, so
// the game builds without it.

import { copyFileSync, mkdirSync, readdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { execFileSync } from 'node:child_process';
import ffmpeg from 'ffmpeg-static';

const stage = process.argv[2];
if (!stage || !existsSync(stage)) {
  console.error('usage: node scripts/assets.mjs <staging folder>');
  process.exit(1);
}
const out = 'client/public';
const credits = [];
const mk = (d) => mkdirSync(d, { recursive: true });

// --- cards: RevK's public-domain SVG deck, large index, poker size --------------------------
{
  const src = join(stage, 'revk-cards/RECOMMENDED_poker_large-index_diamond-back');
  const dst = join(out, 'assets/cards');
  mk(dst);
  let n = 0;
  for (const f of readdirSync(src)) {
    const m = f.match(/^([2-9TJQKA])([SHDC])\.svg$/);
    if (m) {
      copyFileSync(join(src, f), join(dst, `${m[1]}${m[2].toLowerCase()}.svg`));
      n++;
    }
  }
  copyFileSync(join(src, '1B.svg'), join(dst, 'back-blue.svg'));
  copyFileSync(join(src, '2B.svg'), join(dst, 'back-red.svg'));
  credits.push({ what: `Playing cards (${n} faces + 2 backs)`, file: 'assets/cards/', author: 'Adrian Kennard (RevK)', license: 'CC0 / public domain', url: 'https://www.me.uk/cards/' });
}

// --- fonts (SIL OFL 1.1, shipped whole with their licences) -----------------------------------
const FONTS = [
  ['barlowcondensed', 'Barlow Condensed', 'Jeremy Tribby'],
  ['cinzel', 'Cinzel', 'Natanael Gama'],
  ['dseg', 'DSEG7 Classic', 'Keshikan'],
  ['limelight', 'Limelight', 'Nicole Fally / Sorkin Type'],
  ['tiltneon', 'Tilt Neon', 'Andy Clymer'],
];
for (const [dir, family, author] of FONTS) {
  const src = join(stage, 'fonts', dir);
  const dst = join(out, 'fonts', dir);
  mk(dst);
  for (const f of readdirSync(src)) if (/\.(woff2|txt)$/i.test(f)) copyFileSync(join(src, f), join(dst, f));
  credits.push({ what: `${family} font`, file: `fonts/${dir}/`, author, license: 'SIL Open Font License 1.1', url: 'https://fonts.google.com/' });
}

// --- sounds: Kenney packs (CC0), Ogg -> MP3 so Safari plays them everywhere -------------------
const SFX = {
  'card-deal': ['kenney-casino-audio', /^card-slide-[1-4]\.ogg$/],
  'card-place': ['kenney-casino-audio', /^card-place-[1-4]\.ogg$/],
  'card-flip': ['kenney-casino-audio', /^card-shove-[1-3]\.ogg$/],
  'card-shuffle': ['kenney-casino-audio', /^card-shuffle\.ogg$/],
  'chip-lay': ['kenney-casino-audio', /^chip-lay-[1-3]\.ogg$/],
  'chips-stack': ['kenney-casino-audio', /^chips-stack-[1-4]\.ogg$/],
  'chips-collide': ['kenney-casino-audio', /^chips-collide-[1-3]\.ogg$/],
  'chips-handle': ['kenney-casino-audio', /^chips-handle-[1-3]\.ogg$/],
  'dice-shake': ['kenney-casino-audio', /^dice-shake-[1-2]\.ogg$/],
  'dice-throw': ['kenney-casino-audio', /^dice-throw-[1-3]\.ogg$/],
  'ui-click': ['kenney-ui-audio', /^click[1-3]\.ogg$/],
  'ui-switch': ['kenney-ui-audio', /^switch[1-3]\.ogg$/],
};
const sfxOut = join(out, 'assets/sfx');
mk(sfxOut);
const manifest = {};
for (const [name, [pack, re]] of Object.entries(SFX)) {
  const src = join(stage, pack, 'Audio');
  const files = existsSync(src) ? readdirSync(src).filter((f) => re.test(f)).sort() : [];
  manifest[name] = [];
  files.forEach((f, i) => {
    const target = `${name}-${i + 1}.mp3`;
    execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-i', join(src, f), '-ac', '1', '-codec:a', 'libmp3lame', '-q:a', '5', join(sfxOut, target)]);
    manifest[name].push(target);
  });
}
writeFileSync(join(sfxOut, 'sfx.json'), JSON.stringify(manifest, null, 1) + '\n');
credits.push({ what: 'Casino and UI sound effects', file: 'assets/sfx/', author: 'Kenney (kenney.nl)', license: 'CC0 1.0', url: 'https://kenney.nl/assets/casino-audio' });

// The world's models and textures come from scripts/assets-world.mjs, which leaves its own list.
const worldCredits = join(out, 'assets/models/credits.json');
if (existsSync(worldCredits)) {
  for (const c of JSON.parse(readFileSync(worldCredits, 'utf8'))) {
    const file = join('assets/models', c.file).replace(/\\/g, '/');
    const what = basename(c.file).replace(/\.(glb|webp)$/, '').replace(/^char-([mf])-/, (_, b) => `Character (${b === 'm' ? 'men' : 'women'}): `).replace(/-/g, ' ');
    credits.push({ what, file, author: c.author, license: c.license, url: c.url });
  }
}

// --- CREDITS.md ---------------------------------------------------------------------------
const lines = [
  '# Credits',
  '',
  'Everything in this game that wasn\'t written for it, with its licence. Code is MIT (see LICENSE).',
  'Anything not listed here (chips, tables, the roulette wheel, slot machines, felt layouts, the',
  'carpet, neon signs) is drawn in code in this repo.',
  '',
  '| What | Where | By | Licence | Source |',
  '|---|---|---|---|---|',
  ...credits.map((c) => `| ${c.what} | \`${c.file}\` | ${c.author} | ${c.license} | ${c.url} |`),
  '',
];
writeFileSync('docs/CREDITS.md', lines.join('\n'));
console.log(`assets: ${credits.length} credit lines; sfx: ${Object.values(manifest).flat().length} files`);
