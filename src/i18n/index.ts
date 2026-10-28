import en from './en.json';

export type Messages = typeof en;
export type Locale = 'en';
export type Vars = Record<string, string | number>;
export type Translate = (key: string, vars?: Vars) => string;

const MESSAGES: Record<Locale, Messages> = { en };

function lookup(messages: unknown, key: string): unknown {
  return key.split('.').reduce<unknown>((node, part) => (node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined), messages);
}

/** `t('report.subject', { vendors: 'X' })` → interpolates `{vendors}`; returns the key when missing. */
export function translator(locale: Locale = 'en'): Translate {
  const messages = MESSAGES[locale];
  return (key, vars = {}) => {
    const value = lookup(messages, key);
    if (typeof value !== 'string') return key;
    return value.replace(/\{(\w+)\}/g, (m, name: string) => (name in vars ? String(vars[name]) : m));
  };
}

export const t = translator('en');
