import type { Translate } from '../../i18n';
import type { Vendor } from './schema';

/** Display order of vendor categories. Labels: `categories.*` in the messages. */
export const CATEGORIES: Vendor['category'][] = [
  'tag-management',
  'analytics',
  'advertising',
  'experimentation',
  'session-replay',
  'consent',
  'chat',
  'other',
];

/** Vendors grouped by category, in display order, empty groups left out. */
export function groupByCategory(vendors: Vendor[], t: Translate): { id: Vendor['category']; label: string; vendors: Vendor[] }[] {
  return CATEGORIES.map((id) => ({ id, label: t(`categories.${id}`), vendors: vendors.filter((v) => v.category === id) }))
    .filter((g) => g.vendors.length > 0);
}
