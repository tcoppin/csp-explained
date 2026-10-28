/**
 * Code people paste into their browser's DevTools console, on their own site, to collect its CSP.
 * It is shown verbatim on /find-my-csp, so it must stay short, readable and dependency-free.
 *
 * It runs synchronously from start to end, on purpose: the console's `copy()` helper only works
 * while the pasted code runs. Chrome removes it after the first `await` ("copy is not defined");
 * Firefox keeps it but only writes to the clipboard when the evaluation ends, so a later call does
 * nothing. Hence a synchronous XMLHttpRequest instead of `fetch`, despite the deprecation warning
 * some browsers print for it.
 */
export const FIND_CSP_SNIPPET = `(() => {
  // Runs in one go, without waiting: the console's copy() only works until the pasted code ends.
  // Reload this page's response headers, then look for <meta> CSP tags.
  const req = new XMLHttpRequest();
  req.open('GET', location.href, false);
  req.setRequestHeader('Cache-Control', 'no-cache');
  req.send();
  const found = [];
  for (const name of ['Content-Security-Policy', 'Content-Security-Policy-Report-Only']) {
    const value = req.getResponseHeader(name);
    if (value) found.push(name + ': ' + value);
  }
  for (const meta of document.querySelectorAll('meta[http-equiv]')) {
    if (/^content-security-policy/i.test(meta.httpEquiv)) found.push(meta.outerHTML);
  }
  const result = found.join('\\n') || 'No Content-Security-Policy found on ' + location.href;
  console.log(result);
  try {
    copy(result);
    console.log('Copied to your clipboard.');
  } catch {
    console.log('Could not copy automatically: select the text above and copy it.');
  }
  return result;
})();`;
