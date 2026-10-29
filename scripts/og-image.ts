/**
 * Renders the link-preview image (public/og-image.png, 1200×630) with the site's fonts and light colour tokens.
 * Run after changing the tagline or the palette: `yarn og:image` (`--theme dark` for the dark palette,
 * `--out <file>` to write elsewhere).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { chromium } from '@playwright/test';
import en from '../src/i18n/en.json' with { type: 'json' };

const { values: args } = parseArgs({
  options: { theme: { type: 'string', default: 'light' }, out: { type: 'string', default: 'public/og-image.png' } },
});

const root = new URL('../', import.meta.url);
const css = readFileSync(new URL('src/styles/global.css', root), 'utf8');

/** Colour tokens of one theme: the first block for light, the explicit `data-theme='dark'` block for dark. */
function tokens(theme: string): Record<string, string> {
  const start = theme === 'dark' ? css.indexOf("[data-theme='dark']") : 0;
  const block = css.slice(start, css.indexOf('}', start));
  return Object.fromEntries([...block.matchAll(/--([a-z-]+):\s*(#[0-9a-f]{3,8})/gi)].map((m) => [m[1]!, m[2]!]));
}

/** Fonts are embedded: the page is rendered from about:blank, which can't load local files. */
const font = (pkg: string, file: string) =>
  `url(data:font/woff2;base64,${readFileSync(new URL(`node_modules/@fontsource/${pkg}/files/${file}`, root)).toString('base64')}) format('woff2')`;

const c = tokens(args.theme);
const html = `<!doctype html>
<style>
  @font-face { font-family: Sans; font-weight: 400; src: ${font('atkinson-hyperlegible-next', 'atkinson-hyperlegible-next-latin-400-normal.woff2')}; }
  @font-face { font-family: Sans; font-weight: 800; src: ${font('atkinson-hyperlegible-next', 'atkinson-hyperlegible-next-latin-800-normal.woff2')}; }
  @font-face { font-family: Mono; font-weight: 400; src: ${font('atkinson-hyperlegible-mono', 'atkinson-hyperlegible-mono-latin-400-normal.woff2')}; }
  @font-face { font-family: Mono; font-weight: 700; src: ${font('atkinson-hyperlegible-mono', 'atkinson-hyperlegible-mono-latin-700-normal.woff2')}; }
  * { margin: 0; box-sizing: border-box; }
  body { width: 1200px; height: 630px; padding: 72px 80px; background: ${c.paper}; color: ${c.ink}; font-family: Sans;
         display: flex; flex-direction: column; justify-content: space-between; }
  .mark { font-weight: 800; font-size: 34px; align-self: flex-start;
          background: linear-gradient(transparent 55%, ${c['hl-keyword']} 55%, ${c['hl-keyword']} 95%, transparent 95%); }
  h1 { font-weight: 800; font-size: 68px; line-height: 1.08; letter-spacing: -0.01em; max-width: 1000px; }
  .policy { font-family: Mono; font-size: 28px; background: ${c.surface}; border: 2px solid ${c.rule}; border-radius: 10px;
            padding: 22px 28px; display: inline-block; white-space: nowrap; }
  .policy b { font-weight: 700; }
  .hl { padding: 2px 6px; border-radius: 4px; }
  .k { background: ${c['hl-keyword']}; } .h { background: ${c['hl-host']}; }
  .nowrap { white-space: nowrap; }
  .note { font-size: 26px; color: ${c['ink-soft']}; margin-top: 14px; }
</style>
<span class="mark">${en.site.name}</span>
<h1>${en.site.tagline.replace(/Content-Security-Policy|in plain language\./g, (m) => `<span class="nowrap">${m}</span>`)}</h1>
<div>
  <p class="policy"><b>script-src</b> <span class="hl k">'self'</span> <span class="hl h">https://www.googletagmanager.com</span>;</p>
  <p class="note">Every rule explained, for everyone, developers and security teams.</p>
</div>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await page.setContent(html);
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: fileURLToPath(new URL(args.out, root)) });
await browser.close();
console.log(`Wrote ${args.out}`);
