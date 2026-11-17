import { describe, expect, it } from 'vitest';
import { parseViolations } from './violation';

// Messages as the browsers printed them on 2026-11-17 (Chromium and WebKit, through Playwright), on a page whose
// policy blocks one thing of each kind. Firefox's follow its message templates (csp.properties).
const CHROME = {
  stylesheet: `Loading the stylesheet 'https://cdn.blocked-style.test/a.css' violates the following Content Security Policy directive: "style-src 'self'". Note that 'style-src-elem' was not explicitly set, so 'style-src' is used as a fallback. The action has been blocked.`,
  inlineStyle: `Applying inline style violates the following Content Security Policy directive 'style-src 'self''. Either the 'unsafe-inline' keyword, a hash ('sha256-FcQqt3aNlV7AZnGV4zkQRVeCeJOxbMPnQSx258L803E='), or a nonce ('nonce-...') is required to enable inline execution. The action has been blocked.`,
  script: `Loading the script 'https://cdn.us.heap-api.com/js/heap.js' violates the following Content Security Policy directive: "script-src 'self' 'nonce-n0nce'". Note that 'script-src-elem' was not explicitly set, so 'script-src' is used as a fallback. The action has been blocked.`,
  inlineScript: `Executing inline script violates the following Content Security Policy directive 'script-src 'self' 'nonce-n0nce''. Either the 'unsafe-inline' keyword, a hash ('sha256-+8XQnhHQWnHaF/HSXaiQd7BngX+tkgoz78JBKQfBTRg='), or a nonce ('nonce-...') is required to enable inline execution. The action has been blocked.`,
  styleAttr: `Applying inline style violates the following Content Security Policy directive 'style-src 'self''. Either the 'unsafe-inline' keyword, a hash ('sha256-AsBing+OROn4oj79i1McYY1lPcuhBPrT15PfKUjuHIY='), or a nonce ('nonce-...') is required to enable inline execution. Note that hashes do not apply to event handlers, style attributes and javascript: navigations unless the 'unsafe-hashes' keyword is present. The action has been blocked.`,
  handler: `Executing inline event handler violates the following Content Security Policy directive 'script-src 'self' 'nonce-n0nce''. Either the 'unsafe-inline' keyword, a hash ('sha256-...'), or a nonce ('nonce-...') is required to enable inline execution. Note that hashes do not apply to event handlers, style attributes and javascript: navigations unless the 'unsafe-hashes' keyword is present. The action has been blocked.`,
  image: `Loading the image 'https://img.blocked.test/p.gif' violates the following Content Security Policy directive: "img-src 'self'". The action has been blocked.`,
  connect: `Connecting to 'https://api.blocked.test/collect' violates the following Content Security Policy directive: "connect-src 'self'". The action has been blocked.`,
  font: `Loading the font 'https://fonts.blocked.test/f.woff2' violates the following Content Security Policy directive: "font-src 'self'". The action has been blocked.`,
  frame: `Framing 'https://frame.blocked.test/' violates the following Content Security Policy directive: "frame-src 'self'". The request has been blocked.`,
  form: `Sending form data to 'https://form.blocked.test/post?' violates the following Content Security Policy directive: "form-action 'self'". The request has been blocked.`,
  eval: `Evaluating a string as JavaScript violates the following Content Security Policy directive because 'unsafe-eval' is not an allowed source of script: "script-src 'self' 'nonce-n0nce'".\n The policy is report-only, so the violation has been logged but no further action has been taken.`,
  reportOnly: `Loading the image 'https://img.blocked.test/p.gif' violates the following Content Security Policy directive: "img-src 'self'". The policy is report-only, so the violation has been logged but no further action has been taken.`,
  reportOnlyFrame: `Framing 'https://frame.blocked.test/' violates the following report-only Content Security Policy directive: "frame-src 'self'". The violation has been logged, but no further action has been taken.`,
  defaultSrc: `Loading the image 'https://img.blocked.test/p.gif' violates the following Content Security Policy directive: "default-src 'self'". Note that 'img-src' was not explicitly set, so 'default-src' is used as a fallback. The action has been blocked.`,
  defaultSrcInline: `Applying inline style violates the following Content Security Policy directive 'default-src 'self''. Either the 'unsafe-inline' keyword, a hash ('sha256-FcQqt3aNlV7AZnGV4zkQRVeCeJOxbMPnQSx258L803E='), or a nonce ('nonce-...') is required to enable inline execution. Note also that 'style-src' was not explicitly set, so 'default-src' is used as a fallback. The action has been blocked.`,
  // Earlier Chrome versions.
  older: `Refused to load the script 'https://cdn.vendor.example/tag.js' because it violates the following Content Security Policy directive: "script-src 'self' https://www.googletagmanager.com".`,
};

