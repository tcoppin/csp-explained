import { EFFECTIVE_DIRECTIVE, type ResourceType } from './directives';
import { resolve } from './fallback';
import { checkResource, ignoredSources, sourceApplies, type Verdict } from './matcher';
import type { Directive, Policy, SourceExpression } from './model';

/**
 * Compares two versions of a policy the way the browser reads them: what was written (directives and values) and
 * what it means (which directive decides each kind of load, and which of its sources really count).
 */

export type ChangeStatus = 'added' | 'removed' | 'changed' | 'unchanged';

/** Two policies compared, or one left without a counterpart on the other side. */
export interface PolicyPair {
  before?: Policy;
  after?: Policy;
  /** Positions in each side's `policies`, to tell findings and checks apart per policy. */
  beforeIndex?: number;
  afterIndex?: number;
}

export interface ValueDiff {
  /** As written in the policy that has it (the after one when both do). */
  raw: string;
  status: Exclude<ChangeStatus, 'changed'>;
  before?: SourceExpression;
  after?: SourceExpression;
}

export interface DirectiveDiff {
  name: string;
  status: ChangeStatus;
  before?: Directive;
  after?: Directive;
  /** The after policy's values in order, with removed ones where they stood in the before policy. */
  values: ValueDiff[];
}

/** How one kind of load is treated before and after, for loads named by a URL (scripts, images, frames...). */
export interface SourcesChange {
  kind: 'sources';
  type: ResourceType;
  /** Directive that decides it; undefined when nothing restricts that kind of load. */
  before?: string;
  after?: string;
  /**
   * Sources the browser uses (those it ignores, e.g. hosts next to 'strict-dynamic', are left out), without nonces
   * and hashes, which say nothing about addresses.
   */
  added: string[];
  removed: string[];
  /** A nonce appears or goes. A nonce whose value changes is no change: it's new for every page. */
  nonce?: 'added' | 'removed';
  /** Inline code allowed by hash: a changed hash means the code changed. */
  hashesAdded?: string[];
  hashesRemoved?: string[];
}

/** How inline code or eval is treated before and after. */
export interface VerdictChange {
  kind: 'verdict';
  type: ResourceType;
  before?: string;
  after?: string;
  verdictBefore: Verdict;
  verdictAfter: Verdict;
}

export type EffectiveChange = SourcesChange | VerdictChange;

export interface PolicyDiff extends PolicyPair {
  status: ChangeStatus;
  /** Enforced ↔ Report-Only. */
  modeChanged: boolean;
  /** Header ↔ <meta> (pasted policies without either count as neither). */
  deliveryChanged: boolean;
  /** Every directive in either policy, in the after policy's order, removed ones where they stood. */
  directives: DirectiveDiff[];
  /** Only the kinds of load whose treatment changed. */
  effective: EffectiveChange[];
  /**
   * `changed`: both sides have a nonce, with different values, as two page loads should. `same`: the same value on
   * both sides, which two page loads should never show.
   */
  nonce?: 'same' | 'changed';
}

/** Kinds of load named by a URL, in the order people think of them. */
export const URL_TYPES: ResourceType[] = ['script', 'style', 'img', 'font', 'connect', 'frame', 'media', 'object', 'worker', 'manifest', 'form', 'base'];
/** Inline code and eval: allowed or not, whatever the URL. */
export const INLINE_TYPES: ResourceType[] = ['inline-script', 'inline-handler', 'eval', 'inline-style', 'style-attr'];

/** Nonces and hashes are case-sensitive; everything else is compared as the parser lowercased it. */
const valueKey = (v: SourceExpression) => (v.kind === 'nonce' || v.kind === 'hash' ? v.raw : v.value);

/**
 * Directives the browser reads, by name: the first of each name (it ignores the repeats). Names it doesn't know are
 * kept, since a typo fixed or introduced is a change worth showing.
 */
