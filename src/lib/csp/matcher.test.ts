import { describe, expect, it } from 'vitest';
import { resolve } from './fallback';
import { checkResource, expressionMatchesUrl, ignoredSources } from './matcher';
import { classify, parseSinglePolicy } from './parser';

const SELF = 'https://shop.example.com';
const expr = (raw: string) => classify(raw, { start: 0, end: raw.length });
const matches = (raw: string, url: string) => expressionMatchesUrl(expr(raw), url, SELF);

describe('expressionMatchesUrl', () => {
  it('matches hosts with and without scheme', () => {
    expect(matches('cdn.example.net', 'https://cdn.example.net/a.js')).toBe(true);
    expect(matches('cdn.example.net', 'https://other.example.net/a.js')).toBe(false);
    expect(matches('https://cdn.example.net', 'http://cdn.example.net/a.js')).toBe(false);
    expect(matches('http://cdn.example.net', 'https://cdn.example.net/a.js')).toBe(true);
  });

  it('handles subdomain wildcards', () => {
    expect(matches('*.example.net', 'https://a.b.example.net/')).toBe(true);
    expect(matches('*.example.net', 'https://example.net/')).toBe(false);
  });

  it('handles ports', () => {
    expect(matches('cdn.example.net', 'https://cdn.example.net:8443/')).toBe(false);
    expect(matches('cdn.example.net:*', 'https://cdn.example.net:8443/')).toBe(true);
    expect(matches('cdn.example.net:8443', 'https://cdn.example.net:8443/')).toBe(true);
  });

  it('handles paths', () => {
    expect(matches('https://cdn.example.net/lib/', 'https://cdn.example.net/lib/a.js')).toBe(true);
    expect(matches('https://cdn.example.net/lib/a.js', 'https://cdn.example.net/lib/a.js')).toBe(true);
    expect(matches('https://cdn.example.net/lib/a.js', 'https://cdn.example.net/lib/b.js')).toBe(false);
  });

  it('handles schemes and the lone wildcard', () => {
    expect(matches('https:', 'https://anything.test/')).toBe(true);
    expect(matches('data:', 'data:image/png;base64,AA')).toBe(true);
    expect(matches('*', 'https://anything.test/')).toBe(true);
    expect(matches('*', 'data:,x')).toBe(false);
  });

  it("handles 'self' and its secure upgrade", () => {
    expect(matches("'self'", 'https://shop.example.com/a.js')).toBe(true);
    expect(matches("'self'", 'wss://shop.example.com/socket')).toBe(true);
    expect(matches("'self'", 'https://cdn.example.com/a.js')).toBe(false);
  });
});

describe('resolve', () => {
  it('walks the fallback chain', () => {
    const p = parseSinglePolicy("default-src 'self'; child-src https://a.test");
    expect(resolve(p, 'frame-src').governing?.name).toBe('child-src');
    expect(resolve(p, 'script-src-elem').governing?.name).toBe('default-src');
    expect(resolve(p, 'form-action').governing).toBeUndefined();
  });
});

describe('checkResource', () => {
  it('blocks external scripts not in the allowlist', () => {
    const p = parseSinglePolicy("default-src 'self'");
    expect(checkResource(p, 'script', 'https://cdn.vendor.test/x.js', SELF).verdict).toBe('blocked');
    expect(checkResource(p, 'script', 'https://shop.example.com/x.js', SELF).verdict).toBe('allowed');
  });

  it('allows everything a policy does not restrict', () => {
    const p = parseSinglePolicy("img-src 'self'");
    expect(checkResource(p, 'script', 'https://cdn.vendor.test/x.js', SELF).verdict).toBe('allowed');
  });

  it("requires a nonce with 'strict-dynamic'", () => {
    const p = parseSinglePolicy("script-src 'nonce-abc' 'strict-dynamic' https://cdn.vendor.test");
    const r = checkResource(p, 'script', 'https://cdn.vendor.test/x.js', SELF);
    expect(r.verdict).toBe('needs-nonce');
    expect(r.ignored.map((v) => v.raw)).toContain('https://cdn.vendor.test');
  });

  it("ignores 'unsafe-inline' when a nonce is present", () => {
    const p = parseSinglePolicy("script-src 'self' 'unsafe-inline' 'nonce-abc'");
    expect(checkResource(p, 'inline-script', undefined, SELF).verdict).toBe('needs-nonce');
    expect(checkResource(p, 'inline-handler', undefined, SELF).verdict).toBe('blocked');
  });

  it("allows inline code with 'unsafe-inline' alone", () => {
    const p = parseSinglePolicy("script-src 'self' 'unsafe-inline'");
    expect(checkResource(p, 'inline-script', undefined, SELF).verdict).toBe('allowed');
    expect(checkResource(p, 'eval', undefined, SELF).verdict).toBe('blocked');
  });

  it('respects script-src-elem over script-src', () => {
    const p = parseSinglePolicy("script-src 'self'; script-src-elem 'self' https://cdn.vendor.test");
    expect(checkResource(p, 'script', 'https://cdn.vendor.test/x.js', SELF).verdict).toBe('allowed');
  });
});

describe('ignoredSources', () => {
  const raws = (policy: string, type: Parameters<typeof ignoredSources>[1]) =>
    ignoredSources(parseSinglePolicy(policy).directives[0]!, type).map((v) => v.raw);

  it("drops allowlists and 'unsafe-inline' with 'strict-dynamic'", () => {
    const policy = "script-src 'self' 'unsafe-inline' 'nonce-abc' 'strict-dynamic' https: cdn.vendor.test";
    expect(raws(policy, 'script')).toEqual(["'self'", "'unsafe-inline'", 'https:', 'cdn.vendor.test']);
  });

  it("drops only 'unsafe-inline' with a nonce or a hash", () => {
    expect(raws("style-src 'self' 'unsafe-inline' 'sha256-abc'", 'style')).toEqual(["'unsafe-inline'"]);
  });

  it("keeps everything for types 'strict-dynamic' doesn't apply to", () => {
    expect(raws("default-src 'self' 'strict-dynamic' 'nonce-abc'", 'img')).toEqual([]);
  });
});
