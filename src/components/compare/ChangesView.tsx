import { explainSource, type ContentBundle } from '../../lib/content';
import { classify } from '../../lib/csp/parser';
import { directiveInfo } from '../../lib/csp/directives';
import { URL_TYPES, type DirectiveDiff, type EffectiveChange, type PolicyDiff } from '../../lib/csp/diff';
import type { Audience } from '../../lib/csp/model';
import { highlightClass } from '../policy/PolicyView';
import { useT } from '../ui/i18n';

const expr = (raw: string) => classify(raw, { start: 0, end: raw.length });

/** Sources as highlighted chips, with what each means for everyone (hosts speak for themselves). */
function Chips({ sources, audience, content, removed }: { sources: string[]; audience: Audience; content: ContentBundle; removed?: boolean }) {
  return (
    <ul class="chips">
      {sources.map((raw) => {
        const v = expr(raw);
        return (
          <li key={raw}>
            <code class={removed ? 'tok' : `tok ${highlightClass(v)}`}>{raw}</code>
            {audience === 'simple' && v.kind !== 'host' && <span class="chip-note">{explainSource(content, v)?.title}</span>}
          </li>
        );
      })}
    </ul>
  );
}

function ChangeRow({ change, label, audience, content }: { change: EffectiveChange; label: string; audience: Audience; content: ContentBundle }) {
  const t = useT();
  const { before, after } = change;
  const via = audience !== 'simple' && after && before !== after && (
    <span class="via">
      {before ? t('compare.changes.decidedBy', { after, before }) : t('compare.changes.decidedByNew', { after })}
    </span>
  );
  if (change.kind === 'verdict') {
    return (
      <tr>
        <th scope="row">{label}</th>
        <td>
          <span class={`verdict verdict-${change.verdictAfter}`}>{t(`map.verdict.${change.verdictAfter}`)}</span>
          <span class="was">{t('compare.changes.was', { verdict: t(`map.verdict.${change.verdictBefore}`) })}</span>
          {via && <> {via}</>}
        </td>
      </tr>
    );
  }
  return (
    <tr>
      <th scope="row">{label}</th>
      <td>
        {!change.after ? (
          <p class="change-line">
            <span class="verdict-unrestricted">{t('compare.changes.nowUnrestricted')}</span>
          </p>
        ) : (
          <>
            {change.added.length > 0 && (
              <div class="change-line change-added">
                <span class="change-label">{t(change.before ? 'compare.changes.newlyAllowed' : 'compare.changes.nowRestricted')}</span>
                <Chips sources={change.added} audience={audience} content={content} />
              </div>
            )}
            {change.removed.length > 0 && (
              <div class="change-line change-removed">
                <span class="change-label">{t('compare.changes.noLongerAllowed')}</span>
                <Chips sources={change.removed} audience={audience} content={content} removed />
              </div>
            )}
            {change.nonce && (
              <p class={`change-line change-${change.nonce}`}>
                <span class="change-label">{t(`compare.changes.nonce.${change.nonce}`)}</span>
              </p>
            )}
            {change.hashesAdded && (
              <div class="change-line change-added">
                <span class="change-label">{t('compare.changes.hashesAdded')}</span>
                <Chips sources={change.hashesAdded} audience={audience} content={content} />
              </div>
            )}
            {change.hashesRemoved && (
              <div class="change-line change-removed">
                <span class="change-label">{t('compare.changes.hashesRemoved')}</span>
                <Chips sources={change.hashesRemoved} audience={audience} content={content} removed />
              </div>
            )}
          </>
        )}
        {via}
      </td>
    </tr>
  );
}

/** Kinds of content that change in exactly the same way share a row (workers usually follow scripts). */
function grouped(changes: EffectiveChange[]) {
  const groups = new Map<string, { change: EffectiveChange; types: EffectiveChange['type'][] }>();
  for (const change of changes) {
    const { type, ...rest } = change;
    const key = JSON.stringify(rest);
    const group = groups.get(key);
    if (group) group.types.push(type);
    else groups.set(key, { change, types: [type] });
  }
  return [...groups.values()];
}

