import { useT } from '../ui/i18n';
import { unreadableSite } from './state';
import './site-field.css';

interface Props {
  site: string;
  onSite: (site: string) => void;
}

/** The site's address, folded away: optional, and only used to understand 'self'. */
export function SiteField({ site, onSite }: Props) {
  const t = useT();
  const unreadable = unreadableSite(site);
  return (
    <details class="site-field">
      <summary>{t('analyzer.siteLabel')}</summary>
      <input
        type="text"
        inputMode="url"
        value={site}
        placeholder="www.example.com"
        aria-invalid={unreadable}
        aria-describedby={unreadable ? 'site-unreadable' : undefined}
        onInput={(e) => onSite(e.currentTarget.value)}
      />
      {unreadable && <p id="site-unreadable" class="issue">{t('analyzer.siteUnreadable')}</p>}
      <p class="muted">{t('analyzer.siteHint')}</p>
    </details>
  );
}
