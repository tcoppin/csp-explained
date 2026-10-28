export type Audience = 'simple' | 'developer' | 'security';

export type PolicyOrigin = 'header' | 'meta' | 'raw';

/** Half-open range [start, end) inside `Policy.text`. */
export interface Span {
  start: number;
  end: number;
}

export type SourceKind =
  | 'keyword' // 'self', 'unsafe-inline', ...
  | 'nonce' // 'nonce-abc'
  | 'hash' // 'sha256-abc'
  | 'scheme' // https:, data:
  | 'host' // *.example.com, https://cdn.example.com:443/path, *
  | 'token' // value of a directive that does not take a source list (sandbox flags, report-to group, ...)
  | 'invalid';

export interface HostParts {
  scheme?: string;
  host: string;
  port?: string;
  path?: string;
}

export interface SourceExpression {
  raw: string;
  kind: SourceKind;
  /** Lowercased value for keywords/schemes/hosts; untouched for nonces and hashes. */
  value: string;
  span: Span;
  host?: HostParts;
}

export interface Directive {
  /** Lowercased directive name. */
  name: string;
  span: Span;
  nameSpan: Span;
  values: SourceExpression[];
  /** False for directives the browser would ignore (unknown name). */
  known: boolean;
  /** True when a directive with the same name appeared earlier: browsers ignore it. */
  duplicate: boolean;
}

export interface Policy {
  origin: PolicyOrigin;
  reportOnly: boolean;
  /** The serialized policy as it was found (one policy, no header name). */
  text: string;
  directives: Directive[];
}

export type IssueCode =
  | 'empty-input'
  | 'violation-message'
  | 'unknown-directive'
  | 'duplicate-directive'
  | 'deprecated-directive'
  | 'ignored-in-meta'
  | 'missing-quotes'
  | 'invalid-source'
  | 'none-with-other-sources'
  | 'report-only-in-meta'
  | 'empty-directive';

export interface ParseIssue {
  code: IssueCode;
  policyIndex: number;
  directive?: string;
  value?: string;
  span?: Span;
}

export interface ParseResult {
  input: string;
  policies: Policy[];
  issues: ParseIssue[];
}
