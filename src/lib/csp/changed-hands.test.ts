import { describe, expect, it } from 'vitest';
import { CHANGED_HANDS, changedHandsOf } from './changed-hands';

describe('changedHandsOf', () => {
  it('knows polyfill.io however the source is written', () => {
    for (const v of ['polyfill.io', 'https://polyfill.io', 'https://cdn.polyfill.io', 'cdn.polyfill.io/v3/', '*.polyfill.io', 'https://CDN.Polyfill.io:443/v3/polyfill.min.js']) {
      expect(changedHandsOf(v)?.id, v).toBe('polyfill-io');
    }
  });

  it('leaves other hosts alone, including the replacements and look-alikes', () => {
    for (const v of ['https://cdnjs.cloudflare.com/polyfill/', 'https://polyfill-fastly.io', 'polyfill.io.example.com', 'notpolyfill.io', '*.io', '*', 'https:', "'self'", undefined]) {
      expect(changedHandsOf(v), String(v)).toBeUndefined();
    }
  });

  it('gives a source and a date for every domain', () => {
    for (const d of CHANGED_HANDS) {
      expect(d.sources.length, d.id).toBeGreaterThan(0);
      expect(d.lastVerified, d.id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});
