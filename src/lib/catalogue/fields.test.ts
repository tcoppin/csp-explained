import { describe, expect, it } from 'vitest';
import { selectionsOf } from '../analysis';
import { fieldValues, readField, resolveVendor, withFieldValue } from './fields';
import type { Vendor } from './schema';

const piwik: Vendor = {
  id: 'piwik-pro',
  name: 'Piwik PRO',
  category: 'analytics',
  website: 'https://piwik.pro',
  sources: ['https://developers.piwik.pro/'],
  lastVerified: '2026-11-23',
  confidence: 'verified',
  fields: [{ id: 'account', label: 'Your account name', kind: 'subdomain', example: 'organization' }],
  features: [
    {
      id: 'tag-manager',
      label: 'Tag Manager',
      default: true,
      requirements: [{ type: 'connect', sources: ['https://{account}.containers.piwik.pro', 'https://{account}.piwik.pro'], reason: 'r' }],
    },
  ],
};

const matomo: Vendor = {
  ...piwik,
  id: 'matomo',
  fields: [{ id: 'server', label: 'Your Matomo address', kind: 'host', example: 'matomo.example.com' }],
  features: [
    {
      id: 'tracking',
      label: 'Tracking code',
      default: true,
      requirements: [
        { type: 'script', sources: ['https://{server}'], reason: 'r' },
        { type: 'img', sources: ["'self'", 'https://{server}'], reason: 'r' },
      ],
    },
  ],
};

const sources = (v: Vendor) => v.features.flatMap((f) => f.requirements.map((r) => r.sources));
const field = (v: Vendor) => v.fields![0]!;

describe('account fields', () => {
  it('keep what was typed next to the feature ids, encoded, and drop it when emptied', () => {
    const selected = withFieldValue(['tag-manager'], 'account', 'acme, inc');
    expect(selected).toEqual(['tag-manager', 'account=acme%2C%20inc']);
    expect(fieldValues(selected)).toEqual({ account: 'acme, inc' });
    expect(withFieldValue(selected, 'account', ' ')).toEqual(['tag-manager']);
    expect(fieldValues(['account=%E0%A4%A'])).toEqual({});
  });

  it('read an account name, or find it in an address of the tool', () => {
    for (const typed of ['acme', 'Acme', 'acme.piwik.pro', 'https://acme.containers.piwik.pro/', 'acme.containers.piwik.pro']) {
      expect(readField(piwik, field(piwik), typed), typed).toBe('acme');
    }
    for (const typed of ['', 'acme corp', 'acme.example.com', 'a.b.piwik.pro']) expect(readField(piwik, field(piwik), typed), typed).toBeUndefined();
  });

  it('read a whole address, without its scheme, path or port', () => {
    for (const typed of ['matomo.shop.example', 'https://matomo.shop.example/', 'https://Matomo.Shop.Example:8443/index.php']) {
      expect(readField(matomo, field(matomo), typed), typed).toBe('matomo.shop.example');
    }
    for (const typed of ['matomo', 'not an address', 'https://']) expect(readField(matomo, field(matomo), typed), typed).toBeUndefined();
  });

  it('fill in the lines: the value typed, a wildcard for an empty account name, nothing for an empty address', () => {
    expect(sources(resolveVendor(piwik, { account: 'acme' }))).toEqual([['https://acme.containers.piwik.pro', 'https://acme.piwik.pro']]);
    expect(sources(resolveVendor(piwik))).toEqual([['https://*.containers.piwik.pro', 'https://*.piwik.pro']]);
    expect(sources(resolveVendor(matomo, { server: 'stats.shop.example' }))).toEqual([['https://stats.shop.example'], ["'self'", 'https://stats.shop.example']]);
    expect(sources(resolveVendor(matomo))).toEqual([[], ["'self'"]]);
    expect(sources(resolveVendor(matomo, { server: 'not an address' }))).toEqual([[], ["'self'"]]);
    expect(sources(resolveVendor(matomo, {}, 'example'))).toEqual([['https://matomo.example.com'], ["'self'", 'https://matomo.example.com']]);
  });

  it('can be filled in again from a tool already filled in, a line left empty included', () => {
    const once = resolveVendor(piwik);
    expect(sources(resolveVendor(once, { account: 'acme' }))).toEqual([['https://acme.containers.piwik.pro', 'https://acme.piwik.pro']]);
    expect(sources(resolveVendor(resolveVendor(matomo), { server: 'stats.shop.example' }))[0]).toEqual(['https://stats.shop.example']);
  });

  it('reach the checks through the selection', () => {
    const [s] = selectionsOf([resolveVendor(matomo)], { matomo: ['tracking', 'server=stats.shop.example'] });
    expect(s!.features.flatMap((f) => f.requirements.flatMap((r) => r.sources))).toContain('https://stats.shop.example');
  });

  it('stand, while nothing is picked, for every value the vendor lists, only where asked', () => {
    const datadog: Vendor = {
      ...matomo,
      id: 'datadog-rum',
      fields: [
        {
          id: 'intake',
          label: 'Your Datadog site',
          kind: 'host',
          example: 'browser-intake.example.com',
          options: [
            { label: 'US1', value: 'browser-intake-datadoghq.com' },
            { label: 'EU1', value: 'browser-intake-datadoghq.eu' },
          ],
        },
      ],
      features: [{ id: 'f', label: 'f', default: true, requirements: [{ type: 'connect', sources: ['https://{intake}', 'https://quota.{intake}'], reason: 'r' }] }],
    };
    expect(sources(resolveVendor(datadog, {}, 'choices'))[0]).toEqual([
      'https://browser-intake-datadoghq.com',
      'https://browser-intake-datadoghq.eu',
      'https://quota.browser-intake-datadoghq.com',
      'https://quota.browser-intake-datadoghq.eu',
    ]);
    expect(sources(resolveVendor(datadog))[0]).toEqual([]);
    expect(sources(resolveVendor(resolveVendor(datadog, {}, 'choices'), { intake: 'browser-intake-datadoghq.eu' }))[0]).toEqual([
      'https://browser-intake-datadoghq.eu',
      'https://quota.browser-intake-datadoghq.eu',
    ]);
  });
});
