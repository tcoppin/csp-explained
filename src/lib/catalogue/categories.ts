import type { Vendor } from './schema';

/** Display order and labels of vendor categories. */
export const CATEGORIES: Record<Vendor['category'], string> = {
  'tag-management': 'Tag management',
  analytics: 'Analytics',
  advertising: 'Advertising',
  experimentation: 'A/B testing & personalisation',
  'session-replay': 'Session replay & heatmaps',
  consent: 'Consent management',
  chat: 'Chat & support',
  other: 'Other',
};

/** Vendors grouped by category, in display order, empty groups left out. */
export function groupByCategory(vendors: Vendor[]): { id: Vendor['category']; label: string; vendors: Vendor[] }[] {
  return (Object.keys(CATEGORIES) as Vendor['category'][])
    .map((id) => ({ id, label: CATEGORIES[id], vendors: vendors.filter((v) => v.category === id) }))
    .filter((g) => g.vendors.length > 0);
}
