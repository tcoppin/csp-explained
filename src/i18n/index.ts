import en from './en.json';
import enPages from './en.pages.json';
import fr from './fr.json';
import frPages from './fr.pages.json';

/** Interface and report text: what the analyzer island needs, so it is all the browser downloads. */
export type Messages = typeof en;
/** The pages' long-form copy (`pages.*`), rendered at build time only. */
export type PageMessages = typeof enPages;
export const LOCALES = ['en', 'fr'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'en';
export type Vars = Record<string, string | number>;
export interface Translate {
  (key: string, vars?: Vars): string;
  readonly locale: Locale;
  /** The keys under a list or group of messages, in order: `t.keys('pages.find.source.steps')`. */
  keys(key: string): string[];
  /** Whether a message exists, for text with a fallback of its own. */
  has(key: string): boolean;
}

// Typed as English: a French file missing a message doesn't compile.
const MESSAGES: Record<Locale, Messages> = { en, fr };
const PAGE_MESSAGES: Record<Locale, PageMessages> = { en: enPages, fr: frPages };

/** Each language's name in that language, for the language switch. */
export const LOCALE_NAMES: Record<Locale, string> = { en: 'English', fr: 'Français' };

export const isLocale = (value: unknown): value is Locale => LOCALES.includes(value as Locale);

/** The locale of a page: `Astro.currentLocale`, or the default when absent or unknown. */
export const localeOf = (value: string | undefined): Locale => (isLocale(value) ? value : DEFAULT_LOCALE);

function lookup(messages: unknown, key: string): unknown {
  return key.split('.').reduce<unknown>((node, part) => (node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined), messages);
}

/**
 * A path within the site, in a language: English at the root, other languages under `/<locale>`, without a
 * trailing slash like the rest of the site's links. `localePath('fr', '/#v=gtm')` → `/fr#v=gtm`.
 */
export function localePath(locale: Locale, path: string): string {
  const bare = stripLocale(path);
  if (locale === DEFAULT_LOCALE) return bare;
  return bare.startsWith('/#') || bare === '/' ? `/${locale}${bare.slice(1)}` : `/${locale}${bare}`;
}

/** The path without its language prefix: `/fr/learn` → `/learn`, `/fr` and `/fr/` → `/`. */
export function stripLocale(path: string): string {
  const m = /^\/([a-z]{2})(\/.*|#.*)?$/.exec(path);
  if (!m || !isLocale(m[1]) || m[1] === DEFAULT_LOCALE) return path;
  const rest = m[2] ?? '';
  return rest === '' || rest === '/' ? '/' : rest.startsWith('#') ? `/${rest}` : rest;
}

/** `getStaticPaths` for a page that exists in every language (`src/pages/[...lang]/`). */
export const localeParams = () => LOCALES.map((l) => ({ params: { lang: l === DEFAULT_LOCALE ? undefined : l } }));

/** Replaces `{name}` with `vars.name`; unknown names are left as they are. */
export const interpolate = (text: string, vars: Vars = {}) =>
  text.replace(/\{(\w+)\}/g, (m, name: string) => (name in vars ? String(vars[name]) : m));

/** `t('report.subject', { vendors: 'X' })` → interpolates `{vendors}`; returns the key when missing. */
export function translator(locale: Locale, messages: object = MESSAGES[locale]): Translate {
  const t = (key: string, vars?: Vars) => {
    const value = lookup(messages, key);
    return typeof value === 'string' ? interpolate(value, vars) : key;
  };
  const keys = (key: string) => {
    const node = lookup(messages, key);
    return node && typeof node === 'object' ? Object.keys(node).map((k) => `${key}.${k}`) : [];
  };
  const has = (key: string) => typeof lookup(messages, key) === 'string';
  return Object.assign(t, { keys, has, locale });
}

/** The translator for an Astro page or component, with the page copy: `const t = translatorFor(Astro)`. */
export function translatorFor(astro: { currentLocale?: string }): Translate {
  const locale = localeOf(astro.currentLocale);
  return translator(locale, { ...MESSAGES[locale], pages: PAGE_MESSAGES[locale] });
}