const SAFARI = {
  stylesheet: `Refused to load https://cdn.blocked-style.test/a.css because it does not appear in the style-src directive of the Content Security Policy.`,
  inlineStyle: `Refused to apply a stylesheet because its hash, its nonce, or 'unsafe-inline' does not appear in the style-src directive of the Content Security Policy.`,
  inlineScript: `Refused to execute a script because its hash, its nonce, or 'unsafe-inline' does not appear in the script-src directive of the Content Security Policy.`,
  connect: `Refused to connect to https://api.blocked.test/collect because it does not appear in the connect-src directive of the Content Security Policy.`,
  form: `Refused to load https://form.blocked.test/post because it does not appear in the form-action directive of the Content Security Policy.`,
  reportOnly: `[Report Only] Refused to load https://cdn.us.heap-api.com/js/heap.js because it does not appear in the script-src directive of the Content Security Policy.`,
  defaultSrc: `Refused to load https://img.blocked.test/p.gif because it appears in neither the img-src directive nor the default-src directive of the Content Security Policy.`,
};

const FIREFOX = {
  script: `Content-Security-Policy: The page’s settings blocked the loading of a resource (script-src-elem) at https://cdn.us.heap-api.com/js/heap.js because it violates the following directive: “script-src 'self'”`,
  reportOnly: `Content-Security-Policy: The page’s settings observed the loading of a resource (img-src) at https://img.blocked.test/p.gif because it violates the following directive: “default-src 'self'”. A CSP report is being sent.`,
  inlineScript: `Content-Security-Policy: The page’s settings blocked an inline script (script-src-elem) from being executed because it violates the following directive: “script-src 'self'”. Consider using a hash ('sha256-+8XQnhHQWnHaF/HSXaiQd7BngX+tkgoz78JBKQfBTRg=') or a nonce.`,
  eval: `Content-Security-Policy: The page’s settings blocked a JavaScript eval (script-src) from being executed because it violates the following directive: “script-src 'self'” (Missing 'unsafe-eval')`,
  handler: `Content-Security-Policy: The page’s settings blocked an event handler (script-src-attr) from being executed because it violates the following directive: “script-src 'self'”`,
  // Earlier Firefox versions: the rule in brackets at the end, no value.
  older: `Content-Security-Policy: The page’s settings blocked the loading of a resource at https://cdn.vendor.example/tag.js (“script-src”).`,
};

const one = (message: string) => {
  const found = parseViolations(message);
  expect(found, message).toHaveLength(1);
  return found[0]!;
};

