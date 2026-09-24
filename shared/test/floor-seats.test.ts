// Floor seats (chairs, stools, sofa places): who gets a seat when two want it, and what frees it.
// The floor object arbitrates with this book; clients keep a copy of it from the floor's word.

import { describe, expect, it } from 'vitest';
import { SeatBook, isSeatId } from '../src/seats.ts';
import { parseFloorMsg } from '../src/protocol.ts';
import { isGameId } from '../src/games/catalog.ts';

describe('the seat book', () => {
  it('seats the first to ask and refuses the second, naming who is there', () => {
    const book = new SeatBook();
    expect(book.take('bar-stool-3', 11)).toEqual({ ok: true, left: null });
    expect(book.take('bar-stool-3', 12)).toEqual({ ok: false, holder: 11 });
    expect(book.holder('bar-stool-3')).toBe(11);
    expect(book.seatOf(12)).toBeNull();
  });

  it('keeps one seat per player: moving seats frees the old one for someone else', () => {
    const book = new SeatBook();
    book.take('sofa-1-a', 5);
    expect(book.take('sofa-1-b', 5)).toEqual({ ok: true, left: 'sofa-1-a' });
    expect(book.holder('sofa-1-a')).toBeNull();
    expect(book.take('sofa-1-a', 6)).toEqual({ ok: true, left: null });
    expect(book.size).toBe(2);
  });

  it('lets a sitter sit down again where they already are', () => {
    const book = new SeatBook();
    book.take('bar-stool-1', 7);
    expect(book.take('bar-stool-1', 7)).toEqual({ ok: true, left: null });
    expect(book.size).toBe(1);
  });

  it('frees a seat when its sitter stands (or leaves), and only theirs', () => {
    const book = new SeatBook();
    book.take('bar-stool-1', 1);
    book.take('bar-stool-2', 2);
    expect(book.free(1)).toBe('bar-stool-1');
    expect(book.free(1)).toBeNull();
    expect(book.holder('bar-stool-1')).toBeNull();
    expect(book.holder('bar-stool-2')).toBe(2);
    expect(book.take('bar-stool-1', 2)).toEqual({ ok: true, left: 'bar-stool-2' });
  });

  it("takes the floor's word in a client's copy, over whatever it thought", () => {
    const book = new SeatBook();
    book.set(1, 'sofa-2-a');
    // the floor says someone else is there now (the client missed the first sitter standing)
    book.set(2, 'sofa-2-a');
    expect(book.holder('sofa-2-a')).toBe(2);
    expect(book.seatOf(1)).toBeNull();
    book.set(2, null);
    expect(book.size).toBe(0);
  });

  it('races fairly: of many players asking for one seat in turn, exactly one sits', () => {
    const book = new SeatBook();
    const wins = Array.from({ length: 20 }, (_, i) => book.take('lounge-1-sofa-1-b', 100 + i)).filter((r) => r.ok);
    expect(wins).toHaveLength(1);
    expect(book.holder('lounge-1-sofa-1-b')).toBe(100);
  });
});

describe('seat ids and messages', () => {
  it('takes short, plain ids only', () => {
    for (const ok of ['bar-stool-3', 'lounge-1-sofa-2-b', 'online:pc-4.chair', 'a']) expect(isSeatId(ok)).toBe(true);
    for (const bad of ['', 'Bar-Stool', ' stool', 'stool 3', 'x'.repeat(41), '-lead', 'stool/3', 3, null]) expect(isSeatId(bad)).toBe(false);
  });

  it('parses sit and stand', () => {
    expect(parseFloorMsg({ t: 'sit', seat: 'bar-stool-3', x: 1553, z: 572, r: 192 }, isGameId)).toEqual({ t: 'sit', seat: 'bar-stool-3', x: 1553, z: 572, r: 192 });
    expect(parseFloorMsg({ t: 'stand', extra: 1 }, isGameId)).toEqual({ t: 'stand' });
    expect(parseFloorMsg({ t: 'sit', seat: 'Bar Stool', x: 0, z: 0, r: 0 }, isGameId)).toBeNull();
    expect(parseFloorMsg({ t: 'sit', seat: 'bar-stool-3', x: 0.5, z: 0, r: 0 }, isGameId)).toBeNull();
    expect(parseFloorMsg({ t: 'sit', seat: 'bar-stool-3', x: 0, z: 0, r: 256 }, isGameId)).toBeNull();
    expect(parseFloorMsg({ t: 'sit', x: 0, z: 0, r: 0 }, isGameId)).toBeNull();
  });
});
