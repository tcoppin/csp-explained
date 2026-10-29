import { describe, expect, it } from 'vitest';
import en from './en.json';
import { translator } from './index';
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
  const t = translator('en');

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

describe('page messages', () => {
  it.each(leaves(en.pages, 'pages'))('%s has no unbalanced markup', (_key, text) => {
    const stray = parseRich(text)
      .filter((n) => n.type === 'text')
      .map((n) => n.text)
      .join('')
      .match(/`|\*|\[\[|\]\]|\]\(/);
    expect(stray).toBeNull();
  });

  it.each(leaves(en.pages, 'pages'))('%s links only within the site, to https or to a placeholder', (_key, text) => {
    for (const n of parseRich(text)) if (n.type === 'link') expect(n.href).toMatch(/^(\/|#|https:\/\/|\{\w+\}$)/);
  });
});
