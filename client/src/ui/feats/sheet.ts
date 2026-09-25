// The Achievements sheet: every feat on the list, grouped the way the building is (the house, the
// tables, the machines, the online lounge), earned or not, with what each pays. Challenges show
// how far along they are. The title you wear under your name is picked here too.
//
// It opens straight away from what the profile knows (the feats earned) and fills in the progress
// bars once GET /feats answers; progress made at a table you're still sitting at reaches D1 now
// and then (server/src/feats.ts), so a bar can trail the table by a couple of minutes.

import './feats.css';
import type { GameId } from '../../../../shared/src/engine.ts';
import { FEATS, FEAT_GAMES, featOf, tallyValue, type Feat, type FeatsResponse } from '../../../../shared/src/feats.ts';
import type { Look } from '../../../../shared/src/look.ts';
import { el, toast } from '../kit.ts';
import type { Closable, SessionLike } from '../menu/deps.ts';
import { openSheet } from '../menu/sheet.ts';
import { problemText } from '../menu/parts.ts';
import { medal } from './icons.ts';
import { cashNote, dollars, earnedOn, featGroups, paidNote, progressOf, rewardParts, titleText, type FeatGroup } from './lines.ts';

export interface FeatsApi {
  feats(): Promise<FeatsResponse>;
  saveLook(look: Look): Promise<Look>;
}

export interface FeatsSheetDeps {
  root: HTMLElement;
  api: FeatsApi;
  session: SessionLike;
  /** Open at this game's feats (the table you're at); the house's otherwise. */
  game?: GameId | null;
  onClose?(): void;
}

export interface FeatsSheet extends Closable {
  /** A feat just earned: lit where it stands in the list. */
  earned(feat: string, at: number, paid?: number): void;
}

