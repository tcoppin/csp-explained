import { describe, expect, it } from 'vitest';
import en from '../../i18n/en.json';
import fr from '../../i18n/fr.json';
import { CATEGORIES } from './categories';
import { VendorSchema } from './schema';

describe('CATEGORIES', () => {
  it('lists every category a vendor can have, once', () => {
    // A category missing here would hide its tools from the catalogue page and the tool picker.
    expect([...CATEGORIES].sort()).toEqual([...VendorSchema.shape.category.options].sort());
  });

  it('has a label for every category in each language', () => {
    for (const id of CATEGORIES) {
      expect(en.categories[id]).toBeTruthy();
      expect(fr.categories[id]).toBeTruthy();
    }
  });
});
