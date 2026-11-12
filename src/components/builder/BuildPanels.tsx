import { Fragment, type ComponentChildren } from 'preact';
import { useMemo, useState } from 'preact/hooks';
import { localePath, type Translate } from '../../i18n';
import { analyze } from '../../lib/analysis';
import { askedFor, HASHABLE, isHashable, NONCE_PLACEHOLDER, SITE_NEEDS, type BuiltPolicy, type CustomTool, type HashableNeed, type PlacedRequirement, type SiteNeed } from '../../lib/build';
import type { ContentBundle } from '../../lib/content';
import { requiresTrustedTypes } from '../../lib/csp/fallback';
import type { Audience, Policy } from '../../lib/csp/model';
import { deploySnippet, headersBesideMeta, TARGETS, type Target } from '../../lib/reports/developer';
import { track } from '../../scripts/track';
import { CodeBox } from '../ui/CodeBox';
import { Explanation } from '../policy/Explanation';
import { TrustedTypesNote } from '../policy/TrustedTypesNote';
import { HashTool } from '../policy/HashTool';
import { useT } from '../ui/i18n';
import { OwnToolEditor } from './OwnTools';
import { highlightClass, PolicyView, type Selection } from '../policy/PolicyView';
import { Rich } from '../ui/Rich';
import { Segmented } from '../ui/Segmented';
import { encodeCompareState } from '../policy/compare-state';
import { FindingList } from '../policy/FindingList';
import { encodeState, unreadableSite } from '../policy/state';
import { TabList, tabPanelProps } from '../ui/Tabs';
import { ToolPicker } from '../policy/ToolPicker';
import type { BuilderModel } from './useBuilder';

const NEEDS = Object.keys(SITE_NEEDS) as SiteNeed[];

/** Why a requirement is there, in the visitor's words. */
function reasonText(t: Translate, p: PlacedRequirement): string {
  if (p.by.kind === 'site') return t(`build.site.needs.${p.result.requirement.reason}.label`);
  if (p.by.kind === 'custom') return t('build.own.reason', { name: p.by.label });
  return p.result.requirement.reason;
}

/** What happened to a requirement: added, already allowed, or waiting on a nonce. */
function outcomeText(t: Translate, p: PlacedRequirement): string {
  if (p.addedTo) return t('build.outcome.added', { directive: p.addedTo });
  const v = p.result.verdict;
  const match = p.result.checks[0]?.match;
  if (v === 'allowed') return match?.matchedBy ? t('build.outcome.allowed', { source: match.matchedBy.raw }) : t('build.outcome.unrestricted');
  if (v === 'needs-nonce') {
    // Hashes alone (no nonce) make 'unsafe-inline' ignored too: this code then needs a hash of its own.
    const noNonce = match?.directive && !match.directive.values.some((x) => x.kind === 'nonce');
    return t(noNonce ? 'build.outcome.needs-hash' : 'build.outcome.needs-nonce');
  }
  return t('build.outcome.blocked');
}

interface Group {
  type: PlacedRequirement['result']['requirement']['type'];
  outcome: string;
  status: string;
  sources: string[];
  reasons: string[];
}

/** One line per kind of resource and outcome, rather than one per address. */
function groupRequirements(t: Translate, placed: PlacedRequirement[]): Group[] {
  const groups = new Map<string, Group>();
  for (const p of placed) {
    const outcome = outcomeText(t, p);
    const key = `${p.result.requirement.type}|${outcome}`;
    const group = groups.get(key) ?? {
      type: p.result.requirement.type,
      outcome,
      status: p.addedTo ? 'added' : p.result.verdict,
      sources: [],
      reasons: [],
    };
    if (!group.sources.includes(p.result.requirement.source)) group.sources.push(p.result.requirement.source);
    const reason = reasonText(t, p);
    if (!group.reasons.includes(reason)) group.reasons.push(reason);
    groups.set(key, group);
  }
  return [...groups.values()];
}

export function RequirementList({ placed, audience }: { placed: PlacedRequirement[]; audience: Audience }) {
  const t = useT();
  return (
    <ul class="requirements">
      {groupRequirements(t, placed).map((g, i) => (
        <li key={i} class={`req req-${g.status}`}>
          <span class="req-what">
            {t(`resources.${g.type}`)}{' '}
            <span class="req-sources">
              {g.sources.map((s) => (
                <code key={s}>{s}</code>
              ))}
            </span>
          </span>
          <span class="req-why">{audience === 'simple' ? g.reasons.join(' ') : g.outcome}</span>
        </li>
      ))}
    </ul>
  );
}

