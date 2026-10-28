import type { UsageEvent, UsageLabels } from '../usage';

/**
 * Counts one usage event (see src/usage.ts): a request to our own `/e`, carrying the event name and its
 * labels only. No cookie, no referrer, and never what the visitor typed. Not sent in `astro dev`.
 */
export function track<E extends UsageEvent>(event: E, labels: UsageLabels<E> = {}) {
  if (import.meta.env.DEV) return;
  const query = new URLSearchParams({ n: event });
  for (const [name, value] of Object.entries(labels)) if (value) query.set(name, value as string);
  fetch(`/e?${query}`, { keepalive: true, credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store' }).catch(() => {
    // Counting is best effort.
  });
}
