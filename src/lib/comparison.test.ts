import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { VendorSelection } from './analysis';
import { parseVendor } from './catalogue/schema';
import { compare, trendOf } from './comparison';

const SELF = 'https://shop.example.com';

const selection = (id: string): VendorSelection => {
  const vendor = parseVendor(readFileSync(join(import.meta.dirname, '../../catalogue/vendors', `${id}.yaml`), 'utf8'));
  return { vendor, features: vendor.features.filter((f) => f.default) };
};

describe('compare', () => {
  it('sorts findings into fixed, introduced and remaining', () => {
    const c = compare("script-src 'self' 'unsafe-inline'", "script-src 'self' 'unsafe-eval'; object-src 'none'", [], SELF);
    expect(c.fixed.map((f) => f.id)).toContain('script-unsafe-inline');
    expect(c.introduced.map((f) => f.id)).toContain('script-unsafe-eval');
    expect(c.introduced.map((f) => f.id)).not.toContain('script-unsafe-inline');
    expect([...c.fixed, ...c.introduced].some((f) => c.remaining.includes(f))).toBe(false);
  });

  it('matches findings of paired policies even when their positions differ', () => {
    const before = "Content-Security-Policy: script-src 'self' 'unsafe-inline'";
    const after = "Content-Security-Policy-Report-Only: img-src 'self'\nContent-Security-Policy: script-src 'self' 'unsafe-inline'";
    const c = compare(before, after, [], SELF);
    expect(c.fixed).toEqual([]);
    expect(c.remaining.map((f) => f.id)).toContain('script-unsafe-inline');
    expect(c.introduced.every((f) => f.policyIndex === 0)).toBe(true);
  });

  it('tells which tools a change breaks', () => {
    const [hotjar] = compare('', "default-src 'self'", [selection('hotjar')], SELF).vendors;
    expect(hotjar).toMatchObject({ verdictBefore: 'allowed', verdictAfter: 'blocked', trend: 'worse' });
    expect(hotjar!.requirements.every((r) => r.trend === 'worse')).toBe(true);
  });

  it('ranks verdicts from the site’s point of view', () => {
    expect(trendOf('blocked', 'allowed')).toBe('better');
    expect(trendOf('allowed', 'reported')).toBe('worse');
    expect(trendOf('needs-nonce', 'needs-nonce')).toBe('same');
  });
});
