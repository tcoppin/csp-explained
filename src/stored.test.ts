import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import enPages from './i18n/en.pages.json';
import { STORED } from './stored';

/** Keys older versions wrote, now only removed. */
const LEGACY = ['recent-off'];

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return sources(path);
    return /\.(ts|tsx|astro)$/.test(e.name) && !e.name.includes('.test.') ? [path] : [];
  });
}

describe('browser storage', () => {
  it('lists, for the About page, every key the code keeps in the browser', () => {
    const used = new Set(sources(import.meta.dirname).flatMap((f) => [...readFileSync(f, 'utf8').matchAll(/csp-explained:([a-z-]+)/g)].map((m) => m[1]!)));
    expect([...used].filter((k) => !LEGACY.includes(k)).sort()).toEqual([...STORED].sort());
  });

  it('explains each key on the About page', () => {
    const items: Record<string, string> = enPages.about.stored.items;
    expect(Object.keys(items).sort()).toEqual([...STORED].sort());
  });
});
