import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readContentFiles } from '../../scripts/content-files';
import { writeStubs } from '../../scripts/i18n-status';
import { validateTranslations } from '../../scripts/validate-catalogue';
import { loadContent, textHash, translationReports, type ContentFiles } from './content-loader';

const DIRECTIVES = `
- name: script-src
  title: Scripts
  simple: Where code can come from.
  developer: Governs script elements.
  security: Protects against XSS.
`;
const SOURCES = `
- id: "'self'"
  title: Your own site
  simple: Your website.
  developer: The page's origin.
  security: Safe enough.
`;
const VENDOR = `
id: tool
name: Tool
category: analytics
website: https://tool.example
sources: [https://tool.example/docs]
lastVerified: 2026-10-01
confidence: verified
nonce:
  supported: true
  how: Add the nonce.
features:
  - id: tag
    label: Tag
    default: true
    requirements:
      - type: script
        sources: ["*.tool.example"]
        reason: Loads the tag.
      - type: connect
        sources: ["api.tool.example"]
        reason: Sends events.
`;

const field = (english: string, text: string) => `{ en: ${textHash(english)}, text: "${text}" }`;

function files(fr: Partial<ContentFiles['translations'][string]> = {}): ContentFiles {
  return { directives: DIRECTIVES, sources: SOURCES, vendors: { tool: VENDOR }, translations: { fr: { vendors: {}, ...fr } } };
}

describe('loadContent', () => {
  it('leaves English as it is', () => {
    const { bundle, report } = loadContent(files(), 'en');
    expect(bundle.directives['script-src']!.title).toBe('Scripts');
    expect(report).toEqual({ total: 0, pending: [], errors: [] });
  });

  it('uses current translations, field by field, and English for the rest', () => {
    const { bundle, report } = loadContent(
      files({
        directives: `script-src:\n  title: ${field('Scripts', 'Scripts (fr)')}\n  simple: { en: ${textHash('Where code can come from.')}, text: "" }\n`,
        vendors: {
          tool: `features:\n  tag:\n    label: ${field('Tag', 'Balise')}\n    reasons:\n      connect: ${field('Sends events.', 'Envoie les événements.')}\n`,
        },
      }),
      'fr',
    );
    const doc = bundle.directives['script-src']!;
    expect(doc.title).toBe('Scripts (fr)');
    expect(doc.simple).toBe('Where code can come from.');
    const feature = bundle.vendors[0]!.features[0]!;
    expect(feature.label).toBe('Balise');
    expect(feature.requirements.map((r) => r.reason)).toEqual(['Loads the tag.', 'Envoie les événements.']);
    expect(report.errors).toEqual([]);
    // 4 + 4 explanation fields, nonce.how, label and two reasons.
    expect(report.total).toBe(12);
    expect(report.pending.find((p) => p.keys.join('.') === 'script-src.simple')?.state).toBe('missing');
  });

  it('shows English when the English text changed since it was translated', () => {
    const { bundle, report } = loadContent(files({ directives: `script-src:\n  title: ${field('Script files', 'Fichiers de script')}\n` }), 'fr');
    expect(bundle.directives['script-src']!.title).toBe('Scripts');
    expect(report.pending.find((p) => p.keys.join('.') === 'script-src.title')).toMatchObject({ state: 'stale', hash: textHash('Scripts'), english: 'Scripts' });
  });

  it('never changes facts: sources, types and dates come from English', () => {
    const en = loadContent(files(), 'en').bundle.vendors[0]!;
    const fr = loadContent(files({ vendors: { tool: `notes: ${field('x', 'y')}` } }), 'fr').bundle.vendors[0]!;
    const facts = (v: typeof en) => ({ ...v, notes: undefined, nonce: { ...v.nonce, how: undefined }, features: v.features.map((f) => f.requirements.map(({ reason, ...r }) => r)) });
    expect(facts(fr)).toEqual(facts(en));
  });

  it('reports keys that match nothing in English, and text-only violations', () => {
    const { report } = loadContent(
      files({
        directives: `scirpt-src:\n  title: ${field('Scripts', 'x')}\n`,
        sources: `"'self'":\n  sources: ["*"]\n`,
        vendors: {
          tool: `notes: ${field('x', 'y')}\nfeatures:\n  editor:\n    label: ${field('x', 'y')}\n  tag:\n    reasons:\n      img: ${field('x', 'y')}\n`,
          gone: `notes: ${field('x', 'y')}\n`,
        },
      }),
      'fr',
    );
    expect(report.errors).toEqual([
      'src/content/fr/directives.yaml › scirpt-src: no entry with this name in the English file',
      expect.stringMatching(/^src\/content\/fr\/sources\.yaml › 'self': Unrecognized key/),
      'catalogue/i18n/fr/tool.yaml › features.editor: no feature with this id',
      'catalogue/i18n/fr/tool.yaml › notes: the English entry has no such text',
      'catalogue/i18n/fr/tool.yaml › features.tag.reasons.img: the feature has no requirement of this type',
      'catalogue/i18n/fr/gone.yaml › : no vendor with this id',
    ]);
  });

  it('refuses a translation folder for English', () => {
    expect(translationReports({ ...files(), translations: { en: { vendors: {} } } }).en!.errors).toHaveLength(1);
  });
});

describe('writeStubs', () => {
  let root: string | undefined;
  afterEach(() => root && rmSync(root, { recursive: true, force: true }));

  it('adds an empty entry with the hash for each missing field, which then only needs its text', () => {
    root = mkdtempSync(join(tmpdir(), 'csp-i18n-'));
    const before = loadContent(files(), 'fr').report;
    writeStubs(before.pending, 'fr', root);

    const written = readFileSync(join(root, 'src/content/fr/directives.yaml'), 'utf8');
    expect(written).toContain(`# Scripts\n    { en: ${textHash('Scripts')}, text: "" }`);
    const stubbed = loadContent(files({ directives: written }), 'fr').report;
    expect(stubbed.pending.filter((p) => p.state === 'missing')).toHaveLength(before.pending.length);

    const filled = written.replace(`{ en: ${textHash('Scripts')}, text: "" }`, `{ en: ${textHash('Scripts')}, text: "Scripts (fr)" }`);
    expect(loadContent(files({ directives: filled }), 'fr').bundle.directives['script-src']!.title).toBe('Scripts (fr)');
  });
});

describe('the repository', () => {
  it('has translation files that match the English ones', () => {
    expect(validateTranslations()).toEqual([]);
  });

  it('reads the same files as the site', () => {
    expect(Object.keys(readContentFiles().vendors).length).toBeGreaterThan(0);
  });
});