/** Rules that don't decide where content loads from: navigation, reporting, Trusted Types, upgrades... */
const isOther = (d: DirectiveDiff) => d.status !== 'unchanged' && directiveInfo(d.name)?.category !== 'fetch';

function OtherRow({ d, content }: { d: DirectiveDiff; content: ContentBundle }) {
  const t = useT();
  const added = d.values.filter((v) => v.status === 'added').map((v) => v.raw);
  const removed = d.values.filter((v) => v.status === 'removed').map((v) => v.raw);
  const values = (list: string[]) => list.map((raw) => <code key={raw} class={`tok ${highlightClass(expr(raw))}`}>{raw}</code>);
  return (
    <tr>
      <th scope="row">
        {content.directives[d.name]?.title ?? d.name}
        <code class="rule-name">{d.name}</code>
      </th>
      <td>
        {d.status === 'added' && <span class="change-label">{t('compare.changes.ruleAdded')}</span>}
        {d.status === 'removed' && <span class="change-label">{t('compare.changes.ruleRemoved')}</span>}
        {d.status !== 'removed' && added.length > 0 && (
          <p class="change-line change-added">
            {d.status === 'changed' && <span class="change-label">{t('compare.changes.valuesAdded')}</span>} {values(added)}
          </p>
        )}
        {d.status === 'changed' && removed.length > 0 && (
          <p class="change-line change-removed">
            <span class="change-label">{t('compare.changes.valuesRemoved')}</span> {values(removed)}
          </p>
        )}
      </td>
    </tr>
  );
}

/** Notices about the policy as a whole: a new or dropped policy, enforcement, delivery. */
export function pairNotices(pair: PolicyDiff): string[] {
  const notes: string[] = [];
  if (pair.status === 'added') notes.push(pair.after?.reportOnly ? 'compare.notice.addedReportOnly' : 'compare.notice.added');
  if (pair.status === 'removed') notes.push('compare.notice.removed');
  if (pair.modeChanged) notes.push(pair.after?.reportOnly ? 'compare.notice.reportOnlyNow' : 'compare.notice.enforcedNow');
  if (pair.deliveryChanged) notes.push(pair.after?.origin === 'meta' ? 'compare.notice.toMeta' : 'compare.notice.toHeader');
  if (pair.before?.reportOnly && pair.after?.reportOnly) notes.push('compare.notice.bothReportOnly');
  if (pair.nonce) notes.push(pair.nonce === 'same' ? 'compare.notice.nonceSame' : 'compare.notice.nonceChanged');
  return notes;
}

interface Props {
  pair: PolicyDiff;
  audience: Audience;
  content: ContentBundle;
}

/** What a change does, in plain words: per kind of content, then the other rules. */
export function ChangesView({ pair, audience, content }: Props) {
  const t = useT();
  const loads = pair.effective.filter((c) => c.kind === 'sources').sort((a, b) => URL_TYPES.indexOf(a.type) - URL_TYPES.indexOf(b.type));
  const behaviours = pair.effective.filter((c) => c.kind === 'verdict');
  const others = pair.directives.filter(isOther);
  const notices = pairNotices(pair);

  return (
    <div class="changes">
      {notices.map((key) => (
        <p key={key} class={`notice${key.endsWith('bothReportOnly') || key.endsWith('nonceChanged') ? ' notice-quiet' : ''}`}>
          {t(key)}
        </p>
      ))}
      {pair.effective.length === 0 && others.length === 0 && <p>{t('compare.changes.nothing')}</p>}
      {(loads.length > 0 || behaviours.length > 0) && (
        <table class="allow-map change-map">
          <caption class="visually-hidden">{t('compare.changes.loadsTitle')}</caption>
          <tbody>
            {grouped([...loads, ...behaviours]).map(({ change, types }) => (
              <ChangeRow
                key={change.type}
                change={change}
                label={types.map((type) => t(`resources.${type}`)).join(', ')}
                audience={audience}
                content={content}
              />
            ))}
          </tbody>
        </table>
      )}
      {others.length > 0 && (
        <>
          <h3>{t('compare.changes.other')}</h3>
          <table class="allow-map change-map">
            <caption class="visually-hidden">{t('compare.changes.other')}</caption>
            <tbody>
              {others.map((d) => (
                <OtherRow key={d.name} d={d} content={content} />
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
