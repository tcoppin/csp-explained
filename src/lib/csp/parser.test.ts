import { describe, expect, it } from 'vitest';
import { issuesAt, parse } from './parser';

const codes = (input: string) => parse(input).issues.map((i) => i.code);

describe('parse', () => {
  it('parses a bare policy into directives and classified sources', () => {
    const { policies } = parse("default-src 'self'; script-src 'self' https://cdn.example.com 'nonce-abc123' 'sha256-AAAA'; img-src data: *");
    expect(policies).toHaveLength(1);
    const [p] = policies;
    expect(p!.origin).toBe('raw');
    expect(p!.directives.map((d) => d.name)).toEqual(['default-src', 'script-src', 'img-src']);
    expect(p!.directives[1]!.values.map((v) => v.kind)).toEqual(['keyword', 'host', 'nonce', 'hash']);
    expect(p!.directives[2]!.values.map((v) => v.kind)).toEqual(['scheme', 'host']);
    expect(p!.directives[1]!.values[1]!.host).toEqual({ scheme: 'https', host: 'cdn.example.com' });
  });

  it('keeps spans pointing into the policy text', () => {
    const { policies } = parse("  script-src   'self'  ;img-src https://a.example.com:8080/x/");
    const p = policies[0]!;
    for (const d of p.directives) {
      expect(p.text.slice(d.nameSpan.start, d.nameSpan.end)).toBe(d.name);
      for (const v of d.values) expect(p.text.slice(v.span.start, v.span.end)).toBe(v.raw);
    }
    expect(p.directives[1]!.values[0]!.host).toEqual({ scheme: 'https', host: 'a.example.com', port: '8080', path: '/x/' });
  });

  it('lowercases directive names and keywords', () => {
    const d = parse("SCRIPT-SRC 'SELF'").policies[0]!.directives[0]!;
    expect(d.name).toBe('script-src');
    expect(d.values[0]!.value).toBe("'self'");
  });

  it('reads header lines and report-only policies from curl output', () => {
    const { policies } = parse(
      [
        'HTTP/2 200',
        'content-type: text/html',
        "Content-Security-Policy: default-src 'self'",
        'content-security-policy-report-only: script-src https:; report-uri /csp',
      ].join('\n'),
    );
    expect(policies.map((p) => [p.origin, p.reportOnly])).toEqual([
      ['header', false],
      ['header', true],
    ]);
  });

  it('splits comma separated policies', () => {
    expect(parse("default-src 'self', img-src *").policies).toHaveLength(2);
  });

  it('extracts policies from meta tags and flags directives ignored there', () => {
    const html = `<head><meta http-equiv="Content-Security-Policy" content="default-src 'self'; frame-ancestors 'none'"></head>`;
    const result = parse(html);
    expect(result.policies[0]!.origin).toBe('meta');
    expect(result.issues.map((i) => [i.code, i.directive])).toContainEqual(['ignored-in-meta', 'frame-ancestors']);
  });

  it('decodes HTML entities in meta content', () => {
    const html = `<meta content="script-src &#39;self&#39;" http-equiv="content-security-policy">`;
    expect(parse(html).policies[0]!.directives[0]!.values[0]!.kind).toBe('keyword');
  });

  it('reports common mistakes', () => {
    expect(codes('script-src self')).toContain('missing-quotes');
    expect(codes("script-src 'self'; script-src *")).toContain('duplicate-directive');
    expect(codes("scirpt-src 'self'")).toContain('unknown-directive');
    expect(codes('report-uri /csp')).toContain('deprecated-directive');
    expect(codes("img-src 'none' https:")).toContain('none-with-other-sources');
    expect(codes("script-src 'unsafe-inlin'")).toContain('invalid-source');
    expect(codes('')).toContain('empty-input');
  });

  it('recognises a console error message instead of reading it as a policy', () => {
    const errors = {
      chrome: `Refused to load the script 'https://cdn.vendor.example/tag.js' because it violates the following Content Security Policy directive: "script-src 'self' https://www.googletagmanager.com".`,
      // Copied from a console or a page that wrapped the message onto two lines.
      wrapped: `Refused to load the script 'https://cdn.vendor.example/tag.js' because it violates the following\nContent Security Policy directive: "script-src 'self'".`,
      firefox: `Content-Security-Policy: The page’s settings blocked the loading of a resource (script-src-elem) at https://cdn.vendor.example/tag.js because it violates the following directive: “script-src 'self'”`,
      safari: `Refused to load https://cdn.vendor.example/tag.js because it does not appear in the script-src directive of the Content Security Policy.`,
    };
    for (const [browser, message] of Object.entries(errors)) {
      const result = parse(message);
      expect(result.policies, browser).toEqual([]);
      expect(result.issues.find((i) => i.code === 'violation-message')?.directive, browser).toMatch(/^script-src/);
    }
  });

  it('still reads a policy pasted together with an error message', () => {
    const result = parse(`Content-Security-Policy: script-src 'self'\nRefused to load the script because it violates the following Content Security Policy directive: "script-src 'self'".`);
    expect(result.policies).toHaveLength(1);
    expect(result.issues.map((i) => i.code)).not.toContain('violation-message');
  });

  it('marks the second occurrence of a directive as duplicate', () => {
    const ds = parse("script-src 'self'; script-src *").policies[0]!.directives;
    expect(ds.map((d) => d.duplicate)).toEqual([false, true]);
  });

  it('gives each directive and value only its own issues', () => {
    const { policies, issues } = parse('script-src a; script-src b; script-src self');
    const [first, second, third] = policies[0]!.directives;
    expect(issuesAt(issues, 0, first!)).toEqual([]);
    expect(issuesAt(issues, 0, second!).map((i) => i.code)).toEqual(['duplicate-directive']);
    expect(issuesAt(issues, 0, third!).map((i) => i.code)).toEqual(['duplicate-directive']);
    expect(issuesAt(issues, 0, third!, third!.values[0]).map((i) => i.code)).toEqual(['missing-quotes']);
    expect(issuesAt(issues, 1, second!)).toEqual([]);
  });

  it('treats values of non source-list directives as tokens', () => {
    const d = parse('sandbox allow-scripts allow-forms').policies[0]!.directives[0]!;
    expect(d.values.every((v) => v.kind === 'token')).toBe(true);
  });
});
