import type { Vendor } from './schema';

const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** "Google Analytics 4" → "ga4", so people can type the usual abbreviations (GTM, GA4…). */
const initials = (s: string) => normalize(s.split(/[\s-]+/).map((w) => (/^\d+$/.test(w) ? w : (w[0] ?? ''))).join(''));

/** Does a tool match what the user typed: its name, its initials or its category? */
export function matchesTool(vendor: Pick<Vendor, 'name'>, query: string, categoryLabel = ''): boolean {
  const q = normalize(query);
  if (!q) return true;
  return normalize(vendor.name).includes(q) || initials(vendor.name).startsWith(q) || normalize(categoryLabel).includes(q);
}
