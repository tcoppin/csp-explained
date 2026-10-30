import { directiveInfo, KEYWORDS } from './directives';
import type {
  Directive,
  HostParts,
  ParseIssue,
  ParseResult,
  Policy,
  PolicyOrigin,
  SourceExpression,
  Span,
} from './model';

interface RawPolicy {
  origin: PolicyOrigin;
  reportOnly: boolean;
  text: string;
}

const HEADER_LINE = /^\s*(content-security-policy(?:-report-only)?)\s*:\s*(.*)$/i;
const META_TAG = /<meta\b[^>]*>/gi;
// Console messages for a blocked resource (Chrome, Firefox, Safari). They name one rule, not the policy.
const VIOLATION =
  /violates\s+the\s+following\s+(?:content\s+security\s+policy\s+)?directive|directive\s+of\s+the\s+content\s+security\s+policy|content[- ]security[- ]policy:\s+the\s+page.s\s+settings\s+blocked/i;
const VIOLATED_DIRECTIVE = /directive:?\s*["“]([a-z-]+)|in\s+the\s+([a-z-]+)\s+directive|\(“?([a-z-]+)”?\)/i;

/**
 * Parses whatever the user pasted: a bare policy, one or more
 * `Content-Security-Policy[-Report-Only]: …` header lines (e.g. `curl -I` output),
 * or HTML containing `<meta http-equiv="Content-Security-Policy">` tags.
 */
export function parse(input: string): ParseResult {
  const issues: ParseIssue[] = [];
  const raws = extractPolicies(input);

  if (raws.every((r) => r.origin === 'raw') && VIOLATION.test(input)) {
    const m = VIOLATED_DIRECTIVE.exec(input);
    const directive = (m?.[1] ?? m?.[2] ?? m?.[3])?.toLowerCase();
    return { input, policies: [], issues: [{ code: 'empty-input', policyIndex: 0 }, { code: 'violation-message', policyIndex: 0, directive }] };
  }
  const policies = raws.map((raw, i) => parsePolicy(raw, i, issues));

  if (policies.length === 0 || policies.every((p) => p.directives.length === 0)) {
    issues.unshift({ code: 'empty-input', policyIndex: 0 });
  }
  return { input, policies, issues };
}

function extractPolicies(input: string): RawPolicy[] {
  const headers = input
    .split(/\r?\n/)
    // Firefox console errors also start with "Content-Security-Policy:".
    .filter((l) => !/<meta\b/i.test(l) && !VIOLATION.test(l))
    .map((l) => HEADER_LINE.exec(l))
    .filter((m) => m !== null)
    .flatMap((m) =>
      splitHeaderValue(m[2]!).map((text) => ({
        origin: 'header' as const,
        reportOnly: m[1]!.toLowerCase().endsWith('report-only'),
        text,
      })),
    );
  // Headers and <meta> tags can both be present (e.g. the find-my-csp snippet output).
  const found = [...headers, ...extractMetaPolicies(input)];
  if (found.length > 0) return found;

  return splitHeaderValue(input).map((text) => ({ origin: 'raw' as const, reportOnly: false, text }));
}

/** A header value can hold several policies separated by commas; every one is enforced. */
function splitHeaderValue(value: string): string[] {
  return value
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function extractMetaPolicies(input: string): RawPolicy[] {
  const result: RawPolicy[] = [];
  for (const [tag] of input.matchAll(META_TAG)) {
    const equiv = attribute(tag, 'http-equiv')?.toLowerCase();
    if (equiv !== 'content-security-policy' && equiv !== 'content-security-policy-report-only') continue;
    const content = attribute(tag, 'content');
    if (content === undefined) continue;
    result.push({
      origin: 'meta',
      reportOnly: equiv.endsWith('report-only'),
      text: decodeEntities(content).trim(),
    });
  }
  return result;
}

function attribute(tag: string, name: string): string | undefined {
  const re = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i');
  const m = re.exec(tag);
  return m ? (m[1] ?? m[2] ?? m[3]) : undefined;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function parsePolicy(raw: RawPolicy, policyIndex: number, issues: ParseIssue[]): Policy {
  const directives: Directive[] = [];
  const seen = new Set<string>();

  if (raw.origin === 'meta' && raw.reportOnly) {
    issues.push({ code: 'report-only-in-meta', policyIndex });
  }

  let offset = 0;
  for (const chunk of raw.text.split(';')) {
    const chunkStart = offset;
    offset += chunk.length + 1;

    const leading = chunk.length - chunk.trimStart().length;
    const trimmed = chunk.trim();
    if (trimmed === '') continue;

    const start = chunkStart + leading;
    const tokens = tokenize(trimmed, start);
    const [nameToken, ...valueTokens] = tokens;
    if (!nameToken) continue;

    const name = nameToken.text.toLowerCase();
    const info = directiveInfo(name);
    const duplicate = seen.has(name);
    seen.add(name);

    const directive: Directive = {
      name,
      span: { start, end: start + trimmed.length },
      nameSpan: nameToken.span,
      values: valueTokens.map((t) => classify(t.text, t.span, info?.valueType ?? 'tokens')),
      known: info !== undefined,
      duplicate,
    };
    directives.push(directive);

    if (!info) {
      issues.push({ code: 'unknown-directive', policyIndex, directive: name, span: nameToken.span });
    } else {
      if (info.deprecated) issues.push({ code: 'deprecated-directive', policyIndex, directive: name, span: nameToken.span });
      if (info.ignoredInMeta && raw.origin === 'meta') {
        issues.push({ code: 'ignored-in-meta', policyIndex, directive: name, span: nameToken.span });
      }
    }
    if (duplicate) issues.push({ code: 'duplicate-directive', policyIndex, directive: name, span: directive.span });
    collectValueIssues(directive, policyIndex, issues, info?.valueType);
  }

  return { origin: raw.origin, reportOnly: raw.reportOnly, text: raw.text, directives };
}

function collectValueIssues(d: Directive, policyIndex: number, issues: ParseIssue[], valueType?: string) {
  if (valueType === 'source-list' || valueType === 'ancestor-source-list') {
    if (d.values.length === 0) issues.push({ code: 'empty-directive', policyIndex, directive: d.name, span: d.span });
    if (d.values.length > 1 && d.values.some((v) => v.value === "'none'")) {
      issues.push({ code: 'none-with-other-sources', policyIndex, directive: d.name, span: d.span });
    }
  }
  for (const v of d.values) {
    if (v.kind === 'invalid') {
      issues.push({ code: 'invalid-source', policyIndex, directive: d.name, value: v.raw, span: v.span });
    } else if (v.kind === 'host' && KEYWORDS.has(`'${v.value}'`)) {
      // `self` without quotes is parsed by browsers as a host named "self".
      issues.push({ code: 'missing-quotes', policyIndex, directive: d.name, value: v.raw, span: v.span });
    }
  }
}

interface Token {
  text: string;
  span: Span;
}

function tokenize(s: string, base: number): Token[] {
  const tokens: Token[] = [];
  const re = /[^\t\n\f\r ]+/g;
  for (const m of s.matchAll(re)) {
    tokens.push({ text: m[0], span: { start: base + m.index, end: base + m.index + m[0].length } });
  }
  return tokens;
}

const NONCE = /^'nonce-[A-Za-z0-9+/\-_]+={0,2}'$/;
const HASH = /^'(sha256|sha384|sha512)-[A-Za-z0-9+/\-_]+={0,2}'$/i;
const SCHEME = /^[a-z][a-z0-9+.-]*:$/i;
const HOST_SOURCE =
  /^(?:([a-z][a-z0-9+.-]*):\/\/)?(\*|(?:\*\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*)(?::(\d+|\*))?(\/[^?#]*)?$/i;

export function classify(
  raw: string,
  span: Span,
  valueType: 'source-list' | 'ancestor-source-list' | 'tokens' | 'none' = 'source-list',
): SourceExpression {
  if (valueType === 'tokens' || valueType === 'none') {
    return { raw, kind: 'token', value: raw, span };
  }
  const lower = raw.toLowerCase();
  if (KEYWORDS.has(lower)) return { raw, kind: 'keyword', value: lower, span };
  if (NONCE.test(raw)) return { raw, kind: 'nonce', value: raw, span };
  if (HASH.test(raw)) return { raw, kind: 'hash', value: raw, span };
  if (SCHEME.test(raw)) return { raw, kind: 'scheme', value: lower, span };

  const host = parseHostSource(raw);
  if (host) return { raw, kind: 'host', value: lower, span, host };
  return { raw, kind: 'invalid', value: raw, span };
}

export function parseHostSource(raw: string): HostParts | undefined {
  const m = HOST_SOURCE.exec(raw);
  if (!m) return undefined;
  const parts: HostParts = { host: m[2]!.toLowerCase() };
  if (m[1]) parts.scheme = m[1].toLowerCase();
  if (m[3]) parts.port = m[3];
  if (m[4]) parts.path = m[4];
  return parts;
}

/**
 * The issues about one directive (or one of its values): matched by position, not by name, so a directive
 * repeated later in the policy doesn't share the warnings meant for its copies.
 */
export function issuesAt(issues: ParseIssue[], policyIndex: number, directive: Directive, value?: SourceExpression): ParseIssue[] {
  return issues.filter((i) => {
    if (i.policyIndex !== policyIndex || !i.span) return false;
    if (value) return i.span.start === value.span.start && i.span.end === value.span.end;
    return i.value === undefined && i.span.start >= directive.span.start && i.span.end <= directive.span.end;
  });
}

/**
 * One issue per kind of mistake, for the list of things to check: a directive written three times, or the
 * same invalid value in two policies, is one thing to fix and reads as the same sentence.
 */
export function distinctIssues(issues: ParseIssue[]): ParseIssue[] {
  const seen = new Set<string>();
  return issues.filter((i) => {
    const key = `${i.code}|${i.directive ?? ''}|${i.value ?? ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Splits a policy string into directives without any of the extraction heuristics. */
export function parseSinglePolicy(text: string, origin: PolicyOrigin = 'raw', reportOnly = false): Policy {
  return parsePolicy({ origin, reportOnly, text }, 0, []);
}
