/**
 * Usage counts: the only things this site measures. Shared by the site (src/scripts/track.ts) and the
 * counting Lambda (infra/lambda/usage.ts), which drops anything not listed here.
 *
 * Each event carries at most a few labels from our own lists (a page, a tool id, an audience). Never what
 * the visitor typed: no policy, no site address, no identifier, no cookie.
 */
export const USAGE_EVENTS = {
  /** A page opened from outside the site (a visit, counted without cookies). */
  visit: ['page'],
  /** A policy pasted or typed by the visitor was analysed (once per page load; not the example). */
  analyze: [],
  /** "Try an example" was clicked. */
  example: [],
  /** A share link was opened. */
  shared: [],
  /** A tool was added in the tool picker. */
  tool: ['tool'],
  /** A report was copied: which audience, and which part (message, diff, deploy snippet, Markdown). */
  'copy-report': ['audience', 'kind'],
  /** The Find my CSP console snippet was copied. */
  'copy-snippet': [],
} as const satisfies Record<string, readonly string[]>;

export type UsageEvent = keyof typeof USAGE_EVENTS;
export type UsageLabels<E extends UsageEvent> = { [K in (typeof USAGE_EVENTS)[E][number]]?: string };

/** Labels are ids from our own lists; anything else is dropped. */
const LABEL = /^[a-z0-9/][a-z0-9/-]{0,59}$/;

export interface UsageRecord {
  event: UsageEvent;
  labels: Record<string, string>;
}

/** Reads a request's query string (`n` = event name, then its labels), or undefined if it isn't a known event. */
export function usageRecord(query: Record<string, string | undefined>): UsageRecord | undefined {
  const event = query.n;
  if (!event || !Object.hasOwn(USAGE_EVENTS, event)) return undefined;
  const labels: Record<string, string> = {};
  for (const name of USAGE_EVENTS[event as UsageEvent]) {
    const value = query[name];
    if (value !== undefined && LABEL.test(value)) labels[name] = value;
  }
  return { event: event as UsageEvent, labels };
}

export const USAGE_NAMESPACE = 'CspExplained/Usage';

/**
 * One log line in CloudWatch embedded metric format: CloudWatch turns it into a `Count` metric per event
 * (a handful of metrics, within the free tier), and keeps the labels for Logs Insights breakdowns.
 */
export function usageLogLine(record: UsageRecord, timestamp: number): string {
  return JSON.stringify({
    _aws: {
      Timestamp: timestamp,
      CloudWatchMetrics: [{ Namespace: USAGE_NAMESPACE, Dimensions: [['Event']], Metrics: [{ Name: 'Count', Unit: 'Count' }] }],
    },
    Event: record.event,
    Count: 1,
    ...record.labels,
  });
}
