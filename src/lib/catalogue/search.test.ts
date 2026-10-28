import { describe, expect, it } from 'vitest';
import { matchesTool } from './search';

const gtm = { name: 'Google Tag Manager' };
const ga4 = { name: 'Google Analytics 4' };

describe('matchesTool', () => {
  it('matches names regardless of case, spaces and punctuation', () => {
    expect(matchesTool(gtm, 'tag man')).toBe(true);
    expect(matchesTool({ name: 'AB Tasty' }, 'abtasty')).toBe(true);
    expect(matchesTool(gtm, 'hotjar')).toBe(false);
  });

  it('matches usual abbreviations', () => {
    expect(matchesTool(gtm, 'GTM')).toBe(true);
    expect(matchesTool(ga4, 'ga4')).toBe(true);
    expect(matchesTool(ga4, 'ga')).toBe(true);
  });

  it('matches the category', () => {
    expect(matchesTool({ name: 'Hotjar' }, 'heatmap', 'Session replay & heatmaps')).toBe(true);
  });

  it('matches everything when the query is empty', () => {
    expect(matchesTool(gtm, '  ')).toBe(true);
  });
});