function readDirectives(policy: Policy | undefined): Directive[] {
  return policy?.directives.filter((d) => !d.duplicate) ?? [];
}

/**
 * Merges two ordered lists by key: the after list's order, with each item only in the before list placed after the
 * item that preceded it there.
 */
function merge<T, R>(
  before: T[],
  after: T[],
  key: (t: T) => string,
  make: (k: string, b: T | undefined, a: T | undefined) => R,
): R[] {
  const afterKeys = new Set(after.map(key));
  const beforeByKey = new Map(before.map((b) => [key(b), b]));
  const out: R[] = [];
  // Before-only items, grouped under the key of the item that preceded them in the before list ('' = at the start).
  const pending = new Map<string, T[]>();
  let anchor = '';
  for (const b of before) {
    const k = key(b);
    if (afterKeys.has(k)) anchor = k;
    else pending.set(anchor, [...(pending.get(anchor) ?? []), b]);
  }
  const flush = (k: string) => {
    for (const b of pending.get(k) ?? []) out.push(make(key(b), b, undefined));
    pending.delete(k);
  };
  flush('');
  for (const a of after) {
    const k = key(a);
    out.push(make(k, beforeByKey.get(k), a));
    flush(k);
  }
  return out;
}

function diffValues(before: Directive | undefined, after: Directive | undefined): ValueDiff[] {
  return merge(before?.values ?? [], after?.values ?? [], valueKey, (_, b, a) => ({
    raw: (a ?? b)!.raw,
    status: a && b ? 'unchanged' : a ? 'added' : 'removed',
    before: b,
    after: a,
  }));
}

export function diffDirectives(before: Policy | undefined, after: Policy | undefined): DirectiveDiff[] {
  return merge(readDirectives(before), readDirectives(after), (d) => d.name, (name, b, a) => {
    const values = diffValues(b, a);
    const status: ChangeStatus = !b ? 'added' : !a ? 'removed' : values.some((v) => v.status !== 'unchanged') ? 'changed' : 'unchanged';
    return { name, status, before: b, after: a, values };
  });
}

/** Sources the browser uses for `type` in this policy, by key, with the directive that holds them. */
function effectiveSources(policy: Policy | undefined, type: ResourceType) {
  const governing = policy ? resolve(policy, EFFECTIVE_DIRECTIVE[type]).governing : undefined;
  if (!governing) return { directive: undefined, sources: new Map<string, string>(), hashes: new Set<string>(), nonce: false };
  const ignored = new Set(ignoredSources(governing, type));
  const used = governing.values.filter((v) => !ignored.has(v) && sourceApplies(v, type));
  const sources = new Map(used.filter((v) => v.kind !== 'nonce' && v.kind !== 'hash').map((v) => [valueKey(v), v.raw]));
  const hashes = new Set(used.filter((v) => v.kind === 'hash').map((v) => v.raw));
  return { directive: governing.name, sources, hashes, nonce: used.some((v) => v.kind === 'nonce') };
}

/** Every nonce a policy lists, whatever the directive. */
const noncesOf = (policy: Policy | undefined) =>
  new Set(policy?.directives.flatMap((d) => d.values.filter((v) => v.kind === 'nonce').map((v) => v.raw)) ?? []);

/** A policy that isn't there (added or removed) allows everything; so does an empty one. */
function verdictFor(policy: Policy | undefined, type: ResourceType, selfOrigin: string): Verdict {
  return policy ? checkResource(policy, type, undefined, selfOrigin).verdict : 'allowed';
}

