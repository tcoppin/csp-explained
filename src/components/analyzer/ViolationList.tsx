import { useState } from 'preact/hooks';
import type { InlineHash } from '../../lib/csp/hash';
import type { ExplainedViolation, ToolUse } from '../../lib/violations';
import { HashTool } from '../policy/HashTool';
import { CodeBox } from '../ui/CodeBox';
import { useT } from '../ui/i18n';
import { Rich } from '../ui/Rich';

/**
 * Console messages pasted in place of a policy: what each one blocked, the tool behind it, and the line that allows
 * it. The fix covers one message; the intro says how to check a whole policy.
 */
export function ViolationList({ items }: { items: ExplainedViolation[] }) {
  const t = useT();
  return (
    <section class="violations" aria-labelledby="violations-title">
      <h2 id="violations-title">{t('violations.title', { count: items.length })}</h2>
      <p class="panel-intro">
        <Rich msg="violations.intro" />
      </p>
      <ol class="violation-list">
        {items.map((e, i) => (
          <ViolationItem key={`${i}|${e.violation.text}`} e={e} index={i} />
        ))}
      </ol>
    </section>
  );
}

function ViolationItem({ e, index }: { e: ExplainedViolation; index: number }) {
  const t = useT();
  const v = e.violation;
  const what = e.case === 'extension' || e.case === 'ancestors' ? e.case : v.kind === 'url' ? v.type : v.kind;
  const directive = v.directive ?? v.effective ?? '';

  return (
    // The rule's colour says what happened, and the status line says it in words.
    <li class={`violation ${e.case === 'extension' || e.case === 'ancestors' ? 'elsewhere' : v.reportOnly ? 'reported' : 'blocked'}`}>
      <h3>
        <Rich msg={`violations.what.${what}`} vars={{ host: e.host ?? '' }} />
      </h3>
      {directive && e.case !== 'extension' && e.case !== 'ancestors' && (
        <p class="violation-status">
          <Rich msg={v.reportOnly ? 'violations.reported' : 'violations.blocked'} vars={{ directive }} />
          {/* Said once: the note under a created rule says it already. */}
          {v.directive === 'default-src' && v.effective && !e.fix?.created && (
            <>
              {' '}
              <Rich msg="violations.fallback" vars={{ directive: v.directive, effective: v.effective }} />
            </>
          )}
          {v.count > 1 && <> {t('violations.seen', { count: v.count })}</>}
        </p>
      )}
      <Body e={e} />
      {e.fix && v.reportOnly && (
        <p class="muted">
          <Rich msg="violations.reportOnlyFix" />
        </p>
      )}
      {e.case === 'inline' && !e.fix && <HashOffer id={`violation-${index}`} e={e} />}
    </li>
  );
}

/** What the message means for this case, and the fix when there is one. */
function Body({ e }: { e: ExplainedViolation }) {
  const t = useT();
  const v = e.violation;
  const fix = e.fix;
  switch (e.case) {
    case 'extension':
      return <p><Rich msg="violations.extension" vars={{ host: e.host ?? '' }} /></p>;
    case 'ancestors':
      return <p><Rich msg="violations.ancestors" vars={{ host: e.host ?? v.url ?? '' }} /></p>;
    case 'handler':
      return <p><Rich msg="violations.handler" /></p>;
    case 'style-attr':
      return (
        <>
          <p><Rich msg="violations.styleAttr" /></p>
          {fix && <Fix e={e} />}
        </>
      );
    case 'inline':
      return (
        <>
          <p><Rich msg={fix ? 'violations.hash' : 'violations.noHash'} /></p>
          {fix && <Fix e={e} />}
        </>
      );
    case 'eval':
      return (
        <>
          {e.tools.length > 0 && <p>{t('violations.evalTools', { tools: listOf(t.locale, e.tools.map((u) => `${u.vendor.name} (${u.feature.label})`)) })}</p>}
          {fix && <Fix e={e} />}
        </>
      );
    case 'address':
      return (
        <>
          {e.tools.length > 0 ? <Tools uses={e.tools} /> : <p>{t('violations.noTool')}</p>}
          {fix && <Fix e={e} />}
        </>
      );
  }
}

/** One sentence per tool: its catalogue page, and the features that use the address. */
function Tools({ uses }: { uses: ToolUse[] }) {
  const t = useT();
  const byVendor = new Map<string, ToolUse[]>();
  for (const u of uses) byVendor.set(u.vendor.id, [...(byVendor.get(u.vendor.id) ?? []), u]);
  return (
    <>
      {[...byVendor.values()].map((list) => (
        <p key={list[0]!.vendor.id}>
          <Rich
            msg="violations.tool"
            vars={{ vendor: list[0]!.vendor.name, id: list[0]!.vendor.id, features: listOf(t.locale, list.map((u) => u.feature.label)) }}
          />
        </p>
      ))}
    </>
  );
}

/** The line to use when the browser quoted the rule; otherwise what to add, and where. */
function Fix({ e }: { e: ExplainedViolation }) {
  const t = useT();
  const fix = e.fix!;
  return (
    <>
      {fix.line ? (
        <>
          <CodeBox caption={fix.created ? t('violations.fixCreated') : t('violations.fixLine', { directive: fix.directive })} copyText={fix.line} />
          {fix.created && e.case !== 'style-attr' && (
            <p class="muted">
              <Rich msg="violations.createdNote" vars={{ directive: fix.directive }} />
            </p>
          )}
        </>
      ) : (
        <p>
          <Rich msg={fix.created ? 'violations.fixAddCreated' : 'violations.fixAdd'} vars={{ add: fix.add, directive: fix.directive }} />
        </p>
      )}
      {fix.risky && (
        <p class="violation-risk">
          <Rich msg={fix.add === "'unsafe-eval'" ? 'violations.riskEval' : 'violations.riskScheme'} vars={{ add: fix.add, directive: fix.directive }} />
        </p>
      )}
    </>
  );
}

/** Safari gives no hash for blocked inline code: the generator makes one from the code itself. */
function HashOffer({ id, e }: { id: string; e: ExplainedViolation }) {
  const t = useT();
  const [hashes, setHashes] = useState<InlineHash[]>([]);
  const kind = e.violation.kind === 'inline-style' ? 'style' : 'script';
  const directive = e.violation.directive && e.violation.directive !== 'default-src' ? e.violation.directive : `${kind}-src`;
  const values = hashes.map((h) => h.source).join(' ');
  return (
    <>
      <HashTool id={id} kind={kind} hashes={hashes} onChange={setHashes} />
      {hashes.length > 0 && <CodeBox caption={t('violations.hashCaption', { directive })} copyText={values} />}
    </>
  );
}

const listOf = (locale: string, items: string[]) => new Intl.ListFormat(locale, { type: 'conjunction' }).format(items);
