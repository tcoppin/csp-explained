import type { Vendor } from '../lib/catalogue/schema';
import { parse } from '../lib/csp/parser';
import { useT } from './i18n';
import type { RecentAnalysis } from './recent';

interface Props {
  entries: RecentAnalysis[];
  /** The visitor turned the history off on this device. */
  off: boolean;
  vendors: Vendor[];
  onOpen: (entry: RecentAnalysis) => void;
  onDelete: (id: string) => void;
  onClearAll: () => void;
  onSwitch: (off: boolean) => void;
}

/** What the entry shows of the policy: its directives, without header names or curl output around them. */
function excerpt(text: string): string {
  const found = parse(text).policies.map((p) => p.text.trim()).filter(Boolean);
  return (found.length > 0 ? found.join(' | ') : text).replace(/\s+/g, ' ').trim();
}

/** The last policies analysed in this browser, to reopen one where it was left. */
export function RecentAnalyses({ entries, off, vendors, onOpen, onDelete, onClearAll, onSwitch }: Props) {
  const t = useT();
  if (off) {
    return (
      <p class="recent-note muted">
        {t('recent.offNote')}{' '}
        <button type="button" class="link-button" onClick={() => onSwitch(false)}>
          {t('recent.turnOn')}
        </button>
      </p>
    );
  }
  if (entries.length === 0) return null;

  const date = new Intl.DateTimeFormat(t.locale, { dateStyle: 'medium', timeStyle: 'short' });
  const names = (e: RecentAnalysis) =>
    Object.keys(e.vendors)
      .map((id) => vendors.find((v) => v.id === id)?.name)
      .filter((n): n is string => Boolean(n));

  return (
    <section class="recent" aria-labelledby="recent-title">
      <h2 id="recent-title">{t('recent.title')}</h2>
      <ul class="recent-list">
        {entries.map((e) => {
          const when = date.format(e.savedAt);
          const tools = names(e);
          return (
            <li key={e.id} class="recent-item">
              <button type="button" class="recent-open" onClick={() => onOpen(e)}>
                <code class="recent-policy">{excerpt(e.policy)}</code>
                <span class="recent-meta">
                  {e.site.trim() && <span>{e.site.trim()}</span>}
                  {tools.length > 0 && <span>{t('recent.tools', { names: tools.join(', ') })}</span>}
                  <span>{when}</span>
                </span>
              </button>
              <button type="button" class="link-button recent-delete" onClick={() => onDelete(e.id)} aria-label={t('recent.deleteLabel', { date: when })}>
                {t('recent.delete')}
              </button>
            </li>
          );
        })}
      </ul>
      <p class="recent-note muted">{t('recent.note')}</p>
      <div class="recent-actions">
        <button type="button" class="link-button" onClick={onClearAll}>
          {t('recent.clearAll')}
        </button>
        <button type="button" class="link-button" onClick={() => onSwitch(true)}>
          {t('recent.turnOff')}
        </button>
      </div>
    </section>
  );
}
