import type { ResourceType } from './directives';

/**
 * Hashes of inline code (CSP Level 3 §8.4 and §8.3): the browser hashes the text exactly as written, and allows it
 * when the policy lists that hash.
 * - `<script>` and `<style>` blocks: the text between the tags.
 * - Event handlers (`onclick="…"`) and `style="…"` attributes: the attribute's value, once the HTML parser has
 *   decoded its entities. Their hashes only count next to 'unsafe-hashes'.
 * Checked in Chrome, Firefox and Safari (2026-11-27).
 */

export type InlineKind = 'script' | 'style';
/** What a hash allows: a block, or an attribute. */
export type HashKind = InlineKind | 'handler' | 'style-attr';

export const HASH_TYPE: Record<HashKind, ResourceType> = {
  script: 'inline-script',
  style: 'inline-style',
  handler: 'inline-handler',
  'style-attr': 'style-attr',
};

/** Attribute hashes only count with this keyword in the same directive. */
export const UNSAFE_HASHES = "'unsafe-hashes'";
export const isAttributeKind = (kind: HashKind) => kind === 'handler' || kind === 'style-attr';

export interface InlineBlock {
  /** Undefined when the text had no tags: the visitor says what it is. */
  kind?: HashKind;
  /** The text the browser hashes. */
  content: string;
  /**
   * Why it needs no hash, or can't have one: it loads a file without an `integrity` attribute, holds data rather
   * than code, is empty, or is a `javascript:` link (checked under script-src-elem, like `<script>` blocks).
   */
  skipped?: 'external' | 'data' | 'empty' | 'javascript-link';
  /**
   * A `<script src>` with an `integrity` attribute: the hashes it lists, as source expressions. Every one of them must
   * be in the policy (CSP3 §6.7.2.4); the browser's integrity check then makes sure the file is the one expected.
   */
  integrity?: string[];
  /** The address a `<script src>` loads. */
  src?: string;
}

const TAG = /<(script|style)\b([^>]*)>([\s\S]*?)<\/\1\s*>/gi;
const START_TAG = /<([a-z][\w-]*)\b((?:[^>"']|"[^"]*"|'[^']*')*)>/gi;
const ATTRIBUTE = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
/** Attributes pasted without their element: `onclick="go()"`, `style='color: red'`. */
const BARE_ATTRIBUTES = /^\s*(?:[\w-]+\s*=\s*(?:"[^"]*"|'[^']*')\s*)+$/;
/** `type` values the browser runs as script, and the special ones CSP checks like scripts. */
const SCRIPT_TYPES = /^(|module|importmap|speculationrules|(text|application)\/(x-)?(java|ecma)script|text\/(javascript1\.[0-5]|jscript|livescript))$/i;
/** Integrity metadata the browser knows (SRI §3.3.3): other algorithms are ignored. */
const INTEGRITY = /^(sha256|sha384|sha512)-([A-Za-z0-9+/_-]+={0,2})(?:\?.*)?$/i;

function attributes(attrs: string): [string, string][] {
  return [...attrs.matchAll(ATTRIBUTE)].map((m) => [m[1]!.toLowerCase(), m[2] ?? m[3] ?? m[4] ?? '']);
}

function attribute(attrs: string, name: string): string | undefined {
  return attributes(attrs).find(([n]) => n === name)?.[1];
}

const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** Character references the HTML parser decodes in attribute values: numeric ones, and the common named ones. */
function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, ref: string) => {
    if (ref.startsWith('#')) {
      const code = ref[1] === 'x' || ref[1] === 'X' ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return NAMED[ref.toLowerCase()] ?? whole;
  });
}

/** The code in an element's attributes: event handlers and style attributes, in their order. */
function attributeCode(attrs: string): InlineBlock[] {
  const found: InlineBlock[] = [];
  for (const [name, raw] of attributes(attrs)) {
    const value = decodeEntities(raw);
    if (/^on[a-z]+$/.test(name)) found.push(value === '' ? { kind: 'handler', content: value, skipped: 'empty' } : { kind: 'handler', content: value });
    else if (name === 'style') found.push(value === '' ? { kind: 'style-attr', content: value, skipped: 'empty' } : { kind: 'style-attr', content: value });
    else if (/^\s*javascript:/i.test(value)) found.push({ kind: 'handler', content: value, skipped: 'javascript-link' });
  }
  return found;
}

/** The hashes an `integrity` attribute lists, as source expressions; undefined when it lists none the browser knows. */
function integritySources(value: string | undefined): string[] | undefined {
  if (value === undefined) return undefined;
  const sources = value
    .split(/\s+/)
    .map((token) => INTEGRITY.exec(token))
    .filter((m) => m !== null)
    .map((m) => `'${m[1]!.toLowerCase()}-${m[2]}'`);
  return sources.length > 0 ? [...new Set(sources)] : undefined;
}

function block(tag: string, attrs: string, content: string): InlineBlock {
  const kind = tag.toLowerCase() as InlineKind;
  const found: InlineBlock = { kind, content };
  const src = kind === 'script' ? attribute(attrs, 'src') : undefined;
  if (src !== undefined) {
    found.src = src;
    const integrity = integritySources(attribute(attrs, 'integrity'));
    if (integrity) found.integrity = integrity;
    else found.skipped = 'external';
  } else if (kind === 'script' && !SCRIPT_TYPES.test((attribute(attrs, 'type') ?? '').trim())) found.skipped = 'data';
  else if (content === '') found.skipped = 'empty';
  return found;
}

/** The HTML parser turns every line break into a plain `\n` before the browser hashes the text. */
const normalized = (text: string) => text.replace(/\r\n?/g, '\n');

/**
 * The inline code in pasted text, in the order it appears: each `<script>` and `<style>` element and each event
 * handler or style attribute when there are tags; the attributes alone when only those were pasted
 * (`onclick="go()"`); otherwise the whole text as one block (code copied from between the tags). Markup with no
 * inline code in it gives nothing.
 */
export function inlineBlocks(pasted: string): InlineBlock[] {
  const text = normalized(pasted);
  if (BARE_ATTRIBUTES.test(text)) return attributeCode(text);
  const blocks = [...text.matchAll(TAG)];
  // Code copied from between the tags, even when it writes markup (`el.innerHTML = '<b onclick="…">'`).
  if (blocks.length === 0 && !text.trimStart().startsWith('<')) return text.trim() === '' ? [] : [{ content: text }];
  // Element contents blanked out, so markup written inside a script (`'<b onclick=…>'`) isn't read as attributes.
  let markup = text;
  for (const b of blocks) {
    const start = b.index + b[0].indexOf('>') + 1;
    const end = start + b[3]!.length;
    markup = markup.slice(0, start) + ' '.repeat(end - start) + markup.slice(end);
  }
  const found: { at: number; block: InlineBlock }[] = [];
  for (const tag of markup.matchAll(START_TAG)) for (const b of attributeCode(tag[2] ?? '')) found.push({ at: tag.index, block: b });
  // A block comes after its own tag's attributes (`<script onload="…">`).
  for (const b of blocks) found.push({ at: b.index + 0.5, block: block(b[1]!, b[2] ?? '', b[3] ?? '') });
  return found.sort((a, b) => a.at - b.at).map((f) => f.block);
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

/** The source expression allowing this exact text, e.g. `'sha256-qznLcsROx4GACP2dm0UCKCzCG+HiZ1guq6ZZDob/Tng='`. */
export async function hashSource(content: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(content));
  return `'sha256-${toBase64(new Uint8Array(digest))}'`;
}

export interface InlineHash {
  kind: HashKind;
  source: string;
}
