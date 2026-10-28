import { describe, expect, it } from 'vitest';
import { validateCatalogue } from './validate-catalogue';

describe('vendor catalogue', () => {
  it('is valid', () => {
    expect(validateCatalogue()).toEqual([]);
  });
});
