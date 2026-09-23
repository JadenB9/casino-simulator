// The username rule, shared so the login form and the server agree to the character.
//
// There is no password on purpose: typing a name logs into that account, whoever you are.
// It's play money.

export const NAME_RE = /^[A-Za-z0-9_]{3,16}$/;

export function isValidName(name: unknown): name is string {
  return typeof name === 'string' && NAME_RE.test(name);
}

/** Why a name is refused, for the login form; null when it's fine. */
export function nameProblem(name: string): string | null {
  if (name.length < 3) return 'At least 3 characters.';
  if (name.length > 16) return 'At most 16 characters.';
  if (!NAME_RE.test(name)) return 'Letters, numbers and _ only.';
  return null;
}
