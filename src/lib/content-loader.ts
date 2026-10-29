import { createHash } from 'node:crypto';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import { DEFAULT_LOCALE } from '../i18n';
import { VendorSchema, type Vendor } from './catalogue/schema';
import type { ContentBundle, DirectiveDoc, SourceDoc } from './content';

/**
 * Parses, validates and translates the YAML content. Build time only (Astro pages, scripts, tests).
 *
 * English is the reference. A translation file holds text only, never facts: each field is
 * `{ en: <hash of the English text it was translated from>, text }`. A field that is missing, empty or
 * translated from older English (stale) falls back to English, so a vendor update never waits on a translation.
 */

/** The raw files, read by Astro (`import.meta.glob`) or by the scripts (`node:fs`). */
export interface ContentFiles {
  directives: string;
  sources: string;
  /** By vendor id (the file name). */
  vendors: Record<string, string>;
  /** By locale: `src/content/<locale>/*.yaml` and `catalogue/i18n/<locale>/<id>.yaml`. */
  translations: Record<string, LocaleFiles>;
}

export interface LocaleFiles {
  directives?: string;
  sources?: string;
  vendors: Record<string, string>;
}

/** A field that shows in English for now. `keys` is its place in the translation file. */
export interface PendingField {
  file: string;
  keys: string[];
  state: 'missing' | 'stale';
  /** The hash to write in `en:` once translated. */
  hash: string;
  english: string;
}

export interface TranslationReport {
  /** Translatable fields, translated or not. */
  total: number;
  pending: PendingField[];
  /** Keys that match nothing in English, or files that don't parse. These fail validation. */
  errors: string[];
}

export const contentPath = (locale: string, name: 'directives' | 'sources') => `src/content/${locale}/${name}.yaml`;
export const vendorPath = (locale: string, id: string) => `catalogue/i18n/${locale}/${id}.yaml`;

/** Short, stable fingerprint of an English text. */
export const textHash = (text: string) => createHash('sha256').update(text).digest('hex').slice(0, 8);

const Explanation = z.object({ title: z.string(), simple: z.string(), developer: z.string(), security: z.string() });
const DirectiveDoc = Explanation.extend({ name: z.string() });
const SourceDoc = Explanation.extend({ id: z.string() });

const Field = z.strictObject({ en: z.string().regex(/^[0-9a-f]{8}$/, 'en must be the 8-character hash of the English text'), text: z.string() });
type Field = z.infer<typeof Field>;
const ExplanationOverlay = z.strictObject({
  title: Field.optional(),
  simple: Field.optional(),
  developer: Field.optional(),
  security: Field.optional(),
});
const ContentOverlay = z.record(z.string(), ExplanationOverlay);
const VendorOverlay = z.strictObject({
  notes: Field.optional(),
  nonce: z.strictObject({ how: Field.optional() }).optional(),
  features: z
    .record(
      z.string(),
      z.strictObject({
        label: Field.optional(),
        description: Field.optional(),
        /** By requirement type: a feature lists each type once. */
        reasons: z.record(z.string(), Field).optional(),
      }),
    )
    .optional(),
});

const EXPLANATION_FIELDS = ['title', 'simple', 'developer', 'security'] as const;

class Translation {
  readonly report: TranslationReport = { total: 0, pending: [], errors: [] };

  /** Parses a translation file; an invalid one is reported and ignored (everything stays in English). */
  read<T>(file: string, text: string | undefined, schema: z.ZodType<T>, empty: T): T {
    if (text === undefined) return empty;
    try {
      const result = schema.safeParse(parseYaml(text) ?? empty);
      if (result.success) return result.data;
      for (const issue of result.error.issues) this.report.errors.push(`${file} › ${issue.path.join('.') || '(file)'}: ${issue.message}`);
    } catch (e) {
      this.report.errors.push(`${file}: ${e instanceof Error ? e.message : String(e)}`);
    }
    return empty;
  }

  /** The translated text when it is current, otherwise the English one. */
  text(file: string, keys: string[], english: string, field: Field | undefined): string {
    this.report.total++;
    const hash = textHash(english);
    const translated = field !== undefined && field.text.trim() !== '';
    if (translated && field.en === hash) return field.text;
    this.report.pending.push({ file, keys, state: translated ? 'stale' : 'missing', hash, english });
    return english;
  }

  orphan(file: string, keys: string[], what: string) {
    this.report.errors.push(`${file} › ${keys.join('.')}: ${what}`);
  }

