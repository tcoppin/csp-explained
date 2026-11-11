import { Fragment } from 'preact';
import type { ContentBundle } from '../../lib/content';
import type { DirectiveDiff, PolicyDiff, ValueDiff } from '../../lib/csp/diff';
import type { SourceExpression } from '../../lib/csp/model';
import { highlightClass } from '../policy/PolicyView';
import { useT } from '../ui/i18n';
import type { DiffLayout } from './compare-state';

/** A value as the browser reads it on one side: highlighted when the change added it, struck when it took it away. */
function Value({ v, side }: { v: ValueDiff; side?: 'before' | 'after' }) {
  const t = useT();
  const expr = (v.after ?? v.before) as SourceExpression;
  if (v.status === 'added' && side !== 'before') {
    return (
      <ins class={`tok ${highlightClass(expr)}`}>
        <span class="visually-hidden">{t('compare.diff.added')} </span>
        {v.raw}
      </ins>
    );
  }
  if (v.status === 'removed' && side !== 'after') {
    return (
      <del class="tok">
        <span class="visually-hidden">{t('compare.diff.removed')} </span>
        {v.raw}
      </del>
    );
  }
  return <span class="tok">{v.raw}</span>;
}

/** A directive's tokens on one side (or both, merged). */
function Tokens({ d, side }: { d: DirectiveDiff; side?: 'before' | 'after' }) {
  const values = d.values.filter((v) => (side === 'before' ? v.status !== 'added' : side === 'after' ? v.status !== 'removed' : true));
  const Name = d.status === 'added' && side !== 'before' ? 'ins' : d.status === 'removed' && side !== 'after' ? 'del' : 'span';
  return (
    <code class="tokens">
      <Name class="tok tok-directive">{d.name}</Name>
      {values.map((v) => (
        <Fragment key={v.raw}>
          {' '}
          <Value v={v} side={side} />
        </Fragment>
      ))}
      <span class="semi">;</span>
    </code>
  );
}

interface Props {
  pair: PolicyDiff;
  content: ContentBundle;
  layout: DiffLayout;
  /** The tracked layout kept for phones only, while wider screens show the columns. */
  wideHidden?: boolean;
}

/** Both policies as written, with what the change added and took away marked like edits in a document. */
export function DiffView({ pair, content, layout, wideHidden }: Props) {
  const t = useT();
  const title = (d: DirectiveDiff) => content.directives[d.name]?.title ?? '?';

  if (layout === 'tracked') {
    return (
      <ol class={`policy policy-diff${wideHidden ? ' narrow-only' : ''}`}>
        {pair.directives.map((d) => (
          <li key={d.name} class={`line line-${d.status}`}>
            <span class="margin-note" aria-hidden="true">
              {title(d)}
            </span>
            <Tokens d={d} />
          </li>
        ))}
      </ol>
    );
  }

  return (
    <table class="diff-columns wide-only">
      <thead>
        <tr>
          <th scope="col">{t('compare.before')}</th>
          <th scope="col">{t('compare.after')}</th>
        </tr>
      </thead>
      <tbody>
        {pair.directives.map((d) => (
          <tr key={d.name} class={`line-${d.status}`}>
            <td>{d.status === 'added' ? <span class="muted">{t('compare.diff.absent')}</span> : <Tokens d={d} side="before" />}</td>
            <td>{d.status === 'removed' ? <span class="muted">{t('compare.diff.absent')}</span> : <Tokens d={d} side="after" />}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
