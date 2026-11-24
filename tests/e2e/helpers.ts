/** What the end-to-end specs share: the usage fixture, opening each island, and common steps. */
import AxeBuilder from '@axe-core/playwright';
import { test as base, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

export { expect } from '@playwright/test';
import { COMPARE_EXAMPLE as EXAMPLE } from '../../src/config';

/**
 * Every test answers the usage events sent to `/e` and our own policy's violations sent to `/csp-violation`
 * (neither exists in `astro preview`). `sent()` and `violations()` return them, as query strings, for the tests
 * that check what is sent.
 */
export const test = base.extend<{ sent: () => string[]; violations: () => string[] }>({
  sent: [
    async ({ context }, use) => {
      const usage: URLSearchParams[] = [];
      await context.route('**/e?*', (route) => {
        usage.push(new URL(route.request().url()).searchParams);
        return route.fulfill({ status: 204 });
      });
      await use(() => usage.map((q) => q.toString()));
    },
    { auto: true },
  ],
  violations: [
    async ({ context }, use) => {
      const sent: URLSearchParams[] = [];
      await context.route('**/csp-violation?*', (route) => {
        sent.push(new URL(route.request().url()).searchParams);
        return route.fulfill({ status: 204 });
      });
      await use(() => sent.map((q) => q.toString()));
    },
    { auto: true },
  ],
});

/** Fails the test on any console error, including CSP violations of our own policy. */
export function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

/** Waits until the analyzer island is interactive. */
export async function openAnalyzer(page: Page, path = '/') {
  await page.goto(path);
  await page.locator('astro-island:not([ssr])').waitFor({ state: 'attached' });
}

/** Pastes `text` into the focused field, as Ctrl+V does (the analyzer reacts to a paste differently from typing). */
export async function paste(page: Page, text: string) {
  await page.evaluate((text) => {
    const data = new DataTransfer();
    data.setData('text/plain', text);
    document.activeElement!.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  }, text);
}

/** Adds a tool through the searchable multi-select. */
export async function pickTool(page: Page, name: string) {
  await page.getByRole('combobox', { name: 'Add a tool' }).fill(name);
  await page.getByRole('option', { name }).click();
}

/** An action on the analysed policy: on phones, Open in the builder and Clear are under More. */
export async function policyAction(page: Page, role: 'button' | 'link', name: string) {
  const more = page.locator('.summary-actions .more summary');
  if (await more.isVisible()) await more.click();
  await page.locator('.summary-actions').getByRole(role, { name }).click();
}

/** Each path in English and in French (`/learn` → `/learn`, `/fr/learn`). */
export const inEveryLanguage = (paths: string[]) => paths.flatMap((p) => [p, p === '/' ? '/fr' : `/fr${p}`]);

/**
 * A browser console copied whole: six policy messages from Chrome and Safari (a tool's script, a request repeated
 * twice, inline code with its hash, eval in report-only, an extension, inline code without a hash). The inline
 * script is `console.log('inline ran')`, whose hash Chrome gives in the fourth message.
 */
export const CONSOLE = `Loading the script 'https://cdn.us.heap-api.com/js/heap.js' violates the following Content Security Policy directive: "script-src 'self' 'nonce-n0nce'". Note that 'script-src-elem' was not explicitly set, so 'script-src' is used as a fallback. The action has been blocked.
Connecting to 'https://region1.google-analytics.com/g/collect?v=2' violates the following Content Security Policy directive: "default-src 'self'". Note that 'connect-src' was not explicitly set, so 'default-src' is used as a fallback. The action has been blocked.
Connecting to 'https://region1.google-analytics.com/g/collect?v=2' violates the following Content Security Policy directive: "default-src 'self'". Note that 'connect-src' was not explicitly set, so 'default-src' is used as a fallback. The action has been blocked.
Executing inline script violates the following Content Security Policy directive 'script-src 'self' 'nonce-n0nce''. Either the 'unsafe-inline' keyword, a hash ('sha256-+8XQnhHQWnHaF/HSXaiQd7BngX+tkgoz78JBKQfBTRg='), or a nonce ('nonce-...') is required to enable inline execution. The action has been blocked.
Evaluating a string as JavaScript violates the following Content Security Policy directive because 'unsafe-eval' is not an allowed source of script: "script-src 'self' 'nonce-n0nce'". The policy is report-only, so the violation has been logged but no further action has been taken.
Loading the script 'chrome-extension://abcdefghijklmnop/content.js' violates the following Content Security Policy directive: "script-src 'self'". The action has been blocked.
Refused to execute a script because its hash, its nonce, or 'unsafe-inline' does not appear in the script-src directive of the Content Security Policy.`;

export const POLICY = "default-src 'self'; script-src 'self' https://www.googletagmanager.com; img-src 'self' data:; object-src 'none'";

/** Waits until the builder island is interactive. */
export async function openBuilder(page: Page, path = '/build') {
  await page.goto(path);
  await page.locator('astro-island:not([ssr])').waitFor({ state: 'attached' });
}

/** The comparator's example, with Hotjar picked, as a link (the policies base64url-encoded after the #). */
const b64 = (text: string) => Buffer.from(text, 'utf8').toString('base64url');
export const COMPARE_EXAMPLE = `/compare#b=${b64(EXAMPLE.before)}&a=${b64(EXAMPLE.after)}&v=hotjar:tracking`;

/** Waits until the comparator island is interactive. */
export async function openComparator(page: Page, path = '/compare') {
  await page.goto(path);
  await page.locator('astro-island:not([ssr])').waitFor({ state: 'attached' });
}

/** Waits until the reports reader island is interactive. */
export async function openReader(page: Page, path = '/reports') {
  await page.goto(path);
  await page.locator('astro-island:not([ssr])').waitFor({ state: 'attached' });
}

// The example from the CSP specification, and its hash.
export const HELLO = "alert('Hello, world.');";

export const HELLO_HASH = "'sha256-qznLcsROx4GACP2dm0UCKCzCG+HiZ1guq6ZZDob/Tng='";

/** WCAG 2.2 A and AA problems axe finds on the page as it is now, one line each. */
export async function accessibilityProblems(page: Page, where: string): Promise<string[]> {
  const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  return violations.flatMap((v) => v.nodes.map((n) => `${where}: ${v.id} (${v.impact}) ${n.target.join(' ')}`));
}

/**
 * Chosen states nobody can see as the page is shown now (the open tab, the checked option, the current page, the
 * picked part of the policy): each visible element in such a state is pictured, then pictured again with only that
 * state turned off. Identical pictures mean the state shows only through something the display dropped, like
 * colour in high-contrast mode. One line each. Kinds of element already in `seen` (the header's current page, on
 * every page) are skipped.
 */
export async function invisibleStates(page: Page, where: string, seen = new Set<string>()): Promise<string[]> {
  await page.mouse.move(0, 0);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  // Handles, not locators: once its state is off, an element no longer matches the selector.
  const states = await page.$$('[aria-selected="true"], [aria-checked="true"], [aria-pressed="true"], [aria-current]:not([aria-current="false"])');
  const found: string[] = [];
  for (const el of states) {
    if (!(await el.isVisible())) continue;
    const kind = await el.evaluate((e) =>
      [e.tagName, e.className, e.getAttribute('role'), e.parentElement?.className, e.parentElement?.parentElement?.className].join('|'),
    );
    if (seen.has(kind)) continue;
    seen.add(kind);
    await el.scrollIntoViewIfNeeded();
    const box = (await el.boundingBox())!;
    // A little around it, for outlines and underlines drawn outside the element.
    const clip = { x: Math.max(0, box.x - 6), y: Math.max(0, box.y - 6), width: box.width + 12, height: box.height + 12 };
    const on = await page.screenshot({ clip });
    const attribute = await el.evaluate((e) => {
      const name = ['aria-selected', 'aria-checked', 'aria-pressed', 'aria-current'].find((a) => e.hasAttribute(a) && e.getAttribute(a) !== 'false')!;
      const value = e.getAttribute(name)!;
      if (name === 'aria-current') e.removeAttribute(name);
      else e.setAttribute(name, 'false');
      return { name, value };
    });
    const off = await page.screenshot({ clip });
    await el.evaluate((e, { name, value }) => e.setAttribute(name, value), attribute);
    if (on.equals(off)) {
      const label = (await el.getAttribute('aria-label')) ?? (await el.innerText()).trim().replace(/\s+/g, ' ').slice(0, 40);
      found.push(`${where}: ${attribute.name}="${attribute.value}" on "${label}"`);
    }
  }
  return found;
}

/*
 * Screen reader. The virtual screen reader (Guidepup) reads the page the way VoiceOver or NVDA would, from the
 * accessibility tree: tests check what is said, not only what is shown. It is served from the site's own origin,
 * so our CSP stays enforced while it runs.
 */
const SCREEN_READER = readFileSync(createRequire(import.meta.url).resolve('@guidepup/virtual-screen-reader/browser.js'), 'utf8');

async function startScreenReader(page: Page, container: string) {
  if (!(await page.evaluate(() => 'screenReader' in window))) {
    await page.route('**/__test/screen-reader*.js', (route) =>
      route.fulfill({
        contentType: 'text/javascript',
        body: route.request().url().endsWith('lib.js')
          ? SCREEN_READER
          : "import { virtual } from './screen-reader-lib.js'; window.screenReader = virtual;",
      }),
    );
    // A module import, not a <script> tag: our Trusted Types rule refuses script URLs set by code.
    await page.evaluate(() => import('/__test/screen-reader.js' as string));
  }
  await page.evaluate(async (selector) => {
    const sr = (window as any).screenReader;
    await sr.stop();
    await sr.start({ container: document.querySelector(selector) });
  }, container);
}

/**
 * What a screen reader says going through `container` (a CSS selector) from start to end, one phrase per line:
 * roles, names and states, the way someone moving with VoiceOver's or NVDA's "next item" hears it.
 */
export async function readAloud(page: Page, container: string): Promise<string[]> {
  await startScreenReader(page, container);
  const log = await page.evaluate(async () => {
    const sr = (window as any).screenReader;
    const log: string[] = [await sr.lastSpokenPhrase()];
    // At the end, the reader starts again from the top.
    for (let i = 0; i < 1000; i++) {
      await sr.next();
      const phrase: string = await sr.lastSpokenPhrase();
      if (phrase === log[0]) break;
      log.push(phrase);
    }
    await sr.stop();
    return log;
  });
  // Screen readers say a button in one go; the virtual one also steps through what is inside it.
  const out: string[] = [];
  for (let i = 0; i < log.length; i++) {
    out.push(spoken(log[i]!));
    const end = log.indexOf(`end of ${log[i]}`, i + 1);
    if (log[i]!.startsWith('button, ') && end > 0) i = end;
  }
  return out;
}

/**
 * What a screen reader announces by itself (live regions, focus moves) while `action` runs, one phrase per line.
 * Listens to the whole page.
 */
export async function announced(page: Page, action: () => Promise<void>): Promise<string[]> {
  await startScreenReader(page, 'body');
  await page.evaluate(() => (window as any).screenReader.clearSpokenPhraseLog());
  await action();
  // Live regions are read after the change settles.
  await page.waitForTimeout(300);
  return page.evaluate(async () => {
    const sr = (window as any).screenReader;
    const log: string[] = await sr.spokenPhraseLog();
    await sr.stop();
    return log;
  }).then((log) => log.map(spoken));
}

/** Hidden notes start with a comma; the virtual reader puts a space before it, which no one hears. */
const spoken = (phrase: string) => phrase.replace(/\s+,/g, ',');

/** Replaces the browser's print window: records what would be printed, then closes it unless `keepOpen`. */
export async function stubPrint(page: Page, keepOpen = false) {
  await page.evaluate((keep) => {
    window.print = () => {
      const w = window as unknown as { printed: object };
      w.printed = {
        text: document.querySelector<HTMLElement>('.print-host')?.innerText ?? '',
        title: document.title,
        printing: document.documentElement.classList.contains('printing'),
      };
      if (!keep) dispatchEvent(new Event('afterprint'));
    };
  }, keepOpen);
}
export const printed = (page: Page) => page.evaluate(() => (window as unknown as { printed?: { text: string; title: string; printing: boolean } }).printed);
