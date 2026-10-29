/**
 * Renders the link-preview image (public/og-image.png, 1200×630) with the site's fonts and light colour tokens.
 * Run after changing the tagline or the palette: `yarn og:image` for every language (`--locale fr` for one,
 * `--theme dark` for the dark palette, `--out <file>` to write elsewhere).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { chromium } from '@playwright/test';
import en from '../src/i18n/en.json' with { type: 'json' };
import fr from '../src/i18n/fr.json' with { type: 'json' };

const { values: args } = parseArgs({
  options: { theme: { type: 'string', default: 'light' }, locale: { type: 'string' }, out: { type: 'string' } },
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

/** One image per language: the English one at the site's root, the others named after their locale. */
const imagePath = (locale: string) => (locale === 'en' ? 'public/og-image.png' : `public/og-image-${locale}.png`);

const page = (m: typeof en) => `<!doctype html>
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
<span class="mark">${m.site.name}</span>
<h1>${m.site.tagline.replace(/Content-Security-Policy|(?<=, )[^,]+$/g, (s) => `<span class="nowrap">${s}</span>`)}</h1>
<div>
  <p class="policy"><b>script-src</b> <span class="hl k">'self'</span> <span class="hl h">https://www.googletagmanager.com</span>;</p>
  <p class="note">${m.site.ogNote}</p>
</div>`;

const messages: Record<string, typeof en> = { en, fr };
const browser = await chromium.launch();
for (const locale of args.locale ? [args.locale] : Object.keys(messages)) {
  const tab = await browser.newPage({ viewport: { width: 1200, height: 630 } });
  await tab.setContent(page(messages[locale]!));
  await tab.evaluate(() => document.fonts.ready);
  const out = args.out ?? imagePath(locale);
  await tab.screenshot({ path: fileURLToPath(new URL(out, root)) });
  await tab.close();
  console.log(`Wrote ${out}`);
}
await browser.close();
