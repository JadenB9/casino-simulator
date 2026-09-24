// Whether big wins pop up as toasts on the floor. The sign over the pit shows them either way.

const KEY = 'casino.bigwins.toasts';

export function bigWinToasts(): boolean {
  try {
    return localStorage.getItem(KEY) !== '0';
  } catch {
    return true;
  }
}

export function setBigWinToasts(on: boolean): void {
  try {
    localStorage.setItem(KEY, on ? '1' : '0');
  } catch {
    /* blocked: the choice lasts until the page closes */
  }
}
