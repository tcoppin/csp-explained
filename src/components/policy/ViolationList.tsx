import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import type { InlineHash } from '../../lib/csp/hash';
import type { ExplainedMessages, ExplainedViolation, PolicyLine, ToolUse } from '../../lib/violations';
import { HashTool } from './HashTool';
import { CodeBox } from '../ui/CodeBox';
import { useT } from '../ui/i18n';
import { Rich } from '../ui/Rich';
import './violations.css';

/**
 * Console messages pasted in place of a policy: first the lines that allow everything they name at once (so that
 * copying one never drops what another allowed), then what each message blocked, the tool behind it and which line
 * allows it.
 */
export function ViolationList({ explained }: { explained: ExplainedMessages }) {
  const t = useT();
  const { items, lines } = explained;
  return (
    <section class="violations" aria-labelledby="violations-title">
      <h2 id="violations-title">{t('violations.title', { count: items.length })}</h2>
      {lines.length > 0 && <Lines lines={lines} />}
      <ol class="violation-list">
        {items.map((e, i) => (
          <ViolationItem key={`${i}|${e.violation.text}`} e={e} index={i} />
        ))}
      </ol>
      {/* Once the messages are read: how to check more than what was blocked. */}
      <p class="next-step">
        <Rich msg="violations.nextStep" />
      </p>
    </section>
  );
}

/** Where the messages or reports come from: the wording of a few explanations depends on it. */
export type ViolationSource = 'console' | 'reports';

/**
 * The lines that allow everything at once. `title` and `intro` replace the default ones (the reports reader gives
 * one set per policy); `children` go after the lines.
 */
export function Lines({ lines, title, intro, children }: { lines: PolicyLine[]; title?: string; intro?: ComponentChildren; children?: ComponentChildren }) {
  const t = useT();
  const fromDefault = lines.find((l) => l.created && l.directive !== 'style-src-attr');
  return (
    <div class="violation-lines">
      <h3>{title ?? t('violations.lines.title')}</h3>
      {intro ?? <p>{t('violations.lines.intro')}</p>}
      {lines.map((l) => (
        <CodeBox
          key={`${l.reportOnly}|${l.directive}`}
          caption={t(`violations.lines.${l.created ? 'add' : 'replace'}${l.reportOnly ? 'ReportOnly' : ''}`, { directive: l.directive })}
          copyText={l.line}
        />
      ))}
      {fromDefault && (
        <p class="muted">
          <Rich msg="violations.createdNote" vars={{ directive: fromDefault.directive }} />
        </p>
      )}
      {children}
    </div>
  );
}

/**
 * One problem: what was blocked, by which rule, what it means and the fix. `children` go under the status line (the
 * reports reader says there how many reports, pages and browsers).
 */
export function ViolationItem({ e, index, source = 'console', children }: { e: ExplainedViolation; index: number; source?: ViolationSource; children?: ComponentChildren }) {
  const t = useT();
  const v = e.violation;
  const heading =
    e.case === 'extension' || e.case === 'ancestors'
      ? e.case
      : e.case === 'trusted-types'
        ? `trusted.${v.trustedType ?? 'unknown'}`
        : v.kind === 'url'
          ? v.type
          : v.kind;
  const directive = v.directive ?? v.effective ?? '';
  // Repeats of one message; a group of inline blocks counts its blocks in the heading instead.
  const repeats = e.count === 1 ? v.count : 0;

  return (
    // The rule's colour says what happened, and the status line says it in words.
    <li class={`violation ${e.case === 'extension' || e.case === 'ancestors' ? 'elsewhere' : v.reportOnly ? 'reported' : 'blocked'}`}>
      <h3>
        <Rich msg={`violations.what.${heading}`} vars={{ host: e.host ?? '', count: e.count }} />
      </h3>
      {directive && e.case !== 'extension' && e.case !== 'ancestors' && (
        <p class="violation-status">
          <Rich msg={v.reportOnly ? 'violations.reported' : 'violations.blocked'} vars={{ directive }} />
          {/* Said once: the note under a created rule says it already. */}
          {v.directive === 'default-src' && v.effective && !e.fix?.inLines && (
            <>
              {' '}
              <Rich msg="violations.fallback" vars={{ directive: v.directive, effective: v.effective }} />
            </>
          )}
          {repeats > 1 && <> {t('violations.seen', { count: repeats })}</>}
        </p>
      )}
      {children}
      <Body e={e} source={source} />
      {e.fix && !e.fix.inLines && v.reportOnly && (
        <p class="muted">
          <Rich msg="violations.reportOnlyFix" />
        </p>
      )}
      {e.case === 'inline' && !e.fix && <HashOffer id={`violation-${index}`} e={e} />}
    </li>
  );
}

