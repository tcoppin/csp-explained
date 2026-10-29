import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { translator } from '../../i18n';
import { analyze } from '../analysis';
import { parseVendor } from '../catalogue/schema';
import { parse } from '../csp/parser';
import { evaluateSecurity, findingKey } from '../csp/security';
import { deploySnippet, developerReport, policyDiff } from './developer';
import { findingText, securityReport } from './security';
import { itRequest } from './simple';

const t = translator('en');

const vendor = (id: string) => parseVendor(readFileSync(join(import.meta.dirname, '../../../catalogue/vendors', `${id}.yaml`), 'utf8'));
const abTasty = vendor('ab-tasty');
const tag = abTasty.features.filter((f) => f.id === 'tag');
const POLICY = "default-src 'self'; script-src 'self'; img-src 'self' data:; object-src 'none'";

describe('analyze', () => {
  it('checks vendors, builds patches and flags what the patch introduces', () => {
    const a = analyze(POLICY, [{ vendor: abTasty, features: tag }], 'https://shop.example.com');
    expect(a.vendors[0]!.verdict).toBe('blocked');
    expect(a.patches[0]!.after).toContain("script-src 'self' *.abtasty.com 'unsafe-inline'");
    expect(a.introducedFindings.some((f) => f.id === 'script-unsafe-inline')).toBe(true);
  });
});

describe('itRequest', () => {
  const a = analyze(POLICY, [{ vendor: abTasty, features: tag }], 'https://shop.example.com');

  it('writes an email a non-technical person can send', () => {
    const mail = itRequest(a, t, { format: 'email', site: 'shop.example.com', toolUrl: 'csp.example' });
    expect(mail).toMatch(/^Subject: .*AB Tasty/);
    expect(mail).toContain('AB Tasty is blocked for scripts (*.abtasty.com)');
    expect(mail).toContain('script-src: add *.abtasty.com');
    expect(mail).toContain("'unsafe-inline'");
    expect(mail).toContain(abTasty.sources[0]);
    expect(mail).not.toContain('{');
  });

  it('supports chat and ticket formats', () => {
    expect(itRequest(a, t, { format: 'chat', toolUrl: 'x' })).toContain('```');
    expect(itRequest(a, t, { format: 'ticket', toolUrl: 'x' })).toMatch(/^## /);
  });

  it('says no change is needed when everything is allowed', () => {
    const ok = analyze("script-src *.abtasty.com 'unsafe-inline'; style-src *.abtasty.com 'unsafe-inline'", [{ vendor: abTasty, features: tag }]);
    const mail = itRequest(ok, t, { format: 'email', toolUrl: 'x' });
    expect(mail).toContain('no change seems needed');
    expect(mail).not.toContain('Proposed change');
  });
});

describe('developer report', () => {
  const a = analyze(POLICY, [{ vendor: abTasty, features: tag }]);

  it('shows a per-directive diff', () => {
    expect(policyDiff(a)).toContain("- script-src 'self'\n+ script-src 'self' *.abtasty.com 'unsafe-inline'");
  });

  it('renders server snippets', () => {
    expect(deploySnippet(a, 'nginx')).toMatch(/^add_header Content-Security-Policy ".*abtasty.*" always;$/);
    expect(deploySnippet(a, 'express')).toContain('scriptSrc: ["\'self\'", "*.abtasty.com", "\'unsafe-inline\'"]');
    expect(deploySnippet(a, 'meta')).toContain('<meta http-equiv="Content-Security-Policy"');
    expect(JSON.parse(deploySnippet(a, 'vercel')).headers[0].headers[0].key).toBe('Content-Security-Policy');
  });

  it('produces markdown', () => {
    expect(developerReport(a, t)).toContain('```diff');
  });
});

describe('security report', () => {
  it('lists current and introduced findings', () => {
    const report = securityReport(analyze(POLICY, [{ vendor: abTasty, features: tag }]), t);
    expect(report).toContain('Security review');
    expect(report).toContain('script-src');
    expect(report).not.toContain('{high}');
  });
});

describe('findingKey', () => {
  // Policies that trigger every check we run, and each variant of the checks that say several things.
  const POLICIES = [
    "script-src 'unsafe-inline' 'unsafe-eval' 'unsafe-hashes' data: https: http://x.example *",
    "script-src 'nonce-abcdefgh1234'",
    "img-src 'self'",
    "script-src https://www.google.com; object-src 'none'; base-uri 'none'",
    "script-src 'self' https://cdn.example.com; object-src https://x.example https://ajax.googleapis.com",
    "script-src http://127.0.0.1 https://10.0.0.1",
    "script-src 'nonce-abc'",
    'reflected-xss block',
    "script-src: 'self'; foo-src x",
    "script-src 'self' object-src 'none'",
    'script-src self',
    "script-src 'nonce-abcdefgh1234' 'unsafe-inline' 'strict-dynamic' https://x.example",
    "default-src 'self'; report-uri http://r.example",
  ];
  const produced = new Set(POLICIES.flatMap((p) => evaluateSecurity(parse(p)).map((f) => findingKey(f))));

  it('has a message for every finding', () => {
    expect([...produced].filter((key) => !t.has(`findings.${key}`))).toEqual([]);
  });

  it('has no message for a finding that never happens', () => {
    // Our parser drops these values before the evaluator sees them; the messages stay in case it changes.
    const unreachable = ['invalid-keyword.invalid', 'nonce-charset'];
    const messages = t.keys('findings').flatMap((k) => (t.has(k) ? [k] : t.keys(k))).map((k) => k.slice('findings.'.length));
    expect(messages.filter((k) => !produced.has(k) && !unreachable.includes(k))).toEqual([]);
  });

  it('falls back to the evaluator text for a kind of finding we have no message for', () => {
    const f = { ...evaluateSecurity(parse("script-src 'unsafe-inline'"))[0]!, id: 'future-check', description: 'From the evaluator.' };
    expect(findingText(t, f)).toBe('From the evaluator.');
  });
});