/** A tool's outcome in a few words, for its folded summary. */
function ToolStatus({ placed }: { placed: PlacedRequirement[] }) {
  const t = useT();
  const added = placed.filter((p) => p.addedTo).length;
  const nonce = placed.filter((p) => p.result.verdict === 'needs-nonce').length;
  const blocked = placed.filter((p) => !p.addedTo && p.result.verdict === 'blocked').length;
  const tags = [
    added > 0 && <span class="tag">{t('build.tools.status.added', { count: added })}</span>,
    nonce > 0 && <span class="tag tag-warn">{t('build.tools.status.nonce', { count: nonce })}</span>,
    blocked > 0 && <span class="tag tag-bad">{t('build.tools.status.blocked', { count: blocked })}</span>,
  ].filter(Boolean);
  return <span class="tool-status">{tags.length > 0 ? tags : <span class="tag tag-ok">{t('build.tools.status.allowed')}</span>}</span>;
}

/** A tool folded to its name and outcome; the latest one picked starts open. */
function ToolDetails({ name, placed, open, children }: { name: string; placed: PlacedRequirement[]; open: boolean; children: ComponentChildren }) {
  return (
    <details class="tool" open={open}>
      <summary>
        <span class="tool-name">{name}</span>
        <ToolStatus placed={placed} />
      </summary>
      <div class="tool-body">{children}</div>
    </details>
  );
}

/** The built policy as plain text, with what the site and tools added highlighted. */
export function PolicyPreview({ built }: { built: BuiltPolicy }) {
  const t = useT();
  const policy = built.policy;
  if (!policy) return <p class="muted">{t('build.preview.empty')}</p>;
  return (
    <>
      <code class="preview-policy">
        {policy.directives.map((d, di) => (
          <span key={di} class="preview-line">
            <span class="preview-directive">{d.name}</span>
            {d.values.map((v, vi) => (
              <Fragment key={vi}>
                {' '}
                <span class={askedFor(built, d.name, v.raw).length > 0 ? `tok ${highlightClass(v)}` : 'tok'}>{v.raw}</span>
              </Fragment>
            ))}
            <span class="semi">;</span>
          </span>
        ))}
      </code>
      <p class="muted">{t('build.preview.summary', { count: built.changes.reduce((n, c) => n + c.added.length, 0) })}</p>
    </>
  );
}

/** Who asked for the selected value, beside the usual explanation of what it does. */
function WhoAsked({ built, policy, selection }: { built: BuiltPolicy; policy: Policy; selection: Selection }) {
  const t = useT();
  const d = policy.directives[selection.directiveIndex];
  const v = selection.valueIndex === undefined ? undefined : d?.values[selection.valueIndex];
  if (!d || !v) return null;
  const asked = askedFor(built, d.name, v.raw);
  const fromBase = built.base?.directives.some((b) => b.name === d.name && b.values.some((x) => x.raw === v.raw));
  return (
    <div class="who-asked">
      <h3>{t('build.review.whoAsked')}</h3>
      {asked.length > 0 ? (
        <ul>
          {asked.map((p, i) => (
            <li key={i}>
              <strong>{p.by.label}</strong>: {reasonText(t, p)}
            </li>
          ))}
        </ul>
      ) : (
        <p>{fromBase ? t('build.review.fromStart') : t('build.review.copied', { directive: 'default-src' })}</p>
      )}
    </div>
  );
}

