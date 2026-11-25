import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { REPO_URL } from '../src/config';

/**
 * Versions come from commit titles (Conventional Commits, see CONTRIBUTING.md › Commit messages):
 *
 *   yarn tsx scripts/release.ts check <range>          fails on any commit in the range whose title doesn't follow it,
 *                                                      or that isn't signed off (from SIGN_OFF_FROM on)
 *   yarn tsx scripts/release.ts check-message <file>   the same for one message (the commit-msg hook)
 *   yarn tsx scripts/release.ts next [notes.md]        prints the next version and writes its notes, or prints nothing
 *
 * The deploy workflow runs `next` once the site is live, then tags and publishes the release.
 */

export const TYPES = ['feat', 'fix', 'perf', 'docs', 'chore', 'ci', 'test', 'refactor', 'style', 'build', 'revert'] as const;
export type CommitType = (typeof TYPES)[number];

export interface Commit {
  type: CommitType;
  scope?: string;
  breaking: boolean;
  summary: string;
  hash?: string;
}

const TITLE = new RegExp(`^(${TYPES.join('|')})(?:\\(([a-z0-9-]+)\\))?(!)?: (\\S.*)$`);

/** A commit title (and body, for the `BREAKING CHANGE:` footer), or undefined when it doesn't follow the convention. */
export function parseCommit(subject: string, body = ''): Commit | undefined {
  const m = TITLE.exec(subject.trim());
  if (!m) return undefined;
  const [, type, scope, bang, summary] = m;
  return {
    type: type as CommitType,
    ...(scope && { scope }),
    breaking: bang === '!' || /^BREAKING[ -]CHANGE: /m.test(body),
    summary: summary!.trim(),
  };
}

