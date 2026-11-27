import { describe, expect, it } from 'vitest';
import { checkRequirement } from './compat';
import { hashSource, inlineBlocks } from './hash';
import { buildPatches } from './patch';
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

  it('takes code that writes markup as one script, not as attributes', () => {
    const code = `el.innerHTML = '<button onclick="go()">Go</button>';`;
    expect(inlineBlocks(code)).toEqual([{ content: code }]);
  });

  it('gives nothing for markup without inline code', () => {
    expect(inlineBlocks('<p class="intro">Hello</p>')).toEqual([]);
  });
});

describe('inlineBlocks: attributes', () => {
  it('reads event handlers and style attributes, in their order, with their entities decoded as the browser does', () => {
    const html = `<button onclick="track(&quot;buy&quot;)" style="color: red">Buy</button>\n<img src="a.png" onerror='hide(this)'>`;
    expect(inlineBlocks(html)).toEqual([
      { kind: 'handler', content: 'track("buy")' },
      { kind: 'style-attr', content: 'color: red' },
      { kind: 'handler', content: 'hide(this)' },
    ]);
  });

  it('reads attributes pasted without their element', () => {
    expect(inlineBlocks(`onclick="go()"`)).toEqual([{ kind: 'handler', content: 'go()' }]);
    expect(inlineBlocks(`style='display:none' onmouseover="show()"`)).toEqual([
      { kind: 'style-attr', content: 'display:none' },
      { kind: 'handler', content: 'show()' },
    ]);
  });

  it("puts a script's own handler before its content, and doesn't read markup inside scripts", () => {
    const html = `<script onload="ready()">document.write('<b onclick="x()">')</script>`;
    expect(inlineBlocks(html)).toEqual([
      { kind: 'handler', content: 'ready()' },
      { kind: 'script', content: `document.write('<b onclick="x()">')` },
    ]);
  });

  it('leaves out javascript: links, which browsers check like <script> blocks, and empty attributes', () => {
    expect(inlineBlocks('<a href="javascript:void(0)" onclick="">x</a>').map((b) => b.skipped)).toEqual(['javascript-link', 'empty']);
  });
});

describe('inlineBlocks: external scripts', () => {
  const SHA384 = 'sha384-oqVuAfXRKap7fdgcCY5uykM6+R9GqQ8K/uxy9rx7HNQlGYl1kPzQho1wx4JwY8wC';

  it('gives the hashes of the integrity attribute, all of which the policy must list', () => {
    const [b] = inlineBlocks(`<script src="https://cdn.example.org/lib.js" integrity="${SHA384} sha256-abc=" crossorigin="anonymous"></script>`);
    expect(b).toEqual({ kind: 'script', content: '', src: 'https://cdn.example.org/lib.js', integrity: [`'${SHA384}'`, "'sha256-abc='"] });
  });

  it('ignores options and algorithms the browser ignores', () => {
    expect(inlineBlocks(`<script src="/a.js" integrity="md5-abc ${SHA384}?ct=application/javascript"></script>`)[0]!.integrity).toEqual([`'${SHA384}'`]);
    expect(inlineBlocks('<script src="/a.js" integrity="md5-abc"></script>')[0]!.skipped).toBe('external');
  });
});

describe('hash requirements', () => {
  const check = (policy: string, type: 'inline-script' | 'inline-style' | 'inline-handler' | 'style-attr' = 'inline-script') =>
    checkRequirement(parse(policy), { type, source: HELLO_HASH, reason: '' }, SELF);

  it('are allowed only when the directive lists the hash', () => {
    expect(check(`script-src 'self' ${HELLO_HASH}`).verdict).toBe('allowed');
    expect(check(`script-src 'self' ${HELLO_HASH}`).checks[0]!.match.matchedBy?.raw).toBe(HELLO_HASH);
    expect(check("script-src 'self'").verdict).toBe('blocked');
  });

  it("are blocked by a directive that only has 'unsafe-inline', since adding the hash is the point", () => {
    expect(check("script-src 'self' 'unsafe-inline'").verdict).toBe('blocked');
  });

  it("count for event handlers and style attributes only next to 'unsafe-hashes'", () => {
    expect(check(`script-src 'self' ${HELLO_HASH}`, 'inline-handler').verdict).toBe('blocked');
    expect(check(`script-src 'self' 'unsafe-hashes' ${HELLO_HASH}`, 'inline-handler').verdict).toBe('allowed');
    expect(check(`script-src-attr 'unsafe-hashes' ${HELLO_HASH}; script-src 'none'`, 'inline-handler').verdict).toBe('allowed');
    expect(check(`style-src 'self' ${HELLO_HASH}`, 'style-attr').verdict).toBe('blocked');
    expect(check(`style-src-attr 'unsafe-hashes' ${HELLO_HASH}`, 'style-attr').verdict).toBe('allowed');
  });

  it('follow the fallback chain for styles', () => {
    expect(check(`default-src ${HELLO_HASH}`, 'inline-style').verdict).toBe('allowed');
    expect(check(`default-src ${HELLO_HASH}; style-src 'self'`, 'inline-style').verdict).toBe('blocked');
    expect(check('img-src *', 'inline-style').verdict).toBe('allowed');
  });
});

describe('patches for attribute hashes', () => {
  const patched = (policy: string, type: 'inline-handler' | 'style-attr' = 'inline-handler') => {
    const parsed = parse(policy);
    return buildPatches(parsed, [checkRequirement(parsed, { type, source: HELLO_HASH, reason: '' }, SELF)], SELF)[0]?.after;
  };

  it("put them in the attribute's own rule with 'unsafe-hashes', so <script> blocks keep 'unsafe-inline'", () => {
    expect(patched("script-src 'self' 'unsafe-inline'")).toBe(`script-src 'self' 'unsafe-inline'; script-src-attr 'unsafe-hashes' ${HELLO_HASH}`);
    expect(patched("default-src 'self'", 'style-attr')).toBe(`default-src 'self'; style-src-attr 'unsafe-hashes' ${HELLO_HASH}`);
  });

  it("add only what is missing to an existing attribute rule", () => {
    expect(patched("script-src-attr 'none'")).toBe(`script-src-attr 'unsafe-hashes' ${HELLO_HASH}`);
    expect(patched(`script-src-attr ${HELLO_HASH}`)).toBe(`script-src-attr ${HELLO_HASH} 'unsafe-hashes'`);
    expect(patched(`script-src-attr 'unsafe-hashes' ${HELLO_HASH}`)).toBeUndefined();
  });
});