export function effectiveChanges(before: Policy | undefined, after: Policy | undefined, selfOrigin: string): EffectiveChange[] {
  const changes: EffectiveChange[] = [];
  for (const type of URL_TYPES) {
    const b = effectiveSources(before, type);
    const a = effectiveSources(after, type);
    const added = [...a.sources].filter(([k]) => !b.sources.has(k)).map(([, raw]) => raw);
    const removed = [...b.sources].filter(([k]) => !a.sources.has(k)).map(([, raw]) => raw);
    const hashesAdded = [...a.hashes].filter((h) => !b.hashes.has(h));
    const hashesRemoved = [...b.hashes].filter((h) => !a.hashes.has(h));
    const nonce = a.nonce === b.nonce ? undefined : a.nonce ? 'added' : 'removed';
    if (b.directive !== a.directive || added.length > 0 || removed.length > 0 || nonce || hashesAdded.length > 0 || hashesRemoved.length > 0) {
      changes.push({
        kind: 'sources',
        type,
        before: b.directive,
        after: a.directive,
        added,
        removed,
        ...(nonce && { nonce }),
        ...(hashesAdded.length > 0 && { hashesAdded }),
        ...(hashesRemoved.length > 0 && { hashesRemoved }),
      });
    }
  }
  for (const type of INLINE_TYPES) {
    const requested = EFFECTIVE_DIRECTIVE[type];
    const verdictBefore = verdictFor(before, type, selfOrigin);
    const verdictAfter = verdictFor(after, type, selfOrigin);
    const b = before ? resolve(before, requested).governing?.name : undefined;
    const a = after ? resolve(after, requested).governing?.name : undefined;
    if (verdictBefore !== verdictAfter) changes.push({ kind: 'verdict', type, before: b, after: a, verdictBefore, verdictAfter });
  }
  return changes;
}

/**
 * Pairs the policies of both sides. The same number on each side pairs them in order, even when one moved from
 * Report-Only to enforced (the usual rollout). Otherwise enforced policies pair with enforced ones and Report-Only
 * with Report-Only, in order; the rest have no counterpart.
 */
export function pairPolicies(before: Policy[], after: Policy[]): PolicyPair[] {
  const b = before.map((policy, index) => ({ policy, index })).filter((x) => x.policy.directives.length > 0);
  const a = after.map((policy, index) => ({ policy, index })).filter((x) => x.policy.directives.length > 0);
  const pair = (x?: (typeof b)[number], y?: (typeof a)[number]): PolicyPair => ({
    before: x?.policy,
    after: y?.policy,
    beforeIndex: x?.index,
    afterIndex: y?.index,
  });
  const zip = (xs: typeof b, ys: typeof a) => Array.from({ length: Math.max(xs.length, ys.length) }, (_, i) => pair(xs[i], ys[i]));

  if (b.length === a.length) return zip(b, a);
  const byMode = (xs: typeof b, reportOnly: boolean) => xs.filter((x) => x.policy.reportOnly === reportOnly);
  return [...zip(byMode(b, false), byMode(a, false)), ...zip(byMode(b, true), byMode(a, true))];
}

const delivery = (p: Policy) => (p.origin === 'raw' ? undefined : p.origin);

export function diffPolicies(before: Policy[], after: Policy[], selfOrigin: string): PolicyDiff[] {
  return pairPolicies(before, after).map((pair) => {
    const { before: b, after: a } = pair;
    const directives = diffDirectives(b, a);
    const modeChanged = !!a && !!b && a.reportOnly !== b.reportOnly;
    const deliveryChanged = !!a && !!b && !!delivery(a) && !!delivery(b) && delivery(a) !== delivery(b);
    const status: ChangeStatus = !b
      ? 'added'
      : !a
        ? 'removed'
        : modeChanged || deliveryChanged || directives.some((d) => d.status !== 'unchanged')
          ? 'changed'
          : 'unchanged';
    const nb = noncesOf(b);
    const na = noncesOf(a);
    const nonce = nb.size > 0 && na.size > 0 ? ([...na].some((n) => nb.has(n)) ? 'same' : 'changed') : undefined;
    return { ...pair, status, modeChanged, deliveryChanged, directives, effective: effectiveChanges(b, a, selfOrigin), ...(nonce && { nonce }) };
  });
}
