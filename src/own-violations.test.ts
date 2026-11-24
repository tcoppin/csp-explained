import { describe, expect, it } from 'vitest';
import { shortAddress, violationKind, violationLogLine, violationRecord } from './own-violations';

describe('shortAddress', () => {
  it('keeps the origin and path of a web address, never its query or fragment', () => {
    expect(shortAddress('https://evil.example/x.js?user=jane#t')).toBe('https://evil.example/x.js');
    expect(shortAddress('http://localhost:4321/')).toBe('http://localhost:4321/');
  });

  it('keeps the keywords browsers use for code that is not a file', () => {
    expect(shortAddress('inline')).toBe('inline');
    expect(shortAddress('eval')).toBe('eval');
    expect(shortAddress('trusted-types-sink')).toBe('trusted-types-sink');
    expect(shortAddress('')).toBe('');
  });

  it('cuts other schemes to the scheme alone, and refuses what is not an address', () => {
    expect(shortAddress('data:text/javascript,alert(1)')).toBe('data:');
    expect(shortAddress('blob:https://csp-explained.com/1234')).toBe('blob:');
    expect(shortAddress('<script>alert(1)</script>')).toBeUndefined();
  });

  it('keeps long addresses short', () => {
    expect(shortAddress(`https://evil.example/${'a'.repeat(500)}`)).toHaveLength(200);
  });
});

describe('violationKind', () => {
  it('tells code that tried to run from other resources', () => {
    for (const d of ['script-src', 'script-src-elem', 'script-src-attr', 'worker-src', 'require-trusted-types-for', 'trusted-types']) {
      expect(violationKind(d)).toBe('script');
    }
    for (const d of ['img-src', 'style-src-elem', 'connect-src', 'font-src']) expect(violationKind(d)).toBe('other');
  });
});

describe('violationRecord', () => {
  it('keeps what a browser sends for a blocked script', () => {
    expect(violationRecord({ d: 'script-src-elem', b: 'https://evil.example/x.js?id=1', s: 'https://csp-explained.com/fr/build', l: '12', p: '/fr/build' })).toEqual({
      kind: 'script',
      directive: 'script-src-elem',
      blocked: 'https://evil.example/x.js',
      source: 'https://csp-explained.com/fr/build',
      line: 12,
      page: '/fr/build',
    });
    expect(violationRecord({ d: 'img-src', b: 'https://tracker.example/p.gif', s: '', l: '0', p: '/' })).toMatchObject({
      kind: 'other',
      source: '',
      line: 0,
    });
  });

  it('drops what visitors’ extensions trigger', () => {
    expect(violationRecord({ d: 'script-src-elem', b: 'chrome-extension://abc/content.js', p: '/' })).toBeUndefined();
    expect(violationRecord({ d: 'style-src-elem', b: 'inline', s: 'moz-extension://abc/inject.js', p: '/' })).toBeUndefined();
    expect(violationRecord({ d: 'script-src-elem', b: 'safari-web-extension://abc/x.js', p: '/' })).toBeUndefined();
  });

  it('refuses anything else, since anyone can call the endpoint', () => {
    expect(violationRecord({})).toBeUndefined();
    expect(violationRecord({ d: "script-src 'self'", b: 'inline', p: '/' })).toBeUndefined();
    expect(violationRecord({ d: 'script-src', b: 'inline', p: 'https://elsewhere.example/' })).toBeUndefined();
    expect(violationRecord({ d: 'script-src', b: 'inline', p: '/search?q=jane' })).toBeUndefined();
    expect(violationRecord({ d: 'script-src', b: '<img onerror=alert(1)>', p: '/' })).toBeUndefined();
    expect(violationRecord({ d: 'script-src', b: 'inline', s: 'eval', p: '/' })).toBeUndefined();
    expect(violationRecord({ d: 'script-src', b: 'inline', p: '/', l: 'twelve' })).not.toHaveProperty('line');
  });
});

describe('violationLogLine', () => {
  it('writes one embedded-metric line counting the violation by kind', () => {
    const record = violationRecord({ d: 'script-src-elem', b: 'https://evil.example/x.js', s: '', l: '3', p: '/' })!;
    const line = JSON.parse(violationLogLine(record, 1_700_000_000_000));
    expect(line).toMatchObject({ Kind: 'script', Violations: 1, Directive: 'script-src-elem', Blocked: 'https://evil.example/x.js', Line: 3, Page: '/' });
    expect(line._aws.CloudWatchMetrics[0]).toMatchObject({ Namespace: 'CspExplained/Violations', Dimensions: [['Kind']] });
  });
});
