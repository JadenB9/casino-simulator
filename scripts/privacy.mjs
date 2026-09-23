#!/usr/bin/env node
// Refuse to publish anything that ties this repo to a machine or a school account: home-directory
// paths, SSH host names, private network addresses, the school email, iCloud conflict copies, or
// tool attribution in commit messages. Runs before every push (.githooks/pre-push) and on demand
// (`npm run privacy`, `npm run privacy -- <dir>` to scan a build output folder too).

import { execSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const PATTERNS = [
  [/\/Users\/[a-z]/i, 'a macOS home path'],
  [/\bC:\\Users\\/i, 'a Windows home path'],
  [/\b100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d{1,3}\.\d{1,3}\b/, 'a private network address'],
];
const COMMIT_PATTERNS = [/co-authored-by/i, /generated with/i];

// Anything specific (host names, an email domain, names of tools) lives in a local file that is
// never committed, one regular expression per line.
try {
  for (const line of readFileSync('.planning/privacy-patterns.txt', 'utf8').split('\n')) {
    const src = line.trim();
    if (!src || src.startsWith('#')) continue;
    PATTERNS.push([new RegExp(src, 'i'), 'a private detail']);
    COMMIT_PATTERNS.push(new RegExp(src, 'i'));
  }
} catch {
  /* no local list on this machine */
}

let problems = 0;
const report = (where, what) => {
  problems++;
  console.error(`privacy: ${where}: ${what}`);
};

const tracked = execSync('git ls-files -z', { encoding: 'utf8' }).split('\0').filter(Boolean);
for (const f of tracked) {
  if (/(^| )2(\.[^/]*)?$/.test(f.split('/').pop())) report(f, 'looks like an iCloud conflict copy');
  scanFile(f);
}
for (const extra of process.argv.slice(2)) walk(extra);

let log = '';
try {
  log = execSync('git log --format=%ae%n%an%n%B%n--END--', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
} catch {
  /* no commits yet */
}
for (const msg of log.split('--END--')) {
  for (const p of COMMIT_PATTERNS) if (p.test(msg)) report('git log', `commit message matches ${p}`);
}

if (problems) {
  console.error(`privacy: ${problems} problem(s); nothing was published.`);
  process.exit(1);
}
console.log('privacy: clean');

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else scanFile(p);
  }
}

function scanFile(f) {
  let text;
  try {
    const buf = readFileSync(f);
    if (buf.includes(0)) return; // binary
    text = buf.toString('utf8');
  } catch {
    return;
  }
  for (const [re, what] of PATTERNS) if (re.test(text)) report(f, what);
}
