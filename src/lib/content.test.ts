import { describe, expect, it } from 'vitest';
import { content, explainSource } from './content';
import { DIRECTIVES } from './csp/directives';
import { classify } from './csp/parser';

describe('content', () => {
  it('explains every known directive', () => {
    const missing = [...DIRECTIVES.keys()].filter((name) => !content.directives[name]);
    expect(missing).toEqual([]);
  });

  it('explains common source expressions', () => {
    for (const raw of ["'self'", "'unsafe-inline'", "'nonce-abc'", "'sha256-abc'", '*', '*.example.com', 'https:', 'data:', 'wss:', 'cdn.example.com']) {
      expect(explainSource(content, classify(raw, { start: 0, end: raw.length })), raw).toBeDefined();
    }
  });

  it('loads the vendor catalogue', () => {
    expect(content.vendors.length).toBeGreaterThan(0);
  });
});
