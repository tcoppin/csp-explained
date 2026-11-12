/** The comparator (/compare): the two policies, what the change does in each view, the link, and what is counted. */
import { test, expect, watchErrors, openAnalyzer, openBuilder, openComparator, pickTool, policyAction, POLICY } from './helpers';

/** One of the policies kept in a comparator link. */
const inLink = (url: string, key: 'b' | 'a') => {
  const value = new URLSearchParams(new URL(url).hash.slice(1)).get(key);
  return value === null ? null : Buffer.from(value, 'base64url').toString('utf8');
};

const STRICTER = POLICY.replace(' https://www.googletagmanager.com', '');

test('compares two pasted policies, and keeps them in the link', async ({ page, context }) => {
  const errors = watchErrors(page);
  await openComparator(page);
  await expect(page.getByText('Paste a policy on each side to see what changes.')).toBeVisible();

  await page.getByRole('textbox', { name: 'Before' }).fill(POLICY);
  await page.getByRole('textbox', { name: 'After' }).fill(STRICTER);
  const scripts = page.getByRole('row', { name: /^Scripts/ });
  await expect(scripts).toContainText('No longer from');
  await expect(scripts).toContainText('https://www.googletagmanager.com');

  await page.getByRole('button', { name: 'Swap them' }).click();
  await expect(page.getByRole('textbox', { name: 'Before' })).toHaveValue(STRICTER);
  await expect(page.getByRole('textbox', { name: 'After' })).toHaveValue(POLICY);
  await expect(scripts).toContainText('Now also from');

  // The link follows a moment later, with the view.
  await page.getByRole('tab', { name: /^Security/ }).click();
  await expect.poll(() => inLink(page.url(), 'b')).toBe(STRICTER);
  await expect.poll(() => new URL(page.url()).hash).toContain('t=security');
  const again = await context.newPage();
  await openComparator(again, page.url().replace(/^.*?\/\/[^/]+/, ''));
  await expect(again.getByRole('textbox', { name: 'Before' })).toHaveValue(STRICTER);
  await expect(again.getByRole('tab', { name: /^Security/ })).toHaveAttribute('aria-selected', 'true');

  await page.getByRole('button', { name: 'Clear' }).click();
  await expect(page.getByRole('textbox', { name: 'After' })).toHaveValue('');
  await expect.poll(() => new URL(page.url()).hash).toBe('');
  expect(errors).toEqual([]);
});

test('says when two policies only differ in how they are written', async ({ page }) => {
  await openComparator(page);
  await page.getByRole('textbox', { name: 'Before' }).fill(POLICY);
  await page.getByRole('textbox', { name: 'After' }).fill(`Content-Security-Policy: ${POLICY.toUpperCase().replace("'SELF'", "'self'")}`);
  await expect(page.getByRole('tab', { name: /^What changes/ })).toContainText('no difference');
  await expect(page.getByRole('tabpanel')).toContainText('Nothing changes in what browsers allow');
});

test('a renewed nonce is no change, the same nonce twice is a warning', async ({ page }) => {
  await openComparator(page);
  const strict = (nonce: string, extra = '') => `script-src 'nonce-${nonce}' 'strict-dynamic'${extra}; object-src 'none'; base-uri 'none'`;
  await page.getByRole('textbox', { name: 'Before' }).fill(strict('AAAA1111'));
  await page.getByRole('textbox', { name: 'After' }).fill(strict('BBBB2222'));
  const panel = page.getByRole('tabpanel');
  await expect(panel).toContainText('The nonce differs between the two, as it should');
  await expect(panel).toContainText('Nothing changes in what browsers allow');
  await expect(panel).not.toContainText('nonce-BBBB2222');

  await page.getByRole('textbox', { name: 'After' }).fill(strict('AAAA1111', ' https:'));
  await expect(panel).toContainText('Both policies use the same nonce');
});

test('points at a side it cannot read', async ({ page }) => {
  await openComparator(page);
  await page.getByRole('textbox', { name: 'Before' }).fill(';;');
  await expect(page.getByRole('textbox', { name: 'Before' })).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('#before-input-issue')).toContainText("We couldn't find any directive");
  await expect(page.getByRole('region', { name: 'Comparison' })).toHaveCount(0);
});