export function StartPanel({ b }: { b: BuilderModel }) {
  const t = useT();
  const { start, setStart, built } = b;
  return (
    <>
      <fieldset class="choices">
        <legend>{t('build.start.question')}</legend>
        {(['scratch', 'policy'] as const).map((choice) => {
          const checked = choice === 'policy' ? start === 'policy' : start !== undefined && start !== 'policy';
          return (
            <label key={choice} class="choice">
              <input type="radio" name="start" checked={checked} onChange={() => setStart(choice === 'policy' ? 'policy' : 'allowlist')} />
              <span>
                <strong>{t(`build.start.${choice}`)}</strong>
                <span class="muted">{t(`build.start.${choice}Hint`)}</span>
              </span>
            </label>
          );
        })}
      </fieldset>

      {start !== undefined && start !== 'policy' && (
        <fieldset class="choices">
          <legend>{t('build.start.nonceQuestion')}</legend>
          <p class="muted">
            <Rich msg={`build.start.nonceExplain.${b.audience}`} />
          </p>
          {(['nonce', 'allowlist'] as const).map((mode) => (
            <Fragment key={mode}>
              <label class="choice">
                <input type="radio" name="mode" checked={start === mode} onChange={() => setStart(mode)} />
                <span>
                  <strong>{t(`build.start.${mode}`)}</strong>
                  <span class="muted">{t(`build.start.${mode}Hint`)}</span>
                </span>
              </label>
              {/* Part of the "Yes" answer, so it sits under it. */}
              {mode === 'nonce' && start === 'nonce' && (
                <label class="choice older-browsers">
                  <input type="checkbox" checked={b.olderBrowsers} onChange={(e) => b.setOlderBrowsers(e.currentTarget.checked)} />
                  <span>
                    <strong>{t('build.start.olderBrowsers')}</strong>
                    <span class="muted">
                      <Rich msg="build.start.olderBrowsersHint" />
                    </span>
                  </span>
                </label>
              )}
            </Fragment>
          ))}
        </fieldset>
      )}

      {start === 'policy' && (
        <div class="field">
          <label for="build-policy">{t('build.start.paste')}</label>
          <textarea
            id="build-policy"
            class="code"
            rows={5}
            spellcheck={false}
            autocomplete="off"
            placeholder={t('analyzer.placeholder')}
            value={b.policyText}
            onInput={(e) => b.setPolicyText(e.currentTarget.value)}
          />
          {b.policyText.trim() !== '' && !built.policy && <p class="issue">{t('issues.empty-input')}</p>}
          {built.otherPolicies > 0 && <p class="muted">{t('build.start.otherPolicies', { count: built.otherPolicies })}</p>}
          <p class="find-hint">
            {t('analyzer.noPolicy')} <a href={localePath(t.locale, '/find-my-csp')}>{t('analyzer.findLink')}</a>
          </p>
        </div>
      )}
    </>
  );
}

/** For inline code the visitor ticked: allow all of it, or only the blocks listed by hash. */
function InlineChoice({ b, need }: { b: BuilderModel; need: HashableNeed }) {
  const t = useT();
  const listed = b.hashes[need];
  const kind = HASHABLE[need] === 'inline-script' ? 'script' : 'style';
  // Hashes only limit inline code when a directive restricts it: without one, everything already runs.
  const unrestricted = b
    .placedBy('site', 'site')
    .some((p) => p.result.requirement.reason === need && p.result.checks.length > 0 && p.result.checks.every((c) => !c.match.directive));
  return (
    <div class="inline-choice">
      <Segmented
        class="segmented"
        label={t('build.site.inline.question')}
        items={[
          { id: 'all', label: t(b.start === 'nonce' ? 'build.site.inline.nonce' : 'build.site.inline.all') },
          { id: 'listed', label: t('build.site.inline.listed') },
        ]}
        value={listed ? 'listed' : 'all'}
        onChange={(v) => b.setHashes(need, v === 'listed' ? (listed ?? []) : undefined)}
      >
        <span class="muted" aria-hidden="true">{t('build.site.inline.question')}</span>
      </Segmented>
      {listed && (
        <>
          <p class="muted">
            <Rich msg={`build.site.inline.explain.${kind}.${b.audience === 'simple' ? 'simple' : 'technical'}`} />
          </p>
          <HashTool
            id={`hash-${need}`}
            kind={kind}
            hashes={listed.map((source) => ({ kind, source }))}
            onChange={(hashes) => b.setHashes(need, hashes.map((h) => h.source))}
          />
          {unrestricted && (
            <p class="hash-note" role="note">
              <Rich msg={`build.site.inline.unrestricted.${kind}`} />
            </p>
          )}
        </>
      )}
    </div>
  );
}

export function SitePanel({ b }: { b: BuilderModel }) {
  const t = useT();
  const placed = b.placedBy('site', 'site');
  return (
    <>
      <fieldset class="choices">
        <legend>{t('build.site.question')}</legend>
        {NEEDS.map((need) => (
          <Fragment key={need}>
            <label class="choice">
              <input type="checkbox" checked={b.needs.includes(need)} onChange={() => b.toggleNeed(need)} />
              <span>
                <strong>{t(`build.site.needs.${need}.label`)}</strong>
                <span class="muted">{t(`build.site.needs.${need}.${b.audience === 'simple' ? 'hint' : 'detail'}`)}</span>
              </span>
            </label>
            {isHashable(need) && b.needs.includes(need) && <InlineChoice b={b} need={need} />}
          </Fragment>
        ))}
      </fieldset>
      <p class="muted">{t('build.site.unsure')}</p>
      {placed.length > 0 && <RequirementList placed={placed} audience={b.audience} />}
      <div class="field">
        <label for="build-site">{t('analyzer.siteLabel')}</label>
        <input
          id="build-site"
          type="text"
          inputMode="url"
          value={b.site}
          placeholder="www.example.com"
          aria-invalid={unreadableSite(b.site)}
          aria-describedby={unreadableSite(b.site) ? 'build-site-unreadable' : undefined}
          onInput={(e) => b.setSite(e.currentTarget.value)}
        />
        {unreadableSite(b.site) && <p id="build-site-unreadable" class="issue">{t('analyzer.siteUnreadable')}</p>}
        <p class="muted">{t('build.site.addressHint')}</p>
      </div>
    </>
  );
}

