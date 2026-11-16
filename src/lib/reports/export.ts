import type { Audience } from '../csp/model';

/** What the printed (PDF) and .html reports carry besides the report itself. */
export interface ExportOptions {
  /** The policy as it was analysed. */
  policy: boolean;
  /** What each of its rules means, in the reader's voice. */
  rules: boolean;
}

export const DEFAULT_EXPORT: ExportOptions = { policy: true, rules: false };

/** The formats a report can be saved in, counted by the `export-report` usage event. */
export type ExportFormat = 'pdf' | 'html' | 'md' | 'txt';

const BASE: Record<Audience, string> = { simple: 'csp-request-to-it', developer: 'csp-change', security: 'csp-security-review' };

/** The file a report is saved as: `csp-security-review.html`. */
export const exportFileName = (audience: Audience, format: Exclude<ExportFormat, 'pdf'>) => `${BASE[audience]}.${format}`;

/**
 * The page title while printing, which browsers offer as the PDF's file name: the report and the site it is about
 * ("Security review – shop.example.com"). The site as typed is reduced to its host.
 */
export function printTitle(title: string, site: string): string {
  const host = site.trim().replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').split(/[/?#]/)[0];
  return host ? `${title} – ${host}` : title;
}

const ENTITIES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Text made safe for an HTML file we write ourselves (its title, its lang attribute). */
export const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (c) => ENTITIES[c]!);
