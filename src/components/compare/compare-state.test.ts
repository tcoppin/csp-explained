import { describe, expect, it } from 'vitest';
import { decodeCompareState, encodeCompareState } from './compare-state';

describe('compare state', () => {
  it('round-trips both policies, the site, the tools, the view and the reader', () => {
    const state = {
      before: "Content-Security-Policy-Report-Only: default-src 'self'",
      after: "default-src 'self'; script-src 'self' https://cdn.example.com 'nonce-é'",
      site: 'shop.example.com',
      vendors: { hotjar: ['tracking'] },
      view: 'security' as const,
      audience: 'developer' as const,
    };
    expect(decodeCompareState(`#${encodeCompareState(state)}`)).toEqual(state);
  });

  it('leaves defaults out of the link', () => {
    expect(encodeCompareState({ before: 'a', after: '', site: '', vendors: {}, view: 'changes', audience: 'simple' })).toBe('b=YQ');
    expect(encodeCompareState({ before: '', after: '', site: '', vendors: {}, view: 'diff', audience: 'security' })).toBe('');
  });

  it('ignores a malformed policy and unknown values, keeping the rest', () => {
    expect(decodeCompareState('#b=%%%&a=YQ&t=nope&r=boss')).toEqual({ after: 'a' });
  });
});
