import { describe, expect, it } from 'vitest';
import { checkRequirements, probeFor, type Requirement } from './compat';
import { parse } from './parser';
import { buildPatches } from './patch';

const SELF = 'https://shop.example.com';

const vendor: Requirement[] = [
  { type: 'script', source: 'https://*.vendor.test', reason: 'Loads the tag' },
  { type: 'connect', source: 'https://*.vendor.test', reason: 'Sends events' },
  { type: 'img', source: 'data:', reason: 'Inline images' },
  { type: 'inline-style', source: "'unsafe-inline'", reason: 'Injects styles' },
];

describe('probeFor', () => {
  it('derives probe URLs from source expressions', () => {
    expect(probeFor({ type: 'script', source: 'https://*.vendor.test', reason: '' }, SELF)).toBe('https://any-subdomain.vendor.test/');
    expect(probeFor({ type: 'script', source: 'cdn.vendor.test/lib/', reason: '' }, SELF)).toBe('https://cdn.vendor.test/lib/probe');
    expect(probeFor({ type: 'img', source: 'data:', reason: '' }, SELF)).toBe('data:,probe');
    expect(probeFor({ type: 'inline-script', source: "'unsafe-inline'", reason: '' }, SELF)).toBeUndefined();
    expect(probeFor({ type: 'script', source: 'x.test', probe: 'https://x.test/a.js', reason: '' }, SELF)).toBe('https://x.test/a.js');
  });
});

describe('checkRequirements + buildPatches', () => {
  it('reports what is blocked and builds a patch that fixes it', () => {
    const parsed = parse("default-src 'self'; img-src 'self'; style-src 'self'");
    const results = checkRequirements(parsed, vendor, SELF);
    expect(results.map((r) => r.verdict)).toEqual(['blocked', 'blocked', 'blocked', 'blocked']);

    const [patch] = buildPatches(parsed, results);
    expect(patch!.after).toBe(
      "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' https://*.vendor.test; connect-src 'self' https://*.vendor.test",
    );
    expect(patch!.changes.find((c) => c.directive === 'script-src')).toMatchObject({ created: true, copiedFrom: 'default-src' });

    // Round trip: the patched policy satisfies every requirement.
    const again = checkRequirements(parse(patch!.after), vendor, SELF);
    expect(again.every((r) => r.verdict === 'allowed')).toBe(true);
  });

  it("replaces 'none' instead of appending to it", () => {
    const parsed = parse("connect-src 'none'");
    const [patch] = buildPatches(parsed, checkRequirements(parsed, [vendor[1]!], SELF));
    expect(patch!.after).toBe('connect-src https://*.vendor.test');
    expect(patch!.changes[0]!.removedNone).toBe(true);
  });

  it('flags a narrower allowlist than the vendor asks for', () => {
    const parsed = parse('script-src https://try.vendor.test');
    expect(checkRequirements(parsed, [vendor[0]!], SELF)[0]!.verdict).toBe('blocked');
  });

  it('does not patch when a nonce is required', () => {
    const parsed = parse("script-src 'nonce-abc' 'strict-dynamic'");
    const results = checkRequirements(parsed, [vendor[0]!], SELF);
    expect(results[0]!.verdict).toBe('needs-nonce');
    expect(buildPatches(parsed, results)).toEqual([]);
  });

  it('only reports when every policy is report-only', () => {
    const parsed = parse("Content-Security-Policy-Report-Only: default-src 'self'");
    expect(checkRequirements(parsed, [vendor[0]!], SELF)[0]!.verdict).toBe('reported');
  });

  it('requires every enforced policy to allow the load', () => {
    const parsed = parse("script-src https://*.vendor.test, script-src 'self'");
    const results = checkRequirements(parsed, [vendor[0]!], SELF);
    expect(results[0]!.verdict).toBe('blocked');
    expect(buildPatches(parsed, results).map((p) => p.policyIndex)).toEqual([1]);
  });
});