test('the example shows each view: changes, both policies, findings and tools', async ({ page, isMobile }) => {
  const errors = watchErrors(page);
  await openComparator(page);
  await page.getByRole('button', { name: 'Try an example' }).click();

  // What changes: sources gained and lost, inline code by verdict. Scripts gain the nonce; workers, which never carry
  // one, only 'strict-dynamic'.
  const scripts = page.getByRole('row', { name: /^Scripts/ });
  await expect(scripts).toContainText("'strict-dynamic'");
  await expect(scripts).toContainText("Now also what carries the page's nonce");
  await expect(page.getByRole('row', { name: /^Background workers/ })).not.toContainText('nonce');
  await expect(page.getByRole('row', { name: /^Inline event handlers/ })).toContainText('BlockedBefore: Allowed');

  // Both policies: inline, or side by side on wider screens only.
  await page.getByRole('tab', { name: /^Both policies/ }).click();
  const panel = page.getByRole('tabpanel');
  await expect(panel.locator('ins', { hasText: "'strict-dynamic'" })).toBeVisible();
  await expect(panel.locator('del', { hasText: "'unsafe-inline'" }).first()).toBeVisible();
  const layout = page.getByRole('radiogroup', { name: 'Layout' });
  if (isMobile) {
    await expect(layout).toBeHidden();
  } else {
    await layout.getByRole('radio', { name: 'Side by side' }).click();
    await expect(panel.getByRole('columnheader', { name: 'After' })).toBeVisible();
    await expect(panel.locator('.policy-diff')).toBeHidden();
    // Remembered in this browser.
    await page.reload();
    await page.locator('astro-island:not([ssr])').waitFor({ state: 'attached' });
    await expect(page.getByRole('radio', { name: 'Side by side' })).toHaveAttribute('aria-checked', 'true');
  }

  // Security: the short nonce is new, 'unsafe-inline' in script-src is fixed.
  await page.getByRole('tab', { name: /^Security/ }).click();
  await expect(page.getByRole('tab', { name: /^Security/ })).toContainText('1 new finding');
  await expect(page.getByRole('tabpanel')).toContainText("The nonce 'nonce-r4nd0m' is shorter than 8 characters");

  // Tools: Hotjar stays blocked, but its images are newly blocked: worse.
  await page.getByRole('tab', { name: /^Your tools/ }).click();
  await pickTool(page, 'Hotjar');
  await expect(page.getByRole('tab', { name: /^Your tools/ })).toContainText('1 breaks');
  const hotjar = page.getByRole('region', { name: 'Hotjar' });
  await expect(hotjar).toContainText('Blocked by this policy');
  await expect(hotjar).toContainText('Before the change: Blocked by this policy');
  await expect(hotjar.locator('.req-blocked', { hasText: 'https://survey-images.hotjar.com' })).toContainText('Before the change: Works with this policy');
  expect(errors).toEqual([]);
});

test('says when a policy moves from report-only to enforced', async ({ page }) => {
  await openComparator(page);
  await page.getByRole('textbox', { name: 'Before' }).fill(`Content-Security-Policy-Report-Only: ${POLICY}`);
  await page.getByRole('textbox', { name: 'After' }).fill(`Content-Security-Policy: ${POLICY}`);
  await expect(page.getByRole('tabpanel')).toContainText('The after policy is enforced: what the before policy only reported will now be blocked.');
});

test('the analyzer opens the comparator with its policy as the one before', async ({ page }) => {
  await openAnalyzer(page);
  await page.getByRole('textbox', { name: 'Paste a Content-Security-Policy' }).fill(POLICY);
  await page.getByRole('button', { name: 'Done' }).click();
  await policyAction(page, 'link', 'Compare with another policy');
  await page.locator('astro-island:not([ssr])').waitFor({ state: 'attached' });
  await expect(page).toHaveURL(/\/compare#/);
  await expect(page.getByRole('textbox', { name: 'Before' })).toHaveValue(POLICY);
  await expect(page.getByRole('textbox', { name: 'After' })).toBeFocused();
});

test('either side can come from a recent analysis, once the history is on', async ({ page }) => {
  // No history kept, nothing to offer.
  await openComparator(page);
  await expect(page.locator('.recent-picker')).toHaveCount(0);

  await openAnalyzer(page);
  await page.getByRole('button', { name: 'Keep a history on this device' }).click();
  await page.locator('.site-field summary').click();
  await page.locator('.site-field input').fill('shop.example.com');
  await page.getByRole('textbox', { name: 'Paste a Content-Security-Policy' }).fill(POLICY);
  // The analyzer keeps it once the text settles.
  await expect.poll(() => page.evaluate(() => localStorage.getItem('csp-explained:recent') ?? '')).toContain('shop.example.com');

  await openComparator(page);
  const picker = page.getByRole('combobox', { name: 'After: or use a recent analysis' });
  const entry = await picker.locator('option', { hasText: 'shop.example.com' }).getAttribute('value');
  await picker.selectOption(entry!);
  await expect(page.getByRole('textbox', { name: 'After' })).toHaveValue(POLICY);
  await expect(picker).toHaveValue('');
  await page.locator('.site-field summary').click();
  await expect(page.locator('.site-field input')).toHaveValue('shop.example.com');
});

test('the builder compares what it built with the policy it started from', async ({ page }) => {
  await openBuilder(page, `/build#b=policy&p=${Buffer.from(POLICY).toString('base64url')}&v=hotjar:tracking&step=review`);
  await page.getByRole('link', { name: 'Compare with your current policy' }).click();
  await page.locator('astro-island:not([ssr])').waitFor({ state: 'attached' });
  await expect(page.getByRole('textbox', { name: 'Before' })).toHaveValue(POLICY);
  await expect(page.getByRole('textbox', { name: 'After' })).toHaveValue(/hotjar\.com/);
  await expect(page.getByRole('row', { name: /^Data connections/ })).toContainText('https://*.hotjar.com');
  await page.getByRole('tab', { name: /^Your tools/ }).click();
  await expect(page.getByRole('region', { name: 'Hotjar' })).toContainText('Before the change: Blocked by this policy');
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
