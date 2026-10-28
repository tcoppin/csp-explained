import { Fragment } from 'preact';
import type { ContentBundle } from '../lib/content';
import type { Directive, ParseIssue, Policy, SourceExpression } from '../lib/csp/model';
import { t } from '../i18n';

export interface Selection {
  policyIndex: number;
  directiveIndex: number;
  /** Undefined when the directive name itself is selected. */
  valueIndex?: number;
}

export function highlightClass(v: SourceExpression): string {
  switch (v.kind) {
    case 'keyword':
      return v.value.startsWith("'unsafe-") ? 'hl-unsafe' : 'hl-keyword';
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

interface Props {
  policy: Policy;
  policyIndex: number;
  issues: ParseIssue[];
  docs: ContentBundle['directives'];
  selection: Selection | undefined;
  onSelect: (s: Selection) => void;
}

/** The policy, one directive per line, every token clickable, annotated with a plain title in the margin. */
export function PolicyView({ policy, policyIndex, issues, docs, selection, onSelect }: Props) {
  const isSelected = (d: number, v?: number) =>
    selection?.policyIndex === policyIndex && selection.directiveIndex === d && selection.valueIndex === v;

  const flagged = (d: Directive) => issues.some((i) => i.policyIndex === policyIndex && i.directive === d.name);

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
              class={`tok tok-directive${isSelected(di) ? ' selected' : ''}`}
              aria-pressed={isSelected(di)}
              onClick={() => onSelect({ policyIndex, directiveIndex: di })}
            >
              {d.name}
            </button>
            {d.values.map((v, vi) => (
              <Fragment key={vi}>
                {' '}
                <button
                  type="button"
                  class={`tok ${highlightClass(v)}${isSelected(di, vi) ? ' selected' : ''}`}
                  aria-pressed={isSelected(di, vi)}
                  onClick={() => onSelect({ policyIndex, directiveIndex: di, valueIndex: vi })}
                >
                  {v.raw}
                </button>
              </Fragment>
            ))}
            <span class="semi">;</span>
          </code>
        </li>
      ))}
    </ol>
  );
}
