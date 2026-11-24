import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LOCALES } from '.';

// Base.astro names the language to suggest on <html> before the first paint; global.css shows the matching note.
describe('language note', () => {
  const css = readFileSync(new URL('../styles/global.css', import.meta.url), 'utf8');
  it.each(LOCALES)('global.css can show the note in %s', (locale) => {
    expect(css).toContain(`html[data-note-lang='${locale}'] [data-language-note='${locale}']`);
  });
});
