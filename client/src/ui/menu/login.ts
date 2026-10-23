// The login screen: a name and its password. Names are first come, first served: a new name
// takes the password it arrives with, and so does a name from before passwords, the first time.
// Both rules are checked as you type with the same functions the server uses, and whatever the
// server says back is shown under the field it is about.
//
// A returning player's name is remembered (api.lastName): "Continue as" is the gold button and
// the password field waits for them; typing another name hands the gold to Enter.

import './menu.css';
import './login.css';
import type { Profile } from '../../../../shared/src/protocol.ts';
import { nameProblem } from '../../../../shared/src/names.ts';
import { PASSWORD_MAX, PASSWORD_MIN, passwordProblem } from '../../../../shared/src/password.ts';
import { el } from '../kit.ts';
import type { AccountApi, Closable, SessionLike, SfxLike } from './deps.ts';
import { frontShell, monogram } from './front.ts';
import { glyph } from './glyphs.ts';
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

/** A field: its label (and whatever sits at the right of the label), the box, the line under it. */
function fieldParts(id: string, label: string): { root: HTMLElement; head: HTMLElement; label: HTMLLabelElement; box: HTMLElement; line: HTMLElement } {
  const root = el('div', 'login-field');
  const head = el('div', 'field-head');
  const l = el('label', 'field-label', label);
  l.htmlFor = id;
  head.append(l);
  const box = el('div', 'name-row');
  const line = el('p', 'name-rule');
  line.id = `${id}-rule`;
  line.setAttribute('aria-live', 'polite');
  root.append(head, box, line);
  return { root, head, label: l, box, line };
}

