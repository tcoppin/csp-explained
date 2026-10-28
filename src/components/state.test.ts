import { describe, expect, it } from 'vitest';
import { decodeState, encodeState, toOrigin } from './state';

describe('share state', () => {
  it('round-trips through the URL fragment', () => {
    const state = { policy: "script-src 'self' https://é.example", site: 'shop.example.com', vendors: { 'ab-tasty': ['tag', 'editor'], intercom: ['messenger'] } };
    expect(decodeState(`#${encodeState(state)}`)).toEqual(state);
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
});
