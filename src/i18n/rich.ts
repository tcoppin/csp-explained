import { interpolate, type Vars } from './index';

/**
 * The small inline syntax allowed in long-form messages, so translators never write HTML:
 * `code`, **strong**, *em*, [[kbd]] and [label](/path) (or an https:// address, or a `{var}` holding one).
 * No nesting. Everything else is plain text, so `<meta>` needs no escaping.
 */
export type RichNode =
  | { type: 'text'; text: string }
  | { type: 'code' | 'strong' | 'em' | 'kbd'; text: string }
  | { type: 'link'; text: string; href: string };

const TOKEN = /`([^`]+)`|\*\*([^*]+)\*\*|\*([^*]+)\*|\[\[([^\]]+)\]\]|\[([^\]]+)\]\(([^)\s]+)\)/g;

/** Splits a message into nodes; `{var}` placeholders are filled in after parsing, so values are never read as markup. */
export function parseRich(message: string, vars: Vars = {}): RichNode[] {
  const nodes: RichNode[] = [];
  const text = (s: string) => s && nodes.push({ type: 'text', text: interpolate(s, vars) });
  let last = 0;
  for (const m of message.matchAll(TOKEN)) {
    text(message.slice(last, m.index));
    const [, code, strong, em, kbd, label, href] = m;
    if (code !== undefined) nodes.push({ type: 'code', text: interpolate(code, vars) });
    else if (strong !== undefined) nodes.push({ type: 'strong', text: interpolate(strong, vars) });
    else if (em !== undefined) nodes.push({ type: 'em', text: interpolate(em, vars) });
    else if (kbd !== undefined) nodes.push({ type: 'kbd', text: kbd });
    else nodes.push({ type: 'link', text: interpolate(label!, vars), href: interpolate(href!, vars) });
    last = m.index + m[0].length;
  }
  text(message.slice(last));
  return nodes;
}

/** Links to other websites open in a new tab (NewTabLink); links within the site don't. */
export const isExternal = (href: string) => /^https?:\/\//.test(href);
