// What the floor's staff say: short, varied, no emoji. Each picker takes a number (a counter the
// caller keeps) so lines come round in turn rather than at random, and the same visit reads the
// same in a test.

import { formatMoney, type Cents } from '../../../../shared/src/money.ts';

const pick = (list: readonly string[], n: number) => list[((n % list.length) + list.length) % list.length]!;

/** "Good morning" before noon, "Good afternoon" until five, "Good evening" after (and all night). */
export function timeOfDay(hour: number): 'morning' | 'afternoon' | 'evening' {
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 17) return 'afternoon';
  return 'evening';
}

/** A banker's greeting at the window, by name when there is one. */
export function bankerHello(name: string | null, hour: number, n: number): string {
  const t = timeOfDay(hour);
  if (!name) return pick([`Good ${t}.`, 'Welcome to the cage.', 'What can I do for you?'], n);
  return pick([`Good ${t}, ${name}.`, `Welcome back, ${name}.`, `${name}. What can I do for you?`, `Good ${t}, ${name}. How can I help?`], n);
}

/** Counting out a top-up: the amount, to the cent. */
export function bankerPaid(amount: Cents, n: number): string {
  const m = formatMoney(amount);
  return pick([`Here's your ${m}. Good luck out there.`, `${m}, counted out. Play well.`, `There you are: ${m}. Enjoy the floor.`, `${m} for you. Good luck tonight.`], n);
}

/** The bank said not yet. */
export function bankerRefused(n: number): string {
  return pick(["You're still over the line, I'm afraid.", 'Not yet. Come back under ten thousand.', "The bank can't top you up just now."], n);
}

/** Leaving the window. */
export function bankerBye(n: number): string {
  return pick(['Take care.', 'Good luck out there.', 'Enjoy your night.', 'See you soon.'], n);
}

export function shopHello(name: string | null, hour: number, n: number): string {
  const t = timeOfDay(hour);
  if (!name) return pick([`Good ${t}. Have a look around.`, 'Welcome in. Take your time.'], n);
  return pick([`Good ${t}, ${name}. Have a look around.`, `Welcome in, ${name}.`, `${name}, good to see you. Take your time.`], n);
}

export function shopBye(bought: boolean, n: number): string {
  if (bought) return pick(['Wear it well.', 'It suits you.', 'An excellent choice.'], n);
  return pick(['Come back anytime.', 'Whenever you like.', 'Thank you for stopping by.'], n);
}

/** A waiter asked for a drink (the menu opens). */
export function waiterTakes(n: number): string {
  return pick(['What can I get you?', 'Something to drink?', 'What will it be?', 'Can I bring you anything?'], n);
}

export function waiterBrings(item: string, n: number): string {
  return pick([`Your ${item}.`, `One ${item}. Enjoy.`, `Here you are.`, `${item}, as ordered.`], n);
}

export function waiterNoted(n: number): string {
  return pick(['Coming right up.', 'Right away.', 'Back in a moment.'], n);
}

export function bartenderTakes(n: number): string {
  return pick(["What'll it be?", 'What can I pour you?', 'Evening. What are we having?'], n);
}

export function bartenderServes(item: string, n: number): string {
  return pick([`Your ${item}.`, `There you go. One ${item}.`, 'Enjoy.', `${item}. Cheers.`], n);
}
