/** The comparator (/compare): the two policies, the link that keeps them, and what is counted. */
import { test, expect, watchErrors, openComparator, POLICY } from './helpers';

/** One of the policies kept in a comparator link. */
const inLink = (url: string, key: 'b' | 'a') => {
  const value = new URLSearchParams(new URL(url).hash.slice(1)).get(key);
  return value === null ? null : Buffer.from(value, 'base64url').toString('utf8');
};

const STRICTER = POLICY.replace(" https://www.googletagmanager.com", '');

test('compares two pasted policies, and keeps them in the link', async ({ page, context }) => {
  const errors = watchErrors(page);
  await openComparator(page);
  await expect(page.getByText('Paste a policy on each side to see what changes.')).toBeVisible();

  await page.getByRole('textbox', { name: 'Before' }).fill(POLICY);
  await page.getByRole('textbox', { name: 'After' }).fill(STRICTER);
  const results = page.getByRole('region', { name: 'What changes' });
  await expect(results).toContainText('1 rule changes.');

  await page.getByRole('button', { name: 'Swap them' }).click();
  await expect(page.getByRole('textbox', { name: 'Before' })).toHaveValue(STRICTER);
  await expect(page.getByRole('textbox', { name: 'After' })).toHaveValue(POLICY);

  // The link follows a moment later.
  await expect.poll(() => inLink(page.url(), 'b')).toBe(STRICTER);
  const again = await context.newPage();
  await openComparator(again, page.url().replace(/^.*?\/\/[^/]+/, ''));
  await expect(again.getByRole('textbox', { name: 'Before' })).toHaveValue(STRICTER);
  await expect(again.getByRole('region', { name: 'What changes' })).toContainText('1 rule changes.');

  await page.getByRole('button', { name: 'Clear' }).click();
  await expect(page.getByRole('textbox', { name: 'After' })).toHaveValue('');
  await expect.poll(() => new URL(page.url()).hash).toBe('');
  expect(errors).toEqual([]);
});

test('says when two policies only differ in how they are written', async ({ page }) => {
  await openComparator(page);
  await page.getByRole('textbox', { name: 'Before' }).fill(POLICY);
  await page.getByRole('textbox', { name: 'After' }).fill(`Content-Security-Policy: ${POLICY.toUpperCase().replace("'SELF'", "'self'")}`);
  await expect(page.getByRole('region', { name: 'What changes' })).toContainText('No difference');
});

test('points at a side it cannot read', async ({ page }) => {
  await openComparator(page);
  await page.getByRole('textbox', { name: 'Before' }).fill(';;');
  await expect(page.getByRole('textbox', { name: 'Before' })).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('#before-input-issue')).toContainText("We couldn't find any directive");
  await expect(page.getByRole('region', { name: 'What changes' })).toHaveCount(0);
});

test('counts a comparison once, never the example or the policies', async ({ page, sent }) => {
  await openComparator(page);
  await page.getByRole('button', { name: 'Try an example' }).click();
  await expect.poll(sent).toContain('n=example');
  await page.waitForTimeout(1800);
  expect(sent()).not.toContain('n=compare');

  await page.getByRole('textbox', { name: 'Before' }).fill(POLICY);
  await page.getByRole('textbox', { name: 'After' }).fill(STRICTER);
  await expect.poll(sent).toContain('n=compare');
  await page.getByRole('textbox', { name: 'After' }).fill(POLICY);
  await page.waitForTimeout(1800);
  expect(sent().filter((q) => q === 'n=compare')).toHaveLength(1);
  for (const q of sent()) expect(q).not.toMatch(/self|googletagmanager|src/);
});