export function ToolsPanel({ b }: { b: BuilderModel }) {
  const t = useT();
  // The own tool being described: a new one (with the name typed in the picker) or one being edited.
  const [editing, setEditing] = useState<{ initial: Omit<CustomTool, 'id'>; previous?: string } | undefined>();
  const editor = editing && (
    <OwnToolEditor
      key={editing.previous ?? 'new'}
      initial={editing.initial}
      isNew={editing.previous === undefined}
      onSave={(tool) => {
        b.saveOwn(tool, editing.previous);
        setEditing(undefined);
      }}
      onCancel={() => setEditing(undefined)}
    />
  );

  return (
    <div class="vendors">
      <ToolPicker
        vendors={b.allVendors}
        selected={b.selectedTools}
        onToggle={b.toggleTool}
        own={b.ownTools}
        onDescribe={(name) => setEditing({ initial: { name, needs: [] } })}
      />
      {editing?.previous === undefined && editor}
      {b.picked.length === 0 && b.tools.length === 0 && !editing && <p class="muted">{t('build.tools.none')}</p>}
      {(b.picked.length > 0 || b.tools.length > 0) && b.built.policy && !b.built.policy.reportOnly && requiresTrustedTypes(b.built.policy) && <TrustedTypesNote />}
      <div class="tool-list">
        {b.picked.map((vendor) => {
          const placed = b.placedBy('vendor', vendor.id);
          return (
            <ToolDetails key={vendor.id} name={vendor.name} placed={placed} open={vendor.id === b.lastPicked}>
              {vendor.features.length > 1 && (
                <fieldset class="features">
                  <legend>{t('vendors.features')}</legend>
                  {vendor.features.map((f) => (
                    <label key={f.id}>
                      <input type="checkbox" checked={b.vendors[vendor.id]?.includes(f.id)} onChange={() => b.toggleFeature(vendor.id, f.id)} />{' '}
                      {f.label}
                    </label>
                  ))}
                </fieldset>
              )}
              <RequirementList placed={placed} audience={b.audience} />
              {vendor.nonce?.how && (b.start === 'nonce' || placed.some((p) => p.result.verdict === 'needs-nonce')) && (
                <p class="nonce-how">
                  <strong>{t('vendors.nonceHow')}:</strong> {vendor.nonce.how}
                </p>
              )}
            </ToolDetails>
          );
        })}
        {b.tools.map((tool) =>
          editing?.previous === tool.name ? (
            <div key={tool.id}>{editor}</div>
          ) : (
            <ToolDetails key={tool.id} name={tool.name} placed={b.placedBy('custom', tool.id)} open={b.ownId(tool.name) === b.lastPicked}>
              <RequirementList placed={b.placedBy('custom', tool.id)} audience={b.audience} />
              <p class="actions">
                <button type="button" class="button quiet" onClick={() => setEditing({ initial: tool, previous: tool.name })}>
                  {t('build.own.edit')}
                </button>
                <button type="button" class="button quiet" onClick={() => b.removeOwn(tool.name)}>
                  {t('build.own.remove', { name: tool.name })}
                </button>
              </p>
            </ToolDetails>
          ),
        )}
      </div>
      {b.hasLibrary && (
        <p class="own-storage muted">
          {t('build.own.storage')}{' '}
          <button type="button" class="link-button" onClick={b.forgetLibrary}>
            {t('build.own.forget')}
          </button>
        </p>
      )}
    </div>
  );
}

type ReviewTab = 'lines' | 'notes' | 'live';

