// v6 invite6: the invites' row in Settings, built with the sheet's own row helper.

import { el } from '../kit.ts';
import { segmented } from '../menu/parts.ts';
import { doNotDisturb, setDoNotDisturb } from './invite-model.ts';

type Row = (label: string, control: HTMLElement, note?: HTMLElement) => HTMLElement;

export function inviteSettings(row: Row): HTMLElement[] {
  const ctl = segmented<'on' | 'off'>('Invites', [{ id: 'on', label: 'On' }, { id: 'off', label: 'Do not disturb' }], doNotDisturb() ? 'off' : 'on', (v) => setDoNotDisturb(v === 'off'));
  return [row('Invites', ctl.root, el('p', 'set-note', "Players at a table can invite you to join them. Do not disturb stops them; anyone who tries sees you aren't taking invites."))];
}
