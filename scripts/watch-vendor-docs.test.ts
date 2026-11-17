import { describe, expect, it } from 'vitest';
import { extractTokens, fetchTokens } from './watch-vendor-docs';

describe('fetchTokens', () => {
  it('asks for the English page, so a translation never reads as a documentation change', async () => {
    let sent: RequestInit | undefined;
    const get = (async (_url: string, init?: RequestInit) => {
      sent = init;
      return new Response('<p>script-src cdn.vendor.com</p>');
    }) as typeof fetch;
    expect(await fetchTokens('https://docs.vendor.com/csp', get)).toEqual(['cdn.vendor.com', 'script-src']);
    expect(new Headers(sent?.headers).get('accept-language')).toBe('en');
  });
});

describe('extractTokens', () => {
  it('keeps directives, keywords and hosts, ignoring markup and scripts', () => {
    const html = `<html><script>var x = "tracker.example.net"</script>
      <p>Add <code>script-src &#39;unsafe-inline&#39; *.vendor.com https://cdn.vendor.com</code> and
      <code>connect-src wss://ws.vendor.com</code>. Updated last Tuesday.</p></html>`;
    expect(extractTokens(html)).toEqual([
      "'unsafe-inline'",
      '*.vendor.com',
      'connect-src',
      'https://cdn.vendor.com',
      'script-src',
      'wss://ws.vendor.com',
    ]);
  });

  it('ignores the placeholder domains reserved for documentation', () => {
    const html = `<p>img-src https://www.example.com, sgtm.example.com, cdn.example.org, tag.shop.example
      and https://examples.vendor.com, notexample.com</p>`;
    expect(extractTokens(html)).toEqual(['https://examples.vendor.com', 'img-src', 'notexample.com']);
  });
});
