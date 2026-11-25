import { describe, expect, it } from 'vitest';
import { classify, parse } from '../../lib/csp/parser';
import { highlightClass, valueTone } from './PolicyView';

const tone = (raw: string) => highlightClass(classify(raw, { start: 0, end: raw.length }));

describe('highlightClass', () => {
  it("marks 'unsafe-' keywords as risky, except the one that does nothing", () => {
    expect(tone("'unsafe-inline'")).toBe('hl-unsafe');
    expect(tone("'unsafe-webtransport-hashes'")).toBe('hl-unsafe');
    expect(tone("'unsafe-allow-redirects'")).toBe('hl-keyword');
  });
});

describe('valueTone', () => {
  const tones = (text: string) =>
    parse(text).policies[0]!.directives.map((d) => d.values.map((v) => `${v.raw}=${valueTone(d, v)}`));

  it("fades what browsers skip next to 'strict-dynamic' or a nonce, instead of calling it risky", () => {
    expect(tones("script-src 'nonce-abc123' 'strict-dynamic' https: 'unsafe-inline'")[0]).toEqual([
      "'nonce-abc123'=hl-nonce",
      "'strict-dynamic'=hl-keyword",
      'https:=hl-ignored',
      "'unsafe-inline'=hl-ignored",
    ]);
    expect(tones("style-src 'self' 'nonce-abc123' 'unsafe-inline'")[0]).toContain("'unsafe-inline'=hl-ignored");
  });

  it('keeps the risk where browsers apply the value', () => {
    expect(tones("script-src 'self' 'unsafe-inline' https:")[0]).toEqual(["'self'=hl-keyword", "'unsafe-inline'=hl-unsafe", 'https:=hl-unsafe']);
    // default-src still applies https: to images and the rest.
    expect(tones("default-src 'nonce-abc123' 'strict-dynamic' https:")[0]).toContain('https:=hl-unsafe');
  });
});
