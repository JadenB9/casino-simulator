# Security review (v6.1)

What was checked before v6.1 ships, what was found, and the test that holds each result. The
money paths themselves (odds, cheese, idempotency, races) were audited separately in
[ODDS-AUDIT.md](ODDS-AUDIT.md) and are only referred to here. Tests named `sec61` are in
`server/test/sec61.test.ts`; the rest are the existing suites.

Scope: this repo's full history and working tree, the site repo's (j4den) history and the build
output it holds, the Worker and both Durable Objects (`server/src/**`), the client's production
bundle, and `/casino/*` headers. Attacks were run against a local dev stack. The live site got only
read-only checks: headers, CORS preflights, socket upgrades from another origin, and unauthenticated
requests to the dev routes.

## Findings

| # | Severity | Finding | Status |
|---|---|---|---|
| 1 | Medium | The production bundle kept the dev pages: `j4den.com/casino/?dev=table&game=bj` ran the table harness, which logs in as a throwaway `dev_xxxxxx` name with the public dev password. That made real accounts with $50,000 each (up to the sign-up limit), and anyone could log into accounts made that way. `?dev=floor` shipped the dev floor too. | **Fixed.** `client/src/main.ts` reads `?dev=` only when `import.meta.env.DEV`, so production builds drop both harnesses (checked in `dist/`) |
| 2 | Medium | A Worker entry that exports anything besides handlers and classes fails to start in workerd, even though vitest accepts it. This review's first version of the request limit exported two numbers from `server/src/index.ts`, and the dev stack refused to boot. It would have taken the casino down on deploy. | **Fixed** before it left the branch. The numbers live in `ratelimit.ts`, and `sec61` "the Worker's entry exports only its handler..." now fails on any stray export |
| 3 | Low | `readJson` checked `Content-Length` and then buffered the whole body. A chunked body with no length was read to the end (up to 100 MB) before its size was checked. | **Fixed.** The body is streamed and reading stops at the limit (`sec61` "a body with no length...", "a login with an endless body...") |
| 4 | Low | A connection's first position placed the player anywhere in the zone, so reconnecting was a jump across the floor: straight to a gift box ($1,000-$5,000, first to arrive) or a celebrity. | **Fixed.** The floor remembers where each account last stood (`last_pos`). A first position must be where hello put you, or a walk at the speed limit from there since then. Anything else puts you back and sends `tp` (`sec61` "a reconnect can't place you across the room..."). An account's very first placement is still unchecked, so existing tests and a deploy's mass reconnect keep working |
| 5 | Low | `invite.take` with the inviter gone from the casino placed the invitee anywhere they asked. A friend could invite you and then leave, turning the invite into a jump. | **Fixed.** With nobody to stand beside, you stay where you are (or arrive at the casino's elevator doors from another zone) (`sec61` two tests) |
| 6 | Low | Signed-in GETs (`/me`, `/bank`, `/bank/statement`, `/shop`, `/feats`, `/stats`, `/daily`, `/leaderboard`) and `bank/seen` had no limit. Each call is several D1 queries, and `/me` also asks tables. | **Fixed.** Every signed-in request now takes from a per-account bucket: 60 in a burst, then 10 a second, per isolate (`sec61` "signed-in requests...") |
| 7 | Low | The floor capped total connections (150) but not per address, so one person with a pile of accounts could fill the casino. | **Fixed.** At most 20 floor connections per address (/64 for IPv6); a second tab of an account already here doesn't count (`sec61` "one address holds at most 20...") |
| 8 | Low | A missing `CASINO_TOKEN_SECRET` would have signed tokens, tickets and the market's walk with an empty key (`TextEncoder().encode(undefined)` is empty). | **Fixed.** No secret now throws: logins return 500 and nothing is signed (`sec61` "without its token secret...") |
| 9 | Info | Two local branches, `v6/pigs6` (f55099e) and `backup/pre-nm-rewrite`, contain commit c570a10. It commits `node_modules` as a symlink whose target is the home-directory path. Neither is on GitHub, and main already has the rewritten work. | **Resolved.** The orchestrator deleted both branches and filter-branch's `refs/original`, expired the reflog and ran gc; c570a10 no longer exists in the repo |
| 10 | Info | `fair.test.ts` failed now and then: the check's picture is base64 that sometimes spells RED or GOLD, which the "answer never leaks" assertion matched. | **Fixed:** the assertion leaves the picture out |
| 11 | Info | The pit boss sees only players on the floor. A script playing through a table socket with no floor socket is never "seen" (`law.hot` returns `unseen`). | Left for law6 or the owner. Honest clients always have the floor open, so the only effect is on scripts |
| 12 | Info | Passwords can be 4 characters. Per-name lockouts cap guessing at 60 tries per 15 minutes from any number of addresses, which is still about 5,700 a day against one name. | Owner decision (see below) |

Nothing else turned up. The rest of this file is what was checked.

## 1. Repo safety

| Check | Result | How |
|---|---|---|
| Secrets in either repo's history (private keys, AWS/GitHub/Slack/`sk-` tokens, JWTs, `SECRET=`/`TOKEN=`/`PASSWORD=` assignments, `.dev.vars`, `.env`, `.pem`, `.key`, `.map`) | **Clean.** Every blob reachable from every ref of both repos was scanned (3,929 in casino-simulator, 1,128 in j4den). The only hit is the tests' `TOKEN_SECRET: 'test-secret-not-for-production'` | a blob scanner over `git rev-list --all --objects` |
| Private details (home paths, Tailscale addresses, the school domain and the other `.planning/privacy-patterns.txt` patterns) in casino-simulator | **Clean** on `main` and `origin/main`, history included; `npm run privacy` passes. The only hit anywhere was finding 9 (local branches only, since deleted) | same scanner, plus `npm run privacy` |
| Authorship | All 584 commits on `origin/main` are `JadenB9 <jadenb9944@gmail.com>` with no tool trailers | `git log` |
| j4den | Its public pages carry the owner's school email and resume on purpose (a personal site). Its Turnstile keys in HTML are site keys, which are public by design. No secrets in its history | scanner |
| `.dev.vars`, `.env*`, `dist/`, `.wrangler/` | Ignored in both repos; never committed | `.gitignore`, history scan |
| Build output | The client has no source maps. The Worker bundle's `.map` (it holds home paths) stays in `dist/`: `scripts/build.mjs` copies only `index.js` to j4den, and `/casino/assets/*.map` returns 404 live. `workers/casino/index.js` ends in a `sourceMappingURL` comment pointing at a file that isn't there, which is harmless | `npm run build` then `npm run privacy -- dist`, a live request |
| Dev switches | `CASINO_DEV` is set only in `server/wrangler.toml` (dev and tests). `j4den/workers/casino/wrangler.toml` has only `ALLOWED_ORIGINS` (`https://j4den.com,https://www.j4den.com`) and bindings. `workers_dev = false` | read |
| Dev routes | Every `/api/dev/*` route and the High Card fixture check `CASINO_DEV === '1'`. Live, they answer 401 before routing without a token | `sec61` "answers every dev route with 404...", "won't open the test fixture game"; live curl |
| `window.casino` in production | Exposes the engine, world, app and session. It can do only what the page itself can do; everything that moves money, items, emotes, feats, titles, cars, statues or jail is decided on the server (sections 2 and 3) | read |
| CI | j4den's `deploy-casino.yml` runs on push to main only, with `contents: read` and a pinned wrangler. casino-simulator has no CI; its pre-push hook runs the privacy scan | read |

## 2. Server and API

### Authentication and tokens

- Passwords: PBKDF2-HMAC-SHA256, 100,000 iterations (the runtime's maximum), a 16-byte random
  salt per account, constant-time compare. Hashes never leave the Worker (`auth.test`).
- Tokens: `v2.<payload>.<HMAC-SHA256>`, 30 days, checked for signature, version, a safe-integer
  account id and expiry. They are refused when forged, tampered, expired, signed with another
  secret, or for a deleted account (`accounts.test`, `security.test` "tokens").
- Sockets never carry the token. They use a `k1` ticket that lasts 60 seconds, is bound to one path,
  and is spent once in the target object's SQLite, so a restart doesn't forget it. Tokens and
  tickets can't stand in for each other (`tickets.test`).
- The Durable Objects trust only the `x-casino-*` headers the Worker sets on a fresh request
  (`forward()`). Clients can't reach the objects directly.
- The market's HMAC walk uses a key derived from the secret (`"casino-market"`), so its outputs say
  nothing about the token key.
- A missing secret fails closed (finding 8).

### Rate limits

| Route or message | Limit | Where |
|---|---|---|
| login | 30 a minute per address; 20 misses per 15 minutes per address and 60 per name; 10 new accounts an hour per address (/64 for IPv6) | D1 `casino_rate` (`accounts.test`, `security.test`) |
| every signed-in request | 60 burst, then 10 a second, per account | new, `sec61` |
| look | 20 a minute | D1 |
| loan | 10 a minute | D1 |
| socket tickets | 30 burst, then 1 a second | memory |
| new lobbies, joins by PIN | per account and per address (`directory.ts`) | floor SQLite |
| wrong PINs | 5 per account and per address, 30 per PIN across everyone, 10-minute lock | table SQLite (`security.test`) |
| shop, bar, effects | 20 a minute each | D1 |
| bank moves | 30 a minute; sends 10 a minute | D1 |
| daily claim | 20 a minute | D1 |
| valet | 6 a minute | D1 |
| fair check | 20 a minute, plus a growing wait after each miss | D1 |
| celebrity word, gift box | 3 burst, then one every 2 seconds | floor memory |
| invites | 6 a minute and 40 an hour per sender, 1 per pair per 45 seconds, 6 a minute per target, "everyone" once per 3 minutes, 10 joins a minute | floor SQLite |
| punches | one per 650 ms, and the floor's misc bucket | floor |
| floor frames | 60 burst at 30 a second; moves 30/16; misc 10/4; emotes 3/0.5; 200 strikes and the socket closes | floor memory (`security.test` "floods") |
| table frames | 60 burst at 30 a second; actions 24/12; money 3/1; misc 8/4; 40 strikes | table memory |
| chat | 3 lines, then 1 a second per account per room; mutes that double, stored | `chat.test` |
| connections | floor 10 burst, then 1 per 3 seconds per account, 60/2 per address, 150 total and **20 per address** (new); tables 10 burst, then 1 per 3 seconds per account | `security.test`, `sec61` |

### Input validation

- Every HTTP body goes through `readJson` with a byte cap: 2 KB by default, 1 KB for a look,
  256 bytes for a ticket, 8 KB for a check answer. The body is streamed now (finding 3).
- Amounts are whole cents: `isCents`, greater than 0 and at most `MAX_SAFE_INTEGER / 1000` in the
  bank, and whole dollars at tables. Negative, zero, fractional, huge, string, array, object and
  missing amounts get a 4xx on savings, deposits, fund buys and sends, and nothing moves
  (`sec61` "money amounts...").
- Operation ids match `^[A-Za-z0-9_-]{8,40}$` and are namespaced by account (`shop:<id>:<op>`,
  `bank:<id>:<op>`, ...). One account's op id is a different op for another account
  (`sec61` "...the same op id from someone else is their own op").
- Shop, bar and effect items are looked up in fixed catalogs. `__proto__`, `constructor`,
  wrong case, stray spaces and non-strings are refused (`sec61`).
- Floor and table messages go through `parseFloorMsg`, `parseTableMsg`, `parseSay` and
  `parseCelebMsg` after a frame cap (512 bytes on the floor, 4 KB at tables) and `JSON.parse`.
  Positions are safe integers clamped to the zone (or the jail), yaw is a byte, and seats,
  emotes, zones and invite ids come from fixed sets or patterns. Unknown fields are dropped, and
  unknown kinds are strikes. A forged `grant`, a `cashout` naming another account, an `act`
  claiming a win, and buy-ins of -1000, 0, 10.5, 1e300, "1000", null or 2^60 move no money; the
  socket's account is the one the Worker named (`sec61` "forged table messages...").
- Looks: `parseLook` keeps known keys only, with hex colours, an item of the right kind, an earned
  title, and a held drink that must be your own paid, unexpired order (`wornLook`).
- Names are `^[A-Za-z0-9_]{3,16}$`. Chat and transfer notes go through NFC, lose control, bidi and
  zero-width characters, and are capped.
- SQL: every value is a bound parameter. The few interpolated fragments are constants in code
  (column and index names, merge modes). None comes from a request.

### Authorization

| Attempt | Result | Test |
|---|---|---|
| Act for another account | Every route uses the token's account id, and every socket the ticket's | throughout |
| Close another player's deposit | Refused (`account_id` is in the lookup) | `sec61` |
| Read another's bank, statement or profile | No route takes another account's id; boards are names and numbers | read |
| Another player's solo table | Its name comes from the ticket's account; the table also checks the name ends in `:<account>` | `tickets.test` |
| A private lobby without its PIN | Refused and counted (per account, address and PIN) | `security.test` |
| An invite that isn't yours | `invite_to` names the invitee; the PIN leaves only in `invite.go` | `invites.test` |
| Out of jail | Every table socket and `POST /tables` checks the D1 jail row; presence confines, the lift and invites refuse, and `greet` puts you back | `law.test`, `lift.test` |
| Dev routes in production | 404 | `sec61` |
| Emotes you don't own | Dropped by the floor (the Worker passes owned emotes from D1) | `emotes.test` |
| Worn items or titles you don't own | 403 | `accounts.test`, `feats.test` |
| Valet a car you don't own | 409 | `cars6.test` |

### Money paths

audit6's findings stand (ODDS-AUDIT.md section 2): integer cents everywhere, each op's purchase
row and charge in one D1 batch keyed by op id, retries answered with what landed, and races
refused inside the batch. This review added the cross-account op id and forged-message tests
above.

### DoS

The frame caps and buckets above cover floods; a socket that keeps sending junk is closed. New
limits cover bodies (finding 3), signed-in reads (finding 6) and floor seats per address
(finding 7). The expensive paths all have limits: PBKDF2 on login, `/me`'s reconciles, the loan's
count of every table, fair-check pictures, and lobby creation. The limits kept in memory are per
isolate, which is fine for stopping floods, not for metering. Edge rate limiting (below) is the
real defence against a distributed flood.

### CORS, CSP and headers

- The API returns CORS headers only for `ALLOWED_ORIGINS`. A request with a foreign `Origin` is
  refused with 403, and so is a socket upgrade with a foreign or missing `Origin`. Live: the
  preflight from `https://evil.example` gets no `Access-Control-Allow-*`, a POST gets 403, and an
  upgrade gets 403 with either a foreign or no Origin (`security.test` "CORS", "socket upgrades").
- Tokens travel in `Authorization`, not cookies, so there is no CSRF surface.
- `/casino/*` (j4den `_headers`, live): `default-src 'self'`, and `script-src 'self'` plus the
  Cloudflare beacon and Turnstile, with no `unsafe-inline` or `unsafe-eval`. Also `style-src 'self'`,
  `frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'self'`, `form-action 'none'`,
  `connect-src` limited to the site, api.j4den.com (https and wss), Turnstile and the beacon, HSTS
  (1 year, subdomains, preload), `nosniff`, a referrer policy and a permissions policy.
- Live, `X-Frame-Options` is `SAMEORIGIN` and `Referrer-Policy` is `same-origin`, not the file's
  `DENY` and `strict-origin-when-cross-origin`. A Cloudflare zone setting is rewriting them.
  `frame-ancestors 'none'` wins in every current browser, so it's cosmetic.

### XSS

The client has no `innerHTML`, `insertAdjacentHTML`, `eval` or `new Function`. Chat, names,
titles, transfer notes and invite text are all set with `textContent` through `ui/kit.ts`. The
one image path built from server data is a card name from the engines. The CSP would block inline
script even if some got in.

### Fair check and Turnstile

A challenge is spent by a guarded `UPDATE` before it's judged, so a replay or two racing answers
get `used`. The chip picture's answer stays on the server. A Turnstile token is checked with
`siteverify` using the challenge id as the idempotency key, plus the client's address. Misses back
off exponentially (`fair.test`). `siteverify`'s `hostname` isn't compared with the site. That's
worth adding if the widget is ever shared with other hostnames.

## 3. Attacks run against the dev stack

All in `server/test/sec61.test.ts` (15 tests): dev routes and the fixture game under the
production config; a Worker with no secret; the entry module's exports; endless and oversized
bodies; bad amounts on four bank routes; bad items and op ids on shop, bar and effects; another
account's deposit and a replayed op id; forged table messages; a reconnect jump and a
reconnect a few steps on; an invite jump with the inviter gone, from the casino and from the
roof; 21 floor sockets from one address; and 70 signed-in reads in a burst. The dev stack also ran
these e2e scripts: `smoke.mjs` (the dev harness still works on the dev server), `invite6.mjs`
(GPU=1: every step ok), `city6.mjs` (all passed) and `law6.mjs` (all ok).

## For the owner

1. **Cloudflare rate limiting (WAF).** Add a rule on `api.j4den.com/casino/api/login`, for example
   20 requests a minute per IP with a block of a few minutes. A lighter one on
   `api.j4den.com/casino/*` would help too, for example 300 a minute per IP. The Worker's limits
   are per isolate or cost a D1 write each; an edge rule stops a distributed flood before it
   costs anything.
2. **`CASINO_TOKEN_SECRET`.** Make sure it is at least 32 random bytes
   (`openssl rand -base64 48 | wrangler secret put CASINO_TOKEN_SECRET --name j4den-casino`).
   Rotate it if it was ever short, typed by hand, or pasted anywhere. Rotating logs everyone out
   once, and the Casino Index carries on from its stored prices along a new walk.
3. **Turnstile.** If `TURNSTILE_SITEKEY` and `TURNSTILE_SECRET` are set on the casino Worker,
   restrict the widget's hostnames to `j4den.com` in the dashboard. If they aren't set, the chip
   picture is the check, and a determined bot can solve it.
4. **Passwords.** Consider 8 or more characters for new accounts (finding 12); existing ones can keep
   theirs. Tokens can't be revoked before their 30 days are up, and there is no password change.
   Both would be worth adding if accounts ever hold anything real.
5. **Zone headers.** Optional: find the zone rule that rewrites `X-Frame-Options` and
   `Referrer-Policy` so the live headers match `_headers`.
