import { describe, expect, it } from 'vitest';
import { classify } from '../lib/csp/parser';
import { highlightClass } from './PolicyView';

const tone = (raw: string) => highlightClass(classify(raw, { start: 0, end: raw.length }));

describe('highlightClass', () => {
  it("marks 'unsafe-' keywords as risky, except the one that does nothing", () => {
    expect(tone("'unsafe-inline'")).toBe('hl-unsafe');
    expect(tone("'unsafe-webtransport-hashes'")).toBe('hl-unsafe');
    expect(tone("'unsafe-allow-redirects'")).toBe('hl-keyword');
  });
});
