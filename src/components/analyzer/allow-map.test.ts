import { describe, expect, it } from 'vitest';
import type { ResourceType } from '../../lib/csp/directives';
import { parseSinglePolicy } from '../../lib/csp/parser';
import { appliesTo } from './AllowMap';

/** The values "What it allows" lists for one kind of content, from a directive's values. */
const shown = (values: string, type: ResourceType) =>
  parseSinglePolicy(`default-src ${values}`).directives[0]!.values.filter((v) => appliesTo(v, type)).map((v) => v.raw);

const ALL = "'self' 'unsafe-inline' 'unsafe-eval' 'nonce-abc' 'strict-dynamic' https://cdn.example";

describe('appliesTo', () => {
  it('lists everything written for scripts beside scripts', () => {
    expect(shown(ALL, 'script')).toEqual(ALL.split(' '));
  });

  it("leaves inline-code keywords and nonces off workers, which only addresses and 'strict-dynamic' reach", () => {
    expect(shown(ALL, 'worker')).toEqual(["'self'", "'strict-dynamic'", 'https://cdn.example']);
  });

  it('keeps only addresses for content that is never inline code', () => {
    expect(shown(ALL, 'img')).toEqual(["'self'", 'https://cdn.example']);
    expect(shown("'unsafe-inline'", 'font')).toEqual([]);
  });
});
