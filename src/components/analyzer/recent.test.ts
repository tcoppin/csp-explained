import { describe, expect, it } from 'vitest';
import { keepsRecent, readRecent, RECENT_LIMIT, upsertRecent, type RecentAnalysis } from './recent';

const entry = (id: string, policy: string, site = ''): RecentAnalysis => ({
  id,
  policy,
  site,
  vendors: {},
  view: 'read',
  audience: 'simple',
  savedAt: 0,
});

describe('recent analyses', () => {
  it('puts the latest first, replacing the same analysis or the same policy and site', () => {
    const list = [entry('a', "img-src 'self'"), entry('b', "script-src 'self'")];
    expect(upsertRecent(list, entry('c', 'default-src https:')).map((e) => e.id)).toEqual(['c', 'a', 'b']);
    // Same id: the analysis being edited.
    expect(upsertRecent(list, entry('b', "script-src 'none'")).map((e) => e.policy)).toEqual(["script-src 'none'", "img-src 'self'"]);
    // Same policy and site under another id: pasted again.
    expect(upsertRecent(list, entry('c', " img-src 'self' ")).map((e) => e.id)).toEqual(['c', 'b']);
    // Another site is another analysis.
    expect(upsertRecent(list, entry('c', "img-src 'self'", 'shop.example.com'))).toHaveLength(3);
  });

  it(`keeps the last ${RECENT_LIMIT}`, () => {
    let list: RecentAnalysis[] = [];
    for (let i = 0; i < RECENT_LIMIT + 3; i++) list = upsertRecent(list, entry(`${i}`, `img-src https://${i}.example`));
    expect(list).toHaveLength(RECENT_LIMIT);
    expect(list[0]?.id).toBe(`${RECENT_LIMIT + 2}`);
  });

  it('reads back only what makes sense', () => {
    const stored = [
      { id: 'a', policy: "img-src 'self'", site: 'x.example', vendors: { hotjar: ['tracking', 3] }, view: 'tools', audience: 'security', savedAt: 5 },
      { id: 'b', policy: "img-src 'none'", view: 'nope', audience: 'nope' },
      { id: 'c', policy: ' ' },
      { policy: "img-src 'self'" },
      'junk',
    ];
    expect(readRecent(stored)).toEqual([
      { id: 'a', policy: "img-src 'self'", site: 'x.example', vendors: { hotjar: ['tracking'] }, view: 'tools', audience: 'security', savedAt: 5 },
      { id: 'b', policy: "img-src 'none'", site: '', vendors: {}, view: 'read', audience: 'simple', savedAt: 0 },
    ]);
    expect(readRecent({ id: 'a' })).toEqual([]);
  });

  it("doesn't keep empty or oversized texts", () => {
    expect(keepsRecent('  ')).toBe(false);
    expect(keepsRecent("img-src 'self'")).toBe(true);
    expect(keepsRecent('x'.repeat(50_000))).toBe(false);
  });
});
