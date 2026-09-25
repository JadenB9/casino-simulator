// What a seven-segment meter shows for an amount: dollars and cents right-aligned in `digits`
// places ("!" is DSEG's blank), over dim "8" ghosts. An amount too big for dollars and cents
// (a high-limit bet, a win in the millions) drops the cents and uses every place for dollars,
// the way a real meter at a $1,000 machine counts whole dollars; one too big even for that (a
// jackpot of tens of millions) shows all its digits in smaller figures. Never the wrong digits.

const FONT = (px: number) => `700 ${px}px DSEG7, monospace`;

export function segText(amountCents: number, digits: number): { text: string; ghost: string } {
  const cents = Math.max(0, Math.round(amountCents));
  const s = (cents / 100).toFixed(2);
  const intDigits = digits - 2;
  const [i, f] = s.split('.') as [string, string];
  if (i.length <= intDigits) return { text: `${i.padStart(intDigits, '!')}.${f}`, ghost: `${'8'.repeat(intDigits)}.88` };
  const whole = String(Math.floor(cents / 100));
  if (whole.length <= digits) return { text: whole.padStart(digits, '!'), ghost: '8'.repeat(digits) };
  return { text: whole, ghost: '8'.repeat(whole.length) };
}

/**
 * Set `g`'s font for a meter `avail` pixels wide at `px` and say what it shows: as many places as
 * fit the window at full size, smaller figures only for an amount that fits no other way.
 */
export function meterText(g: CanvasRenderingContext2D, amountCents: number, avail: number, px = 58): { text: string; ghost: string } {
  g.font = FONT(px);
  const places = Math.max(4, Math.floor((avail - g.measureText('.').width) / g.measureText('8').width));
  const r = segText(amountCents, places);
  const width = g.measureText(r.ghost).width;
  if (width > avail) g.font = FONT(Math.floor((px * avail) / width));
  return r;
}
