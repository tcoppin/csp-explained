import { describe, expect, it } from 'vitest';
import { translatorFor } from '../../i18n';
import { DIRECTIVES } from '../../lib/csp/directives';
import { parse } from '../../lib/csp/parser';
import { issueText } from './Explanation';

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
