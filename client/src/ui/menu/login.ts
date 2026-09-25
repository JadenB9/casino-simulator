// The login screen: a name and its password. Names are first come, first served: a new name
// takes the password it arrives with, and so does a name from before passwords, the first time.
// Both rules are checked as you type with the same functions the server uses, and whatever the
// server says back is shown under the field it is about.

import './menu.css';
import './login.css';
import type { Profile } from '../../../../shared/src/protocol.ts';
import { nameProblem } from '../../../../shared/src/names.ts';
import { PASSWORD_MAX, PASSWORD_MIN, passwordProblem } from '../../../../shared/src/password.ts';
import { el } from '../kit.ts';
import type { AccountApi, Closable, SessionLike, SfxLike } from './deps.ts';
import { frontShell } from './front.ts';
import { keycap, problemText } from './parts.ts';
import { calm, setCalm } from '../../app/comfort.ts';

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

const RULE = '3 to 16 letters, numbers or underscores';
const PASS_RULE = `${PASSWORD_MIN} to ${PASSWORD_MAX} characters`;

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
  input.name = 'username';
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

  const passLabel = el('label', 'field-label pass-label', 'Password');
  passLabel.htmlFor = 'login-pass';
  const pass = el('input', 'pass-input');
  pass.id = 'login-pass';
  pass.name = 'password';
  pass.type = 'password';
  pass.maxLength = PASSWORD_MAX;
  pass.autocomplete = 'current-password';
  pass.spellcheck = false;
  pass.setAttribute('autocapitalize', 'off');
  pass.setAttribute('aria-describedby', 'login-pass-rule');
  const show = el('button', 'pass-show', 'Show');
  show.type = 'button';
  show.setAttribute('aria-controls', 'login-pass');
  show.setAttribute('aria-pressed', 'false');
  show.setAttribute('aria-label', 'Show password');
  const passRow = el('div', 'name-row pass-row');
  passRow.append(pass, show);
  const passRule = el('p', 'name-rule pass-rule', PASS_RULE);
  passRule.id = 'login-pass-rule';
  passRule.setAttribute('aria-live', 'polite');

  const enter = el('button', 'btn enter-btn');
  enter.type = 'submit';
  enter.append(document.createTextNode('Enter'));

  const note = el('p', 'login-note');
  note.append(
    el('span', 'login-note-lead', 'New name? Pick a password and this name is yours.'),
    document.createTextNode(' Played here before passwords? The first one you pick claims your name.'),
  );
  // Before the floor's lights are ever seen: the switch for anyone who needs them steady.
  const steady = el('button', 'calm-switch');
  steady.type = 'button';
  steady.setAttribute('role', 'switch');
  steady.append(el('span', 'calm-box'), document.createTextNode('Reduce flashing & motion'));
  const paintSteady = () => steady.setAttribute('aria-checked', String(calm()));
  steady.addEventListener('click', () => {
    setCalm(!calm());
    paintSteady();
  });
  paintSteady();
  form.append(cont, label, row, rule, passLabel, passRow, passRule, enter, note, steady);
  shell.col.append(form);

  let busy = false;
  // A problem with the password shows from the first try to enter, not while it's being typed.
  let passShown: string | null = null;

  /** Whose password is being asked for: the typed name, else the remembered one. */
  const target = (): string | null => input.value || last;

  const paint = () => {
    const v = input.value;
    count.textContent = `${v.length}/16`;
    const problem = v ? nameProblem(v) : null;
    rule.classList.remove('err');
    rule.classList.toggle('bad', !!problem);
    rule.classList.toggle('ok', !!v && !problem);
    rule.textContent = problem ?? RULE;
    rule.removeAttribute('role');
    paintPass();
    // One primary action at a time: "Continue as" until a new name is typed.
    const typing = v.length > 0;
    cont.classList.toggle('primary', !typing);
    enter.classList.toggle('primary', typing || !last);
    enter.disabled = busy || (typing ? !!problem : !last);
    cont.disabled = busy;
    input.disabled = busy;
    pass.disabled = busy;
    show.disabled = busy;
  };

  const paintPass = () => {
    passRule.classList.remove('err', 'ok');
    passRule.removeAttribute('role');
    if (passShown) {
      passRule.classList.add('bad');
      passRule.textContent = passShown;
      return;
    }
    passRule.classList.remove('bad');
    // Continuing as the remembered name: say whose password this is.
    passRule.textContent = !input.value && last ? `The password for ${last}` : PASS_RULE;
  };

  const showError = (line: HTMLElement, msg: string) => {
    line.classList.remove('ok', 'bad');
    line.classList.add('err');
    line.setAttribute('role', 'alert');
    line.textContent = msg;
  };

  const shake = (r: HTMLElement) => {
    r.classList.remove('shake');
    void r.offsetWidth; // restart the animation
    r.classList.add('shake');
  };

  const go = async (name: string, password: string) => {
    if (busy) return;
    busy = true;
    enter.firstChild!.textContent = 'Opening';
    shell.root.classList.add('busy');
    paint();
    try {
      const profile = await deps.api.login(name, password);
      deps.sfx?.play('ui-click', { volume: 0.45 });
      deps.session.set(profile);
      deps.onDone(profile);
    } catch (err) {
      busy = false;
      enter.firstChild!.textContent = 'Enter';
      shell.root.classList.remove('busy');
      paint();
      const code = (err as { body?: { error?: unknown } }).body?.error;
      if (code === 'BAD_NAME') {
        showError(rule, problemText(err));
        input.focus();
        return;
      }
      // A wrong password starts over with an empty field; a pause (too many tries, no network)
      // keeps what was typed for the next attempt.
      if (code === 'UNAUTHORIZED') pass.value = '';
      showError(passRule, problemText(err));
      pass.focus();
    }
  };

  const submit = () => {
    const who = target();
    if (!who) {
      input.focus();
      return;
    }
    if (input.value && nameProblem(input.value)) {
      shake(row);
      input.focus();
      return;
    }
    passShown = passwordProblem(pass.value);
    if (passShown) {
      paintPass();
      shake(passRow);
      pass.focus();
      return;
    }
    void go(who, pass.value);
  };

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    submit();
  });
  cont.addEventListener('click', () => {
    if (!last) return;
    // The remembered name, whatever was half-typed in the name field.
    input.value = '';
    paint();
    if (!pass.value) {
      pass.focus();
      return;
    }
    submit();
  });
  // Enter in the name field moves on to the password until there is one.
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !pass.value && input.value && !nameProblem(input.value)) {
      e.preventDefault();
      pass.focus();
    }
  });
  input.addEventListener('input', paint);
  pass.addEventListener('input', () => {
    // Once the rule is met, the old complaint goes; a stale server error goes on the first key.
    if (passShown && !passwordProblem(pass.value)) passShown = null;
    paintPass();
  });
  show.addEventListener('click', () => {
    const on = pass.type === 'password';
    pass.type = on ? 'text' : 'password';
    show.textContent = on ? 'Hide' : 'Show';
    show.setAttribute('aria-pressed', String(on));
    show.setAttribute('aria-label', on ? 'Hide password' : 'Show password');
    pass.focus();
    const end = pass.value.length;
    pass.setSelectionRange(end, end);
  });

  paint();
  // Someone coming back only needs their password; someone new starts with a name.
  queueMicrotask(() => (last ? pass : input).focus({ preventScroll: true }));

  return {
    root: shell.root,
    close: () => shell.close(),
  };
}
