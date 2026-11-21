import type { VNode } from 'preact';
import { renderDocument } from './document';

/**
 * A document as Markdown, read from the same rendered document as the PDF and the .html file, so the three never say
 * different things. Knows the elements our documents use: headings, paragraphs, lists, code boxes (a figure with its
 * caption), definition lists, and inline code, strong, emphasis and links. Text hidden for screen readers (a link's
 * "opens in a new tab") and icons are left out.
 */
export function markdownOf(doc: VNode): string {
  return renderDocument(doc, (host) => `${blocks(host).join('\n\n').trim()}\n`);
}

/** The blocks an element holds, each a string of one or more lines. */
function blocks(el: Element): string[] {
  const out: string[] = [];
  for (const child of el.children) out.push(...block(child));
  return out.filter((b) => b.trim() !== '');
}

function block(el: Element): string[] {
  const tag = el.tagName.toLowerCase();
  if (hidden(el)) return [];
  const heading = /^h([1-6])$/.exec(tag);
  if (heading) return [`${'#'.repeat(Number(heading[1]))} ${inline(el)}`];
  switch (tag) {
    case 'p':
      return [inline(el)];
    case 'pre':
      return [fence(el.textContent ?? '')];
    case 'figure': {
      const caption = el.querySelector('figcaption');
      const pre = el.querySelector('pre');
      return [...(caption ? [inline(caption)] : []), ...(pre ? [fence(pre.textContent ?? '')] : [])];
    }
    case 'ul':
    case 'ol': {
      const items = [...el.children].map((li, i) => item(li, tag === 'ol' ? `${i + 1}. ` : '- '));
      // Items of several blocks need a blank line between them; one-line items don't.
      return [items.join(items.some((i) => i.includes('\n')) ? '\n\n' : '\n')];
    }
    case 'dl':
      return [[...el.querySelectorAll('dt')].map((dt) => `- **${inline(dt)}**: ${dt.nextElementSibling ? inline(dt.nextElementSibling) : ''}`).join('\n')];
    default:
      // Sections, headers, footers, divs: what they hold.
      return blocks(el);
  }
}

/** A list item: its first block after the marker, the others indented under it. */
function item(li: Element, marker: string): string {
  const parts = [...li.children].some((c) => isBlock(c)) ? blocks(li) : [inline(li)];
  const indent = ' '.repeat(marker.length);
  return parts.map((part, i) => (i === 0 ? marker : indent) + part.split('\n').join(`\n${indent}`)).join('\n\n');
}

const BLOCKS = new Set(['p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'figure', 'pre', 'section', 'dl']);
const isBlock = (el: Element) => BLOCKS.has(el.tagName.toLowerCase());
const hidden = (el: Element) => el.classList.contains('visually-hidden') || el.tagName.toLowerCase() === 'svg' || el.getAttribute('aria-hidden') === 'true';

function inline(el: Node): string {
  let out = '';
  for (const node of el.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      out += escape(node.textContent ?? '');
      continue;
    }
    if (!(node instanceof Element) || hidden(node)) continue;
    const text = () => inline(node).trim();
    switch (node.tagName.toLowerCase()) {
      case 'code':
        out += code(node.textContent ?? '');
        break;
      case 'strong':
      case 'b':
        out += `**${text()}**`;
        break;
      case 'em':
      case 'i':
        out += `*${text()}*`;
        break;
      case 'a':
        out += `[${text()}](${(node as HTMLAnchorElement).href})`;
        break;
      default:
        out += inline(node);
    }
  }
  return out.replace(/[ \t\n]+/g, ' ').trim();
}

/** Text that Markdown would otherwise read as markup. */
const escape = (text: string) => text.replace(/([\\`*_[\]<>])/g, '\\$1');

/** Inline code, with enough backticks around it for the ones inside. */
function code(text: string): string {
  const longest = Math.max(0, ...[...text.matchAll(/`+/g)].map((m) => m[0].length));
  const ticks = '`'.repeat(longest + 1);
  return longest > 0 ? `${ticks} ${text} ${ticks}` : `${ticks}${text}${ticks}`;
}

function fence(text: string): string {
  const longest = Math.max(2, ...[...text.matchAll(/`+/g)].map((m) => m[0].length));
  const ticks = '`'.repeat(longest + 1);
  return `${ticks}\n${text.replace(/\n$/, '')}\n${ticks}`;
}
