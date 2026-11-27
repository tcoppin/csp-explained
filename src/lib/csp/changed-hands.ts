import { parseHostSource } from './parser';

/**
 * Domains that started serving malicious code after they changed owner. A policy that still allows one lets the new
 * owner's code run on the site. Each entry comes from public statements, linked in `sources`, like the catalogue.
 * Its explanation is `findings.changed-hands.<id>` (and `risks.…`) in the messages.
 */
export interface ChangedHands {
  id: string;
  /** The domain; its subdomains are covered too (`cdn.polyfill.io`). */
  domain: string;
  sources: string[];
  lastVerified: string;
}

export const CHANGED_HANDS: ChangedHands[] = [
  {
    // Sold to Funnull in February 2024; from June 2024 it served code that sent visitors to other websites.
    // Replacements: Cloudflare's copy (https://cdnjs.cloudflare.com/polyfill/, in the catalogue under cdnjs) and
    // Fastly's (polyfill-fastly.io).
    id: 'polyfill-io',
    domain: 'polyfill.io',
    sources: [
      'https://blog.cloudflare.com/automatically-replacing-polyfill-io-links-with-cloudflares-mirror-for-a-safer-internet/',
      'https://blog.cloudflare.com/polyfill-io-now-available-on-cdnjs-reduce-your-supply-chain-risk/',
      'https://community.fastly.com/t/new-options-for-polyfill-io-users/2540',
    ],
    lastVerified: '2026-11-27',
  },
];

/**
 * The domain a source allows that changed hands: `polyfill.io`, `https://cdn.polyfill.io/v3/`, `*.polyfill.io`.
 * Wider sources (`*`, `https:`) aren't about one domain: the usual checks already flag them.
 */
export function changedHandsOf(value: string | undefined): ChangedHands | undefined {
  const host = value === undefined ? undefined : parseHostSource(value)?.host;
  if (!host || host === '*') return undefined;
  const name = host.startsWith('*.') ? host.slice(2) : host;
  return CHANGED_HANDS.find((d) => name === d.domain || name.endsWith(`.${d.domain}`));
}
