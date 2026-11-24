import { useEffect, useState } from 'preact/hooks';
import type { Locale } from '../../i18n';
import type { Vendor } from '../../lib/catalogue/schema';

/** Where each language's tool texts are published (src/pages/data/vendors-[locale].json.ts). */
export const vendorTextsUrl = (locale: Locale) => `/data/vendors-${locale}.json`;

const loading = new Map<Locale, Promise<Vendor[]>>();

/** A language's tool texts, fetched once per page; a failed fetch is tried again next time. */
export function loadVendorTexts(locale: Locale): Promise<Vendor[]> {
  let promise = loading.get(locale);
  if (!promise) {
    promise = fetch(vendorTextsUrl(locale)).then((r) => {
      if (!r.ok) throw new Error(`${r.status} ${r.url}`);
      return r.json() as Promise<Vendor[]>;
    });
    promise.catch(() => loading.delete(locale));
    loading.set(locale, promise);
  }
  return promise;
}

export type VendorTexts = { state: 'ready'; vendors: Vendor[] } | { state: 'loading' } | { state: 'failed' };

/**
 * The tool texts for a message in `locale`: the page's own right away, another language's once fetched.
 * Fetching only when asked keeps every language's catalogue out of the home page.
 */
export function useVendorTexts(locale: Locale, pageLocale: Locale, pageVendors: Vendor[]): VendorTexts {
  const [loaded, setLoaded] = useState<Partial<Record<Locale, Vendor[]>>>({});
  // Only the language picked last: picking it again after a failure tries once more.
  const [failed, setFailed] = useState<Locale | null>(null);
  const other = locale !== pageLocale;
  const got = other ? loaded[locale] : pageVendors;
  useEffect(() => {
    setFailed(null);
    if (!other || got) return;
    let current = true;
    loadVendorTexts(locale).then(
      (vendors) => current && setLoaded((l) => ({ ...l, [locale]: vendors })),
      () => current && setFailed(locale),
    );
    return () => {
      current = false;
    };
  }, [locale, other, got]);
  if (got) return { state: 'ready', vendors: got };
  return failed === locale ? { state: 'failed' } : { state: 'loading' };
}