export function ReviewPanel({ b, content }: { b: BuilderModel; content: ContentBundle }) {
  const t = useT();
  const { built, audience } = b;
  const [tab, setTab] = useState<ReviewTab>('lines');
  const [selection, setSelection] = useState<Selection | undefined>();
  const [target, setTarget] = useState<Target>('nginx');
  const deployAnalysis = useMemo(() => analyze(built.text, [], b.origin), [built.text, b.origin]);
  const policy = built.policy;
  if (!policy) return null;

  const activeSelection = selection && policy.directives[selection.directiveIndex] ? selection : { policyIndex: 0, directiveIndex: 0 };
  const nonceWaiting = built.requirements.filter((p) => p.result.verdict === 'needs-nonce');
  const findings = built.findings.filter((f) => audience === 'security' || f.level === 'high' || f.level === 'medium');
  const notes = findings.length + (nonceWaiting.length > 0 ? 1 : 0) + (b.start === 'nonce' ? 1 : 0);
  const snippet = deploySnippet(deployAnalysis, target);
  const metaHeaders = target === 'meta' ? headersBesideMeta(deployAnalysis) : '';
  const analyzeHref = localePath(t.locale, `/#${encodeState({ policy: built.text, site: b.site, vendors: b.vendors })}`);
  // Started from a policy: the comparator shows what the builder changed in it.
  const compareHref =
    b.start === 'policy' && b.policyText.trim() !== ''
      ? localePath(t.locale, `/compare#${encodeCompareState({ before: b.policyText, after: built.text, site: b.site, vendors: b.vendors, audience })}`)
      : undefined;

  return (
    <div class="review">
      <TabList
        id="review"
        label={t('build.review.tabs.label')}
        value={tab}
        onChange={setTab}
        items={(['lines', 'notes', 'live'] as const).map((id) => ({
          id,
          label: (
            <>
              <span class="tab-label">{t(`build.review.tabs.${id}`)}</span>
              {id === 'notes' && notes > 0 && <span class="count count-warn">{notes}</span>}
            </>
          ),
        }))}
      />

      {tab === 'lines' && (
        <div {...tabPanelProps('review', 'lines')} class="panel">
          <p class="muted">{t('build.review.intro')}</p>
          <div class="decoded-grid">
            <PolicyView
              policy={policy}
              policyIndex={0}
              issues={[]}
              docs={content.directives}
              selection={activeSelection}
              onSelect={setSelection}
              highlighted={(d, v) => askedFor(built, d.name, v.raw).length > 0}
            />
            <div class="explanation-slot">
              <WhoAsked built={built} policy={policy} selection={activeSelection} />
              <Explanation policy={policy} selection={activeSelection} issues={[]} audience={audience} content={content} />
            </div>
          </div>
        </div>
      )}

      {tab === 'notes' && (
        <div {...tabPanelProps('review', 'notes')} class="panel">
          {b.start === 'nonce' && (
            <div class="companion-note">
              <h3>{t('build.review.nonceTitle')}</h3>
              <p>
                <Rich msg="build.review.nonce" vars={{ placeholder: NONCE_PLACEHOLDER }} />
              </p>
            </div>
          )}
          {nonceWaiting.length > 0 && (
            <div class="companion-note">
              <h3>{t('build.review.waitingTitle')}</h3>
              <RequirementList placed={nonceWaiting} audience={audience} />
            </div>
          )}
          {findings.length === 0 ? (
            <p>{t('report.security.noFindings')}</p>
          ) : (
            <FindingList
              findings={findings}
              tag={(f) => (built.introducedFindings.includes(f) ? t('build.review.fromTools') : undefined)}
              action={(f) =>
                f.id === 'script-unsafe-inline' &&
                b.needs.includes('inline-scripts') &&
                !b.hashes['inline-scripts'] && (
                  <button
                    type="button"
                    class="link-button"
                    onClick={() => {
                      b.setHashes('inline-scripts', []);
                      b.setStep('site');
                    }}
                  >
                    {t('build.review.useHashes')}
                  </button>
                )
              }
            />
          )}
          <p class="muted">{t('report.security.attribution')}</p>
        </div>
      )}

      {tab === 'live' && (
        <div {...tabPanelProps('review', 'live')} class="panel">
          <p>
            <Rich msg="build.review.reportOnly" />
          </p>
          <Segmented
            class="tabs"
            items={TARGETS.map((id) => ({ id, label: t(`report.developer.targets.${id}`) }))}
            value={target}
            onChange={setTarget}
            label={t('report.developer.deploy')}
          />
          {snippet && <CodeBox caption={t(`report.developer.targetCaptions.${target}`)} copyText={snippet} onCopy={() => track('copy-build', { kind: target })} />}
          {metaHeaders && <CodeBox caption={t('report.developer.metaHeaders')} copyText={metaHeaders} onCopy={() => track('copy-build', { kind: target })} />}
          <CodeBox caption={t('build.review.policyCaption')} copyText={built.text} onCopy={() => track('copy-build', { kind: 'policy' })} />
        </div>
      )}

      <p class="actions">
        <a class="button quiet" href={analyzeHref}>
          {t('build.review.analyze')}
        </a>
        {compareHref && (
          <a class="button quiet" href={compareHref}>
            {t('build.review.compare')}
          </a>
        )}
      </p>
    </div>
  );
}
