import { describe, expect, it } from 'vitest';

import { clampPage, pageCount, pageRange } from './fullList';
import { fullListLine } from './replies';

describe('the full list, paged', () => {
  it('counts pages, never fewer than one', () => {
    expect(pageCount(0)).toBe(1);
    expect(pageCount(1)).toBe(1);
    expect(pageCount(20)).toBe(1);
    expect(pageCount(21)).toBe(2);
    expect(pageCount(45, 20)).toBe(3);
  });

  it('a page out of range is brought back into it', () => {
    expect(clampPage(0, 45)).toBe(1);
    expect(clampPage(-3, 45)).toBe(1);
    expect(clampPage(2.7, 45)).toBe(2);
    expect(clampPage(9, 45)).toBe(3);
    expect(clampPage(4, 0)).toBe(1);
  });

  it('a page says which ranks it holds, counted after the top picks', () => {
    // Five top picks, 42 more: 6–25, 26–45, 46–47 of 47.
    expect(pageRange(1, 42, 5)).toEqual({ from: 6, to: 25, of: 47 });
    expect(pageRange(2, 42, 5)).toEqual({ from: 26, to: 45, of: 47 });
    expect(pageRange(3, 42, 5)).toEqual({ from: 46, to: 47, of: 47 });
    expect(pageRange(7, 42, 5)).toEqual({ from: 46, to: 47, of: 47 });
    expect(pageRange(1, 3, 5, 2)).toEqual({ from: 6, to: 7, of: 8 });
    expect(pageRange(1, 0, 5)).toBeNull();
  });

  it('the chat line counts from the rows and says when everything is already on screen', () => {
    expect(fullListLine(5, 13)).toBe('All 18 hotels that fit are listed under the top picks, in the same order.');
    expect(fullListLine(5, 1995)).toBe('All 2,000 hotels that fit are listed under the top picks, in the same order.');
    expect(fullListLine(3, 0)).toBe('All 3 hotels that fit are already on screen.');
    expect(fullListLine(1, 0)).toBe('That is the only hotel that fits; it is on screen.');
  });
});