export function openFeats(deps: FeatsSheetDeps): FeatsSheet {
  const { session, api } = deps;
  let alive = true;
  let off = () => {};
  const sheet = openSheet(deps.root, {
    title: 'Achievements',
    subtitle: 'Each one is earned once and paid once. Challenges fill as you win.',
    cls: 'feats-sheet',
    onClose: () => {
      alive = false;
      off();
      deps.onClose?.();
    },
  });

  const groups = featGroups();
  // at a table, its game's; otherwise today's challenges
  let current: FeatGroup = groups.find((g) => g.id === deps.game) ?? groups[0]!;
  const earned = new Map<string, number>((session.profile?.feats ?? []).map((f) => [f.feat, f.at]));
  /** The cash each earned feat paid, where the server has said. */
  const paidOf = new Map<string, number>((session.profile?.feats ?? []).flatMap((f) => (f.paid !== undefined ? [[f.feat, f.paid] as [string, number]] : [])));
  let tally: Record<string, number> | null = null;
  let problem: string | null = null;

  // --- the summary strip and the title picker --------------------------------------------------

  const summary = el('div', 'stats ft-stats');
  const tile = (label: string) => {
    const t = el('div', 'stat');
    const v = el('div', 'stat-value money');
    t.append(el('div', 'stat-label', label), v);
    summary.append(t);
    return v;
  };
  const sEarned = tile('Earned');
  const sPaid = tile('Paid out');
  const sWon = tile('Won in all');
  const sGames = tile('Games won at');

  const titleRow = el('div', 'ft-titles');
  const titleLabel = el('div', 'field-label', 'Title under your name');
  const titleChoices = el('div', 'seg ft-title-seg');
  titleChoices.setAttribute('role', 'radiogroup');
  titleChoices.setAttribute('aria-label', 'Title under your name');
  const titleNote = el('p', 'quiet ft-title-note');
  titleRow.append(titleLabel, titleChoices, titleNote);
  let saving = false;

  const wear = async (id: string | null) => {
    const p = session.profile;
    if (!p || saving) return;
    saving = true;
    paintTitles();
    try {
      const next: Look = { ...p.look };
      if (id) next.title = id;
      else delete next.title;
      const stored = await api.saveLook(next);
      const now = session.profile;
      if (now) session.set({ ...now, look: stored });
    } catch (err) {
      toast(problemText(err), 'err');
    } finally {
      saving = false;
      paintTitles();
    }
  };

  function paintTitles(): void {
    const mine = FEATS.filter((f) => f.reward.title && earned.has(f.id));
    const wearing = session.profile?.look.title ?? null;
    titleChoices.replaceChildren();
    titleChoices.hidden = mine.length === 0;
    if (mine.length === 0) {
      const some = FEATS.filter((f) => f.reward.title).slice(0, 4).map((f) => f.reward.title);
      titleNote.textContent = `Some feats come with a title to wear: ${some.join(', ')} and more.`;
      titleNote.hidden = false;
      return;
    }
    titleNote.hidden = true;
    const choice = (label: string, id: string | null) => {
      const b = el('button', 'seg-btn', label);
      b.type = 'button';
      b.setAttribute('role', 'radio');
      const on = (id ?? null) === (wearing && earned.has(wearing) ? wearing : null);
      b.setAttribute('aria-checked', String(on));
      b.classList.toggle('on', on);
      b.disabled = saving;
      b.addEventListener('click', () => void (on ? null : wear(id)));
      titleChoices.append(b);
    };
    choice('None', null);
    for (const f of mine) choice(f.reward.title!, f.id);
  }

  // --- the rail: every group, with how many are earned ------------------------------------------

  const main = el('div', 'ft-main');
  const rail = el('nav', 'ft-rail');
  rail.setAttribute('aria-label', 'Games');
  const list = el('section', 'ft-list');
  list.setAttribute('aria-live', 'polite');
  main.append(rail, list);
  const railButtons = new Map<string, { b: HTMLButtonElement; n: HTMLElement }>();

  let part = '';
  for (const g of groups) {
    if (g.part !== part) {
      part = g.part;
      rail.append(el('div', 'ft-rail-head', part));
    }
    const b = el('button', 'ft-rail-btn');
    b.type = 'button';
    const n = el('span', 'ft-rail-n money');
    b.append(el('span', 'ft-rail-name', g.name), n);
    b.addEventListener('click', () => select(g));
    rail.append(b);
    railButtons.set(g.id, { b, n });
  }
  // Up and down walk the rail, like a list.
  rail.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const i = groups.indexOf(current);
    const next = groups[Math.max(0, Math.min(groups.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))]!;
    select(next);
    railButtons.get(next.id)?.b.focus();
  });

  function select(g: FeatGroup): void {
    current = g;
    paintRail();
    paintList();
    list.scrollTop = 0;
  }

  function paintRail(): void {
    for (const g of groups) {
      const r = railButtons.get(g.id)!;
      const have = g.feats.filter((f) => earned.has(f.id)).length;
      r.n.textContent = `${have}/${g.feats.length}`;
      r.b.classList.toggle('done', have === g.feats.length);
      const on = g === current;
      r.b.classList.toggle('on', on);
      r.b.setAttribute('aria-current', String(on));
    }
  }

  // --- the list ---------------------------------------------------------------------------------

  function row(f: Feat): HTMLElement {
    const at = earned.get(f.id);
    const got = at !== undefined;
    const prog = !got && tally ? progressOf(f, tally) : null;
    const r = el('article', `ft-row ${got ? 'earned' : 'locked'}`);
    r.dataset.feat = f.id;
    r.append(medal(got, prog?.k ?? 0));
    const text = el('div', 'ft-text');
    const top = el('div', 'ft-top');
    top.append(el('h4', 'ft-name', f.name), el('span', 'ft-kind', f.daily ? 'Daily' : f.kind === 'challenge' ? 'Challenge' : 'Achievement'));
    text.append(top, el('p', 'ft-about', f.about));
    if (f.kind === 'challenge' && !got) {
      const bar = el('div', 'ft-bar');
      const fill = el('i');
      fill.style.width = `${Math.round((prog?.k ?? 0) * 1000) / 10}%`;
      bar.append(fill);
      const note = el('div', 'ft-prog money', prog ? prog.text : problem ? '' : 'Counting…');
      text.append(bar, note);
    }
    const side = el('div', 'ft-side');
    const rewards = el('ul', 'ft-rewards');
    for (const p of rewardParts(f)) rewards.append(el('li', `ft-reward ${p.kind}`, p.text));
    side.append(rewards);
    if (got) {
      const short = paidNote(f, paidOf.get(f.id));
      side.append(el('div', 'ft-when', short ? `Earned ${earnedOn(at)} · ${short}` : `Earned ${earnedOn(at)}`));
    } else {
      // how the cash is worked out, and what a minimum stake unlocks
      const note = cashNote(f);
      if (note) text.append(el('p', 'ft-cash', note));
      if (f.minStake) text.append(el('p', 'ft-cash', `Counts on a round staking ${dollars(f.minStake)} or more.`));
    }
    r.append(text, side);
    return r;
  }

  function paintList(): void {
    const g = current;
    const head = el('header', 'ft-head');
    const have = g.feats.filter((f) => earned.has(f.id)).length;
    const titles = el('div', 'ft-head-titles');
    titles.append(el('h3', 'ft-group', g.name), el('div', 'ft-count', `${have} of ${g.feats.length} earned`));
    head.append(titles);
    if (g.id === 'today') head.append(el('div', 'ft-won no', 'New at midnight, Las Vegas time'));
    // a game: whether it counts toward Champion yet
    else if (g.id !== 'house' && tally) {
      const won = (tally[`wins:${g.id}`] ?? 0) > 0;
      head.append(el('div', `ft-won ${won ? 'yes' : 'no'}`, won ? 'Won here' : 'No win here yet'));
    }
    const rows = el('div', 'ft-rows');
    // achievements first, then the amount challenges; the list's own order within each
    const sorted = [...g.feats].sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'achievement' ? -1 : 1));
    for (const f of sorted) rows.append(row(f));
    const nodes: HTMLElement[] = [head, rows];
    if (problem) nodes.push(el('p', 'quiet ft-problem', `Progress isn't showing: ${problem}`));
    list.replaceChildren(...nodes);
  }

  function paintSummary(): void {
    // the list's feats; a day's challenges come and go
    sEarned.textContent = `${FEATS.filter((f) => earned.has(f.id)).length} of ${FEATS.length}`;
    let paid = 0;
    for (const id of earned.keys()) paid += featOf(id)?.reward.cash ?? 0;
    sPaid.textContent = dollars(paid);
    sWon.textContent = tally ? dollars(tally.won ?? 0) : '…';
    sGames.textContent = tally ? `${tallyValue(tally, 'games')} of ${FEAT_GAMES.length}` : '…';
  }

  function paint(): void {
    paintSummary();
    paintTitles();
    paintRail();
    paintList();
  }

  sheet.body.append(summary, titleRow, main);
  paint();
  // the list opens where you are
  queueMicrotask(() => railButtons.get(current.id)?.b.scrollIntoView({ block: 'nearest' }));

  api.feats().then(
    (r) => {
      if (!alive) return;
      tally = r.tally;
      for (const f of r.feats) {
        if (!featOf(f.feat)) continue;
        earned.set(f.feat, f.at);
        if (f.paid !== undefined) paidOf.set(f.feat, f.paid);
      }
      paint();
    },
    (err: unknown) => {
      if (!alive) return;
      problem = problemText(err);
      paint();
    },
  );
  off = session.on(() => paintTitles());

  return {
    root: sheet.root,
    earned(feat, at, paid) {
      if (!featOf(feat) || earned.has(feat)) return;
      earned.set(feat, at);
      if (paid !== undefined) paidOf.set(feat, paid);
      paint();
      list.querySelector<HTMLElement>(`[data-feat="${feat}"]`)?.classList.add('fresh');
    },
    close: () => sheet.close(),
  };
}

/** The title's words for a look (for the HUD and the name tags), or null. */
export { titleText };
