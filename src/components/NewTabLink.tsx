import type { Translate } from '../i18n';
import { useT } from './i18n';

/**
 * A link that opens in a new tab: a small icon shows it, and screen readers hear it.
 * Renders as static HTML on Astro pages (pass `t`) and inside islands alike. Styles: `.new-tab` in global.css.
 * The label is plain text so the icon can share an unbreakable span with its last word: it never
 * wraps onto a line alone.
 */
export function NewTabLink({ href, label, t: given }: { href: string; label: string; t?: Translate }) {
  const t = useT(given);
  const cut = label.lastIndexOf(' ') + 1;
  return (
    <a class="new-tab" href={href} target="_blank" rel="noopener noreferrer">
      {label.slice(0, cut)}
      <span class="new-tab-end">
        {label.slice(cut)}
        <svg class="new-tab-icon" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M9.5 2.5h4v4M13.5 2.5l-6 6" />
          <path d="M11.5 9.5v3a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1h3" />
        </svg>
      </span>
      <span class="visually-hidden">{` ${t('site.newTab')}`}</span>
    </a>
  );
}
