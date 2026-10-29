import { readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { requirementsOf } from '../src/lib/catalogue/requirements';
import { translationReports } from '../src/lib/content-loader';
import { parseVendor } from '../src/lib/catalogue/schema';
import { probeFor } from '../src/lib/csp/compat';
import { classify } from '../src/lib/csp/parser';
import { readContentFiles } from './content-files';

const DIR = join(import.meta.dirname, '..', 'catalogue', 'vendors');
const NO_URL_TYPES = new Set(['inline-script', 'inline-handler', 'eval', 'inline-style', 'style-attr']);

/** Returns a list of human-readable problems; empty when the catalogue is valid. */
export function validateCatalogue(dir = DIR): string[] {
  const problems: string[] = [];
  const ids = new Set<string>();

  for (const file of readdirSync(dir).filter((f) => f.endsWith('.yaml')).sort()) {
    const where = `catalogue/vendors/${file}`;
    let vendor;
    try {
      vendor = parseVendor(readFileSync(join(dir, file), 'utf8'));
    } catch (e) {
      problems.push(`${where}: ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }
    if (vendor.id !== basename(file, '.yaml')) problems.push(`${where}: id "${vendor.id}" must match the file name`);
    if (ids.has(vendor.id)) problems.push(`${where}: duplicate id "${vendor.id}"`);
    ids.add(vendor.id);
    if (!vendor.features.some((f) => f.default)) problems.push(`${where}: at least one feature must be default: true`);

    for (const feature of vendor.features) {
      // Translations key a requirement's reason by its type, so each type appears once per feature.
      const types = feature.requirements.map((r) => r.type);
      for (const type of new Set(types.filter((t, i) => types.indexOf(t) !== i))) {
        problems.push(`${where} › ${feature.id}: "${type}" is listed twice; merge its sources into one requirement`);
      }
      for (const req of requirementsOf(feature)) {
        const label = `${where} › ${feature.id} › ${req.type} ${req.source}`;
        const kind = classify(req.source, { start: 0, end: req.source.length }).kind;
        if (kind === 'invalid' || kind === 'token') problems.push(`${label}: not a valid CSP source expression`);
        if (NO_URL_TYPES.has(req.type)) {
          if (kind !== 'keyword' && kind !== 'nonce' && kind !== 'hash') {
            problems.push(`${label}: inline/eval requirements take a keyword such as 'unsafe-inline'`);
          }
        } else if (!probeFor(req, 'https://site.example')) {
          problems.push(`${label}: cannot derive a URL to test; add a probe`);
        }
      }
    }
  }
  return problems;
}

/** Translation files whose keys match nothing in English. Missing or outdated text is not a problem: see `yarn i18n:status`. */
export function validateTranslations(root?: string): string[] {
  return Object.values(translationReports(readContentFiles(root))).flatMap((r) => r.errors);
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  const problems = [...validateCatalogue(), ...validateTranslations()];
  if (problems.length > 0) {
    console.error(problems.map((p) => `✗ ${p}`).join('\n'));
    process.exit(1);
  }
  console.log(`✓ catalogue is valid (${readdirSync(DIR).filter((f) => f.endsWith('.yaml')).length} vendors)`);
}
