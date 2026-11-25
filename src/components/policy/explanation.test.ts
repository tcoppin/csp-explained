import { describe, expect, it } from 'vitest';
import { translatorFor } from '../../i18n';
import { DIRECTIVES } from '../../lib/csp/directives';
import { parse } from '../../lib/csp/parser';
import { issueText, skippedText } from './Explanation';

const deprecated = [...DIRECTIVES.values()].filter((d) => d.deprecated).map((d) => d.name);

describe('issueText', () => {
  it.each(['en', 'fr'])('has its own message for each deprecated directive (%s)', (locale) => {
    const t = translatorFor({ currentLocale: locale });
    for (const name of deprecated) expect(t.has(`issues.deprecated.${name}`), name).toBe(true);
  });

  it("never says report-uri has no effect: it still works, and some browsers only report through it", () => {
    const t = translatorFor({ currentLocale: 'en' });
    const issue = parse('report-uri /csp').issues.find((i) => i.code === 'deprecated-directive')!;
    expect(issueText(t, issue)).toContain('still works');
    expect(issueText(t, issue)).not.toContain('no effect');
  });
});

describe('skippedText', () => {
  const t = translatorFor({ currentLocale: 'en' });
  const at = (text: string, directive: string, value: string) => {
    const policy = parse(text).policies[0]!;
    const d = policy.directives.find((x) => x.name === directive)!;
    return skippedText(t, policy, d, d.values.find((v) => v.raw === value)!);
  };
  const STRICT = "script-src 'nonce-abc123' 'strict-dynamic' https: 'unsafe-inline'";

  it("says why hosts, schemes and 'unsafe-inline' are skipped next to 'strict-dynamic'", () => {
    expect(at(STRICT, 'script-src', 'https:')).toContain("because of 'strict-dynamic'");
    expect(at(STRICT, 'script-src', "'unsafe-inline'")).toContain("because of 'strict-dynamic'");
    expect(at(STRICT, 'script-src', "'nonce-abc123'")).toBeUndefined();
  });

  it("says 'unsafe-inline' is skipped next to a nonce or a hash, for scripts and styles", () => {
    expect(at("script-src 'self' 'nonce-abc123' 'unsafe-inline'", 'script-src', "'unsafe-inline'")).toContain('nonce or a hash');
    expect(at("style-src 'sha256-abc=' 'unsafe-inline'", 'style-src', "'unsafe-inline'")).toContain('nonce or a hash');
    expect(at("script-src 'self' 'unsafe-inline'", 'script-src', "'unsafe-inline'")).toBeUndefined();
  });

  it('in default-src, says it only for scripts, and only when scripts use that rule', () => {
    const text = "default-src 'nonce-abc123' 'strict-dynamic' https:";
    expect(at(text, 'default-src', 'https:')).toMatch(/^For scripts: .*still uses it\.$/);
    expect(at(`${text}; script-src 'self'`, 'default-src', 'https:')).toBeUndefined();
  });
});
