/**
 * "Try an example": a week of reports from a small shop, one per line as a collector logs them (Reporting API
 * format). Hotjar and Google Analytics are blocked across pages and browsers, a product page uses style attributes,
 * the checkout has an inline script, and some visitors' extensions add their own noise.
 */

const SITE = 'https://shop.example.com';

export const EXAMPLE_REPORTS_POLICY =
  "default-src 'self'; script-src 'self' 'nonce-r4nd0m' https://www.googletagmanager.com; " +
  "style-src 'self' https://fonts.googleapis.com; img-src 'self' data:; font-src 'self' https://fonts.gstatic.com; " +
  "frame-ancestors 'self'; object-src 'none'; base-uri 'self'; report-to csp";

const BROWSERS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:159.0) Gecko/20100101 Firefox/159.0',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36 Edg/142.0.0.0',
];

const PAGES = ['/', '/products/blue-mug', '/products/red-scarf', '/cart', '/checkout?step=2', '/blog/new-collection?utm_source=newsletter'];

interface Kind {
  times: number;
  blockedURL: string;
  effectiveDirective: string;
  /** Which pages and browsers, by index; all of them when absent. */
  pages?: number[];
  browsers?: number[];
  sourceFile?: string;
  sample?: string;
}

const KINDS: Kind[] = [
  { times: 46, blockedURL: 'https://static.hotjar.com/c/hotjar-3712045.js?sv=6', effectiveDirective: 'script-src-elem' },
  { times: 31, blockedURL: 'https://region1.google-analytics.com/g/collect', effectiveDirective: 'connect-src' },
  { times: 12, blockedURL: 'wss://ws.hotjar.com/api/v2/client/ws', effectiveDirective: 'connect-src', browsers: [0, 1, 3] },
  { times: 9, blockedURL: 'inline', effectiveDirective: 'style-src-attr', pages: [1, 2], sample: 'display:none' },
  { times: 4, blockedURL: 'inline', effectiveDirective: 'script-src-elem', pages: [4], sample: 'window.dataLayer = window.dataLayer || [' },
  { times: 7, blockedURL: 'chrome-extension://gighmmpiobklfepjocnamgkkbiglidom/content.js', effectiveDirective: 'script-src-elem', browsers: [0] },
  { times: 3, blockedURL: 'inline', effectiveDirective: 'style-src-elem', browsers: [2], sourceFile: 'moz-extension://5b3c9e1a-1f4e-4d2b-9a77-0c2f6d8e4b10/inject.js' },
];

export const EXAMPLE_REPORTS = KINDS.flatMap((k, n) =>
  Array.from({ length: k.times }, (_, i) => {
    const pages = k.pages ?? PAGES.map((_, p) => p);
    const browsers = k.browsers ?? BROWSERS.map((_, b) => b);
    const page = `${SITE}${PAGES[pages[(i + n) % pages.length]!]}`;
    return JSON.stringify({
      age: 1000 * (i + 1),
      type: 'csp-violation',
      url: page,
      user_agent: BROWSERS[browsers[(i + 2 * n + Math.floor(i / pages.length)) % browsers.length]!],
      body: {
        documentURL: page,
        blockedURL: k.blockedURL,
        effectiveDirective: k.effectiveDirective,
        originalPolicy: EXAMPLE_REPORTS_POLICY,
        disposition: 'enforce',
        statusCode: 200,
        ...(k.sourceFile ? { sourceFile: k.sourceFile } : {}),
        ...(k.sample ? { sample: k.sample } : {}),
      },
    });
  }),
).join('\n');
