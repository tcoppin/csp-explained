import { describe, expect, it } from 'vitest';
import { requiresTrustedTypes, resolve } from './fallback';
import type { ResourceType } from './directives';
import { checkResource, expressionMatchesUrl, ignoredSources, sourceApplies } from './matcher';
import { classify, parse, parseSinglePolicy } from './parser';

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

  it("matches 'self' on other ports and schemes the way CSP3 does", () => {
    const self = (url: string, page: string) => expressionMatchesUrl(expr("'self'"), url, page);
    expect(self('https://site.test/', 'http://site.test/')).toBe(true);
    expect(self('ws://site.test/', 'http://site.test/')).toBe(true);
    expect(self('http://site.test/', 'https://site.test/')).toBe(false);
    expect(self('ws://site.test/', 'https://site.test/')).toBe(false);
    expect(self('https://site.test:8080/', 'http://site.test:8080/')).toBe(true);
    // Upgrading to the default https port only works from the default http port.
    expect(self('https://site.test/', 'http://site.test:8080/')).toBe(false);
    expect(self('https://site.test:8443/', 'https://site.test/')).toBe(false);
  });
});

describe('resolve', () => {
  it('walks the fallback chain', () => {
    const p = parseSinglePolicy("default-src 'self'; child-src https://a.test");
    expect(resolve(p, 'frame-src').governing?.name).toBe('child-src');
    expect(resolve(p, 'fenced-frame-src')).toMatchObject({ governing: { name: 'child-src' }, skipped: ['fenced-frame-src', 'frame-src'] });
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

  it("lets scripts start workers with 'strict-dynamic', since a script always creates them", () => {
    const p = parseSinglePolicy("script-src 'nonce-abc' 'strict-dynamic' https://cdn.vendor.test");
    const r = checkResource(p, 'worker', 'https://other.test/worker.js', SELF);
    expect(r.verdict).toBe('allowed');
    expect(r.matchedBy?.raw).toBe("'strict-dynamic'");
    // worker-src doesn't know 'strict-dynamic': its own list decides.
    const own = parseSinglePolicy("script-src 'nonce-abc' 'strict-dynamic'; worker-src 'self'");
    expect(checkResource(own, 'worker', 'https://other.test/worker.js', SELF).verdict).toBe('blocked');
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

  it("allows code from text with 'trusted-types-eval' only when Trusted Types are enforced", () => {
    const enforced = parseSinglePolicy("script-src 'self' 'trusted-types-eval'; require-trusted-types-for 'script'");
    const r = checkResource(enforced, 'eval', undefined, SELF);
    expect(r.verdict).toBe('allowed');
    expect(r.matchedBy?.raw).toBe("'trusted-types-eval'");
    const alone = parseSinglePolicy("script-src 'self' 'trusted-types-eval'");
    expect(checkResource(alone, 'eval', undefined, SELF).verdict).toBe('blocked');
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

describe('requiresTrustedTypes', () => {
  const policy = (text: string) => parse(text).policies[0]!;
  it("is on with require-trusted-types-for 'script' only", () => {
    expect(requiresTrustedTypes(policy("default-src 'self'; require-trusted-types-for 'script'"))).toBe(true);
    expect(requiresTrustedTypes(policy("require-trusted-types-for 'SCRIPT'"))).toBe(true);
    expect(requiresTrustedTypes(policy('trusted-types default'))).toBe(false);
    expect(requiresTrustedTypes(policy("default-src 'self'"))).toBe(false);
  });
});

describe('sourceApplies', () => {
  /** The values that can allow one kind of content, from a directive's values. */
  const shown = (values: string, type: ResourceType) =>
    parseSinglePolicy(`default-src ${values}`).directives[0]!.values.filter((v) => sourceApplies(v, type)).map((v) => v.raw);
  const ALL = "'self' 'unsafe-inline' 'unsafe-eval' 'nonce-abc' 'strict-dynamic' https://cdn.example";

  it('keeps everything written for scripts beside scripts', () => {
    expect(shown(ALL, 'script')).toEqual(ALL.split(' '));
  });

  it("leaves inline-code keywords and nonces off workers, which only addresses and 'strict-dynamic' reach", () => {
    expect(shown(ALL, 'worker')).toEqual(["'self'", "'strict-dynamic'", 'https://cdn.example']);
  });

  it('keeps only addresses for content that is never inline code', () => {
    expect(shown(ALL, 'img')).toEqual(["'self'", 'https://cdn.example']);
    expect(shown("'unsafe-inline'", 'font')).toEqual([]);
  });
});
