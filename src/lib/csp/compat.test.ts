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

  it('tests a host without a scheme over https, also from an http page', () => {
    const HTTP_SELF = 'http://shop.example.com';
    const req: Requirement = { type: 'script', source: 'cdn.vendor.test', reason: '' };
    expect(probeFor(req, HTTP_SELF)).toBe('https://cdn.vendor.test/');
    // The tool loads https://cdn.vendor.test, which a policy listing only that origin allows.
    expect(checkRequirements(parse('script-src https://cdn.vendor.test'), [req], HTTP_SELF)[0]?.verdict).toBe('allowed');
  });
});

describe('checkRequirements + buildPatches', () => {
  it('reports what is blocked and builds a patch that fixes it', () => {
    const parsed = parse("default-src 'self'; img-src 'self'; style-src 'self'");
    const results = checkRequirements(parsed, vendor, SELF);
    expect(results.map((r) => r.verdict)).toEqual(['blocked', 'blocked', 'blocked', 'blocked']);

    const [patch] = buildPatches(parsed, results, SELF);
    expect(patch!.after).toBe(
      "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' https://*.vendor.test; connect-src 'self' https://*.vendor.test",
    );
    expect(patch!.changes.find((c) => c.directive === 'script-src')).toMatchObject({ created: true, copiedFrom: 'default-src' });

    // Round trip: the patched policy satisfies every requirement.
    const again = checkRequirements(parse(patch!.after), vendor, SELF);
    expect(again.every((r) => r.verdict === 'allowed')).toBe(true);
  });

  it('adds one value when it already covers what another tool asks for, whatever their order', () => {
    const wide: Requirement = { type: 'connect', source: 'https://*.google.com', reason: 'GA4' };
    const narrow: Requirement = { type: 'connect', source: 'https://www.google.com', reason: 'GTM' };
    const parsed = parse("connect-src 'self'");
    for (const reqs of [[wide, narrow], [narrow, wide]]) {
      const [patch] = buildPatches(parsed, checkRequirements(parsed, reqs, SELF), SELF);
      expect(patch!.after).toBe("connect-src 'self' https://*.google.com");
      expect(patch!.changes[0]!.requestedBy['https://*.google.com']).toHaveLength(2);
    }
    // A subdomain wildcard doesn't cover the bare domain: both stay.
    const bare: Requirement = { type: 'connect', source: 'https://google.com', reason: '' };
    const [patch] = buildPatches(parsed, checkRequirements(parsed, [wide, bare], SELF), SELF);
    expect(patch!.after).toBe("connect-src 'self' https://*.google.com https://google.com");
    // wss: allows https: too, but the https address the vendor documents stays.
    const socket: Requirement = { type: 'connect', source: 'wss://*.hotjar.com', reason: '' };
    const events: Requirement = { type: 'connect', source: 'https://*.hotjar.com', reason: '' };
    const [both] = buildPatches(parsed, checkRequirements(parsed, [socket, events], SELF), SELF);
    expect(both!.after).toBe("connect-src 'self' wss://*.hotjar.com https://*.hotjar.com");
  });

  it("replaces 'none' instead of appending to it", () => {
    const parsed = parse("connect-src 'none'");
    const [patch] = buildPatches(parsed, checkRequirements(parsed, [vendor[1]!], SELF), SELF);
    expect(patch!.after).toBe('connect-src https://*.vendor.test');
    expect(patch!.changes[0]!.removedNone).toBe(true);
  });

  it('flags a narrower allowlist than the vendor asks for', () => {
    const parsed = parse('script-src https://try.vendor.test');
    expect(checkRequirements(parsed, [vendor[0]!], SELF)[0]!.verdict).toBe('blocked');
  });

  it("doesn't add 'unsafe-inline' where a nonce makes browsers ignore it", () => {
    const parsed = parse("script-src 'nonce-abc'; style-src 'nonce-abc'");
    const reqs: Requirement[] = [
      { type: 'inline-handler', source: "'unsafe-inline'", reason: '' },
      { type: 'style-attr', source: "'unsafe-inline'", reason: '' },
    ];
    const [patch] = buildPatches(parsed, checkRequirements(parsed, reqs, SELF), SELF);
    // Style attributes get their own directive; inline handlers stay blocked rather than undo the nonce.
    expect(patch!.after).toBe("script-src 'nonce-abc'; style-src 'nonce-abc'; style-src-attr 'unsafe-inline'");
    expect(checkRequirements(parse(patch!.after), reqs, SELF).map((r) => r.verdict)).toEqual(['blocked', 'allowed']);
  });

  it('does not patch when a nonce is required', () => {
    const parsed = parse("script-src 'nonce-abc' 'strict-dynamic'");
    const results = checkRequirements(parsed, [vendor[0]!], SELF);
    expect(results[0]!.verdict).toBe('needs-nonce');
    expect(buildPatches(parsed, results, SELF)).toEqual([]);
  });

  it('does not patch a source that is already listed but ignored', () => {
    // The nonce makes browsers ignore 'unsafe-inline': adding it again would fix nothing.
    const parsed = parse("default-src 'self' 'unsafe-inline' 'nonce-abc123'");
    const results = checkRequirements(parsed, [{ type: 'inline-handler', source: "'unsafe-inline'", reason: '' }], SELF);
    expect(results[0]!.verdict).toBe('blocked');
    expect(buildPatches(parsed, results, SELF)).toEqual([]);
  });

  it('only reports when every policy is report-only, and patches the report-only policy', () => {
    const parsed = parse("Content-Security-Policy-Report-Only: default-src 'self'");
    const results = checkRequirements(parsed, [vendor[0]!], SELF);
    expect(results[0]).toMatchObject({ verdict: 'reported', reported: true, checks: [] });
    expect(buildPatches(parsed, results, SELF).map((p) => p.after)).toEqual(["default-src 'self'; script-src 'self' https://*.vendor.test"]);
  });

  it('checks report-only policies even when an enforced policy allows the load', () => {
    const parsed = parse(
      "Content-Security-Policy: script-src https://*.vendor.test\nContent-Security-Policy-Report-Only: script-src 'self'",
    );
    const results = checkRequirements(parsed, [vendor[0]!], SELF);
    expect(results[0]).toMatchObject({ verdict: 'allowed', reported: true });
    expect(results[0]!.checks.map((c) => [c.policyIndex, c.match.verdict])).toEqual([[0, 'allowed']]);
    expect(results[0]!.reportOnly.map((c) => [c.policyIndex, c.match.verdict])).toEqual([[1, 'blocked']]);

    // The patch stops the reports: only the report-only policy changes.
    const patches = buildPatches(parsed, results, SELF);
    expect(patches.map((p) => [p.policyIndex, p.after])).toEqual([[1, "script-src 'self' https://*.vendor.test"]]);
  });

  it('keeps the enforced verdict and patches both policies when both object', () => {
    const parsed = parse("Content-Security-Policy: script-src 'self'\nContent-Security-Policy-Report-Only: script-src 'self'");
    const results = checkRequirements(parsed, [vendor[0]!], SELF);
    expect(results[0]).toMatchObject({ verdict: 'blocked', reported: true });
    expect(buildPatches(parsed, results, SELF).map((p) => p.policyIndex)).toEqual([0, 1]);
  });

  it('does not flag a load every report-only policy allows', () => {
    const parsed = parse(
      "Content-Security-Policy: script-src 'self'\nContent-Security-Policy-Report-Only: script-src https://*.vendor.test",
    );
    const results = checkRequirements(parsed, [vendor[0]!], SELF);
    expect(results[0]).toMatchObject({ verdict: 'blocked', reported: false });
    expect(buildPatches(parsed, results, SELF).map((p) => p.policyIndex)).toEqual([0]);
  });

  it('requires every enforced policy to allow the load', () => {
    const parsed = parse("script-src https://*.vendor.test, script-src 'self'");
    const results = checkRequirements(parsed, [vendor[0]!], SELF);
    expect(results[0]!.verdict).toBe('blocked');
    expect(buildPatches(parsed, results, SELF).map((p) => p.policyIndex)).toEqual([1]);
  });
});