describe('parseViolations', () => {
  it('reads what Chrome blocked, the rule it checked and the rule meant for the resource', () => {
    expect(one(CHROME.script)).toMatchObject({
      kind: 'url',
      url: 'https://cdn.us.heap-api.com/js/heap.js',
      type: 'script',
      directive: 'script-src',
      value: "script-src 'self' 'nonce-n0nce'",
      effective: 'script-src-elem',
      reportOnly: false,
    });
    const types = (['stylesheet', 'image', 'connect', 'font', 'frame', 'form'] as const).map((k) => one(CHROME[k]).type);
    expect(types).toEqual(['style', 'img', 'connect', 'font', 'frame', 'form']);
    expect(one(CHROME.form).url).toBe('https://form.blocked.test/post?');
    expect(one(CHROME.older)).toMatchObject({ url: 'https://cdn.vendor.example/tag.js', directive: 'script-src', value: "script-src 'self' https://www.googletagmanager.com" });
  });

  it('reads inline code, with the hash Chrome computes, and tells a style attribute from a style block', () => {
    expect(one(CHROME.inlineScript)).toMatchObject({
      kind: 'inline-script',
      type: 'inline-script',
      directive: 'script-src',
      value: "script-src 'self' 'nonce-n0nce'",
      hash: "'sha256-+8XQnhHQWnHaF/HSXaiQd7BngX+tkgoz78JBKQfBTRg='",
    });
    expect(one(CHROME.inlineStyle)).toMatchObject({ kind: 'inline-style', value: "style-src 'self'", hash: "'sha256-FcQqt3aNlV7AZnGV4zkQRVeCeJOxbMPnQSx258L803E='" });
    expect(one(CHROME.styleAttr).kind).toBe('style-attr');
    // The hash in the event handler message is a placeholder.
    expect(one(CHROME.handler)).toMatchObject({ kind: 'inline-handler', directive: 'script-src' });
    expect(one(CHROME.handler).hash).toBeUndefined();
    expect(one(CHROME.eval)).toMatchObject({ kind: 'eval', type: 'eval', value: "script-src 'self' 'nonce-n0nce'", reportOnly: true });
  });

  it('reads report-only messages and default-src fallbacks', () => {
    expect(one(CHROME.reportOnly).reportOnly).toBe(true);
    expect(one(CHROME.reportOnlyFrame)).toMatchObject({ reportOnly: true, type: 'frame', directive: 'frame-src' });
    expect(one(CHROME.defaultSrc)).toMatchObject({ type: 'img', directive: 'default-src', effective: 'img-src', value: "default-src 'self'" });
    expect(one(CHROME.defaultSrcInline)).toMatchObject({ kind: 'inline-style', directive: 'default-src', effective: 'style-src' });
  });

  it("reads Safari's messages, which name the rule without its value", () => {
    expect(one(SAFARI.stylesheet)).toMatchObject({ url: 'https://cdn.blocked-style.test/a.css', type: 'style', directive: 'style-src', reportOnly: false });
    expect(one(SAFARI.stylesheet).value).toBeUndefined();
    expect(one(SAFARI.inlineStyle)).toMatchObject({ kind: 'inline-style', directive: 'style-src' });
    expect(one(SAFARI.inlineScript)).toMatchObject({ kind: 'inline-script', directive: 'script-src' });
    expect(one(SAFARI.connect)).toMatchObject({ url: 'https://api.blocked.test/collect', type: 'connect' });
    expect(one(SAFARI.form)).toMatchObject({ type: 'form', directive: 'form-action' });
    expect(one(SAFARI.reportOnly)).toMatchObject({ reportOnly: true, url: 'https://cdn.us.heap-api.com/js/heap.js', type: 'script' });
    expect(one(SAFARI.defaultSrc)).toMatchObject({ type: 'img', directive: 'default-src', effective: 'img-src' });
  });

  it("reads Firefox's messages", () => {
    expect(one(FIREFOX.script)).toMatchObject({ url: 'https://cdn.us.heap-api.com/js/heap.js', type: 'script', directive: 'script-src', effective: 'script-src-elem', value: "script-src 'self'" });
    expect(one(FIREFOX.reportOnly)).toMatchObject({ reportOnly: true, type: 'img', directive: 'default-src', effective: 'img-src' });
    expect(one(FIREFOX.inlineScript)).toMatchObject({ kind: 'inline-script', hash: "'sha256-+8XQnhHQWnHaF/HSXaiQd7BngX+tkgoz78JBKQfBTRg='" });
    expect(one(FIREFOX.eval)).toMatchObject({ kind: 'eval', directive: 'script-src' });
    expect(one(FIREFOX.handler)).toMatchObject({ kind: 'inline-handler', effective: 'script-src-attr' });
    expect(one(FIREFOX.older)).toMatchObject({ url: 'https://cdn.vendor.example/tag.js', type: 'script', directive: 'script-src' });
  });

  it('reads a whole console pasted at once: each message once, the noise left out', () => {
    const console = [
      CHROME.script,
      'heap.js:1  Failed to load resource: net::ERR_BLOCKED_BY_CLIENT',
      CHROME.connect,
      'Fetch API cannot load https://api.blocked.test/collect. Refused to connect because it violates the document\'s Content Security Policy.',
      CHROME.connect,
      CHROME.inlineScript,
      'index.html:12 Uncaught ReferenceError: x is not defined',
      SAFARI.defaultSrc,
    ].join('\n');
    const found = parseViolations(console);
    expect(found.map((v) => v.url ?? v.kind)).toEqual([
      'https://cdn.us.heap-api.com/js/heap.js',
      'https://api.blocked.test/collect',
      'inline-script',
      'https://img.blocked.test/p.gif',
    ]);
    expect(found[1]!.count).toBe(2);
  });

  it("reads Chrome's messages one after another, with nothing between them", () => {
    const found = parseViolations([CHROME.script, CHROME.connect, CHROME.connect, CHROME.font, CHROME.inlineScript, CHROME.form].join('\n'));
    expect(found.map((v) => v.url ?? v.kind)).toEqual([
      'https://cdn.us.heap-api.com/js/heap.js',
      'https://api.blocked.test/collect',
      'https://fonts.blocked.test/f.woff2',
      'inline-script',
      'https://form.blocked.test/post?',
    ]);
  });

  it('reads a message the console wrapped onto several lines', () => {
    expect(one(CHROME.script.replace(' violates the following ', ' violates the following\n'))).toMatchObject({ directive: 'script-src', url: 'https://cdn.us.heap-api.com/js/heap.js' });
  });

  it('finds nothing in a policy or in other console errors', () => {
    expect(parseViolations("script-src 'self' https://cdn.example.com")).toEqual([]);
    expect(parseViolations('Uncaught TypeError: Cannot read properties of undefined')).toEqual([]);
  });
});
