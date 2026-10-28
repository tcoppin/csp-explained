/**
 * Registry of directives defined by CSP Level 3 (plus a few still seen in the wild),
 * with how their values are parsed and how they fall back to one another.
 */

export type DirectiveCategory = 'fetch' | 'document' | 'navigation' | 'reporting' | 'other';

export type ValueType =
  | 'source-list' // 'self' https://cdn.example.com ...
  | 'ancestor-source-list' // frame-ancestors: hosts/schemes/'self'/'none' only
  | 'tokens' // sandbox flags, trusted-types policy names, report-to group, URLs ...
  | 'none'; // upgrade-insecure-requests takes no value

export interface DirectiveInfo {
  name: string;
  category: DirectiveCategory;
  valueType: ValueType;
  /** Directives consulted, in order, when this one is absent (excluding itself). */
  fallback: string[];
  deprecated?: boolean;
  /** Browsers ignore it when the policy is delivered through a <meta> tag. */
  ignoredInMeta?: boolean;
}

const D = (
  name: string,
  category: DirectiveCategory,
  valueType: ValueType,
  fallback: string[] = [],
  extra: Partial<DirectiveInfo> = {},
): DirectiveInfo => ({ name, category, valueType, fallback, ...extra });

const LIST: DirectiveInfo[] = [
  // Fetch directives
  D('default-src', 'fetch', 'source-list'),
  D('child-src', 'fetch', 'source-list', ['default-src']),
  D('connect-src', 'fetch', 'source-list', ['default-src']),
  D('font-src', 'fetch', 'source-list', ['default-src']),
  D('frame-src', 'fetch', 'source-list', ['child-src', 'default-src']),
  D('img-src', 'fetch', 'source-list', ['default-src']),
  D('manifest-src', 'fetch', 'source-list', ['default-src']),
  D('media-src', 'fetch', 'source-list', ['default-src']),
  D('object-src', 'fetch', 'source-list', ['default-src']),
  D('script-src', 'fetch', 'source-list', ['default-src']),
  D('script-src-elem', 'fetch', 'source-list', ['script-src', 'default-src']),
  D('script-src-attr', 'fetch', 'source-list', ['script-src', 'default-src']),
  D('style-src', 'fetch', 'source-list', ['default-src']),
  D('style-src-elem', 'fetch', 'source-list', ['style-src', 'default-src']),
  D('style-src-attr', 'fetch', 'source-list', ['style-src', 'default-src']),
  D('worker-src', 'fetch', 'source-list', ['child-src', 'script-src', 'default-src']),
  D('prefetch-src', 'fetch', 'source-list', ['default-src'], { deprecated: true }),
  // Document directives
  D('base-uri', 'document', 'source-list'),
  D('sandbox', 'document', 'tokens', [], { ignoredInMeta: true }),
  // Navigation directives
  D('form-action', 'navigation', 'source-list'),
  D('frame-ancestors', 'navigation', 'ancestor-source-list', [], { ignoredInMeta: true }),
  // Reporting directives
  D('report-uri', 'reporting', 'tokens', [], { deprecated: true, ignoredInMeta: true }),
  D('report-to', 'reporting', 'tokens', [], { ignoredInMeta: true }),
  // Other
  D('upgrade-insecure-requests', 'other', 'none'),
  D('block-all-mixed-content', 'other', 'none', [], { deprecated: true }),
  D('require-trusted-types-for', 'other', 'tokens'),
  D('trusted-types', 'other', 'tokens'),
  D('webrtc', 'other', 'tokens'),
  D('plugin-types', 'other', 'tokens', [], { deprecated: true }),
  D('navigate-to', 'navigation', 'source-list', [], { deprecated: true }),
  D('require-sri-for', 'other', 'tokens', [], { deprecated: true }),
];

export const DIRECTIVES: ReadonlyMap<string, DirectiveInfo> = new Map(LIST.map((d) => [d.name, d]));

export function directiveInfo(name: string): DirectiveInfo | undefined {
  return DIRECTIVES.get(name.toLowerCase());
}

/** Resource types a page can load, mapped to the directive the browser checks first. */
export type ResourceType =
  | 'script'
  | 'style'
  | 'img'
  | 'font'
  | 'connect'
  | 'frame'
  | 'media'
  | 'object'
  | 'manifest'
  | 'worker'
  | 'form'
  | 'base'
  | 'inline-script' // <script>…</script> blocks
  | 'inline-handler' // onclick="…" attributes
  | 'eval' // eval(), new Function(), setTimeout("string")
  | 'inline-style' // <style>…</style> blocks
  | 'style-attr'; // style="…" attributes

export const EFFECTIVE_DIRECTIVE: Record<ResourceType, string> = {
  script: 'script-src-elem',
  style: 'style-src-elem',
  img: 'img-src',
  font: 'font-src',
  connect: 'connect-src',
  frame: 'frame-src',
  media: 'media-src',
  object: 'object-src',
  manifest: 'manifest-src',
  worker: 'worker-src',
  form: 'form-action',
  base: 'base-uri',
  'inline-script': 'script-src-elem',
  'inline-handler': 'script-src-attr',
  eval: 'script-src',
  'inline-style': 'style-src-elem',
  'style-attr': 'style-src-attr',
};

/**
 * The directive people usually write for a resource type. When a policy only has
 * default-src, this is the directive we suggest creating rather than widening default-src.
 */
export const CANONICAL_DIRECTIVE: Record<ResourceType, string> = {
  ...EFFECTIVE_DIRECTIVE,
  script: 'script-src',
  style: 'style-src',
  'inline-script': 'script-src',
  'inline-handler': 'script-src',
  'inline-style': 'style-src',
  'style-attr': 'style-src',
};

export const KEYWORDS = new Set([
  "'self'",
  "'none'",
  "'unsafe-inline'",
  "'unsafe-eval'",
  "'strict-dynamic'",
  "'unsafe-hashes'",
  "'report-sample'",
  "'wasm-unsafe-eval'",
  "'unsafe-allow-redirects'",
  "'inline-speculation-rules'",
  "'trusted-types-eval'",
  "'report-sha256'",
  "'report-sha384'",
  "'report-sha512'",
]);

