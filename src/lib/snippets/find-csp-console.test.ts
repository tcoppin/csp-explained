import { afterEach, describe, expect, it, vi } from 'vitest';
import { parse } from '../csp/parser';
import { FIND_CSP_SNIPPET } from './find-csp-console';

/**
 * Runs the snippet against a fake page: a response with headers and a list of <meta> tags.
 * Like the DevTools console, `copy()` only counts while the pasted code runs: Chrome removes it after
 * the first await and Firefox ignores later calls. So the snippet must copy before it returns.
 */
function run(headers: Record<string, string>, metas: { httpEquiv: string; outerHTML: string }[] = [], withCopy = true) {
  const copy = vi.fn();
  const logs: string[] = [];
  vi.stubGlobal('location', { href: 'https://shop.example.com/' });
  vi.stubGlobal(
    'XMLHttpRequest',
    class {
      open(method: string, url: string, async: boolean) {
        expect([method, url, async]).toEqual(['GET', 'https://shop.example.com/', false]);
      }
      setRequestHeader() {}
      send() {}
      getResponseHeader(name: string) {
        return new Headers(headers).get(name);
      }
    },
  );
  vi.stubGlobal('document', { querySelectorAll: () => metas });
  if (withCopy) vi.stubGlobal('copy', copy);
  vi.spyOn(console, 'log').mockImplementation((m: string) => logs.push(m));
  const result: unknown = new Function(`return ${FIND_CSP_SNIPPET}`)();
  const copiedInTime = copy.mock.calls.map(([value]) => value);
  Reflect.deleteProperty(globalThis, 'copy');
  return { result, copiedInTime, logs };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('find-csp console snippet', () => {
  it('collects header and meta policies in a format the analyzer reads', () => {
    const { result } = run(
      { 'content-security-policy': "default-src 'self'", 'content-security-policy-report-only': 'script-src https:' },
      [{ httpEquiv: 'Content-Security-Policy', outerHTML: `<meta http-equiv="Content-Security-Policy" content="img-src *">` }],
    );
    expect(parse(result as string).policies.map((p) => [p.origin, p.reportOnly])).toEqual([
      ['header', false],
      ['header', true],
      ['meta', false],
    ]);
  });

  it('copies with the console helper before it returns, as Chrome and Firefox require', () => {
    const { result, copiedInTime, logs } = run({ 'content-security-policy': "default-src 'self'" });
    expect(result).toBeTypeOf('string');
    expect(copiedInTime).toEqual([result]);
    expect(logs).toContain('Copied to your clipboard.');
  });

  it('says how to copy by hand when the helper is not available', () => {
    const { logs } = run({ 'content-security-policy': "default-src 'self'" }, [], false);
    expect(logs).toContain('Could not copy automatically: select the text above and copy it.');
  });

  it('says so when there is no policy', () => {
    const { result } = run({});
    expect(result).toBe('No Content-Security-Policy found on https://shop.example.com/');
  });
});
