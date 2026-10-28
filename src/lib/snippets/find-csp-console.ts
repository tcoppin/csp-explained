/**
 * Code people paste into their browser's DevTools console, on their own site, to collect its CSP.
 * It is shown verbatim on /find-my-csp, so it must stay short, readable and dependency-free.
 */
export const FIND_CSP_SNIPPET = `(async () => {
  // Reload this page's response headers, then look for <meta> CSP tags.
  const res = await fetch(location.href, { cache: 'no-store', credentials: 'include' });
  const found = [];
  for (const name of ['Content-Security-Policy', 'Content-Security-Policy-Report-Only']) {
    const value = res.headers.get(name);
    if (value) found.push(name + ': ' + value);
  }
  for (const meta of document.querySelectorAll('meta[http-equiv]')) {
    if (/^content-security-policy/i.test(meta.httpEquiv)) found.push(meta.outerHTML);
  }
  const result = found.join('\\n') || 'No Content-Security-Policy found on ' + location.href;
  console.log(result);
  try { copy(result); console.log('Copied to your clipboard.'); } catch {}
  return result;
})();`;