/** What the message means for this case, and where the fix is. */
function Body({ e, source }: { e: ExplainedViolation; source: ViolationSource }) {
  const t = useT();
  const v = e.violation;
  switch (e.case) {
    case 'extension':
      return <p><Rich msg={source === 'reports' ? 'violations.extensionReport' : 'violations.extension'} vars={{ host: e.host ?? '' }} /></p>;
    case 'ancestors':
      return <p><Rich msg="violations.ancestors" vars={{ host: e.host ?? v.url ?? '' }} /></p>;
    case 'handler':
      return <p><Rich msg="violations.handler" /></p>;
    case 'trusted-types':
      return (
        <>
          <p><Rich msg="violations.tt" vars={{ what: t(`violations.ttWhat.${v.trustedType ?? 'unknown'}`) }} /></p>
          {v.sink && <p><Rich msg="violations.ttSink" vars={{ sink: v.sink }} /></p>}
          {byVendor(e.tools).map(([first]) => (
            <p key={first.vendor.id}>
              <Rich msg="violations.ttTool" vars={{ vendor: first.vendor.name, id: first.vendor.id }} />
            </p>
          ))}
        </>
      );
    case 'style-attr':
      return (
        <>
          <p><Rich msg="violations.styleAttr" /></p>
          <Fix e={e} />
        </>
      );
    case 'inline':
      return (
        <>
          <p><Rich msg={e.fix ? 'violations.hash' : source === 'reports' ? 'violations.noHashReport' : 'violations.noHash'} /></p>
          {e.fix && <Fix e={e} />}
        </>
      );
    case 'eval':
      return (
        <>
          {e.tools.length > 0 && <p>{t('violations.evalTools', { tools: listOf(t.locale, e.tools.map((u) => `${u.vendor.name} (${u.feature.label})`)) })}</p>}
          <Fix e={e} />
        </>
      );
    case 'address':
      return (
        <>
          {e.tools.length > 0 ? <Tools uses={e.tools} /> : <p>{t('violations.noTool')}</p>}
          <Fix e={e} />
        </>
      );
  }
}

const byVendor = (uses: ToolUse[]) => {
  const groups = new Map<string, ToolUse[]>();
  for (const u of uses) groups.set(u.vendor.id, [...(groups.get(u.vendor.id) ?? []), u]);
  return [...groups.values()] as [ToolUse, ...ToolUse[]][];
};

/** One sentence per tool: its catalogue page, and the features that use the address. */
function Tools({ uses }: { uses: ToolUse[] }) {
  const t = useT();
  return (
    <>
      {byVendor(uses).map((list) => (
        <p key={list[0].vendor.id}>
          <Rich msg="violations.tool" vars={{ vendor: list[0].vendor.name, id: list[0].vendor.id, features: listOf(t.locale, list.map((u) => u.feature.label)) }} />
        </p>
      ))}
    </>
  );
}

/** Which line above allows it; when the browser didn't quote the rule (Safari), what to add and where. */
function Fix({ e }: { e: ExplainedViolation }) {
  const fix = e.fix;
  if (!fix) return null;
  const add = fix.add.join(' ');
  return (
    <>
      <p>
        {fix.inLines ? (
          <Rich msg="violations.inLines" vars={{ directive: fix.directive, count: e.count }} />
        ) : (
          <Rich msg={fix.created ? 'violations.fixAddCreated' : 'violations.fixAdd'} vars={{ add, directive: fix.directive }} />
        )}
      </p>
      {fix.risky && (
        <p class="violation-risk">
          <Rich msg={fix.add.includes("'unsafe-eval'") ? 'violations.riskEval' : 'violations.riskScheme'} vars={{ add, directive: fix.directive }} />
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
  return (
    <>
      <HashTool id={id} kind={kind} hashes={hashes} onChange={setHashes} />
      {hashes.length > 0 && <CodeBox caption={t('violations.hashCaption', { directive })} copyText={hashes.map((h) => h.source).join(' ')} />}
    </>
  );
}

const listOf = (locale: string, items: string[]) => new Intl.ListFormat(locale, { type: 'conjunction' }).format(items);
