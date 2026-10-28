/**
 * Code people paste into their browser's DevTools console, on their own site, to collect its CSP.
 * It is shown verbatim on /find-my-csp, so it must stay short, readable and dependency-free.
 *
 * `copy()` is a DevTools console helper that only exists while the console evaluates the pasted
 * line: after the first `await` it is gone ("copy is not defined"). The snippet therefore keeps a
 * reference to it before awaiting anything.
 */
export const FIND_CSP_SNIPPET = `(async () => {
  // The console's copy() helper disappears after the first await: keep it now.
  const toClipboard = typeof copy === 'function' ? copy : null;
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
  try {
    toClipboard(result);
    console.log('Copied to your clipboard.');
  } catch {
    console.log('Could not copy automatically: select the text above and copy it.');
  }
  return result;
})();`;
