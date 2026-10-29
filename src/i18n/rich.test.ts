import { describe, expect, it } from 'vitest';
import en from './en.json';
import enPages from './en.pages.json';
import fr from './fr.json';
import frPages from './fr.pages.json';
import { localePath, stripLocale, translatorFor } from './index';
import { parseRich } from './rich';

describe('parseRich', () => {
  it('reads each kind of inline markup', () => {
    expect(parseRich('Press [[F12]], open **Network**, find `script-src` in *Headers*, then [paste it](/).')).toEqual([
      { type: 'text', text: 'Press ' },
      { type: 'kbd', text: 'F12' },
      { type: 'text', text: ', open ' },
      { type: 'strong', text: 'Network' },
      { type: 'text', text: ', find ' },
      { type: 'code', text: 'script-src' },
      { type: 'text', text: ' in ' },
      { type: 'em', text: 'Headers' },
      { type: 'text', text: ', then ' },
      { type: 'link', text: 'paste it', href: '/' },
      { type: 'text', text: '.' },
    ]);
  });

  it('keeps angle brackets as text', () => {
    expect(parseRich('a `<meta>` tag')).toEqual([
      { type: 'text', text: 'a ' },
      { type: 'code', text: '<meta>' },
      { type: 'text', text: ' tag' },
    ]);
  });

  it('fills placeholders after parsing, so values are never read as markup', () => {
    expect(parseRich('[open an issue]({url}) about {name}', { url: 'https://example.com/x', name: '**AB**' })).toEqual([
      { type: 'link', text: 'open an issue', href: 'https://example.com/x' },
      { type: 'text', text: ' about **AB**' },
    ]);
  });
});

describe('translator', () => {
  const t = translatorFor({ currentLocale: 'en' });

  it('interpolates and falls back to the key', () => {
    expect(t('vendors.remove', { name: 'Hotjar' })).toBe('Remove Hotjar');
    expect(t('nope.missing')).toBe('nope.missing');
  });

  it('lists the keys of a group in order', () => {
    expect(t.keys('pages.find.source.steps')).toEqual(['pages.find.source.steps.0', 'pages.find.source.steps.1', 'pages.find.source.steps.2']);
    expect(t.keys('site.name')).toEqual([]);
  });
});

/** Every page message, as [key, text]. */
function leaves(node: unknown, prefix: string): [string, string][] {
  if (typeof node === 'string') return [[prefix, node]];
  return Object.entries(node as object).flatMap(([k, v]) => leaves(v, `${prefix}.${k}`));
}

const pages = [...leaves(enPages, 'pages'), ...leaves(frPages, 'fr:pages')];

describe('page messages', () => {
  it.each(pages)('%s has no unbalanced markup', (_key, text) => {
    const stray = parseRich(text)
      .filter((n) => n.type === 'text')
      .map((n) => n.text)
      .join('')
      .match(/`|\*|\[\[|\]\]|\]\(/);
    expect(stray).toBeNull();
  });

  it.each(pages)('%s links only within the site, to https or to a placeholder', (_key, text) => {
    for (const n of parseRich(text)) if (n.type === 'link') expect(n.href).toMatch(/^(\/|#|https:\/\/|\{\w+\}$)/);
  });
});

describe('translations', () => {
  const english = new Map([...leaves(en, ''), ...leaves(enPages, 'pages')]);
  const french = new Map([...leaves(fr, ''), ...leaves(frPages, 'pages')]);
  const shape = (text: string) => ({
    vars: [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort(),
    // Links and inline code keep their targets and content; only the words around them change.
    links: parseRich(text).filter((n) => n.type === 'link').map((n) => (n.type === 'link' ? n.href : '')),
  });

  it('have the same messages in every language', () => {
    expect([...french.keys()]).toEqual([...english.keys()]);
  });

  it.each([...english])('%s keeps its placeholders and links in French', (key, text) => {
    expect(shape(french.get(key) ?? '')).toEqual(shape(text));
  });
});

describe('localePath', () => {
  it('puts other languages under their prefix, without a trailing slash', () => {
    expect(localePath('en', '/learn')).toBe('/learn');
    expect(localePath('fr', '/learn')).toBe('/fr/learn');
    expect(localePath('fr', '/')).toBe('/fr');
    expect(localePath('fr', '/#v=gtm:container')).toBe('/fr#v=gtm:container');
    expect(localePath('en', '/fr/vendors/hotjar')).toBe('/vendors/hotjar');
  });

  it('reads the language back out of a path', () => {
    expect(stripLocale('/fr')).toBe('/');
    expect(stripLocale('/fr/')).toBe('/');
    expect(stripLocale('/fr/directives/script-src')).toBe('/directives/script-src');
    expect(stripLocale('/fr#p=abc')).toBe('/#p=abc');
    expect(stripLocale('/frame')).toBe('/frame');
    expect(stripLocale('/learn')).toBe('/learn');
  });
});
