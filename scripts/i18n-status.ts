import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { isMap, parseDocument, type Document } from 'yaml';
import { LOCALES, DEFAULT_LOCALE } from '../src/i18n';
import { translationReports, type PendingField, type TranslationReport } from '../src/lib/content-loader';
import { readContentFiles, ROOT } from './content-files';

/**
 * What the YAML translations still show in English.
 *
 *   yarn i18n:status            every translation folder, plus the site's locales that have none yet
 *   yarn i18n:status fr         one language, listing each stale field with its current English
 *   yarn i18n:status fr --write adds an empty entry, with the hash to keep, for every missing field
 *
 * Missing and stale text never fails: it shows in English. Keys that match nothing in English do (exit 1).
 */

const HEADER = (locale: string) =>
  `# ${locale} text for the English entry of the same name. Text only: hosts, types and dates come from English.\n` +
  `# en: hash of the English text this was translated from (yarn i18n:status ${locale} --write adds it).\n`;

/** Adds `{ en: <hash>, text: '' }` for each missing field, keeping the file's comments and order. */
export function writeStubs(fields: PendingField[], locale: string, root = ROOT): string[] {
  const written: string[] = [];
  const byFile = Map.groupBy(
    fields.filter((f) => f.state === 'missing'),
    (f) => f.file,
  );
  for (const [file, missing] of byFile) {
    const path = join(root, file);
    const doc: Document = existsSync(path) ? parseDocument(readFileSync(path, 'utf8')) : parseDocument(HEADER(locale));
    if (!isMap(doc.contents)) doc.contents = doc.createNode({});
    let added = 0;
    for (const field of missing) {
      if (doc.hasIn(field.keys) && String(doc.getIn([...field.keys, 'text']) ?? '').trim() !== '') continue;
      const node = doc.createNode({ en: field.hash, text: '' });
      node.flow = true;
      node.commentBefore = ` ${field.english.replace(/\s+/g, ' ').trim()}`;
      doc.setIn(field.keys, node);
      added++;
    }
    if (added === 0) continue;
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, doc.toString({ lineWidth: 0 }));
    written.push(`${file} (${added} added)`);
  }
  return written;
}

function summary(locale: string, report: TranslationReport): string {
  const missing = report.pending.filter((p) => p.state === 'missing').length;
  const stale = report.pending.length - missing;
  const done = report.total - report.pending.length;
  return `${locale}: ${done}/${report.total} translated, ${missing} missing, ${stale} stale${report.errors.length ? `, ${report.errors.length} errors` : ''}`;
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  const args = process.argv.slice(2);
  const write = args.includes('--write');
  const only = args.find((a) => !a.startsWith('--'));
  const files = readContentFiles();
  if (only) files.translations[only] ??= { vendors: {} };
  // The site's languages are reported even before their first translation file exists.
  for (const locale of LOCALES) if (locale !== DEFAULT_LOCALE) files.translations[locale] ??= { vendors: {} };

  const reports = Object.entries(translationReports(files)).filter(([locale]) => !only || locale === only);
  if (reports.length === 0) console.log('No translations yet. Start one with: yarn i18n:status <locale> --write');

  let failed = false;
  for (const [locale, report] of reports) {
    console.log(summary(locale, report));
    for (const e of report.errors) console.error(`  ✗ ${e}`);
    failed ||= report.errors.length > 0;
    if (only) {
      for (const p of report.pending.filter((f) => f.state === 'stale')) {
        console.log(`  stale ${p.file} › ${p.keys.join('.')} (en: ${p.hash})\n        ${p.english.replace(/\s+/g, ' ').trim()}`);
      }
    }
    if (write) for (const w of writeStubs(report.pending, locale)) console.log(`  wrote ${w}`);
  }
  if (failed) process.exit(1);
}
