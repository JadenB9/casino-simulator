// The effects on the real stack (fx6.mjs live): two players in the lobby; A buys effects through
// the shop's POST /shop/fx and the statue through /shop/buy, and B sees each one play: in B's world,
// on B's screen, with the caption naming A. A second disco bought while the first plays is queued
// and shown as next; a page that joins while effects play comes in part way through (the `fxs`
// after its hello). Needs the shop's endpoints (shop6): without them it says so and passes.
// Fixed names fx6_e2e_a and fx6_e2e_b; A's winnings are put straight in the local database as a
// table would pay them, and the statue an earlier run bought is taken back first (refunded, so
// ledger - items - orders = balance still holds).

import { execFileSync } from 'node:child_process';

function sql(command) {
  return execFileSync('node_modules/.bin/wrangler', ['d1', 'execute', 'DB', '--local', '-c', 'server/wrangler.toml', '--json', '--command', command], { stdio: 'pipe', env: { ...process.env, CI: '1' } }).toString();
}

function grant(name, dollars) {
  const cents = dollars * 100;
  const now = Date.now();
  sql(`INSERT INTO casino_ledger (op_id, account_id, kind, amount, table_id, created_at) SELECT 'e2e-win:' || id || ':${now}', id, 'cashout', ${cents}, 'e2e', ${now} FROM casino_accounts WHERE name = '${name}'; UPDATE casino_accounts SET balance = balance + ${cents}, rev = rev + 1 WHERE name = '${name}';`);
}

function balanced(name) {
  const r = JSON.parse(sql(`SELECT
    (SELECT COALESCE(SUM(amount), 0) FROM casino_ledger l JOIN casino_accounts a ON a.id = l.account_id WHERE a.name = '${name}') -
    (SELECT COALESCE(SUM(price), 0) FROM casino_items i JOIN casino_accounts a ON a.id = i.account_id WHERE a.name = '${name}') -
    (SELECT COALESCE(SUM(price), 0) FROM casino_orders o JOIN casino_accounts a ON a.id = o.account_id WHERE a.name = '${name}') AS sum,
    (SELECT balance FROM casino_accounts WHERE name = '${name}') AS balance`))[0].results[0];
  return r.sum === r.balance;
}

function startOver(name) {
  sql(`UPDATE casino_accounts SET balance = balance + (SELECT COALESCE(SUM(price), 0) FROM casino_items WHERE account_id = casino_accounts.id AND item = 'statue') WHERE name = '${name}';
       DELETE FROM casino_items WHERE item = 'statue' AND account_id = (SELECT id FROM casino_accounts WHERE name = '${name}');`);
}