export function mountLogin(deps: LoginDeps): Closable {
  const shell = frontShell(deps.root, 'front-login', deps.backdrop);
  const last = deps.api.lastName();

  const form = el('form', 'login-form front-main front-rise');
  form.noValidate = true;
  form.setAttribute('aria-label', 'Log in');

  const cont = el('button', 'continue-btn');
  cont.type = 'button';
  const contName = el('span', 'continue-name', last ?? '');
  const contText = el('span', 'continue-text');
  contText.append(el('span', 'continue-label', 'Continue as'), contName);
  cont.append(monogram(last ?? ''), contText, keycap('Enter'));
  cont.hidden = !last;
  // With a name remembered, another one is the second way in.
  const or = el('div', 'login-or', 'or another name');
  or.hidden = !last;

  const name = fieldParts('login-name', 'Name');
  const input = el('input', 'name-input');
  input.id = 'login-name';
  input.name = 'username';
  input.type = 'text';
  input.maxLength = 16;
  input.autocomplete = 'username';
  input.spellcheck = false;
  input.setAttribute('autocapitalize', 'off');
  input.setAttribute('aria-describedby', 'login-name-rule');
  const count = el('span', 'name-count money', '');
  count.setAttribute('aria-hidden', 'true');
  name.box.append(input);
  name.head.append(count);
  const rule = name.line;
  rule.textContent = RULE;

  const passF = fieldParts('login-pass', 'Password');
  passF.root.classList.add('pass-field');
  passF.label.classList.add('pass-label');
  passF.box.classList.add('pass-row');
  const pass = el('input', 'pass-input');
  pass.id = 'login-pass';
  pass.name = 'password';
  pass.type = 'password';
  pass.maxLength = PASSWORD_MAX;
  pass.autocomplete = 'current-password';
  pass.spellcheck = false;
  pass.setAttribute('autocapitalize', 'off');
  pass.setAttribute('aria-describedby', 'login-pass-rule');
  const show = el('button', 'pass-show');
  show.type = 'button';
  show.setAttribute('aria-controls', 'login-pass');
  show.setAttribute('aria-pressed', 'false');
  show.setAttribute('aria-label', 'Show password');
  const showText = el('span', 'pass-show-text', 'Show');
  show.append(glyph('eye'), showText);
  passF.box.append(pass, show);
  // Caps Lock, said beside the label while it's on (a password typed in capitals is a wrong one)
  const caps = el('span', 'caps-hint');
  caps.id = 'login-caps';
  caps.append(glyph('caps'), document.createTextNode('Caps Lock is on'));
  caps.hidden = true;
  passF.head.append(caps);
  const passRule = passF.line;
  passRule.classList.add('pass-rule');
  passRule.textContent = PASS_RULE;

  const enter = el('button', 'btn enter-btn');
  enter.type = 'submit';
  const enterLabel = el('span', 'enter-label', 'Enter');
  enter.append(el('i', 'enter-spin'), enterLabel);
  form.append(cont, or, name.root, passF.root, enter);

  const aside = el('div', 'front-aside front-rise');
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
  aside.append(note, steady);
  shell.col.append(form, aside);

  let busy = false;
  // A problem with the password shows from the first try to enter, not while it's being typed.
  let passShown: string | null = null;

  /** Whose password is being asked for: the typed name, else the remembered one. */
  const target = (): string | null => input.value || last;

  const paint = () => {
    const v = input.value;
    count.textContent = v ? `${v.length}/16` : '';
    const problem = v ? nameProblem(v) : null;
    rule.classList.remove('err');
    rule.classList.toggle('bad', !!problem);
    rule.classList.toggle('ok', !!v && !problem);
    rule.textContent = problem ?? RULE;
    rule.removeAttribute('role');
    name.box.classList.remove('err');
    name.box.classList.toggle('bad', !!problem);
    if (problem) input.setAttribute('aria-invalid', 'true');
    else input.removeAttribute('aria-invalid');
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
    passF.box.classList.remove('err');
    if (passShown) {
      passRule.classList.add('bad');
      passRule.textContent = passShown;
      passF.box.classList.add('bad');
      pass.setAttribute('aria-invalid', 'true');
      return;
    }
    passRule.classList.remove('bad');
    passF.box.classList.remove('bad');
    pass.removeAttribute('aria-invalid');
    // Continuing as the remembered name: say whose password this is.
    passRule.textContent = !input.value && last ? `The password for ${last}` : PASS_RULE;
  };

  const showError = (line: HTMLElement, box: HTMLElement, field: HTMLInputElement, msg: string) => {
    line.classList.remove('ok', 'bad');
    line.classList.add('err');
    line.setAttribute('role', 'alert');
    line.textContent = msg;
    box.classList.add('err');
    field.setAttribute('aria-invalid', 'true');
  };

  const shake = (r: HTMLElement) => {
    r.classList.remove('shake');
    void r.offsetWidth; // restart the animation
    r.classList.add('shake');
  };

  const go = async (who: string, password: string) => {
    if (busy) return;
    busy = true;
    enterLabel.textContent = 'Opening';
    enter.classList.add('busy');
    form.setAttribute('aria-busy', 'true');
    shell.root.classList.add('busy');
    paint();
    try {
      const profile = await deps.api.login(who, password);
      deps.sfx?.play('ui-click', { volume: 0.45 });
      deps.session.set(profile);
      deps.onDone(profile);
    } catch (err) {
      busy = false;
      enterLabel.textContent = 'Enter';
      enter.classList.remove('busy');
      form.removeAttribute('aria-busy');
      shell.root.classList.remove('busy');
      paint();
      const code = (err as { body?: { error?: unknown } }).body?.error;
      if (code === 'BAD_NAME') {
        showError(rule, name.box, input, problemText(err));
        input.focus();
        return;
      }
      // A wrong password starts over with an empty field; a pause (too many tries, no network)
      // keeps what was typed for the next attempt.
      if (code === 'UNAUTHORIZED') pass.value = '';
      showError(passRule, passF.box, pass, problemText(err));
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
      shake(name.box);
      input.focus();
      return;
    }
    passShown = passwordProblem(pass.value);
    if (passShown) {
      paintPass();
      shake(passF.box);
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
  // Caps Lock: known only from a key event, so it shows from the first key typed in either field
  // (and the password field is described by it only while it shows: a hidden node named in
  // aria-describedby would still be read out)
  const setCaps = (on: boolean) => {
    if (caps.hidden === !on) return;
    caps.hidden = !on;
    pass.setAttribute('aria-describedby', on ? 'login-pass-rule login-caps' : 'login-pass-rule');
  };
  const paintCaps = (e: KeyboardEvent) => {
    if (typeof e.getModifierState === 'function') setCaps(e.getModifierState('CapsLock'));
  };
  for (const f of [input, pass]) {
    f.addEventListener('keydown', paintCaps);
    f.addEventListener('keyup', paintCaps);
  }
  form.addEventListener('focusout', () => {
    // leaving the form for good (not just going from one field to the other)
    queueMicrotask(() => {
      if (!form.contains(document.activeElement)) setCaps(false);
    });
  });
  show.addEventListener('click', () => {
    const on = pass.type === 'password';
    pass.type = on ? 'text' : 'password';
    showText.textContent = on ? 'Hide' : 'Show';
    show.replaceChild(glyph(on ? 'eye-off' : 'eye'), show.firstChild!);
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
