// The login screen: a name and nothing else. The rule is checked as you type with the same
// function the server uses, and whatever the server says back is shown under the field.

import './menu.css';
import type { Profile } from '../../../../shared/src/protocol.ts';
import { nameProblem } from '../../../../shared/src/names.ts';
import { el } from '../kit.ts';
import type { AccountApi, Closable, SessionLike, SfxLike } from './deps.ts';
import { frontShell } from './front.ts';
import { keycap, problemText } from './parts.ts';

export interface LoginDeps {
  root: HTMLElement;
  api: Pick<AccountApi, 'login' | 'lastName'>;
  session: Pick<SessionLike, 'set'>;
  /** After a successful login; the profile is already in the session. */
  onDone(profile: Profile): void;
  /** Starts the 3D pass behind the screen and returns its stop; without it the screen paints its own. */
  backdrop?: () => (() => void) | void;
  sfx?: Pick<SfxLike, 'play'>;
}

const RULE = '3 to 16 letters, numbers or _';

export function mountLogin(deps: LoginDeps): Closable {
  const shell = frontShell(deps.root, 'front-login', deps.backdrop);
  const last = deps.api.lastName();

  const form = el('form', 'login-form front-rise');
  form.noValidate = true;
  form.setAttribute('aria-label', 'Log in');

  const cont = el('button', 'continue-btn');
  cont.type = 'button';
  const contName = el('span', 'continue-name', last ?? '');
  cont.append(el('span', 'continue-label', 'Continue as'), contName, keycap('Enter'));
  cont.hidden = !last;

  const label = el('label', 'field-label', last ? 'Or another name' : 'Your name');
  label.htmlFor = 'login-name';
  const input = el('input', 'name-input');
  input.id = 'login-name';
  input.type = 'text';
  input.maxLength = 16;
  input.autocomplete = 'username';
  input.spellcheck = false;
  input.setAttribute('autocapitalize', 'off');
  input.setAttribute('aria-describedby', 'login-rule');
  const count = el('span', 'name-count money', '0/16');
  const row = el('div', 'name-row');
  row.append(input, count);
  const rule = el('p', 'name-rule', RULE);
  rule.id = 'login-rule';
  rule.setAttribute('aria-live', 'polite');

  const enter = el('button', 'btn enter-btn');
  enter.type = 'submit';
  enter.append(document.createTextNode('Enter'));

  const note = el('p', 'login-note', "No password: typing a name opens that account. It's play money.");
  form.append(cont, label, row, rule, enter, note);
  shell.col.append(form);

  let busy = false;

  const paint = () => {
    const v = input.value;
    count.textContent = `${v.length}/16`;
    const problem = v ? nameProblem(v) : null;
    rule.classList.remove('err');
    rule.classList.toggle('bad', !!problem);
    rule.classList.toggle('ok', !!v && !problem);
    rule.textContent = problem ?? RULE;
    rule.removeAttribute('role');
    // One primary action at a time: "Continue as" until a new name is typed.
    const typing = v.length > 0;
    cont.classList.toggle('primary', !typing);
    enter.classList.toggle('primary', typing || !last);
    enter.disabled = busy || (typing ? !!problem : !last);
    cont.disabled = busy;
    input.disabled = busy;
  };

  const showError = (msg: string) => {
    rule.classList.remove('ok', 'bad');
    rule.classList.add('err');
    rule.setAttribute('role', 'alert');
    rule.textContent = msg;
  };

  const go = async (name: string) => {
    if (busy) return;
    busy = true;
    enter.firstChild!.textContent = 'Opening';
    shell.root.classList.add('busy');
    paint();
    try {
      const profile = await deps.api.login(name);
      deps.sfx?.play('ui-click', { volume: 0.45 });
      deps.session.set(profile);
      deps.onDone(profile);
    } catch (err) {
      busy = false;
      enter.firstChild!.textContent = 'Enter';
      shell.root.classList.remove('busy');
      paint();
      showError(problemText(err));
      input.focus();
    }
  };

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const v = input.value;
    if (!v) {
      if (last) void go(last);
      else input.focus();
      return;
    }
    const problem = nameProblem(v);
    if (problem) {
      row.classList.remove('shake');
      void row.offsetWidth; // restart the animation
      row.classList.add('shake');
      input.focus();
      return;
    }
    void go(v);
  });
  cont.addEventListener('click', () => last && void go(last));
  input.addEventListener('input', paint);

  paint();
  queueMicrotask(() => input.focus({ preventScroll: true }));

  return {
    root: shell.root,
    close: () => shell.close(),
  };
}
