// The password rule, shared so the login form and the server agree to the character.
//
// A password is what keeps a name yours. Names are first come, first served: the first login
// with a name sets its password, and every login after that has to bring it. Any characters
// count, spaces included, and they are counted the way a person counts them (so an accented
// letter is one character however the keyboard typed it).

export const PASSWORD_MIN = 4;
export const PASSWORD_MAX = 64;

/** The form the server hashes: NFC, so the same password typed two ways hashes the same. */
export function normalizePassword(password: string): string {
  return password.normalize('NFC');
}

function characters(password: string): number {
  return [...normalizePassword(password)].length;
}

export function isValidPassword(password: unknown): password is string {
  return typeof password === 'string' && passwordProblem(password) === null;
}

/** Why a password is refused, for the login form; null when it's fine. */
export function passwordProblem(password: string): string | null {
  const n = characters(password);
  if (n < PASSWORD_MIN) return `At least ${PASSWORD_MIN} characters.`;
  if (n > PASSWORD_MAX) return `At most ${PASSWORD_MAX} characters.`;
  return null;
}
