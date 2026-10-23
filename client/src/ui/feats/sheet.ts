// The Achievements sheet: every feat on the list, grouped the way the building is (the house, the
// tables, the machines, the online lounge), earned or not, with what each pays. Challenges show
// how far along they are, each game in the rail how much of it is earned, and today's three when
// they change. Filters show all, the ones still to earn or the ones earned; a search finds a feat
// by its name, its line, its rewards or its game, across every game at once. The title you wear
// under your name is picked here too.
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
import { cashNote, dollars, earnedOn, featGroups, matchesFeat, nextDayIn, paidNote, progressOf, rewardParts, titleText, untilText, type FeatGroup } from './lines.ts';

/** Which feats the list shows: every one, the ones still to earn, or the ones earned. */
type Filter = 'all' | 'todo' | 'done';
const FILTERS: [Filter, string][] = [
  ['all', 'All'],
  ['todo', 'In progress'],
  ['done', 'Earned'],
];

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
  let clockTimer = 0;
  const sheet = openSheet(deps.root, {
    title: 'Achievements',
    subtitle: 'Each one is earned once and paid once. Challenges fill as you win.',
    cls: 'feats-sheet',
    onClose: () => {
      alive = false;
      off();
      clearInterval(clockTimer);
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
  // the share of the whole list earned, as a bar under the count
  const sBar = el('div', 'ft-bar ft-bar-all');
  const sFill = el('i');
  sBar.append(sFill);
  sEarned.parentElement!.append(sBar);
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

  // --- the filters and the search ---------------------------------------------------------------

  let filter: Filter = 'all';
  let query = '';
  const tools = el('div', 'ft-tools');
  const filterSeg = el('div', 'seg ft-filter');
  filterSeg.setAttribute('role', 'radiogroup');
  filterSeg.setAttribute('aria-label', 'Show');
  const filterBtns = FILTERS.map(([id, label]) => {
    const b = el('button', 'seg-btn', label);
    b.type = 'button';
    b.setAttribute('role', 'radio');
    b.addEventListener('click', () => {
      filter = id;
      paintFilter();
      paintList();
    });
    filterSeg.append(b);
    return { id, b };
  });
  const paintFilter = () => {
    for (const { id, b } of filterBtns) {
      b.setAttribute('aria-checked', String(id === filter));
      b.tabIndex = id === filter ? 0 : -1;
    }
  };
  filterSeg.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const i = FILTERS.findIndex(([id]) => id === filter);
    filter = FILTERS[(i + (e.key === 'ArrowRight' ? 1 : FILTERS.length - 1)) % FILTERS.length]![0];
    paintFilter();
    paintList();
    filterBtns.find((x) => x.id === filter)?.b.focus();
  });
  const find = el('label', 'ft-search');
  const findInput = el('input', 'ft-search-input');
  findInput.type = 'search';
  findInput.placeholder = 'Search';
  findInput.autocomplete = 'off';
  findInput.spellcheck = false;
  findInput.maxLength = 40;
  findInput.setAttribute('aria-label', 'Find an achievement by name, reward or game');
  findInput.addEventListener('input', () => {
    query = findInput.value;
    paintRail();
    paintList();
    list.scrollTop = 0;
  });
  find.append(searchIcon(), findInput);
  tools.append(filterSeg, find);

  // --- the rail: every group, with how many are earned ------------------------------------------

  const main = el('div', 'ft-main');
  const rail = el('nav', 'ft-rail');
  rail.setAttribute('aria-label', 'Games');
  const list = el('section', 'ft-list');
  list.setAttribute('aria-live', 'polite');
  main.append(rail, list);
  const railButtons = new Map<string, { b: HTMLButtonElement; n: HTMLElement; fill: HTMLElement }>();

  let part = '';
  for (const g of groups) {
    if (g.part !== part) {
      part = g.part;
      rail.append(el('div', 'ft-rail-head', part));
    }
    const b = el('button', 'ft-rail-btn');
    b.type = 'button';
    const n = el('span', 'ft-rail-n money');
    // how much of the group is earned, as a hairline under its name
    const bar = el('span', 'ft-rail-bar');
    const fill = el('i');
    bar.append(fill);
    b.append(el('span', 'ft-rail-name', g.name), n, bar);
    b.addEventListener('click', () => {
      // picking a game puts a search away: the rail is where you are
      if (query) findInput.value = query = '';
      select(g);
    });
    rail.append(b);
    railButtons.set(g.id, { b, n, fill });
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
      r.fill.style.width = `${g.feats.length ? Math.round((have / g.feats.length) * 1000) / 10 : 0}%`;
      // while searching, no group is the one shown
      const on = g === current && !query;
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

  /** Whether the filter lets a feat through. */
  const shown = (f: Feat) => filter === 'all' || (filter === 'done') === earned.has(f.id);
  /** Achievements first, then the amount challenges; the list's own order within each. */
  const ordered = (feats: Feat[]) => [...feats].sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'achievement' ? -1 : 1));

  function paintList(): void {
    const nodes: HTMLElement[] = [];
    if (query.trim()) {
      // the search: every group's matches, each under its group's name
      const found = groups.map((g) => ({ g, feats: ordered(g.feats.filter((f) => matchesFeat(f, query) && shown(f))) })).filter((x) => x.feats.length > 0);
      const n = found.reduce((a, x) => a + x.feats.length, 0);
      const head = el('header', 'ft-head');
      const titles = el('div', 'ft-head-titles');
      titles.append(el('h3', 'ft-group', 'Search'), el('div', 'ft-count', n === 0 ? `Nothing matches "${query.trim()}"` : `${n} ${n === 1 ? 'match' : 'matches'} for "${query.trim()}"`));
      head.append(titles);
      nodes.push(head);
      for (const { g, feats } of found) {
        const rows = el('div', 'ft-rows');
        rows.append(el('h4', 'ft-sub', g.id === 'today' ? 'Today' : g.name));
        for (const f of feats) rows.append(row(f));
        nodes.push(rows);
      }
    } else {
      const g = current;
      const head = el('header', 'ft-head');
      const have = g.feats.filter((f) => earned.has(f.id)).length;
      const titles = el('div', 'ft-head-titles');
      titles.append(el('h3', 'ft-group', g.name), el('div', 'ft-count', `${have} of ${g.feats.length} earned`));
      head.append(titles);
      if (g.id === 'today') {
        // when the three change, counted down (the clock repaints it)
        const next = el('div', 'ft-won no ft-next', `New in ${untilText(nextDayIn())}`);
        next.title = 'At midnight, Las Vegas time';
        head.append(next);
      }
      // a game: whether it counts toward Champion yet
      else if (g.id !== 'house' && tally) {
        const won = (tally[`wins:${g.id}`] ?? 0) > 0;
        head.append(el('div', `ft-won ${won ? 'yes' : 'no'}`, won ? 'Won here' : 'No win here yet'));
      }
      const rows = el('div', 'ft-rows');
      const feats = ordered(g.feats.filter(shown));
      for (const f of feats) rows.append(row(f));
      nodes.push(head, rows);
      if (feats.length === 0) nodes.push(el('p', 'quiet ft-none', filter === 'done' ? 'None earned here yet.' : 'Every one here is earned.'));
    }
    if (problem) nodes.push(el('p', 'quiet ft-problem', `Progress isn't showing: ${problem}`));
    list.replaceChildren(...nodes);
  }

  function paintSummary(): void {
    // the list's feats; a day's challenges come and go
    const all = FEATS.filter((f) => earned.has(f.id)).length;
    sEarned.textContent = `${all} of ${FEATS.length}`;
    sFill.style.width = `${Math.round((all / FEATS.length) * 1000) / 10}%`;
    let paid = 0;
    // what each paid, as the server says; a feat whose cash doesn't scale paid what it lists
    for (const id of earned.keys()) {
      const f = featOf(id);
      paid += paidOf.get(id) ?? (f && f.odds === undefined && !f.comp ? (f.reward.cash ?? 0) : 0);
    }
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

  sheet.body.append(summary, titleRow, tools, main);
  paintFilter();
  paint();
  // Today's countdown, while the sheet is up
  clockTimer = window.setInterval(() => {
    const next = list.querySelector('.ft-next');
    if (next) next.textContent = `New in ${untilText(nextDayIn())}`;
  }, 30_000);
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

/** The search field's glass (the lobby's, drawn the same way). */
function searchIcon(): SVGSVGElement {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('class', 'ft-search-ico');
  svg.setAttribute('aria-hidden', 'true');
  const ring = document.createElementNS(NS, 'circle');
  ring.setAttribute('cx', '7');
  ring.setAttribute('cy', '7');
  ring.setAttribute('r', '4.3');
  const handle = document.createElementNS(NS, 'path');
  handle.setAttribute('d', 'm10.2 10.2 3.6 3.6');
  svg.append(ring, handle);
  return svg;
}
