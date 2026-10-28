import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { t } from '../../i18n';
import { analyze } from '../analysis';
import { parseVendor } from '../catalogue/schema';
import { deploySnippet, developerReport, policyDiff } from './developer';
import { securityReport } from './security';
import { itRequest } from './simple';

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
