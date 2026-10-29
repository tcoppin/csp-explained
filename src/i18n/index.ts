import en from './en.json';

export type Messages = typeof en;
export const LOCALES = ['en'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'en';
export type Vars = Record<string, string | number>;
export interface Translate {
  (key: string, vars?: Vars): string;
  /** The keys under a list or group of messages, in order: `t.keys('pages.find.source.steps')`. */
  keys(key: string): string[];
  /** Whether a message exists, for text with a fallback of its own. */
  has(key: string): boolean;
}

const MESSAGES: Record<Locale, Messages> = { en };

export const isLocale = (value: unknown): value is Locale => LOCALES.includes(value as Locale);

/** The locale of a page: `Astro.currentLocale`, or the default when absent or unknown. */
export const localeOf = (value: string | undefined): Locale => (isLocale(value) ? value : DEFAULT_LOCALE);

function lookup(messages: unknown, key: string): unknown {
  return key.split('.').reduce<unknown>((node, part) => (node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined), messages);
}

/** Replaces `{name}` with `vars.name`; unknown names are left as they are. */
export const interpolate = (text: string, vars: Vars = {}) =>
  text.replace(/\{(\w+)\}/g, (m, name: string) => (name in vars ? String(vars[name]) : m));

/** `t('report.subject', { vendors: 'X' })` → interpolates `{vendors}`; returns the key when missing. */
export function translator(locale: Locale): Translate {
  const messages = MESSAGES[locale];
  const t = (key: string, vars?: Vars) => {
    const value = lookup(messages, key);
    return typeof value === 'string' ? interpolate(value, vars) : key;
  };
  const keys = (key: string) => {
    const node = lookup(messages, key);
    return node && typeof node === 'object' ? Object.keys(node).map((k) => `${key}.${k}`) : [];
  };
  const has = (key: string) => typeof lookup(messages, key) === 'string';
  return Object.assign(t, { keys, has });
}

/** The translator for an Astro page or component: `const t = translatorFor(Astro)`. */
export const translatorFor = (astro: { currentLocale?: string }) => translator(localeOf(astro.currentLocale));