/** Messages git writes itself (merges, reverts, autosquash) are let through. */
export const isGitGenerated = (subject: string) => /^(Merge |Revert "|fixup! |squash! |amend! )/.test(subject);

type Bump = 'major' | 'minor' | 'patch';

function bumpOf(c: Commit): Bump | undefined {
  if (c.breaking) return 'major';
  if (c.type === 'feat') return 'minor';
  if (c.type === 'fix' || c.type === 'perf') return 'patch';
  return undefined;
}

/** The version after these commits, or undefined when none of them calls for a release (docs, chore, ci…). */
export function nextVersion(current: string, commits: Commit[]): string | undefined {
  const bumps = new Set(commits.map(bumpOf));
  const [major, minor, patch] = current.replace(/^v/, '').split('.').map(Number) as [number, number, number];
  if (bumps.has('major')) return `${major + 1}.0.0`;
  if (bumps.has('minor')) return `${major}.${minor + 1}.0`;
  if (bumps.has('patch')) return `${major}.${minor}.${patch + 1}`;
  return undefined;
}

const line = (c: Commit) => {
  const text = c.summary.charAt(0).toUpperCase() + c.summary.slice(1);
  return `- ${c.scope ? `**${c.scope}**: ` : ''}${text}${c.hash ? ` (${c.hash.slice(0, 7)})` : ''}`;
};

/** Release notes: breaking changes, new features and fixes; housekeeping commits are left out. */
export function releaseNotes(commits: Commit[], previousTag: string, nextTag: string): string {
  const sections: [string, Commit[]][] = [
    ['Breaking changes', commits.filter((c) => c.breaking)],
    ['New features', commits.filter((c) => !c.breaking && c.type === 'feat')],
    ['Fixes', commits.filter((c) => !c.breaking && (c.type === 'fix' || c.type === 'perf'))],
  ];
  const body = sections.filter(([, list]) => list.length > 0).map(([title, list]) => `## ${title}\n\n${list.map(line).join('\n')}`);
  return [...body, `**Full changelog**: ${REPO_URL}/compare/${previousTag}...${nextTag}`].join('\n\n') + '\n';
}

/**
 * Every commit authored from this day on (the author's own date) carries a `Signed-off-by:` line for its author: the
 * Developer Certificate of Origin (CONTRIBUTING.md). Older commits came before the rule.
 */
export const SIGN_OFF_FROM = '2026-11-25';

export interface GitCommit {
  hash: string;
  subject: string;
  body: string;
  authorName: string;
  authorEmail: string;
  /** ISO 8601, in the author's time zone. */
  authorDate: string;
}

/** Bots (Dependabot, GitHub Actions) can't certify anything: their commits need no sign-off. */
const isBot = (email: string) => /\[bot\]@users\.noreply\.github\.com$/i.test(email);

/** Whether the commit needs a sign-off and lacks one from its author (same e-mail address). */
export function missingSignOff(c: Omit<GitCommit, 'hash'>): boolean {
  if (c.authorDate.slice(0, 10) < SIGN_OFF_FROM || isBot(c.authorEmail) || isGitGenerated(c.subject)) return false;
  const signers = [...c.body.matchAll(/^Signed-off-by: .*<([^>]+)>\s*$/gm)].map((m) => m[1]!.toLowerCase());
  return !signers.includes(c.authorEmail.toLowerCase());
}

/** Commits in a git range, oldest first, without merges. */
function gitCommits(range: string): GitCommit[] {
  const out = execFileSync('git', ['log', '--no-merges', '--reverse', '--format=%H%x1f%s%x1f%an%x1f%ae%x1f%aI%x1f%b%x1e', range], { encoding: 'utf8' });
  return out
    .split('\x1e')
    .map((r) => r.trim())
    .filter(Boolean)
    .map((r) => {
      const [hash = '', subject = '', authorName = '', authorEmail = '', authorDate = '', body = ''] = r.split('\x1f');
      return { hash, subject, body, authorName, authorEmail, authorDate };
    });
}

const HELP = 'Commit titles follow `type(scope): summary`, e.g. `feat(catalogue): add Axeptio` (CONTRIBUTING.md › Commit messages).';
const SIGN_OFF_HELP = 'Sign off each commit with `git commit -s` (CONTRIBUTING.md › Commit messages); `git commit --amend -s --no-edit` fixes the last one.';

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  const [command, arg] = process.argv.slice(2);
  if (command === 'check' && arg) {
    const commits = gitCommits(arg);
    const bad = commits.filter((c) => !isGitGenerated(c.subject) && !parseCommit(c.subject, c.body));
    for (const c of bad) console.error(`✗ ${c.hash.slice(0, 7)} ${c.subject}`);
    if (bad.length > 0) console.error(HELP);
    const unsigned = commits.filter(missingSignOff);
    for (const c of unsigned) console.error(`✗ ${c.hash.slice(0, 7)} not signed off by ${c.authorName} <${c.authorEmail}>`);
    if (unsigned.length > 0) console.error(SIGN_OFF_HELP);
    if (bad.length + unsigned.length > 0) process.exit(1);
    console.log(`✓ commit titles follow the convention, and commits are signed off (${arg})`);
  } else if (command === 'check-message' && arg) {
    const [subject = '', ...rest] = readFileSync(arg, 'utf8').split('\n').filter((l) => !l.startsWith('#'));
    if (!isGitGenerated(subject) && !parseCommit(subject, rest.join('\n'))) {
      console.error(`✗ ${subject}\n${HELP}`);
      process.exit(1);
    }
    // The commit being made: its author is whoever git will record, dated now.
    const ident = /^(.*) <([^>]*)> (\d+)/.exec(execFileSync('git', ['var', 'GIT_AUTHOR_IDENT'], { encoding: 'utf8' }));
    const today = new Date().toLocaleDateString('sv');
    if (ident && missingSignOff({ subject, body: rest.join('\n'), authorName: ident[1]!, authorEmail: ident[2]!, authorDate: today })) {
      console.error(`✗ not signed off by ${ident[1]} <${ident[2]}>\n${SIGN_OFF_HELP}`);
      process.exit(1);
    }
  } else if (command === 'next') {
    const previous = execFileSync('git', ['describe', '--tags', '--abbrev=0', '--match', 'v*'], { encoding: 'utf8' }).trim();
    const commits = gitCommits(`${previous}..HEAD`).flatMap((c) => {
      const parsed = parseCommit(c.subject, c.body);
      return parsed ? [{ ...parsed, hash: c.hash }] : [];
    });
    const version = nextVersion(previous, commits);
    if (version) {
      writeFileSync(arg ?? 'notes.md', releaseNotes(commits, previous, `v${version}`));
      console.log(version);
    } else {
      console.error(`No release: no feat, fix or breaking commit since ${previous}.`);
    }
  } else {
    console.error('Usage: release.ts check <range> | check-message <file> | next [notes.md]');
    process.exit(2);
  }
}
