import { createContext } from 'preact';
import { useContext } from 'preact/hooks';
import type { Translate } from '../i18n';

/** The island's translator, provided once by the Analyzer from its `locale` prop. */
export const I18n = createContext<Translate | undefined>(undefined);

/**
 * The translator for a Preact component: the `t` it was given (static components rendered by Astro pages,
 * which can't provide a context), or the island's. Throws rather than silently falling back to English.
 */
export function useT(t?: Translate): Translate {
  const fromContext = useContext(I18n);
  const result = t ?? fromContext;
  if (!result) throw new Error('No translator: pass `t`, or render inside <I18n.Provider>');
  return result;
}
