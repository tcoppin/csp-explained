import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseVendor } from './catalogue/schema';
import { explainViolations } from './violations';

const dir = join(import.meta.dirname, '../../catalogue/vendors');
const vendors = readdirSync(dir).map((f) => parseVendor(readFileSync(join(dir, f), 'utf8')));
const explainOne = (message: string) => {
  const found = explainViolations(message, vendors);
  expect(found, message).toHaveLength(1);
  return found[0]!;
};

describe('explainViolations', () => {
  it("names the tool behind a blocked address and adds the value its documentation gives, to the rule the browser quoted", () => {
    const e = explainOne(`Loading the script 'https://cdn.us.heap-api.com/js/heap.js' violates the following Content Security Policy directive: "script-src 'self' 'nonce-n0nce'". Note that 'script-src-elem' was not explicitly set, so 'script-src' is used as a fallback. The action has been blocked.`);
    expect(e.case).toBe('address');
    expect(e.host).toBe('cdn.us.heap-api.com');
    expect(e.tools.map((t) => `${t.vendor.name} › ${t.feature.id}`)).toEqual(['Contentsquare › product-analytics-us', 'Contentsquare › product-analytics-eu']);
    expect(e.fix).toEqual({
      add: 'https://cdn.us.heap-api.com',
      directive: 'script-src',
      created: false,
      line: "script-src 'self' 'nonce-n0nce' https://cdn.us.heap-api.com",
      risky: false,
    });
  });

  it("uses the tool's documented wildcard, and creates a rule rather than widening default-src", () => {
    const e = explainOne(`Connecting to 'https://region1.google-analytics.com/g/collect?v=2' violates the following Content Security Policy directive: "default-src 'self'". Note that 'connect-src' was not explicitly set, so 'default-src' is used as a fallback. The action has been blocked.`);
    expect(e.tools[0]!.vendor.name).toBe('Google Analytics 4');
    expect(e.fix).toMatchObject({ add: 'https://*.google-analytics.com', directive: 'connect-src', created: true, line: "connect-src 'self' https://*.google-analytics.com" });
  });

  it('allows the address itself when no tool is known, and names the rule when the browser gave no value (Safari)', () => {
    const e = explainOne(`Refused to load https://cdn.unknown.test:8443/a.js because it appears in neither the script-src directive nor the default-src directive of the Content Security Policy.`);
    expect(e.tools).toEqual([]);
    expect(e.fix).toEqual({ add: 'https://cdn.unknown.test:8443', directive: 'script-src', created: true, risky: false });
  });

  it("adds the hash the browser computed for inline code, and gives style attributes their own rule", () => {
    const script = explainOne(`Executing inline script violates the following Content Security Policy directive 'script-src 'self' 'nonce-n0nce''. Either the 'unsafe-inline' keyword, a hash ('sha256-+8XQnhHQWnHaF/HSXaiQd7BngX+tkgoz78JBKQfBTRg='), or a nonce ('nonce-...') is required to enable inline execution. The action has been blocked.`);
    expect(script.case).toBe('inline');
    expect(script.fix?.line).toBe("script-src 'self' 'nonce-n0nce' 'sha256-+8XQnhHQWnHaF/HSXaiQd7BngX+tkgoz78JBKQfBTRg='");
    // Safari doesn't give the hash: no fix, the page offers to compute it.
    expect(explainOne(`Refused to execute a script because its hash, its nonce, or 'unsafe-inline' does not appear in the script-src directive of the Content Security Policy.`).fix).toBeUndefined();
    const attr = explainOne(`Applying inline style violates the following Content Security Policy directive 'style-src 'self''. Either the 'unsafe-inline' keyword, a hash ('sha256-AsBing+OROn4oj79i1McYY1lPcuhBPrT15PfKUjuHIY='), or a nonce ('nonce-...') is required to enable inline execution. Note that hashes do not apply to event handlers, style attributes and javascript: navigations unless the 'unsafe-hashes' keyword is present. The action has been blocked.`);
    expect(attr.case).toBe('style-attr');
    expect(attr.fix).toMatchObject({ directive: 'style-src-attr', line: "style-src-attr 'unsafe-inline'", risky: false });
  });

  it("offers 'unsafe-eval' as risky, with the catalogue tools known to need it, and nothing for event handlers", () => {
    const e = explainOne(`Evaluating a string as JavaScript violates the following Content Security Policy directive because 'unsafe-eval' is not an allowed source of script: "script-src 'self'". The action has been blocked.`);
    expect(e.case).toBe('eval');
    expect(e.fix).toMatchObject({ add: "'unsafe-eval'", line: "script-src 'self' 'unsafe-eval'", risky: true });
    expect(e.tools.map((t) => t.vendor.name)).toEqual(expect.arrayContaining(['Google Tag Manager', 'Optimizely Web Experimentation', 'Contentsquare']));
    const handler = explainOne(`Executing inline event handler violates the following Content Security Policy directive 'script-src 'self''. Either the 'unsafe-inline' keyword, a hash ('sha256-...'), or a nonce ('nonce-...') is required to enable inline execution. The action has been blocked.`);
    expect(handler.case).toBe('handler');
    expect(handler.fix).toBeUndefined();
  });

  it('sets browser extensions and frames refused by another site apart: nothing to change in this policy', () => {
    expect(explainOne(`Loading the script 'chrome-extension://abcdefghijklmnop/content.js' violates the following Content Security Policy directive: "script-src 'self'". The action has been blocked.`)).toMatchObject({ case: 'extension', host: 'abcdefghijklmnop' });
    const framed = explainOne(`Framing 'https://other.example/' violates the following Content Security Policy directive: "frame-ancestors 'self'". The request has been blocked.`);
    expect(framed.case).toBe('ancestors');
    expect(framed.fix).toBeUndefined();
  });

  it('allows data: and blob: by scheme, risky for scripts only', () => {
    expect(explainOne(`Loading the image 'data:image/png;base64,iVBORw0KGgo=' violates the following Content Security Policy directive: "img-src 'self'". The action has been blocked.`).fix).toMatchObject({ add: 'data:', line: "img-src 'self' data:", risky: false });
    expect(explainOne(`Loading the script 'blob:https://site.example/1b2c' violates the following Content Security Policy directive: "script-src 'self'". The action has been blocked.`).fix).toMatchObject({ add: 'blob:', risky: true });
  });
});
