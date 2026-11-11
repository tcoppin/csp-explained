import type { Audience } from '../../lib/csp/model';
import { isAudience, VIEWS, type View } from '../policy/state';

/**
 * The last policies analysed, kept in this browser's own storage only, to reopen one where it was left, once the
 * visitor turned the history on. Nothing here is ever sent anywhere.
 */
export interface RecentAnalysis {
  id: string;
  policy: string;
  site: string;
  /** vendor id → selected feature ids */
  vendors: Record<string, string[]>;
  view: View;
  audience: Audience;
  /** Last change, in milliseconds since 1970. */
  savedAt: number;
}

export const RECENT_LIMIT = 10;
/** Longer texts aren't kept: a policy is a few kilobytes at most, anything bigger was pasted by mistake. */
const MAX_POLICY_LENGTH = 20_000;

const RECENT_KEY = 'csp-explained:recent';
const ON_KEY = 'csp-explained:recent-on';
/** Set by older versions, when the history was kept by default and turned off here. */
const LEGACY_OFF_KEY = 'csp-explained:recent-off';

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Keeps the entries that make sense, drops the rest (storage can hold anything, from an older version or by hand). */
export function readRecent(value: unknown): RecentAnalysis[] {
  if (!Array.isArray(value)) return [];
  const out: RecentAnalysis[] = [];
  for (const e of value) {
    if (!isRecord(e) || typeof e.id !== 'string' || typeof e.policy !== 'string' || !e.policy.trim()) continue;
    const vendors: Record<string, string[]> = {};
    if (isRecord(e.vendors)) {
      for (const [id, features] of Object.entries(e.vendors)) {
        if (Array.isArray(features)) vendors[id] = features.filter((f): f is string => typeof f === 'string');
      }
    }
    out.push({
      id: e.id,
      policy: e.policy,
      site: typeof e.site === 'string' ? e.site : '',
      vendors,
      view: (VIEWS as readonly unknown[]).includes(e.view) ? (e.view as View) : 'read',
      audience: typeof e.audience === 'string' && isAudience(e.audience) ? e.audience : 'simple',
      savedAt: typeof e.savedAt === 'number' ? e.savedAt : 0,
    });
  }
  return out.slice(0, RECENT_LIMIT);
}

/**
 * Puts `entry` first. It replaces the entry with the same id (the analysis being worked on), and any other entry
 * with the same policy and site, so reopening or pasting a policy again doesn't list it twice.
 */
export function upsertRecent(list: RecentAnalysis[], entry: RecentAnalysis): RecentAnalysis[] {
  const same = (e: RecentAnalysis) => e.id === entry.id || (e.policy.trim() === entry.policy.trim() && e.site.trim() === entry.site.trim());
  return [entry, ...list.filter((e) => !same(e))].slice(0, RECENT_LIMIT);
}

export const keepsRecent = (policy: string) => policy.trim() !== '' && policy.length <= MAX_POLICY_LENGTH;

export const newRecentId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

export function loadRecent(): RecentAnalysis[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    return raw ? readRecent(JSON.parse(raw)) : [];
  } catch {
    // Storage can be unavailable (private mode, blocked site data), or hold something we can't read.
    return [];
  }
}

export function saveRecent(list: RecentAnalysis[]): void {
  try {
    if (list.length > 0) localStorage.setItem(RECENT_KEY, JSON.stringify(list));
    else localStorage.removeItem(RECENT_KEY);
  } catch {
    // Full or unavailable storage: the history is a convenience.
  }
}

/**
 * Whether the visitor asked for a history on this device. Nothing is kept until they do: storing it is only allowed
 * once they asked for it (EU ePrivacy rules, see CLAUDE.md). Before the history was opt-in it was kept unless turned
 * off: a browser that already holds one, and never turned it off, carries on.
 */
export function historyOn(get: (key: string) => string | null): { on: boolean; migrate: boolean } {
  if (get(ON_KEY) === '1') return { on: true, migrate: false };
  const legacy = get(LEGACY_OFF_KEY) !== '1' && get(RECENT_KEY) !== null;
  return { on: legacy, migrate: legacy || get(LEGACY_OFF_KEY) !== null };
}

export function loadRecentOn(): boolean {
  try {
    const { on, migrate } = historyOn((key) => localStorage.getItem(key));
    if (migrate) saveRecentOn(on);
    return on;
  } catch {
    return false;
  }
}

/** Turning the history on remembers that choice; turning it off forgets the choice and everything kept. */
export function saveRecentOn(on: boolean): void {
  try {
    localStorage.removeItem(LEGACY_OFF_KEY);
    if (on) localStorage.setItem(ON_KEY, '1');
    else {
      localStorage.removeItem(ON_KEY);
      localStorage.removeItem(RECENT_KEY);
    }
  } catch {
    // Not critical.
  }
}
