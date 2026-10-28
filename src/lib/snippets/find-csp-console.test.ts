import { afterEach, describe, expect, it, vi } from 'vitest';
import { parse } from '../csp/parser';
import { FIND_CSP_SNIPPET } from './find-csp-console';

/** Runs the snippet against a fake page: a response with headers and a list of <meta> tags. */
async function run(headers: Record<string, string>, metas: { httpEquiv: string; outerHTML: string }[] = []) {
  const copy = vi.fn();
  vi.stubGlobal('location', { href: 'https://shop.example.com/' });
  vi.stubGlobal('fetch', async () => new Response('', { headers }));
  vi.stubGlobal('document', { querySelectorAll: () => metas });
  vi.stubGlobal('copy', copy);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  const result = (await new Function(`return ${FIND_CSP_SNIPPET}`)()) as string;
  return { result, copy };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('find-csp console snippet', () => {
  it('collects header and meta policies in a format the analyzer reads', async () => {
    const { result, copy } = await run(
      { 'content-security-policy': "default-src 'self'", 'content-security-policy-report-only': 'script-src https:' },
      [{ httpEquiv: 'Content-Security-Policy', outerHTML: `<meta http-equiv="Content-Security-Policy" content="img-src *">` }],
    );
    expect(copy).toHaveBeenCalledWith(result);
    expect(parse(result).policies.map((p) => [p.origin, p.reportOnly])).toEqual([
      ['header', false],
      ['header', true],
      ['meta', false],
    ]);
  });

  it('says so when there is no policy', async () => {
    const { result } = await run({});
    expect(result).toBe('No Content-Security-Policy found on https://shop.example.com/');
  });
});
