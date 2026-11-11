import type { Vendor } from '../../lib/catalogue/schema';
import { useT } from '../ui/i18n';
import { excerpt, type RecentAnalysis } from '../policy/recent';

interface Props {
  entries: RecentAnalysis[];
  /** The visitor asked for a history on this device. */
  on: boolean;
  vendors: Vendor[];
  onOpen: (entry: RecentAnalysis) => void;
  onDelete: (id: string) => void;
  onClearAll: () => void;
  onSwitch: (on: boolean) => void;
}

/** The last policies analysed in this browser, to reopen one where it was left. */
export function RecentAnalyses({ entries, on, vendors, onOpen, onDelete, onClearAll, onSwitch }: Props) {
  const t = useT();
  if (!on) {
    return (
      <p class="recent-note muted">
        {t('recent.offNote')}{' '}
        <button type="button" class="link-button" onClick={() => onSwitch(true)}>
          {t('recent.turnOn')}
        </button>
      </p>
    );
  }
  if (entries.length === 0) {
    return (
      <p class="recent-note muted">
        {t('recent.emptyNote')}{' '}
        <button type="button" class="link-button" onClick={() => onSwitch(false)}>
          {t('recent.turnOff')}
        </button>
      </p>
    );
  }

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
        <button type="button" class="link-button" onClick={() => onSwitch(false)}>
          {t('recent.turnOff')}
        </button>
      </div>
    </section>
  );
}
