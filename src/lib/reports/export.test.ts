import { describe, expect, it } from 'vitest';
import { escapeHtml, exportFileName, printTitle } from './export';

describe('report export', () => {
  it('names files after the report', () => {
    expect(exportFileName('security', 'html')).toBe('csp-security-review.html');
    expect(exportFileName('developer', 'md')).toBe('csp-change.md');
    expect(exportFileName('simple', 'txt')).toBe('csp-request-to-it.txt');
  });

  it('titles the printed report with the host of the site, as typed or not', () => {
    expect(printTitle('Security review', '')).toBe('Security review');
    expect(printTitle('Security review', 'shop.example.com')).toBe('Security review – shop.example.com');
    expect(printTitle('Security review', 'https://shop.example.com/fr/cart?x=1')).toBe('Security review – shop.example.com');
  });

  it('escapes what goes into the HTML file', () => {
    expect(escapeHtml(`<b title="x">'Tom' & co</b>`)).toBe('&lt;b title=&quot;x&quot;&gt;&#39;Tom&#39; &amp; co&lt;/b&gt;');
  });
});
