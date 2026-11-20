import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseVendor } from './catalogue/schema';
import { explainGroups, explainViolations } from './violations';

const dir = join(import.meta.dirname, '../../catalogue/vendors');
const vendors = readdirSync(dir).map((f) => parseVendor(readFileSync(join(dir, f), 'utf8')));
/** One message: its explanation, and the lines (one per rule) that allow it. */
const explainOne = (message: string) => {
  const { items, lines } = explainViolations(message, vendors);
  expect(items, message).toHaveLength(1);
  return { ...items[0]!, lines: lines.map((l) => l.line) };
};

describe('explainViolations', () => {
  it('names the tool behind a blocked address, and adds the value its documentation gives to the rule the browser quoted', () => {
    const e = explainOne(`Loading the script 'https://cdn.us.heap-api.com/js/heap.js' violates the following Content Security Policy directive: "script-src 'self' 'nonce-n0nce'". Note that 'script-src-elem' was not explicitly set, so 'script-src' is used as a fallback. The action has been blocked.`);
    expect(e.case).toBe('address');
    expect(e.host).toBe('cdn.us.heap-api.com');
    expect(e.tools.map((t) => `${t.vendor.name} › ${t.feature.id}`)).toEqual(['Contentsquare › product-analytics-us', 'Contentsquare › product-analytics-eu']);
    expect(e.fix).toEqual({ add: ['https://cdn.us.heap-api.com'], directive: 'script-src', created: false, inLines: true });
    expect(e.lines).toEqual(["script-src 'self' 'nonce-n0nce' https://cdn.us.heap-api.com"]);
  });

  it("uses the tool's documented wildcard, and creates a rule rather than widening default-src", () => {
    const e = explainOne(`Connecting to 'https://region1.google-analytics.com/g/collect?v=2' violates the following Content Security Policy directive: "default-src 'self'". Note that 'connect-src' was not explicitly set, so 'default-src' is used as a fallback. The action has been blocked.`);
    expect(e.tools[0]!.vendor.name).toBe('Google Analytics 4');
    expect(e.fix).toMatchObject({ add: ['https://*.google-analytics.com'], directive: 'connect-src', created: true });
    expect(e.lines).toEqual(["connect-src 'self' https://*.google-analytics.com"]);
  });

  it('allows the address itself when no tool is known, and names the rule when the browser gave no value (Safari)', () => {
    const e = explainOne(`Refused to load https://cdn.unknown.test:8443/a.js because it appears in neither the script-src directive nor the default-src directive of the Content Security Policy.`);
    expect(e.tools).toEqual([]);
    expect(e.fix).toEqual({ add: ['https://cdn.unknown.test:8443'], directive: 'script-src', created: true, inLines: false });
    expect(e.lines).toEqual([]);
  });

  it('adds the hash the browser computed for inline code; a style attribute gets its own rule only as the weaker way', () => {
    const script = explainOne(`Executing inline script violates the following Content Security Policy directive 'script-src 'self' 'nonce-n0nce''. Either the 'unsafe-inline' keyword, a hash ('sha256-+8XQnhHQWnHaF/HSXaiQd7BngX+tkgoz78JBKQfBTRg='), or a nonce ('nonce-...') is required to enable inline execution. The action has been blocked.`);
    expect(script.case).toBe('inline');
    expect(script.lines).toEqual(["script-src 'self' 'nonce-n0nce' 'sha256-+8XQnhHQWnHaF/HSXaiQd7BngX+tkgoz78JBKQfBTRg='"]);
    // Safari doesn't give the hash: no fix, the page offers to compute it.
    expect(explainOne(`Refused to execute a script because its hash, its nonce, or 'unsafe-inline' does not appear in the script-src directive of the Content Security Policy.`).fix).toBeUndefined();
    const attr = explainOne(`Applying inline style violates the following Content Security Policy directive 'style-src 'self''. Either the 'unsafe-inline' keyword, a hash ('sha256-AsBing+OROn4oj79i1McYY1lPcuhBPrT15PfKUjuHIY='), or a nonce ('nonce-...') is required to enable inline execution. Note that hashes do not apply to event handlers, style attributes and javascript: navigations unless the 'unsafe-hashes' keyword is present. The action has been blocked.`);
    expect(attr.case).toBe('style-attr');
    expect(attr.fix).toBeUndefined();
    expect(attr.lines).toEqual([]);
    expect(attr.weaker).toEqual({ risk: 'style-attr', add: ["'unsafe-inline'"], directive: 'style-src-attr', created: true, line: "style-src-attr 'unsafe-inline'" });
  });

  it("offers 'unsafe-inline' for inline code without a hash only as the weaker way, and not where a nonce makes browsers ignore it", () => {
    const message = (rule: string) =>
      `Executing inline script violates the following Content Security Policy directive '${rule}'. Either the 'unsafe-inline' keyword, a hash ('sha256-+8XQnhHQWnHaF/HSXaiQd7BngX+tkgoz78JBKQfBTRg='), or a nonce ('nonce-...') is required to enable inline execution. The action has been blocked.`;
    // The hash is the safe way, the only one offered.
    expect(explainOne(message("script-src 'self'")).weaker).toBeUndefined();
    // Safari, no hash: 'unsafe-inline' as the weaker way, without a line (the rule wasn't quoted).
    const safari = explainOne(`Refused to execute a script because its hash, its nonce, or 'unsafe-inline' does not appear in the script-src directive of the Content Security Policy.`);
    expect(safari.weaker).toEqual({ risk: 'inline-script', add: ["'unsafe-inline'"], directive: 'script-src', created: false });
    // From a report (no hash): a line of its own, or nothing where a nonce is.
    const { items } = explainGroups([{ v: { kind: 'inline-script', type: 'inline-script', text: '', directive: 'script-src', effective: 'script-src-elem', value: "script-src 'self'", reportOnly: false, count: 1 }, others: [] }], vendors);
    expect(items[0]!.weaker).toMatchObject({ line: "script-src 'self' 'unsafe-inline'" });
    const nonce = explainGroups([{ v: { kind: 'inline-script', type: 'inline-script', text: '', directive: 'script-src', value: "script-src 'self' 'nonce-abc'", reportOnly: false, count: 1 }, others: [] }], vendors);
    expect(nonce.items[0]!.weaker).toMatchObject({ ignored: true });
    expect(nonce.items[0]!.weaker?.line).toBeUndefined();
    expect(nonce.lines).toEqual([]);
  });

  it("offers 'unsafe-eval' and event handlers' 'unsafe-inline' only as the weaker way, never in the lines", () => {
    const e = explainOne(`Evaluating a string as JavaScript violates the following Content Security Policy directive because 'unsafe-eval' is not an allowed source of script: "script-src 'self'". The action has been blocked.`);
    expect(e.case).toBe('eval');
    expect(e.fix).toBeUndefined();
    expect(e.lines).toEqual([]);
    expect(e.weaker).toEqual({ risk: 'eval', add: ["'unsafe-eval'"], directive: 'script-src', created: false, line: "script-src 'self' 'unsafe-eval'" });
    expect(e.tools.map((t) => t.vendor.name)).toEqual(expect.arrayContaining(['Google Tag Manager', 'Optimizely Web Experimentation', 'Contentsquare']));
    const handler = explainOne(`Executing inline event handler violates the following Content Security Policy directive 'script-src 'self''. Either the 'unsafe-inline' keyword, a hash ('sha256-...'), or a nonce ('nonce-...') is required to enable inline execution. The action has been blocked.`);
    expect(handler.case).toBe('handler');
    expect(handler.fix).toBeUndefined();
    expect(handler.lines).toEqual([]);
    expect(handler.weaker).toMatchObject({ risk: 'handler', directive: 'script-src-attr', created: true, line: "script-src-attr 'unsafe-inline'" });
  });

  it('sets browser extensions and frames refused by another site apart: nothing to change in this policy', () => {
    expect(explainOne(`Loading the script 'chrome-extension://abcdefghijklmnop/content.js' violates the following Content Security Policy directive: "script-src 'self'". The action has been blocked.`)).toMatchObject({ case: 'extension', host: 'abcdefghijklmnop' });
    const framed = explainOne(`Framing 'https://other.example/' violates the following Content Security Policy directive: "frame-ancestors 'self'". The request has been blocked.`);
    expect(framed).toMatchObject({ case: 'ancestors', host: 'other.example' });
    expect(framed.fix).toBeUndefined();
  });

  it('allows data: and blob: by scheme, and for scripts only as the weaker way', () => {
    const data = explainOne(`Loading the image 'data:image/png;base64,iVBORw0KGgo=' violates the following Content Security Policy directive: "img-src 'self'". The action has been blocked.`);
    expect(data.fix).toMatchObject({ add: ['data:'] });
    expect(data.weaker).toBeUndefined();
    expect(data.lines).toEqual(["img-src 'self' data:"]);
    const blob = explainOne(`Loading the script 'blob:https://site.example/1b2c' violates the following Content Security Policy directive: "script-src 'self'". The action has been blocked.`);
    expect(blob.fix).toBeUndefined();
    expect(blob.lines).toEqual([]);
    expect(blob.weaker).toMatchObject({ risk: 'scheme', add: ['blob:'], line: "script-src 'self' blob:" });
  });

  it('reads inline blocks of one kind as one item, and gives one line per rule that allows every message at once', () => {
    // A site's console (the tag id replaced): three inline scripts and two style blocks with their hashes, under
    // rules that already list hashes, and a tool's request.
    const style = (hash: string) =>
      `Applying inline style violates the following Content Security Policy directive 'style-src 'self' 'sha256-0PgzLpyNYtIATtFzbrJcHZ5O3XcUgZ2pakKMBmKY5lw=' 'sha256-mJcWkI4eXbz6YxOK2+x3r+Gsf8kTiZz1EbmVj7kL/j8=''. Either the 'unsafe-inline' keyword, a hash ('${hash}'), or a nonce ('nonce-...') is required to enable inline execution. The action has been blocked.`;
    const script = (line: number, hash: string) =>
      `(index):${line} Executing inline script violates the following Content Security Policy directive 'script-src 'self' 'sha256-iIXugiarzTiVamZ3wjmzcfZMgD/nNHxWWbnCS7QQjnE=''. Either the 'unsafe-inline' keyword, a hash ('${hash}'), or a nonce ('nonce-...') is required to enable inline execution. The action has been blocked.`;
    const console = [
      style('sha256-V9HL7FwGxnX1In22B1unH/J5BuQ2cnNFknkCDqf1TCY='),
      script(385, 'sha256-YSONuKDlNhvNRwhfhXzquBYpFGmOVh2LsuN7ye4knzM='),
      `(index):416 ${style('sha256-yMSX++jw55IotF4gcBqILRDavqzrsJTTGVDOSdEZFMs=')}`,
      script(421, 'sha256-TdI93GEHDen26pHkyYLEx8h9zCRWJzTA/kivlZ+EDVY='),
      script(432, 'sha256-zoNwv5W51qqwRPNbu6wpejlwJUE9dco0gfCb4aTxhU4='),
      `0123abcd.js:1 Connecting to 'https://try.abtasty.com/0123abcd/initiator.js' violates the following Content Security Policy directive: "connect-src 'self'". The action has been blocked.`,
      '0123abcd.js:1 Fetch API cannot load https://try.abtasty.com/0123abcd/initiator.js. Refused to connect because it violates the document\'s Content Security Policy.',
    ].join('\n');
    const { items, lines } = explainViolations(console, vendors);
    expect(items.map((e) => `${e.case} ${e.violation.kind} ×${e.count}`)).toEqual(['inline inline-style ×2', 'inline inline-script ×3', 'address url ×1']);
    expect(items[1]!.fix?.add).toHaveLength(3);
    expect(items.every((e) => e.fix?.inLines)).toBe(true);
    expect(lines.map((l) => l.line)).toEqual([
      "style-src 'self' 'sha256-0PgzLpyNYtIATtFzbrJcHZ5O3XcUgZ2pakKMBmKY5lw=' 'sha256-mJcWkI4eXbz6YxOK2+x3r+Gsf8kTiZz1EbmVj7kL/j8=' 'sha256-V9HL7FwGxnX1In22B1unH/J5BuQ2cnNFknkCDqf1TCY=' 'sha256-yMSX++jw55IotF4gcBqILRDavqzrsJTTGVDOSdEZFMs='",
      "script-src 'self' 'sha256-iIXugiarzTiVamZ3wjmzcfZMgD/nNHxWWbnCS7QQjnE=' 'sha256-YSONuKDlNhvNRwhfhXzquBYpFGmOVh2LsuN7ye4knzM=' 'sha256-TdI93GEHDen26pHkyYLEx8h9zCRWJzTA/kivlZ+EDVY=' 'sha256-zoNwv5W51qqwRPNbu6wpejlwJUE9dco0gfCb4aTxhU4='",
      "connect-src 'self' *.abtasty.com",
    ]);
    expect(items[2]!.tools[0]!.vendor.name).toBe('AB Tasty');
  });

  it('puts an inline script and a tool blocked under the same rule on one line', () => {
    const { lines } = explainViolations(
      [
        `Loading the script 'https://cdn.us.heap-api.com/js/heap.js' violates the following Content Security Policy directive: "script-src 'self'". The action has been blocked.`,
        `Executing inline script violates the following Content Security Policy directive 'script-src 'self''. Either the 'unsafe-inline' keyword, a hash ('sha256-+8XQnhHQWnHaF/HSXaiQd7BngX+tkgoz78JBKQfBTRg='), or a nonce ('nonce-...') is required to enable inline execution. The action has been blocked.`,
      ].join('\n'),
      vendors,
    );
    expect(lines.map((l) => l.line)).toEqual(["script-src 'self' https://cdn.us.heap-api.com 'sha256-+8XQnhHQWnHaF/HSXaiQd7BngX+tkgoz78JBKQfBTRg='"]);
  });

  it('explains Trusted Types: nothing to add to the policy, and the tool behind an address pasted with the message', () => {
    // Code run in the console (the tag id replaced), then Chrome's message and error.
    const pasted = [
      "const s = document.createElement('script');",
      's.src = "https://try.abtasty.com/0123abcd.js";',
      'document.head.appendChild(s);',
      "VM309:2 This document requires 'TrustedScriptURL' assignment. The action has been blocked.",
      "VM309:2 Uncaught TypeError: Failed to set the 'src' property on 'HTMLScriptElement': This document requires 'TrustedScriptURL' assignment.",
      '    at <anonymous>:2:7',
    ].join('\n');
    const { items, lines } = explainViolations(pasted, vendors);
    expect(items).toHaveLength(1);
    expect(items[0]!.case).toBe('trusted-types');
    expect(items[0]!.violation).toMatchObject({ trustedType: 'TrustedScriptURL', sink: 'HTMLScriptElement.src', directive: 'require-trusted-types-for', reportOnly: false });
    expect(items[0]!.fix).toBeUndefined();
    expect(lines).toEqual([]);
    expect([...new Set(items[0]!.tools.map((t) => t.vendor.name))]).toEqual(['AB Tasty']);
  });

  it("names no tool for Trusted Types from addresses in the browser's own lines", () => {
    const firefox = readFileSync(join(import.meta.dirname, 'csp/console-messages/firefox-trusted-types.txt'), 'utf8');
    const { items } = explainViolations(firefox, vendors);
    // Firefox's "Loading failed for the <script> with source “https://cdn.us.heap-api.com/…”" isn't the blocked code.
    expect(items.filter((e) => e.case === 'trusted-types').flatMap((e) => e.tools)).toEqual([]);
  });
});
