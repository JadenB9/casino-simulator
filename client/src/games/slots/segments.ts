// What a seven-segment meter shows for an amount: dollars and cents right-aligned in `digits`
// places ("!" is DSEG's blank), over dim "8" ghosts. An amount too big for dollars and cents
// (a high-limit bet, a win in the millions) drops the cents and uses every place for dollars,
// the way a real meter at a $1,000 machine counts whole dollars; never the wrong digits.

export function segText(amountCents: number, digits: number): { text: string; ghost: string } {
  const cents = Math.max(0, Math.round(amountCents));
  const s = (cents / 100).toFixed(2);
  const intDigits = digits - 2;
  const [i, f] = s.split('.') as [string, string];
  if (i.length <= intDigits) return { text: `${i.padStart(intDigits, '!')}.${f}`, ghost: `${'8'.repeat(intDigits)}.88` };
  const whole = String(Math.floor(cents / 100));
  return { text: whole.length <= digits ? whole.padStart(digits, '!') : '9'.repeat(digits), ghost: '8'.repeat(digits) };
}
