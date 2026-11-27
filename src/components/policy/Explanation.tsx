import { Fragment } from 'preact';
import { localePath, type Translate } from '../../i18n';
import { explainSource, type ContentBundle } from '../../lib/content';
import { changedHandsOf } from '../../lib/csp/changed-hands';
import { directiveInfo, DIRECTIVES } from '../../lib/csp/directives';
import { resolve } from '../../lib/csp/fallback';
import { issuesAt } from '../../lib/csp/parser';
import { ignoredSources } from '../../lib/csp/matcher';
import type { Audience, Directive, ParseIssue, Policy, SourceExpression } from '../../lib/csp/model';
import { useT } from '../ui/i18n';
import { ignoredValues, valueTone, type Selection } from './PolicyView';
import './explanation.css';

interface Props {
  policy: Policy;
  selection: Selection;
  issues: ParseIssue[];
  audience: Audience;
  content: ContentBundle;
}

export function issueText(t: Translate, i: ParseIssue): string {
  // Each deprecated directive has its own story (report-uri still works, plugin-types does nothing).
  const own = `issues.deprecated.${i.directive ?? ''}`;
  const key = i.code === 'deprecated-directive' && t.has(own) ? own : `issues.${i.code}`;
  return t(key, { directive: i.directive ?? '', value: (i.value ?? '').replace(/'/g, '') });
}

/**
 * Why current browsers skip `value` in `directive`, said before what the value means on its own (which would call
 * `https:` or 'unsafe-inline' risky). In default-src, only when it is the rule scripts use, and saying so.
 */
export function skippedText(t: Translate, policy: Policy, directive: Directive, value: SourceExpression): string | undefined {
  const params = { directive: directive.name, value: value.raw };
  const why = (d: Directive) =>
    d.values.some((v) => v.kind === 'keyword' && v.value === "'strict-dynamic'")
      ? t('findings.ignored.strict-dynamic', params)
      : t('findings.ignored.unsafe-inline', params);
  if (ignoredValues(directive).includes(value)) return directive.name.startsWith('style') ? t('findings.ignored.unsafe-inline', params) : why(directive);
  if (
    directive.name === 'default-src' &&
    resolve(policy, 'script-src-elem').governing === directive &&
    ignoredSources(directive, 'script').includes(value)
  ) {
    return t('explanation.skippedForScripts', { reason: why(directive) });
  }
  return undefined;
}

/**
 * One line naming what is explained ("'unsafe-inline' in script-src: Inline code"), for the islands' live region:
 * a screen reader announces it on each pick, and the whole explanation stays where it is to read on.
 */
export function explanationSummary(t: Translate, policy: Policy, selection: Selection | undefined, content: ContentBundle): string {
  const directive = selection && policy.directives[selection.directiveIndex];
  if (!directive) return '';
  const value = selection.valueIndex === undefined ? undefined : directive.values[selection.valueIndex];
  if (!value) return t('explanation.summaryDirective', { directive: directive.name, title: content.directives[directive.name]?.title ?? '' });
  const title = explainSource(content, value)?.title;
  return title
    ? t('explanation.summaryValue', { value: value.raw, directive: directive.name, title })
    : t('explanation.summaryValueOnly', { value: value.raw, directive: directive.name });
}

/** Explains the selected directive or value, in the voice of the selected audience. */
export function Explanation({ policy, selection, issues, audience, content }: Props) {
  const t = useT();
  const directive = policy.directives[selection.directiveIndex];
  if (!directive) return null;
  const info = directiveInfo(directive.name);
  const doc = content.directives[directive.name];
  const value = selection.valueIndex === undefined ? undefined : directive.values[selection.valueIndex];
  const valueDoc = value ? explainSource(content, value) : undefined;

  const relevant = issuesAt(issues, selection.policyIndex, directive, value);
  const skipped = value ? skippedText(t, policy, directive, value) : undefined;
  // What happened to a domain that changed hands, in the same words as Things to check or the security review.
  const changed = value?.kind === 'host' ? changedHandsOf(value.raw) : undefined;
  const changedText =
    changed && t(`${audience === 'simple' ? 'risks' : 'findings'}.changed-hands.${changed.id}`, { directive: directive.name, value: value!.raw });

  // Absent directives that fall back to this one, and are therefore governed by it.
  const covers = directive.duplicate
    ? []
    : [...DIRECTIVES.values()]
        .filter((d) => !d.deprecated && d.name !== directive.name && d.fallback.includes(directive.name))
        .map((d) => d.name)
        .filter((name) => resolve(policy, name).governing === directive);

  return (
    <article class="explanation" id="explanation">
      {value ? (
        <>
          <p class="crumb">
            <code>{directive.name}</code>
            {doc && <span>{doc.title}</span>}
          </p>
          <h3>
            <code class={`tok ${valueTone(directive, value)}`}>{value.raw}</code>
          </h3>
          {skipped && <p class="skipped">{skipped}</p>}
          {changedText && <p class="changed-hands">{changedText}</p>}
          {valueDoc ? (
            <>
              <p class="lead">{valueDoc.title}</p>
              <p>{valueDoc[audience]}</p>
            </>
          ) : (
            <p>{value.kind === 'token' ? doc?.[audience] : t('issues.invalid-source', { directive: directive.name, value: value.raw })}</p>
          )}
          {value.host && audience !== 'simple' && (
            <dl class="parts">
              {value.host.scheme && (
                <>
                  <dt>scheme</dt>
                  <dd>{value.host.scheme}</dd>
                </>
              )}
              <dt>host</dt>
              <dd>{value.host.host}</dd>
              {value.host.port && (
                <>
                  <dt>port</dt>
                  <dd>{value.host.port}</dd>
                </>
              )}
              {value.host.path && (
                <>
                  <dt>path</dt>
                  <dd>{value.host.path}</dd>
                </>
              )}
            </dl>
          )}
        </>
      ) : (
        <>
          <p class="crumb">
            <code>{directive.name}</code>
          </p>
          <h3>{doc?.title ?? directive.name}</h3>
          <p>{doc ? doc[audience] : t('issues.unknown-directive', { directive: directive.name })}</p>
          {audience !== 'simple' && info && info.fallback.length > 0 && (
            <p class="muted">
              {t('explanation.fallsBackTo')} <code>{info.fallback.join(' → ')}</code>
            </p>
          )}
          {covers.length > 0 && (
            <p class="muted">
              {audience === 'simple' ? t('explanation.alsoAppliesTo') : t('explanation.alsoGoverns')}{' '}
              {covers.map((c, i) => (
                <Fragment key={c}>
                  {i > 0 && ', '}
                  {audience === 'simple' ? content.directives[c]?.title.toLowerCase() : <code>{c}</code>}
                </Fragment>
              ))}
            </p>
          )}
          {info && (
            <p>
              <a href={localePath(t.locale, `/directives/${directive.name}`)}>{t('explanation.moreAbout', { directive: directive.name })}</a>
            </p>
          )}
        </>
      )}
      {relevant.map((i, n) => (
        <p key={n} class="issue" role="note">
          {issueText(t, i)}
        </p>
      ))}
    </article>
  );
}