  docs<T extends DirectiveDoc | SourceDoc>(docs: T[], keyOf: (d: T) => string, file: string, text: string | undefined): T[] {
    const overlay = this.read(file, text, ContentOverlay, {});
    const known = new Set(docs.map(keyOf));
    for (const key of Object.keys(overlay)) if (!known.has(key)) this.orphan(file, [key], 'no entry with this name in the English file');
    return docs.map((doc) => {
      const entry = overlay[keyOf(doc)];
      const out = { ...doc };
      for (const f of EXPLANATION_FIELDS) out[f] = this.text(file, [keyOf(doc), f], doc[f], entry?.[f]);
      return out;
    });
  }

  vendor(vendor: Vendor, file: string, text: string | undefined): Vendor {
    const overlay = this.read(file, text, VendorOverlay, {});
    const field = (keys: string[], english: string | undefined, given: Field | undefined) => {
      if (english === undefined) {
        if (given) this.orphan(file, keys, 'the English entry has no such text');
        return undefined;
      }
      return this.text(file, keys, english, given);
    };

    const features = new Map(vendor.features.map((f) => [f.id, f]));
    for (const id of Object.keys(overlay.features ?? {})) if (!features.has(id)) this.orphan(file, ['features', id], 'no feature with this id');

    const how = field(['nonce', 'how'], vendor.nonce?.how, overlay.nonce?.how);
    const notes = field(['notes'], vendor.notes, overlay.notes);
    return {
      ...vendor,
      ...(notes !== undefined && { notes }),
      ...(vendor.nonce && { nonce: { ...vendor.nonce, ...(how !== undefined && { how }) } }),
      features: vendor.features.map((f) => {
        const given = overlay.features?.[f.id];
        const types = new Set(f.requirements.map((r) => r.type));
        for (const type of Object.keys(given?.reasons ?? {})) {
          if (!types.has(type as never)) this.orphan(file, ['features', f.id, 'reasons', type], 'the feature has no requirement of this type');
        }
        const description = field(['features', f.id, 'description'], f.description, given?.description);
        return {
          ...f,
          label: this.text(file, ['features', f.id, 'label'], f.label, given?.label),
          ...(description !== undefined && { description }),
          requirements: f.requirements.map((r) => ({
            ...r,
            reason: this.text(file, ['features', f.id, 'reasons', r.type], r.reason, given?.reasons?.[r.type]),
          })),
        };
      }),
    };
  }
}

const byKey = <T>(items: T[], keyOf: (item: T) => string) => Object.fromEntries(items.map((i) => [keyOf(i), i])) as Record<string, T>;

/** English content, parsed and validated: invalid content throws, which fails the build. */
function english(files: ContentFiles) {
  return {
    directives: z.array(DirectiveDoc).parse(parseYaml(files.directives)),
    sources: z.array(SourceDoc).parse(parseYaml(files.sources)),
    vendors: Object.entries(files.vendors).map(([id, text]) => ({ id, vendor: VendorSchema.parse(parseYaml(text)) })),
  };
}

/** The content in one language, with what is still in English and what doesn't match the English files. */
export function loadContent(files: ContentFiles, locale: string): { bundle: ContentBundle; report: TranslationReport } {
  const en = english(files);
  const translation = new Translation();
  const given = locale === DEFAULT_LOCALE ? undefined : (files.translations[locale] ?? { vendors: {} });

  const directives = given ? translation.docs(en.directives, (d) => d.name, contentPath(locale, 'directives'), given.directives) : en.directives;
  const sources = given ? translation.docs(en.sources, (d) => d.id, contentPath(locale, 'sources'), given.sources) : en.sources;
  const vendors = en.vendors.map(({ id, vendor }) => (given ? translation.vendor(vendor, vendorPath(locale, id), given.vendors[id]) : vendor));
  if (given) {
    for (const id of Object.keys(given.vendors)) if (!files.vendors[id]) translation.orphan(vendorPath(locale, id), [], 'no vendor with this id');
  }

  return {
    bundle: {
      directives: byKey(directives, (d) => d.name),
      sources: byKey(sources, (d) => d.id),
      vendors: vendors.sort((a, b) => a.name.localeCompare(b.name)),
    },
    report: translation.report,
  };
}

/** Every translation present in the files, by locale. English has no translation folder: it is the reference. */
export function translationReports(files: ContentFiles): Record<string, TranslationReport> {
  return Object.fromEntries(
    Object.keys(files.translations)
      .sort()
      .map((locale) => {
        if (locale === DEFAULT_LOCALE) {
          return [locale, { total: 0, pending: [], errors: [`${locale}: English is the reference; translation folders are for other languages`] }];
        }
        return [locale, loadContent(files, locale).report];
      }),
  );
}
