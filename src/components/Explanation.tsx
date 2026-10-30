import { localePath, type Translate } from '../i18n';
import { explainSource, type ContentBundle } from '../lib/content';
import { Fragment } from 'preact';
import { directiveInfo, DIRECTIVES } from '../lib/csp/directives';
import { resolve } from '../lib/csp/fallback';
import { issuesAt } from '../lib/csp/parser';
import type { Audience, ParseIssue, Policy } from '../lib/csp/model';
import { useT } from './i18n';
import { highlightClass, type Selection } from './PolicyView';

interface Props {
  policy: Policy;
  selection: Selection;
  issues: ParseIssue[];
  audience: Audience;
  content: ContentBundle;
}

function issueText(t: Translate, i: ParseIssue): string {
  return t(`issues.${i.code}`, { directive: i.directive ?? '', value: (i.value ?? '').replace(/'/g, '') });
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

  // Absent directives that fall back to this one, and are therefore governed by it.
  const covers = directive.duplicate
    ? []
    : [...DIRECTIVES.values()]
        .filter((d) => !d.deprecated && d.name !== directive.name && d.fallback.includes(directive.name))
        .map((d) => d.name)
        .filter((name) => resolve(policy, name).governing === directive);

  return (
    <article class="explanation" aria-live="polite">
      {value ? (
        <>
          <p class="crumb">
            <code>{directive.name}</code> · {doc?.title}
          </p>
          <h3>
            <code class={`tok ${highlightClass(value)}`}>{value.raw}</code>
          </h3>
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

export { issueText };
