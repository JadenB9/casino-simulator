// The chat text rules both sides share: what a line looks like once cleaned, and which frames
// are a `say` at all. The server's limits, word mask and rooms are tested in the worker project
// (server/test/chat.test.ts).

import { describe, it, expect } from 'vitest';
import { CHAT_MAX, cleanChat, parseSay } from '../src/protocol.ts';

describe('cleanChat', () => {
  it('turns every kind of whitespace into single spaces and trims', () => {
    expect(cleanChat('  hello\tthere\n\nfriend  ')).toBe('hello there friend');
    expect(cleanChat('a\u00a0\u2003b\u2028c\u3000d\u0085e')).toBe('a b c d e');
  });

  it('removes control characters, lone surrogates and invisible formatting', () => {
    expect(cleanChat('he\u0000l\u0007l\u001bo\u007f\u009b')).toBe('hello');
    expect(cleanChat('ab\ud800cd\udfffef')).toBe('abcdef');
    // zero-width space, soft hyphen, word joiner, BOM
    expect(cleanChat('in\u200bvi\u00adsi\u2060ble\ufeff')).toBe('invisible');
    // every bidi control: an override would run the rest of the line backwards
    expect(cleanChat('abc\u202edcba\u202c\u2066x\u2069\u200e\u200f\u061c')).toBe('abcdcbax');
  });

  it('keeps emoji sequences and the joiners scripts need', () => {
    const family = '\u{1f468}\u200d\u{1f469}\u200d\u{1f467}';
    expect(cleanChat(`hi ${family} \u{1f44d}\u{1f3fd}`)).toBe(`hi ${family} \u{1f44d}\u{1f3fd}`);
    expect(cleanChat('\u0645\u06cc\u200c\u062e\u0648\u0627\u0647\u0645')).toBe('\u0645\u06cc\u200c\u062e\u0648\u0627\u0647\u0645');
  });

  it('composes (NFC) and cuts a pile of combining marks to four', () => {
    expect(cleanChat('cafe\u0301')).toBe('caf\u00e9');
    // (q has no precomposed accented forms, so every mark stays a mark)
    const zalgo = 'q' + '\u0301\u0302\u0303\u0304\u0305\u0306\u0307\u0308\u0309'.repeat(3) + 'o';
    expect(cleanChat(zalgo)).toBe('q\u0301\u0302\u0303\u0304o');
    // Real diacritics stay: Vietnamese stacks two on one letter.
    expect(cleanChat('ti\u00ea\u0301ng Vi\u00ea\u0323t')).toBe('ti\u1ebfng Vi\u1ec7t');
  });

  it('takes 1 to CHAT_MAX characters, counting an emoji as one', () => {
    expect(cleanChat('x'.repeat(CHAT_MAX))).toBe('x'.repeat(CHAT_MAX));
    expect(cleanChat('x'.repeat(CHAT_MAX + 1))).toBeNull();
    expect(cleanChat('\u{1f3b2}'.repeat(CHAT_MAX))).toBe('\u{1f3b2}'.repeat(CHAT_MAX));
    // Length is measured after cleaning: what gets stripped doesn't count.
    expect(cleanChat(`   ${'x'.repeat(CHAT_MAX)}\u0000\u0000   `)).toBe('x'.repeat(CHAT_MAX));
    expect(cleanChat('')).toBeNull();
    expect(cleanChat('   \n\t ')).toBeNull();
    expect(cleanChat('\u200b\u202e\u0000')).toBeNull();
  });
});

describe('parseSay', () => {
  it('takes { t: "say", text } and nothing else from the client', () => {
    expect(parseSay({ t: 'say', text: 'hi' })).toEqual({ t: 'say', text: 'hi' });
    // A name or id from the client is dropped: the server signs every line itself.
    expect(parseSay({ t: 'say', text: 'hi', name: 'dealer', id: 1 })).toEqual({ t: 'say', text: 'hi' });
    expect(parseSay({ t: 'say' })).toBeNull();
    expect(parseSay({ t: 'say', text: 5 })).toBeNull();
    expect(parseSay({ t: 'say', text: ['hi'] })).toBeNull();
    expect(parseSay({ t: 'emote', e: 'wave' })).toBeNull();
    expect(parseSay(['say', 'hi'])).toBeNull();
    expect(parseSay(null)).toBeNull();
    // Far too long to be a line, whatever cleaning would leave.
    expect(parseSay({ t: 'say', text: 'x'.repeat(CHAT_MAX * 4 + 1) })).toBeNull();
  });
});
