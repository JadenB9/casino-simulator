// Keys every table shares.

/**
 * Whether a key picks a chip from the tray: 1-9, and 0 for a tenth. Test the key itself:
 * Number(e.key) turns Space (' ') into 0, which once took Space away from Deal and Spin.
 */
export function isChipKey(key: string): boolean {
  return /^[0-9]$/.test(key);
}
