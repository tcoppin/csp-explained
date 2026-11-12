import type { ComponentChildren } from 'preact';
import type { SecurityFinding } from '../../lib/csp/security';
import { findingText } from '../../lib/reports/security';
import { useT } from '../ui/i18n';

interface Props {
  findings: SecurityFinding[];
  /** A neutral tag after the directive, e.g. which policy the finding is about. */
  tag?: (f: SecurityFinding) => string | undefined;
  /** Something to do about the finding, after its explanation. */
  action?: (f: SecurityFinding) => ComponentChildren;
  /** The explanation; the security review's own words by default. */
  text?: (f: SecurityFinding) => string;
}

/** Security findings, each with its level, where it is, and what it means in our words. */
export function FindingList({ findings, tag, action, text }: Props) {
  const t = useT();
  return (
    <ul class="findings">
      {findings.map((f, i) => {
        const label = tag?.(f);
        const extra = action?.(f);
        return (
          <li key={i} class={`finding level-${f.level}`}>
            <span class="level">
              {t(`report.security.level.${f.level}`)}
              {f.maybe && ` (${t('report.security.maybe')})`}
            </span>
            <code>{[f.directive, f.value].filter(Boolean).join(' ')}</code>
            {label && <span class="tag">{label}</span>}
            <span class="desc">
              {text ? text(f) : findingText(t, f)}
              {extra && <> {extra}</>}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
