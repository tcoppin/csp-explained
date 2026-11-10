import { describe, expect, it } from 'vitest';
import { decodeBuildState, encodeBuildState, unpackTools, type BuildState } from './build-state';
import { encodeState } from '../policy/state';

const tools = [{ id: 'own-1', name: 'Our CDN', needs: [{ type: 'img' as const, sources: ['cdn.example.org', 'https://é.example'] }] }];

describe('build state', () => {
  it('round-trips through the URL fragment', () => {
    const state: BuildState = {
      start: 'policy',
      policy: "default-src 'self'",
      site: 'shop.example.com',
      needs: ['inline-scripts', 'inline-styles', 'data-images'],
      hashes: { 'inline-scripts': [], 'inline-styles': ["'sha256-47DEQpj8HBSa+/TImW5JCeuQeRkm5NMpJWZG3hSuFU='"] },
      vendors: { hotjar: ['tracking'] },
      tools,
      step: 'review',
      audience: 'developer',
    };
    expect(decodeBuildState(`#${encodeBuildState(state)}`)).toEqual(state);
  });

  it('only carries the policy when building on one', () => {
    const hash = encodeBuildState({ start: 'nonce', policy: "img-src 'self'", site: '', needs: [], hashes: {}, vendors: {}, tools: [] });
    expect(decodeBuildState(hash)).toEqual({ start: 'nonce' });
  });

  it('only carries hashes for the needs that are ticked', () => {
    const hash = encodeBuildState({ policy: '', site: '', needs: [], hashes: { 'inline-scripts': ["'sha256-abc='"] }, vendors: {}, tools: [] });
    expect(decodeBuildState(hash).hashes).toBeUndefined();
  });

  it('builds on a policy sent by the analyzer', () => {
    const hash = encodeState({ policy: "default-src 'self'", site: 'shop.example.com', vendors: { hotjar: ['tracking'] }, view: 'tools' });
    expect(decodeBuildState(hash)).toEqual({ start: 'policy', policy: "default-src 'self'", site: 'shop.example.com', vendors: { hotjar: ['tracking'] } });
  });

  it('drops what it does not understand', () => {
    expect(decodeBuildState('#b=nope&n=eval,nope&step=nope&c=%%%')).toEqual({ needs: ['eval'] });
    expect(decodeBuildState('#hi=sha256-abc%3D,nope,md5-abc').hashes).toEqual({ 'inline-scripts': ["'sha256-abc='"] });
    expect(unpackTools([['', []], ['A', [['nope', ['x']], ['img', ['a.example', 3]]]], 'x'])).toEqual([
      { id: 'own-2', name: 'A', needs: [{ type: 'img', sources: ['a.example'] }] },
    ]);
  });
});
