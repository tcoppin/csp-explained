/** What the end-to-end specs share: the usage fixture, opening each island, and common steps. */
import AxeBuilder from '@axe-core/playwright';
import { test as base, type Page } from '@playwright/test';

export { expect } from '@playwright/test';

/**
 * Every test answers the usage events sent to `/e` itself (there is no `/e` in `astro preview`).
 * `sent()` returns them, as query strings, for the tests that check what is counted.
 */
export const test = base.extend<{ sent: () => string[] }>({
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

export const POLICY = "default-src 'self'; script-src 'self' https://www.googletagmanager.com; img-src 'self' data:; object-src 'none'";

/** Waits until the builder island is interactive. */
export async function openBuilder(page: Page, path = '/build') {
  await page.goto(path);
  await page.locator('astro-island:not([ssr])').waitFor({ state: 'attached' });
}

/** Waits until the comparator island is interactive. */
export async function openComparator(page: Page, path = '/compare') {
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
