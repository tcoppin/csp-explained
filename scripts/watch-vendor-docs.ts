/**
 * Detects changes in vendors' official CSP documentation.
 *
 * For every source URL in the catalogue, keeps only the CSP-relevant tokens of the page
 * (directive names, keywords, hosts) and compares them with the snapshot in
 * catalogue/doc-snapshots.json. Cosmetic page changes are ignored; a new or removed domain is not.
 *
 *   npx tsx scripts/watch-vendor-docs.ts            # report changes (markdown on stdout)
 *   npx tsx scripts/watch-vendor-docs.ts --update   # also rewrite the snapshot file
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseVendor } from '../src/lib/catalogue/schema';

const ROOT = join(import.meta.dirname, '..');
const VENDORS = join(ROOT, 'catalogue', 'vendors');
const SNAPSHOTS = join(ROOT, 'catalogue', 'doc-snapshots.json');

type Snapshots = Record<string, string[]>;

const DIRECTIVE = /\b[a-z]+-src(?:-elem|-attr)?\b|\b(?:frame-ancestors|form-action|base-uri|upgrade-insecure-requests)\b/g;
const KEYWORD = /'(?:self|none|unsafe-inline|unsafe-eval|strict-dynamic|unsafe-hashes|wasm-unsafe-eval)'/g;
const HOST = /(?<![\w.*/-])(?:(?:https?|wss?):\/\/)?(?:\*\.)?(?:[a-z0-9-]+\.)+[a-z]{2,}\b/gi;

export function extractTokens(html: string): string[] {
  const text = html
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&');
  const tokens = new Set<string>();
  for (const re of [DIRECTIVE, KEYWORD, HOST]) for (const m of text.matchAll(re)) tokens.add(m[0].toLowerCase());
  return [...tokens].sort();
}

async function fetchTokens(url: string): Promise<string[] | Error> {
  try {
    const res = await fetch(url, { headers: { 'user-agent': 'csp-explained-catalogue-watch (+https://github.com)' }, redirect: 'follow' });
    if (!res.ok) return new Error(`HTTP ${res.status}`);
    return extractTokens(await res.text());
  } catch (e) {
    return e instanceof Error ? e : new Error(String(e));
  }
}

async function main() {
  const update = process.argv.includes('--update');
  let previous: Snapshots = {};
  try {
    previous = JSON.parse(readFileSync(SNAPSHOTS, 'utf8')) as Snapshots;
  } catch {
    // First run: everything is new.
  }

  const next: Snapshots = { ...previous };
  const report: string[] = [];

  for (const file of readdirSync(VENDORS).filter((f) => f.endsWith('.yaml')).sort()) {
    const vendor = parseVendor(readFileSync(join(VENDORS, file), 'utf8'));
    for (const url of vendor.sources) {
      const tokens = await fetchTokens(url);
      if (tokens instanceof Error) {
        report.push(`- **${vendor.name}**: could not read ${url} (${tokens.message}). Check it by hand.`);
        continue;
      }
      next[url] = tokens;
      const before = previous[url];
      if (!before) continue;
      const added = tokens.filter((t) => !before.includes(t));
      const removed = before.filter((t) => !tokens.includes(t));
      if (added.length || removed.length) {
        report.push(
          `- **${vendor.name}** (\`catalogue/vendors/${file}\`): ${url}`,
          ...(added.length ? [`  - added: ${added.map((t) => `\`${t}\``).join(', ')}`] : []),
          ...(removed.length ? [`  - removed: ${removed.map((t) => `\`${t}\``).join(', ')}`] : []),
        );
      }
    }
  }

  if (update) writeFileSync(SNAPSHOTS, `${JSON.stringify(next, null, 2)}\n`);
  console.log(report.length ? `Vendor documentation changed:\n\n${report.join('\n')}` : 'No vendor documentation change detected.');
}

if (process.argv[1] && import.meta.filename === process.argv[1]) await main();
