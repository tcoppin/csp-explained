import type { ResourceType } from './directives';

/**
 * Hashes of inline `<script>` and `<style>` blocks (CSP Level 3 §8.4): the browser hashes the element's text,
 * exactly as written between the tags, and allows the block when the policy lists that hash.
 */

export type InlineKind = 'script' | 'style';

export const INLINE_TYPE: Record<InlineKind, ResourceType> = { script: 'inline-script', style: 'inline-style' };

export interface InlineBlock {
  /** Undefined when the text had no tags: the visitor says what it is. */
  kind?: InlineKind;
  /** The text the browser hashes. */
  content: string;
  /** Why the block needs no hash: it loads a file, holds data rather than code, or is empty. */
  skipped?: 'external' | 'data' | 'empty';
}

const TAG = /<(script|style)\b([^>]*)>([\s\S]*?)<\/\1\s*>/gi;
/** `type` values the browser runs as script, and the special ones CSP checks like scripts. */
const SCRIPT_TYPES = /^(|module|importmap|speculationrules|(text|application)\/(x-)?(java|ecma)script|text\/(javascript1\.[0-5]|jscript|livescript))$/i;

function attribute(attrs: string, name: string): string | undefined {
  const m = new RegExp(`(?:^|\\s)${name}(?:\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+)))?`, 'i').exec(attrs);
  return m ? (m[1] ?? m[2] ?? m[3] ?? '') : undefined;
}

/** The HTML parser turns every line break into a plain `\n` before the browser hashes the text. */
const normalized = (text: string) => text.replace(/\r\n?/g, '\n');

/**
 * The inline blocks in pasted text: each `<script>` and `<style>` element when there are tags, otherwise the
 * whole text as one block (code copied from between the tags).
 */
export function inlineBlocks(pasted: string): InlineBlock[] {
  const text = normalized(pasted);
  const tags = [...text.matchAll(TAG)];
  if (tags.length === 0) return text.trim() === '' ? [] : [{ content: text }];
  return tags.map(([, tag, attrs = '', content = '']) => {
    const kind = tag!.toLowerCase() as InlineKind;
    const block: InlineBlock = { kind, content };
    if (kind === 'script' && attribute(attrs, 'src') !== undefined) block.skipped = 'external';
    else if (kind === 'script' && !SCRIPT_TYPES.test((attribute(attrs, 'type') ?? '').trim())) block.skipped = 'data';
    else if (content === '') block.skipped = 'empty';
    return block;
  });
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
  kind: InlineKind;
  source: string;
}
