import { describe, expect, it } from 'vitest';
import { diffDirectives, diffPolicies, effectiveChanges, pairPolicies } from './diff';
import { parse, parseSinglePolicy } from './parser';

const SELF = 'https://shop.example.com';
const policy = (text: string, reportOnly = false) => parseSinglePolicy(text, 'raw', reportOnly);
const summary = (before: string, after: string) =>
  diffDirectives(policy(before), policy(after)).map((d) => [d.name, d.status, d.values.map((v) => `${v.status[0]}:${v.raw}`).join(' ')]);

describe('diffDirectives', () => {
  it('marks directives and values added, removed or unchanged', () => {
    expect(summary("default-src 'self'; script-src 'self' cdn.a.com; img-src *", "default-src 'self'; script-src 'self' cdn.b.com; font-src 'self'")).toEqual([
      ['default-src', 'unchanged', "u:'self'"],
      ['script-src', 'changed', "u:'self' r:cdn.a.com a:cdn.b.com"],
      ['img-src', 'removed', 'r:*'],
      ['font-src', 'added', "a:'self'"],
    ]);
  });

  it('ignores case and order where the browser does, not in nonces and hashes', () => {
    expect(summary("Script-Src 'SELF' https://CDN.a.com 'nonce-AbC'", "script-src https://cdn.a.com 'self' 'nonce-abc'")).toEqual([
      ['script-src', 'changed', "u:https://cdn.a.com r:'nonce-AbC' u:'self' a:'nonce-abc'"],
    ]);
  });

  it('compares the directive the browser reads, not a repeat it ignores', () => {
    expect(summary("img-src 'self'; img-src *", "img-src 'self'")).toEqual([['img-src', 'unchanged', "u:'self'"]]);
  });

  it('keeps removed values next to where they stood', () => {
    expect(summary('script-src a.com b.com c.com d.com', 'script-src a.com c.com e.com')).toEqual([
      ['script-src', 'changed', 'u:a.com r:b.com u:c.com r:d.com a:e.com'],
    ]);
  });
});

describe('effectiveChanges', () => {
  const changes = (before: string | undefined, after: string | undefined) =>
    effectiveChanges(before === undefined ? undefined : policy(before), after === undefined ? undefined : policy(after), SELF);

  it('follows the fallback: a new script-src takes scripts away from default-src', () => {
    const c = changes("default-src 'self' cdn.a.com", "default-src 'self' cdn.a.com; script-src 'self'");
    const moved = { kind: 'sources', before: 'default-src', after: 'script-src', added: [], removed: ['cdn.a.com'] };
    // Workers fall back to script-src too.
    expect(c).toEqual([
      { ...moved, type: 'script' },
      { ...moved, type: 'worker' },
    ]);
  });

  it('leaves out sources the browser ignores next to strict-dynamic', () => {
    const c = changes("script-src 'self' cdn.a.com", "script-src 'self' cdn.a.com 'nonce-r4nd' 'strict-dynamic'");
    const scripts = c.find((x) => x.type === 'script');
    expect(scripts).toMatchObject({ added: ["'nonce-r4nd'", "'strict-dynamic'"], removed: ["'self'", 'cdn.a.com'] });
  });

  it('reports inline code and eval by verdict', () => {
    const c = changes("script-src 'self' 'unsafe-inline' 'unsafe-eval'", "script-src 'self' 'nonce-r4nd'");
    expect(c.filter((x) => x.kind === 'verdict').map((x) => x.kind === 'verdict' && [x.type, x.verdictBefore, x.verdictAfter])).toEqual([
      ['inline-script', 'allowed', 'needs-nonce'],
      ['inline-handler', 'allowed', 'blocked'],
      ['eval', 'allowed', 'blocked'],
    ]);
  });

  it('treats a missing policy as allowing everything', () => {
    const c = changes(undefined, "default-src 'self'");
    expect(c.find((x) => x.type === 'img')).toEqual({ kind: 'sources', type: 'img', before: undefined, after: 'default-src', added: ["'self'"], removed: [] });
    expect(c.find((x) => x.type === 'inline-style')).toMatchObject({ verdictBefore: 'allowed', verdictAfter: 'blocked' });
  });

  it('finds nothing when only the wording changed', () => {
    expect(changes("default-src 'self'; img-src 'self'", "img-src 'SELF'; default-src 'self'")).toEqual([]);
  });
});

describe('pairPolicies', () => {
  const indices = (before: string, after: string) =>
    pairPolicies(parse(before).policies, parse(after).policies).map((p) => [p.beforeIndex, p.afterIndex]);

  it('pairs in order when both sides have as many policies, even across modes', () => {
    expect(indices("Content-Security-Policy-Report-Only: default-src 'self'", "Content-Security-Policy: default-src 'self'")).toEqual([[0, 0]]);
  });

  it('pairs by mode otherwise, leaving the rest alone', () => {
    const before = "Content-Security-Policy: default-src 'self'";
    const after = "Content-Security-Policy-Report-Only: script-src 'none'\nContent-Security-Policy: default-src 'self'";
    expect(indices(before, after)).toEqual([
      [0, 1],
      [undefined, 0],
    ]);
  });
});

describe('diffPolicies', () => {
  it('says when a policy moves from Report-Only to enforced', () => {
    const [d] = diffPolicies(
      parse("Content-Security-Policy-Report-Only: default-src 'self'").policies,
      parse("Content-Security-Policy: default-src 'self'").policies,
      SELF,
    );
    expect(d).toMatchObject({ status: 'changed', modeChanged: true, deliveryChanged: false, effective: [] });
  });

  it('says when a policy moves from a header to a meta tag, not when it was pasted bare', () => {
    const meta = `<meta http-equiv="Content-Security-Policy" content="default-src 'self'">`;
    expect(diffPolicies(parse("Content-Security-Policy: default-src 'self'").policies, parse(meta).policies, SELF)[0]).toMatchObject({
      status: 'changed',
      deliveryChanged: true,
    });
    expect(diffPolicies(parse("default-src 'self'").policies, parse(meta).policies, SELF)[0]).toMatchObject({
      status: 'unchanged',
      deliveryChanged: false,
    });
  });

  it('marks a policy added when the before side had none', () => {
    expect(diffPolicies([], parse("default-src 'self'").policies, SELF).map((d) => d.status)).toEqual(['added']);
  });
});
