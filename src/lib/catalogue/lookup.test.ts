import { describe, expect, it } from 'vitest';
import { addressOf, sourceMatchesAddress } from './lookup';

const match = (source: string, typed: string) => sourceMatchesAddress(source, addressOf(typed)!);

describe('addressOf', () => {
  it('reads a host, a full address or a value copied from a console message', () => {
    expect(addressOf('static.hotjar.com')?.href).toBe('https://static.hotjar.com/');
    expect(addressOf('  https://region1.google-analytics.com/g/collect?v=2 ')?.hostname).toBe('region1.google-analytics.com');
    expect(addressOf("'https://cdn.us.heap-api.com/heap.js'.")?.hostname).toBe('cdn.us.heap-api.com');
    expect(addressOf('//t.contentsquare.net/uxa/x.js')?.protocol).toBe('https:');
    expect(addressOf('wss://ws.hotjar.com')?.protocol).toBe('wss:');
    expect(addressOf('static.hotjar.com:8443')?.port).toBe('8443');
  });

  it('leaves tool names and other text to the name search', () => {
    for (const q of ['', 'hotjar', 'Google Analytics 4', 'GA4', 'a.b c', 'blob:', "'self'", '...']) expect(addressOf(q)).toBeUndefined();
  });
});

describe('sourceMatchesAddress', () => {
  it('is exact when a policy with the source would let the browser load the address', () => {
    expect(match('*.contentsquare.net', 't.contentsquare.net')).toBe('exact');
    expect(match('https://*.google-analytics.com', 'https://region1.google-analytics.com/g/collect')).toBe('exact');
    expect(match('https://cdn.us.heap-api.com', 'cdn.us.heap-api.com/js/heap.js')).toBe('exact');
    expect(match('https://www.google.com/pagead/', 'www.google.com')).toBe('exact');
  });

  it('is domain for another host under the typed one, or the same host on another scheme or port', () => {
    expect(match('https://www.google.com', 'google.com')).toBe('domain');
    expect(match('*.contentsquare.net', 'contentsquare.net')).toBe('domain');
    expect(match('https://cdn.us.heap-api.com', 'heap-api.com')).toBe('domain');
    expect(match('https://static.hotjar.com', 'http://static.hotjar.com')).toBe('domain');
    expect(match('https://static.hotjar.com', 'static.hotjar.com:8443')).toBe('domain');
  });

  it('ignores unrelated hosts, look-alike hosts and values that are not addresses', () => {
    expect(match('https://www.google.com', 'www.google.com.example.org')).toBeUndefined();
    expect(match('*.hotjar.com', 'nothotjar.com')).toBeUndefined();
    expect(match('https://heapanalytics.com', 'cdn.heapanalytics.com')).toBeUndefined();
    for (const source of ["'self'", "'unsafe-inline'", 'blob:', 'data:', '*']) expect(match(source, 'static.hotjar.com')).toBeUndefined();
  });
});
