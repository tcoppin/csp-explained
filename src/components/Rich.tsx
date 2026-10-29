import { Fragment } from 'preact';
import type { Translate, Vars } from '../i18n';
import { isExternal, parseRich } from '../i18n/rich';
import { useT } from './i18n';
import { NewTabLink } from './NewTabLink';

/**
 * A long-form message with its inline markup (see `src/i18n/rich.ts`), rendered as elements, never as raw HTML.
 * Wrap it in the block element it belongs to: `<p><Rich t={t} msg="pages.learn.lead" /></p>`.
 */
export function Rich({ msg, vars, t }: { msg: string; vars?: Vars; t?: Translate }) {
  const tr = useT(t);
  return (
    <>
      {parseRich(tr(msg), vars).map((node, i) => {
        switch (node.type) {
          case 'text':
            return <Fragment key={i}>{node.text}</Fragment>;
          case 'code':
            return <code key={i}>{node.text}</code>;
          case 'strong':
            return <strong key={i}>{node.text}</strong>;
          case 'em':
            return <em key={i}>{node.text}</em>;
          case 'kbd':
            return <kbd key={i}>{node.text}</kbd>;
          case 'link':
            return isExternal(node.href) ? (
              <NewTabLink key={i} href={node.href} label={node.text} t={tr} />
            ) : (
              <a key={i} href={node.href}>
                {node.text}
              </a>
            );
        }
      })}
    </>
  );
}