export async function live({ browser, port, out }) {
  let failed = 0;
  const fail = (what) => {
    failed++;
    console.log(`FAIL ${what}`);
  };
  const check = (ok, what) => (ok ? console.log(`ok   ${what}`) : fail(what));

  async function enterAs(name) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
    const p = await ctx.newPage();
    p.setDefaultTimeout(120000);
    const errors = [];
    p.on('console', (m) => m.type() === 'error' && !/favicon|status of 404|status of 409|status of 429/.test(m.text()) && errors.push(m.text()));
    p.on('pageerror', (e) => errors.push(String(e)));
    await p.goto(`http://localhost:${port}/casino/`, { timeout: 180000 });
    await p.waitForSelector('.name-input', { timeout: 180000 });
    await p.fill('.name-input', name);
    if (await p.$('.pass-input')) await p.fill('.pass-input', 'casino-dev');
    await p.click('.enter-btn');
    await p.waitForSelector('.menu-item, .editor-panel.guided', { timeout: 30000 });
    if (await p.$('.editor-panel.guided')) {
      for (let i = 0; i < 3; i++) {
        await p.click('.editor-panel .ed-buttons .btn.primary');
        await p.waitForTimeout(500);
      }
    } else {
      await p.click('.menu-item >> nth=0');
    }
    await p.waitForSelector('.hud', { timeout: 30000 });
    await p.waitForTimeout(1500);
    await p.evaluate(() => {
      window.heard = [];
      window.casino.app.link.subscribe((m) => window.heard.push(m));
    });
    return { p, ctx, errors };
  }

  /** A calls the shop: `route` with `item` and a fresh op; the JSON and the status. */
  const shop = (p, route, item) =>
    p.evaluate(
      async ([route, item]) => {
        const t = sessionStorage.getItem('casino.token');
        const r = await fetch(`/casino/api/${route}`, { method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ item, op: crypto.randomUUID() }) });
        return { status: r.status, body: await r.json().catch(() => null) };
      },
      [route, item],
    );
  const heard = (p, t, fx) => p.evaluate(([t, fx]) => window.heard.filter((m) => m.t === t && (!fx || m.fx === fx)), [t, fx]);
  const active = (p) => p.evaluate(() => window.casino.world.fx.active);
  const caption = (p) => p.evaluate(() => [...document.querySelectorAll('.fx-caption .fx-line')].map((l) => l.textContent));
  const look = (p, pos, at) =>
    p.evaluate(
      ([pos, at]) => {
        const c = window.casino;
        c.world.player.setEnabled(false);
        c.shot = { pos, at };
        if (!c.shotHook) c.shotHook = c.engine.onFrame(() => c.shot && (c.engine.camera.position.set(...c.shot.pos), c.engine.camera.lookAt(...c.shot.at)));
      },
      [pos, at],
    );
  const shot = async (p, name) => {
    await p.waitForTimeout(300);
    await p.screenshot({ path: `${out}/${name}.png` });
    console.log(`     ${out}/${name}.png`);
  };

  try {
    startOver('fx6_e2e_a');
  } catch {
    /* a fresh database */
  }
  const a = await enterAs('fx6_e2e_a');
  const b = await enterAs('fx6_e2e_b');
  try {
    grant('fx6_e2e_a', 1_020_000_000);
    await a.p.evaluate(() => window.casino.world.player.teleport(0.6, 9.2, Math.PI));
    await b.p.evaluate(() => window.casino.world.player.teleport(-0.8, 13.2, Math.PI));
    await a.p.waitForTimeout(1500);
    const probe = await shop(a.p, 'shop/fx', 'fx-confetti');
    if (probe.status === 404) {
      console.log('skip live: this stack has no /shop/fx yet (the shop6 slice)');
      return 0;
    }
    check(probe.status === 200, `A buys the confetti (${probe.status} ${probe.body?.error ?? ''})`);
    await b.p.waitForFunction(() => window.casino.world.fx.active.some((e) => e.fx === 'fx-confetti'), null, { timeout: 10000 }).then(
      () => check(true, 'B plays the confetti'),
      () => fail('B plays the confetti'),
    );
    await look(b.p, [-0.8, 1.8, 13.4], [0.6, 1.8, 9.2]);
    await shot(b.p, 'live-b-confetti');

    for (const fx of ['fx-spotlight', 'fx-sparklers', 'fx-round', 'fx-disco']) {
      const r = await shop(a.p, 'shop/fx', fx);
      check(r.status === 200, `A buys ${fx} (${r.status} ${r.body?.error ?? ''}${r.body?.fx ? `, starts in ${Math.round((r.body.fx.at - Date.now()) / 1000)} s` : ''})`);
    }
    // a second disco in the same room waits for the first
    const second = await shop(a.p, 'shop/fx', 'fx-disco');
    const queued = second.status === 200 && second.body.fx.at > Date.now() + 30_000;
    check(queued, `a second disco is queued behind the first (${second.status}, at +${second.body?.fx ? Math.round((second.body.fx.at - Date.now()) / 1000) : '?'} s)`);
    await b.p.waitForTimeout(6000);
    const shownB = await active(b.p);
    for (const fx of ['fx-spotlight', 'fx-sparklers', 'fx-round', 'fx-disco']) check(shownB.some((e) => e.fx === fx && e.shown), `B sees ${fx}`);
    const lines = await caption(b.p);
    check(lines.some((l) => l.includes('Disco Night') && l.includes('fx6_e2e_a')), `B's caption names A's disco: ${JSON.stringify(lines)}`);
    check(lines.some((l) => l.startsWith('Next')), "B's caption shows the queued disco as next");
    // A holds a flute (drawn, not saved), and so does B, in the same room
    const flutes = await b.p.evaluate(() => [...window.casino.world.characterFactory.people()].filter((p) => p.currentLook.held?.item === 'champagne').length);
    check(flutes >= 2, `the round puts a glass in ${flutes} hands in B's lobby`);
    const saved = await a.p.evaluate(async () => {
      const t = sessionStorage.getItem('casino.token');
      return (await (await fetch('/casino/api/me', { headers: { Authorization: `Bearer ${t}` } })).json()).profile.look.held ?? null;
    });
    check(!saved || saved.item !== 'champagne', "the round's glass is never saved in A's look");
    await look(b.p, [-0.8, 2.0, 13.8], [0.4, 1.6, 7.5]);
    await shot(b.p, 'live-b-lobby-party');
    await look(a.p, [2.2, 2.0, 12.8], [0.6, 1.5, 9.2]);
    await shot(a.p, 'live-a-own');

    // B joins late: a new page gets the list of what's playing and comes in part way through
    await b.ctx.close();
    const c = await enterAs('fx6_e2e_b');
    await c.p.waitForTimeout(2500);
    const late = await active(c.p);
    check(late.some((e) => e.fx === 'fx-disco') && late.some((e) => e.fx === 'fx-spotlight'), `a page joining late plays what's on (${late.map((e) => e.fx).join(', ')})`);
    check((await heard(c.p, 'fxs')).length >= 1, 'it heard the fxs list after its hello');

    // the statue: bought once, in the lobby for everyone
    const st = await shop(a.p, 'shop/buy', 'statue');
    check(st.status === 200, `A buys the statue (${st.status} ${st.body?.error ?? ''})`);
    await c.p.waitForFunction(() => window.casino.world.fx.statues.standing.some((s) => s.name === 'fx6_e2e_a'), null, { timeout: 20000 }).then(
      () => check(true, "A's statue stands in B's lobby"),
      () => fail("A's statue stands in B's lobby"),
    );
    const standing = await c.p.evaluate(() => window.casino.world.fx.statues.standing);
    const s0 = standing.find((s) => s.name === 'fx6_e2e_a');
    if (s0) {
      await look(c.p, [s0.x + Math.sin(s0.yaw) * 3.2, 1.7, s0.z + Math.cos(s0.yaw) * 3.2], [s0.x, 1.9, s0.z]);
      await shot(c.p, 'live-statue');
    }
    check(balanced('fx6_e2e_a'), "A's money adds up after the effects and the statue");
    for (const [who, pg] of [
      ['A', a],
      ['B', c],
    ])
      if (pg.errors.length) fail(`${who} console errors: ${pg.errors.slice(0, 4).join(' | ')}`);
    await c.ctx.close();
  } finally {
    await a.ctx.close();
  }
  return failed;
}
