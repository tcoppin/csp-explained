import { describe, expect, it } from 'vitest';
import { checkRequirement } from './compat';
import { hashSource, inlineBlocks } from './hash';
import { parse } from './parser';

const SELF = 'https://shop.example.com';
// The example from the CSP specification.
const HELLO = "alert('Hello, world.');";
const HELLO_HASH = "'sha256-qznLcsROx4GACP2dm0UCKCzCG+HiZ1guq6ZZDob/Tng='";

describe('hashSource', () => {
  it('matches the specification example', async () => {
    expect(await hashSource(HELLO)).toBe(HELLO_HASH);
  });

  it('hashes the exact text, spaces included', async () => {
    expect(await hashSource(` ${HELLO}`)).not.toBe(HELLO_HASH);
  });

  it('hashes the UTF-8 bytes', async () => {
    expect(await hashSource('console.log("é")')).toBe("'sha256-VTYzPTDQuNPoWL/7G5e/rIEDQUCBzo6SN59iNx2PWNw='");
  });
});

describe('inlineBlocks', () => {
  it('takes text without tags as one block of unknown kind', () => {
    expect(inlineBlocks(HELLO)).toEqual([{ content: HELLO }]);
    expect(inlineBlocks('  \n')).toEqual([]);
  });

  it('reads each script and style element between its tags', () => {
    const html = `<style>\nbody { margin: 0 }\n</style>\n<SCRIPT type="module">${HELLO}</SCRIPT>`;
    expect(inlineBlocks(html)).toEqual([
      { kind: 'style', content: '\nbody { margin: 0 }\n' },
      { kind: 'script', content: HELLO },
    ]);
  });

  it('skips scripts that load a file, hold data, or are empty', () => {
    const html = [
      '<script src="/app.js"></script>',
      '<script type="application/ld+json">{"@type":"Thing"}</script>',
      '<script></script>',
      `<script type="text/javascript">${HELLO}</script>`,
    ].join('');
    expect(inlineBlocks(html).map((b) => b.skipped)).toEqual(['external', 'data', 'empty', undefined]);
  });

  it('turns Windows line breaks into the ones the browser hashes', () => {
    expect(inlineBlocks('<script>\r\na()\r\n</script>')[0]!.content).toBe('\na()\n');
  });
});

describe('hash requirements', () => {
  const check = (policy: string, type: 'inline-script' | 'inline-style' = 'inline-script') =>
    checkRequirement(parse(policy), { type, source: HELLO_HASH, reason: '' }, SELF);

  it('are allowed only when the directive lists the hash', () => {
    expect(check(`script-src 'self' ${HELLO_HASH}`).verdict).toBe('allowed');
    expect(check(`script-src 'self' ${HELLO_HASH}`).checks[0]!.match.matchedBy?.raw).toBe(HELLO_HASH);
    expect(check("script-src 'self'").verdict).toBe('blocked');
  });

  it("are blocked by a directive that only has 'unsafe-inline', since adding the hash is the point", () => {
    expect(check("script-src 'self' 'unsafe-inline'").verdict).toBe('blocked');
  });

  it('follow the fallback chain for styles', () => {
    expect(check(`default-src ${HELLO_HASH}`, 'inline-style').verdict).toBe('allowed');
    expect(check(`default-src ${HELLO_HASH}; style-src 'self'`, 'inline-style').verdict).toBe('blocked');
    expect(check('img-src *', 'inline-style').verdict).toBe('allowed');
  });
});
