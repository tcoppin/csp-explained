import { describe, expect, it } from 'vitest';
import { decodeState, encodeState, toOrigin, unreadableSite } from './state';

describe('share state', () => {
  it('round-trips through the URL fragment', () => {
    const state = { policy: "script-src 'self' https://é.example", site: 'shop.example.com', vendors: { 'ab-tasty': ['tag', 'editor'], intercom: ['messenger'] } };
    expect(decodeState(`#${encodeState(state)}`)).toEqual(state);
  });

  it('keeps the open view and audience', () => {
    const state = { policy: "img-src 'self'", site: '', vendors: {}, view: 'tools' as const, audience: 'security' as const };
    expect(decodeState(`#${encodeState(state)}`)).toMatchObject({ view: 'tools', audience: 'security' });
    expect(decodeState('#t=nope&a=nope')).toEqual({});
  });

  it('ignores malformed policies', () => {
    expect(decodeState('#p=%%%')).toEqual({});
  });
});

describe('toOrigin', () => {
  it('accepts bare hosts and full URLs', () => {
    expect(toOrigin('shop.example.com')).toBe('https://shop.example.com');
    expect(toOrigin('http://shop.example.com:8080/a')).toBe('http://shop.example.com:8080');
    expect(toOrigin('')).toBeUndefined();
  });

  it('keeps the scheme the visitor typed, http or https', () => {
    expect(toOrigin('http://shop.example.com')).toBe('http://shop.example.com');
    expect(toOrigin('HTTPS://Shop.Example.com/')).toBe('https://shop.example.com');
  });

  it('reads mistyped schemes as meant', () => {
    expect(toOrigin('http:/shop.example.com')).toBe('http://shop.example.com');
    expect(toOrigin('http//shop.example.com')).toBe('http://shop.example.com');
    expect(toOrigin('https:shop.example.com')).toBe('https://shop.example.com');
    expect(toOrigin('https:///shop.example.com')).toBe('https://shop.example.com');
    expect(toOrigin('Http:/shop.example.com:8080')).toBe('http://shop.example.com:8080');
  });

  it('accepts local and IP addresses', () => {
    expect(toOrigin('localhost:3000')).toBe('https://localhost:3000');
    expect(toOrigin('http://127.0.0.1:8080/')).toBe('http://127.0.0.1:8080');
    expect(toOrigin('http://[::1]:3000')).toBe('http://[::1]:3000');
  });

  it('turns down addresses that are not a site', () => {
    expect(toOrigin('shop example')).toBeUndefined();
    expect(toOrigin('file:///home/me/index.html')).toBeUndefined();
    expect(toOrigin('data:,hi')).toBeUndefined();
  });
});

describe('unreadableSite', () => {
  it('flags only a typed address we cannot read', () => {
    expect(unreadableSite('')).toBe(false);
    expect(unreadableSite('  ')).toBe(false);
    expect(unreadableSite('shop.example.com')).toBe(false);
    expect(unreadableSite('shop example')).toBe(true);
  });
});
