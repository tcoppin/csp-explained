import { describe, expect, it } from 'vitest';
import { isGitGenerated, nextVersion, parseCommit, releaseNotes, type Commit } from './release';

describe('parseCommit', () => {
  it('reads the type, scope and summary', () => {
    expect(parseCommit('feat(catalogue): add Axeptio')).toEqual({ type: 'feat', scope: 'catalogue', breaking: false, summary: 'add Axeptio' });
    expect(parseCommit('docs: split the README')).toEqual({ type: 'docs', breaking: false, summary: 'split the README' });
  });

  it('sees breaking changes in the title or in a footer', () => {
    expect(parseCommit('feat!: new share-link format')?.breaking).toBe(true);
    expect(parseCommit('fix(catalogue)!: rename the requirement types')?.breaking).toBe(true);
    expect(parseCommit('feat: new share-link format', 'Longer text.\n\nBREAKING CHANGE: old links stop working')?.breaking).toBe(true);
    expect(parseCommit('feat: mention a breaking change in passing', 'Not a BREAKING CHANGE: footer here')?.breaking).toBe(false);
  });

  it('refuses titles that do not follow the convention', () => {
    for (const title of ['Add Axeptio to the catalogue', 'feature: add Axeptio', 'feat:add Axeptio', 'feat(Catalogue): add Axeptio', 'feat: ', 'FEAT: add Axeptio']) {
      expect(parseCommit(title), title).toBeUndefined();
    }
  });

  it('lets messages written by git through', () => {
    expect(isGitGenerated('Merge pull request #12 from tcoppin/catalogue/vendor-docs-changed')).toBe(true);
    expect(isGitGenerated('Revert "feat: add Axeptio"')).toBe(true);
    expect(isGitGenerated('fixup! feat: add Axeptio')).toBe(true);
    expect(isGitGenerated('Add Axeptio')).toBe(false);
  });
});

const commit = (title: string, body = '') => parseCommit(title, body)!;

describe('nextVersion', () => {
  it('follows the biggest change since the last version', () => {
    expect(nextVersion('v1.1.0', [commit('fix: a typo'), commit('docs: readme')])).toBe('1.1.1');
    expect(nextVersion('v1.1.0', [commit('fix: a typo'), commit('feat: add a tool')])).toBe('1.2.0');
    expect(nextVersion('v1.1.3', [commit('feat: add a tool')])).toBe('1.2.0');
    expect(nextVersion('v1.1.3', [commit('feat: add a tool'), commit('fix: x', 'BREAKING CHANGE: y')])).toBe('2.0.0');
    expect(nextVersion('v1.1.0', [commit('perf: faster parser')])).toBe('1.1.1');
  });

  it('releases nothing for housekeeping alone', () => {
    expect(nextVersion('v1.1.0', [commit('docs: readme'), commit('chore: snapshots'), commit('ci: release job')])).toBeUndefined();
    expect(nextVersion('v1.1.0', [])).toBeUndefined();
  });
});

describe('releaseNotes', () => {
  it('lists breaking changes, features and fixes, leaving housekeeping out', () => {
    const commits: Commit[] = [
      { ...commit('feat(catalogue): add Axeptio'), hash: 'aa76bdd0000000' },
      { ...commit('docs: split the README'), hash: '464a91a0000000' },
      { ...commit('fix(i18n): keep the # part'), hash: 'c5af8ab0000000' },
      { ...commit('feat!: new share-link format'), hash: '97088ca0000000' },
    ];
    expect(releaseNotes(commits, 'v1.1.0', 'v2.0.0')).toBe(
      [
        '## Breaking changes',
        '',
        '- New share-link format (97088ca)',
        '',
        '## New features',
        '',
        '- **catalogue**: Add Axeptio (aa76bdd)',
        '',
        '## Fixes',
        '',
        '- **i18n**: Keep the # part (c5af8ab)',
        '',
        '**Full changelog**: https://github.com/tcoppin/csp-explained/compare/v1.1.0...v2.0.0',
        '',
      ].join('\n'),
    );
  });
});
