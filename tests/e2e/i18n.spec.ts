/** Languages: the French site, the language note, and the 404 page. */
import { test, expect, watchErrors } from './helpers';

test('the French site stays in French and links to the same page in English', async ({ page, request }) => {
  const errors = watchErrors(page);
  await page.goto('/fr/learn');
  await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
  await expect(page.locator('h1')).toHaveText("Qu'est-ce qu'une Content-Security-Policy\u202f?");
  await expect(page.locator('link[rel="alternate"][hreflang="en"]')).toHaveAttribute('href', 'https://csp-explained.com/learn');
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute('content', 'https://csp-explained.com/og-image-fr.png');
  expect((await request.get('/og-image-fr.png')).headers()['content-type']).toBe('image/png');

  // Every link within the site, in the header, the page and the footer, stays on French pages.
  for (const path of ['/fr', '/fr/build', '/fr/build#b=allowlist&step=review', '/fr/compare', '/fr/learn', '/fr/find-my-csp', '/fr/vendors', '/fr/vendors/hotjar', '/fr/directives', '/fr/directives/script-src', '/fr/about']) {
    await page.goto(path);
    const english = await page
      .locator('a[href^="/"]:not([data-lang-switch])')
      .evaluateAll((as) => as.map((a) => a.getAttribute('href')!).filter((h) => h !== '/fr' && !h.startsWith('/fr/') && !h.startsWith('/fr#')));
    expect(english, path).toEqual([]);
  }

  // The language switch, in the footer, opens the same page, keeping what follows the #.
  await page.goto('/fr/find-my-csp#terminal');
  await expect(page.getByRole('banner').getByRole('link', { name: 'English' })).toHaveCount(0);
  await page.getByRole('contentinfo').getByRole('navigation', { name: 'Langue' }).getByRole('link', { name: 'English' }).click();
  await expect(page).toHaveURL(/\/find-my-csp#terminal$/);
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await page.getByRole('contentinfo').getByRole('link', { name: 'Français' }).click();
  await expect(page).toHaveURL(/\/fr\/find-my-csp#terminal$/);
  expect(errors).toEqual([]);
});

test.describe('a visitor whose browser prefers French', () => {
  test.use({ locale: 'fr-FR' });

  test('is told, in French, that the page exists in French, and can dismiss it', async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto('/find-my-csp#terminal');
    const note = page.locator('[data-language-note="fr"]');
    await expect(note).toBeVisible();
    await expect(note).toHaveAttribute('lang', 'fr');
    await expect(note).toContainText('Cette page existe aussi en français.');

    // Dismissed once, gone on the next pages too.
    await note.getByRole('button', { name: 'Fermer' }).click();
    await expect(note).toBeHidden();
    await page.goto('/learn');
    await expect(page.locator('[data-language-note]')).toBeHidden();
    expect(errors).toEqual([]);
  });

  test('follows the note to the same page in French, keeping the # part, and sees no note there', async ({ page }) => {
    await page.goto('/find-my-csp#terminal');
    await page.getByRole('link', { name: 'La lire en français' }).click();
    await expect(page).toHaveURL(/\/fr\/find-my-csp#terminal$/);
    await expect(page.locator('[data-language-note]')).toBeHidden();
  });
});

test('a browser that prefers English sees no note on English pages', async ({ page }) => {
  await page.goto('/learn');
  await expect(page.locator('[data-language-note]')).toBeHidden();
});

test('the 404 page speaks both languages', async ({ page }) => {
  const res = await page.goto('/this-page-does-not-exist');
  expect(res?.status()).toBe(404);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText("This page isn't on the list");
  const french = page.locator('section[lang="fr"]');
  await expect(french.getByRole('heading')).toHaveText("Cette page n'est pas sur la liste");
  await expect(french.getByRole('link', { name: "Aller à l'analyseur" })).toHaveAttribute('href', '/fr');
});
