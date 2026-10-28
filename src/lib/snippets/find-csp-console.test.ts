import { afterEach, describe, expect, it, vi } from 'vitest';
import { parse } from '../csp/parser';
import { FIND_CSP_SNIPPET } from './find-csp-console';

/**
 * Runs the snippet against a fake page: a response with headers and a list of <meta> tags.
 * Like the DevTools console, `copy()` only exists until the snippet first waits (on fetch).
 */
async function run(headers: Record<string, string>, metas: { httpEquiv: string; outerHTML: string }[] = [], withCopy = true) {
  const copy = vi.fn();
  const logs: string[] = [];
  vi.stubGlobal('location', { href: 'https://shop.example.com/' });
  vi.stubGlobal('fetch', async () => {
    Reflect.deleteProperty(globalThis, 'copy');
    return new Response('', { headers });
  });
  vi.stubGlobal('document', { querySelectorAll: () => metas });
  if (withCopy) vi.stubGlobal('copy', copy);
  vi.spyOn(console, 'log').mockImplementation((m: string) => logs.push(m));
  const result = (await new Function(`return ${FIND_CSP_SNIPPET}`)()) as string;
  return { result, copy, logs };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('find-csp console snippet', () => {
  it('collects header and meta policies in a format the analyzer reads', async () => {
    const { result } = await run(
      { 'content-security-policy': "default-src 'self'", 'content-security-policy-report-only': 'script-src https:' },
      [{ httpEquiv: 'Content-Security-Policy', outerHTML: `<meta http-equiv="Content-Security-Policy" content="img-src *">` }],
    );
    expect(parse(result).policies.map((p) => [p.origin, p.reportOnly])).toEqual([
      ['header', false],
      ['header', true],
      ['meta', false],
    ]);
  });

  it('copies with the console helper even though it is gone after the first await', async () => {
    const { result, copy, logs } = await run({ 'content-security-policy': "default-src 'self'" });
    expect(copy).toHaveBeenCalledWith(result);
    expect(logs).toContain('Copied to your clipboard.');
  });

  it('says how to copy by hand when the helper is not available', async () => {
    const { logs } = await run({ 'content-security-policy': "default-src 'self'" }, [], false);
    expect(logs).toContain('Could not copy automatically: select the text above and copy it.');
  });

  it('says so when there is no policy', async () => {
    const { result } = await run({});
    expect(result).toBe('No Content-Security-Policy found on https://shop.example.com/');
  });
});
