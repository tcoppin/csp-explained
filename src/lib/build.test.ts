import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { askedFor, baselinePolicy, buildPolicy, customContribution, isValidSource, siteContribution, type Contribution } from './build';
import { requirementsOf } from './catalogue/requirements';
import { parseVendor } from './catalogue/schema';
import { parse } from './csp/parser';

const SELF = 'https://shop.example.com';

const vendor = (id: string): Contribution => {
  const v = parseVendor(readFileSync(join(import.meta.dirname, '../../catalogue/vendors', `${id}.yaml`), 'utf8'));
  return {
    by: { kind: 'vendor', id: v.id, label: v.name },
    requirements: v.features.filter((f) => f.default).flatMap(requirementsOf),
  };
};

const directive = (text: string, name: string) => parse(text).policies[0]!.directives.find((d) => d.name === name);

describe('baselinePolicy', () => {
  it('parses cleanly in both modes', () => {
    for (const mode of ['allowlist', 'nonce'] as const) {
      const parsed = parse(baselinePolicy(mode));
      expect(parsed.issues).toEqual([]);
      expect(directive(baselinePolicy(mode), 'object-src')?.values.map((v) => v.raw)).toEqual(["'none'"]);
    }
    expect(directive(baselinePolicy('nonce'), 'script-src')?.values.map((v) => v.kind)).toEqual(['nonce', 'keyword']);
  });
});

describe('buildPolicy', () => {
  it('adds what tools need in dedicated directives and says who asked', () => {
    const built = buildPolicy(baselinePolicy('allowlist'), [vendor('hotjar')], SELF);
    expect(directive(built.text, 'default-src')?.values.map((v) => v.raw)).toEqual(["'self'"]);
    expect(built.text).toContain("connect-src 'self' https://*.hotjar.com https://*.hotjar.io wss://*.hotjar.com");
    expect(built.requirements.every((r) => r.result.verdict === 'blocked' && r.addedTo)).toBe(true);
    expect(askedFor(built, 'connect-src', 'wss://*.hotjar.com').map((r) => r.by.id)).toEqual(['hotjar']);
    expect(askedFor(built, 'default-src', "'self'")).toEqual([]);
    expect(built.introducedFindings.some((f) => f.id === 'script-unsafe-inline')).toBe(true);
  });

  it('adds a value once when several tools ask for it, and remembers both', () => {
    const built = buildPolicy(baselinePolicy('allowlist'), [siteContribution(['inline-styles']), vendor('hotjar')], SELF);
    expect(built.text.match(/style-src [^;]*/)![0].split(' ').filter((v) => v === "'unsafe-inline'")).toHaveLength(1);
    expect(askedFor(built, 'style-src', "'unsafe-inline'").map((r) => r.by.kind)).toEqual(['site', 'vendor']);
  });

  it('keeps what the starting policy already allows', () => {
    const built = buildPolicy("default-src 'self'; img-src 'self' data:", [siteContribution(['data-images'])], SELF);
    expect(built.changes).toEqual([]);
    expect(built.text).toBe("default-src 'self'; img-src 'self' data:");
    expect(built.requirements[0]!.result.verdict).toBe('allowed');
  });

  it('asks for the nonce rather than unsafe-inline with a nonce baseline', () => {
    const built = buildPolicy(baselinePolicy('nonce'), [siteContribution(['inline-scripts'])], SELF);
    expect(built.requirements[0]!.result.verdict).toBe('needs-nonce');
    expect(built.text).toBe(baselinePolicy('nonce'));
  });

  it('checks a Report-Only starting policy as if it decided', () => {
    const header = `Content-Security-Policy-Report-Only: ${baselinePolicy('nonce')}`;
    const built = buildPolicy(header, [siteContribution(['inline-scripts'])], SELF);
    expect(built.requirements[0]!.result.verdict).toBe('needs-nonce');

    const own = customContribution({ id: 'cdn', name: 'Our CDN', needs: [{ type: 'img', sources: ["'self'"] }] });
    const allowed = buildPolicy("Content-Security-Policy-Report-Only: default-src 'self'", [own], SELF).requirements[0]!;
    expect(allowed.result.verdict).toBe('allowed');
    expect(allowed.result.checks[0]?.match.matchedBy?.raw).toBe("'self'");
  });

  it('builds on the enforced policy of a pasted header set', () => {
    const built = buildPolicy(
      "Content-Security-Policy-Report-Only: default-src 'none'\nContent-Security-Policy: default-src 'self'",
      [siteContribution(['data-images'])],
      SELF,
    );
    expect(built.otherPolicies).toBe(1);
    expect(built.text).toBe("default-src 'self'; img-src 'self' data:");
  });

  it('returns nothing to build on for an empty text', () => {
    expect(buildPolicy('', [siteContribution(['eval'])]).text).toBe('');
  });
});

describe('own tools', () => {
  it('keeps only sources the browser understands', () => {
    expect(isValidSource('https://cdn.example.org')).toBe(true);
    expect(isValidSource("'self'")).toBe(true);
    expect(isValidSource('self')).toBe(false);
    expect(isValidSource("'nonce-abc'")).toBe(false);
    const c = customContribution({ id: 'cdn', name: 'Our CDN', needs: [{ type: 'img', sources: ['cdn.example.org', 'not a host'] }] });
    expect(c.requirements.map((r) => r.source)).toEqual(['cdn.example.org']);
    const built = buildPolicy(baselinePolicy('allowlist'), [c], SELF);
    expect(askedFor(built, 'img-src', 'cdn.example.org').map((r) => r.by.label)).toEqual(['Our CDN']);
  });
});
