import { Fragment } from 'preact';
import type { ContentBundle } from '../../lib/content';
import type { Directive, ParseIssue, Policy, SourceExpression } from '../../lib/csp/model';
import type { Translate } from '../../i18n';
import { useT } from '../ui/i18n';
import './policy-view.css';

export interface Selection {
  policyIndex: number;
  directiveIndex: number;
  /** Undefined when the directive name itself is selected. */
  valueIndex?: number;
}

export function highlightClass(v: SourceExpression): string {
  switch (v.kind) {
    case 'keyword':
      // 'unsafe-allow-redirects' does nothing: its name alone doesn't make it a risk.
      return v.value.startsWith("'unsafe-") && v.value !== "'unsafe-allow-redirects'" ? 'hl-unsafe' : 'hl-keyword';
    case 'host':
      return v.host?.host === '*' ? 'hl-unsafe' : 'hl-host';
    case 'scheme':
      return v.value === 'https:' || v.value === 'http:' ? 'hl-unsafe' : 'hl-scheme';
    case 'nonce':
    case 'hash':
      return 'hl-nonce';
    case 'invalid':
      return 'hl-invalid';
    default:
      return 'hl-token';
  }
}

/**
 * What the highlight says without its colour, read after the value by screen readers ("'unsafe-inline', risky").
 * Empty for the colours that only tell the kind of value apart.
 */
export function valueNote(t: Translate, highlight: string): string {
  if (highlight === 'hl-unsafe') return t('policyView.risky');
  if (highlight === 'hl-invalid') return t('policyView.invalid');
  return '';
}

/** A short spoken note, after a pause, that sighted readers get from the look of the part. */
export function SpokenNote({ text }: { text: string }) {
  return text ? <span class="visually-hidden">, {text}</span> : null;
}

interface Props {
  policy: Policy;
  policyIndex: number;
  issues: ParseIssue[];
  docs: ContentBundle['directives'];
  selection: Selection | undefined;
  onSelect: (s: Selection) => void;
  /** Highlights only the values it returns true for (the builder's additions); all of them by default. */
  highlighted?: (d: Directive, v: SourceExpression) => boolean;
}

/** The policy, one directive per line, every token clickable, annotated with a plain title in the margin. */
export function PolicyView({ policy, policyIndex, issues, docs, selection, onSelect, highlighted }: Props) {
  const t = useT();
  const isSelected = (d: number, v?: number) =>
    selection?.policyIndex === policyIndex && selection.directiveIndex === d && selection.valueIndex === v;

  // Any issue on the directive or one of its values.
  const flagged = (d: Directive) =>
    issues.some((i) => i.policyIndex === policyIndex && i.span && i.span.start >= d.span.start && i.span.end <= d.span.end);

  // Struck through or flagged in the margin, which screen readers skip: said on the directive's name instead.
  const directiveNote = (d: Directive) =>
    [d.duplicate ? t('policyView.repeated') : !d.known ? t('policyView.unknown') : '', flagged(d) ? t('policyView.flagged') : '']
      .filter(Boolean)
      .join(', ');

  return (
    <ol class="policy" aria-label={t('analyzer.policy', { index: policyIndex + 1 })}>
      {policy.directives.map((d, di) => (
        <li key={di} class={`line${d.duplicate || !d.known ? ' line-ignored' : ''}`}>
          <span class="margin-note" aria-hidden="true">
            {docs[d.name]?.title ?? '?'}
            {flagged(d) && <span class="flag" title={t('issues.title')}>!</span>}
          </span>
          <code class="tokens">
            <button
              type="button"
              class="tok tok-directive"
              aria-pressed={isSelected(di)}
              onClick={() => onSelect({ policyIndex, directiveIndex: di })}
            >
              {d.name}
              <SpokenNote text={directiveNote(d)} />
            </button>
            {d.values.map((v, vi) => {
              const shown = !highlighted || highlighted(d, v);
              const hl = shown ? highlightClass(v) : 'hl-none';
              // In the builder the highlight means "added for your site or tools", whatever the kind of value.
              const note = highlighted ? (shown ? t('policyView.added') : '') : valueNote(t, hl);
              return (
                <Fragment key={vi}>
                  {' '}
                  <button
                    type="button"
                    class={`tok ${hl}`}
                    aria-pressed={isSelected(di, vi)}
                    onClick={() => onSelect({ policyIndex, directiveIndex: di, valueIndex: vi })}
                  >
                    {v.raw}
                    <SpokenNote text={note} />
                  </button>
                </Fragment>
              );
            })}
            <span class="semi">;</span>
          </code>
        </li>
      ))}
    </ol>
  );
}
