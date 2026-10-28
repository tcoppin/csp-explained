import { describe, expect, it } from 'vitest';
import { usageLogLine, usageRecord } from './usage';

describe('usageRecord', () => {
  it('keeps a known event and its labels', () => {
    expect(usageRecord({ n: 'copy-report', audience: 'developer', kind: 'diff' })).toEqual({
      event: 'copy-report',
      labels: { audience: 'developer', kind: 'diff' },
    });
    expect(usageRecord({ n: 'visit', page: '/find-my-csp/' })).toEqual({ event: 'visit', labels: { page: '/find-my-csp/' } });
  });

  it('ignores unknown events, including inherited property names', () => {
    expect(usageRecord({ n: 'policy' })).toBeUndefined();
    expect(usageRecord({ n: 'toString' })).toBeUndefined();
    expect(usageRecord({})).toBeUndefined();
  });

  it('drops labels the event does not have, and values that are not ids', () => {
    expect(usageRecord({ n: 'analyze', policy: "script-src 'self'" })).toEqual({ event: 'analyze', labels: {} });
    expect(usageRecord({ n: 'tool', tool: "script-src 'self'" })).toEqual({ event: 'tool', labels: {} });
    expect(usageRecord({ n: 'tool', tool: 'x'.repeat(61) })).toEqual({ event: 'tool', labels: {} });
  });
});

describe('usageLogLine', () => {
  it('writes one embedded-metric line counting the event', () => {
    const line = JSON.parse(usageLogLine({ event: 'tool', labels: { tool: 'google-tag-manager' } }, 1_700_000_000_000));
    expect(line).toMatchObject({ Event: 'tool', Count: 1, tool: 'google-tag-manager' });
    expect(line._aws.CloudWatchMetrics[0].Dimensions).toEqual([['Event']]);
  });
});
