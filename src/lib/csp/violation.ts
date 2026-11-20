import type { ResourceType } from './directives';

/**
 * Reads the messages browsers write in the console when a policy blocks (or, in report-only mode, would block)
 * something. Each names one rule, not the whole policy, but says enough to explain what happened and to write the
 * line that allows it.
 *
 * The wordings below were collected from the browsers themselves (Chromium 2026, WebKit 2026) and from Firefox's
 * message templates (`csp.properties`). Older Chrome wordings ("Refused to load the script …") are read too.
 */

export type BlockedKind = 'url' | 'inline-script' | 'inline-style' | 'style-attr' | 'inline-handler' | 'eval' | 'trusted-types';

/** What a page with `require-trusted-types-for 'script'` refused to take as plain text. */
export type TrustedType = 'TrustedHTML' | 'TrustedScript' | 'TrustedScriptURL';

export interface Violation {
  /** The message, as pasted (on one line). */
  text: string;
  kind: BlockedKind;
  /** What was blocked, for `kind: 'url'`: as the browser wrote it. */
  url?: string;
  /** The kind of resource, as in the catalogue and the matcher. */
  type: ResourceType;
  /** The rule the browser checked: the one whose value it quotes (often a fallback such as script-src or default-src). */
  directive?: string;
  /**
   * That rule as the browser quoted it, name included (Chrome and Firefox; Safari doesn't quote it). From a report,
   * the whole policy it carries: the line to change is computed on it.
   */
  value?: string;
  /** The rule meant for this kind of resource, when the browser names it (script-src-elem, img-src…). */
  effective?: string;
  /** The hash Chrome and Firefox compute for a blocked inline script or style. */
  hash?: string;
  /** For `kind: 'trusted-types'`: what the page asked for. */
  trustedType?: TrustedType;
  /** Where the code tried to put it, when Chrome's error that follows says so: `HTMLScriptElement.src`. */
  sink?: string;
  /** Report-only: nothing was blocked, the browser only reports it. */
  reportOnly: boolean;
  /** The same message pasted several times (browsers repeat them): counted once. */
  count: number;
}

// Where a message starts, so that several pasted together (a console copied whole) are read one by one.
const START = new RegExp(
  [
    String.raw`(?:\[Report Only\]\s*)?(?:(?:Uncaught\s+)?EvalError:\s*)?Refused to\b`,
    // Firefox; in report-only mode: "Content-Security-Policy: (Report-Only policy) The page’s settings would block…".
    String.raw`Content[- ]Security[- ]Policy:\s+(?:\(Report-Only policy\)\s+)?The page`,
    // Trusted Types: "This document requires 'TrustedHTML' assignment." (Chrome), "This requires a TrustedHTML
    // value else it violates…" (WebKit).
    // Not when Chrome's TypeError repeats it ("…'HTMLScriptElement': This document requires…"): that is the same one.
    String.raw`(?<!:\s)(?:\[Report Only\]\s*)?This (?:document )?requires (?:a |')Trusted`,
    // Chrome's current wording: the verb comes first, the address (with its dots) before "violates".
    String.raw`\b(?:Loading|Connecting to|Framing|Executing|Applying|Evaluating|Compiling|Creating|Sending|Setting|Navigating to|Running)\b(?=.{0,400}?\bviolates the following)`,
    // Noise browsers print around violations: starts of messages we then drop (Chrome and Safari, then Firefox).
    String.raw`\bFetch API cannot load\b`,
    String.raw`\bFailed to load resource\b`,
    String.raw`\bThe Content Security Policy '`,
    String.raw`\bLoading failed for the\b`,
    String.raw`\bSecurity Error:`,
    String.raw`\bCross-Origin Request Blocked:`,
    String.raw`\bdownloadable font:`,
  ].join('|'),
  'g',
);

// The rule's value, quoted: "script-src 'self'" (Chrome), “script-src 'self'” (Firefox, which sometimes closes with
// an opening quote: “require-trusted-types-for ’script’“), or between single quotes for inline code in Chrome:
// 'script-src 'self' 'nonce-abc''.
const QUOTED_VALUE = /directive[^"“]{0,120}?["“]([a-z][a-z-]*(?:\s[^"”“]*)?)["”“]/i;
const SINGLE_QUOTED_VALUE = /directive '([a-z][a-z-]*(?: .*?)?)'(?:\.\s|\.$|$)/i;
const NEITHER = /neither the ([a-z-]+) directive nor the ([a-z-]+) directive/i;
const IN_THE = /\bin the ([a-z-]+) directive/i;
const PARENTHESISED = /\(\s*["“]?([a-z]+-[a-z-]+)["”]?\s*\)/i;
const FALLBACK_NOTE = /Note (?:also )?that '([a-z-]+)' was not explicitly set, so '([a-z-]+)' is used as a fallback/i;
const HASH = /'(sha(?:256|384|512)-[A-Za-z0-9+/_-]{20,}={0,2})'/;
const QUOTED_URL = /['‘"“]((?:[a-z][a-z0-9+.-]*:\/\/|blob:|data:)[^'’"”\s]*)['’"”]/i;
const BARE_URL = /\b(?:at|load|to|from)\s+((?:https?|wss?|ftp|blob|data|[a-z-]+-extension):[^\s'"“”]+)/i;
const TRUSTED = /requires (?:a |')(Trusted(?:HTML|ScriptURL|Script))'?(?: value| assignment)/;
// Firefox doesn't name the type: "The page’s settings blocked assigning to an injection sink because it violates…".
const TRUSTED_FIREFOX = /settings (?:blocked|observed) assigning to an injection sink/i;
// Chrome's TypeError after the message: "Failed to set the 'src' property on 'HTMLScriptElement'", or
// "Failed to execute 'setTimeout' on 'Window'".
const SINK = /Failed to (?:set the '([\w$]+)' property|execute '([\w$]+)') on '([\w$]+)'/;
// Firefox's: "HTMLScriptElement.src setter: Sink type mismatch violation blocked by CSP", followed by where it
// happened ("trusted-types:18:145") when Firefox prints it apart from the message.
const FIREFOX_SINK = /\b([A-Z][\w$]*)\.([\w$]+)(?: setter)?: Sink type mismatch/;
const FIREFOX_SINK_AT = /\b([A-Z][\w$]*)\.([\w$]+)(?: setter)?: Sink type mismatch violation blocked by CSP\s+(\S+:\d+):\d+/g;
// Where Firefox's message happened: after the rule it quotes, "…“require-trusted-types-for ’script’“ trusted-types:18:53".
const MESSAGE_AT = /require-trusted-types-for[^“”"]*[“”"]\s+(\S+:\d+):\d+/;
const REPORT_ONLY = /\[Report Only\]|report-only|\bobserved (?:the|an?|assigning)\b|A CSP report is being sent/i;

/** What a sink takes, for Firefox, which names the sink but not the type: `HTMLScriptElement.src` takes a script URL. */
export function trustedTypeOf(sink: string): TrustedType | undefined {
  const [owner, member] = sink.split('.') as [string, string];
  if (/^(?:src|href)$/.test(member) && /Script/.test(owner)) return 'TrustedScriptURL';
  if (/^(?:importScripts|Worker|SharedWorker|register)$/.test(member)) return 'TrustedScriptURL';
  if (/^(?:innerHTML|outerHTML|srcdoc|insertAdjacentHTML|write|writeln|parseFromString|setHTMLUnsafe|createContextualFragment)$/.test(member)) return 'TrustedHTML';
  if (/^(?:text|textContent|innerText|eval|setTimeout|setInterval|Function)$/.test(member)) return 'TrustedScript';
  return undefined;
}

/** The kind of resource each rule is for (rules for several kinds left out). */
export const DIRECTIVE_TYPE: Record<string, ResourceType> = {
  'script-src': 'script',
  'script-src-elem': 'script',
  'style-src': 'style',
  'style-src-elem': 'style',
  'img-src': 'img',
  'font-src': 'font',
  'connect-src': 'connect',
  'frame-src': 'frame',
  'frame-ancestors': 'frame',
  'media-src': 'media',
  'object-src': 'object',
  'manifest-src': 'manifest',
  'worker-src': 'worker',
  'form-action': 'form',
  'base-uri': 'base',
};

// The words browsers use for each kind of resource, for rules that cover several (default-src, child-src).
const WORDS: [RegExp, ResourceType][] = [
  [/\bworker\b/i, 'worker'],
  [/\bstyle ?sheet\b/i, 'style'],
  [/\bscript\b/i, 'script'],
  [/\bimage\b/i, 'img'],
  [/\bfont\b/i, 'font'],
  [/\bconnect(?:ing)?\b/i, 'connect'],
  [/\bfram(?:e|ing)\b/i, 'frame'],
  [/\bmedia\b/i, 'media'],
  [/\bform data\b/i, 'form'],
  [/\bmanifest\b/i, 'manifest'],
  [/\b(?:plugin|object)\b/i, 'object'],
  [/\bbase URI\b/i, 'base'],
];

/** The messages in `input`, each read once; text that isn't a policy message (other console lines) is left out. */
export function parseViolations(input: string): Violation[] {
  const text = input.replace(/\s+/g, ' ').trim();
  // Firefox's Trusted Types errors, by file and line, for the messages printed apart from them.
  const sinksAt = new Map([...text.matchAll(FIREFOX_SINK_AT)].map((m) => [m[3]!, `${m[1]}.${m[2]}`]));
  const starts = [...text.matchAll(START)].map((m) => m.index);
  if (starts[0] !== 0) starts.unshift(0);
  const found = new Map<string, Violation>();
  starts.forEach((start, i) => {
    const v = readOne(text.slice(start, starts[i + 1]).trim(), sinksAt);
    if (!v) return;
    const key = `${v.kind}|${v.url ?? ''}|${v.directive ?? ''}|${v.value ?? ''}|${v.hash ?? ''}|${v.trustedType ?? ''}|${v.sink ?? ''}|${v.reportOnly}`;
    const same = found.get(key);
    if (same) same.count++;
    else found.set(key, v);
  });
  return [...found.values()];
}

function readOne(text: string, sinksAt: Map<string, string>): Violation | undefined {
  const trusted = TRUSTED.exec(text);
  if (trusted || TRUSTED_FIREFOX.test(text)) {
    const chromeSink = SINK.exec(text);
    const firefoxSink = FIREFOX_SINK.exec(text);
    const at = MESSAGE_AT.exec(text)?.[1];
    const sink = chromeSink
      ? `${chromeSink[3]}.${chromeSink[1] ?? chromeSink[2]}`
      : firefoxSink
        ? `${firefoxSink[1]}.${firefoxSink[2]}`
        : at
          ? sinksAt.get(at)
          : undefined;
    const trustedType = (trusted?.[1] as TrustedType | undefined) ?? (sink ? trustedTypeOf(sink) : undefined);
    return {
      text,
      kind: 'trusted-types',
      type: 'script',
      directive: 'require-trusted-types-for',
      ...(trustedType ? { trustedType } : {}),
      ...(sink ? { sink } : {}),
      reportOnly: REPORT_ONLY.test(text),
      count: 1,
    };
  }
  if (!/violates|does not appear in|appears in neither|settings (?:blocked|observed)/i.test(text)) return undefined;

  const quoted = QUOTED_VALUE.exec(text) ?? SINGLE_QUOTED_VALUE.exec(text);
  const value = quoted?.[1]?.trim();
  // The rest of the message, without the rule's value (which holds addresses and keywords of its own).
  const rest = quoted ? text.replace(quoted[1]!, ' ') : text;

  const neither = NEITHER.exec(rest);
  const note = FALLBACK_NOTE.exec(rest);
  // Firefox writes a rule in brackets: the one meant for the resource when it quotes the rule it checked
  // ("(script-src-elem) at https://… violates … “script-src 'self'”"), the rule it checked when it doesn't (older
  // versions: "at https://… (“script-src”)").
  const bracketed = PARENTHESISED.exec(rest)?.[1];
  const directive = (value?.split(' ')[0] ?? neither?.[2] ?? IN_THE.exec(rest)?.[1] ?? bracketed)?.toLowerCase();
  const effective = (neither?.[1] ?? note?.[1] ?? (value ? bracketed : undefined))?.toLowerCase();
  if (!directive && !effective) return undefined;

  const kind = kindOf(rest);
  // The first address in the message: quoted (Chrome) or not (Firefox, Safari).
  const url =
    kind === 'url'
      ? [QUOTED_URL.exec(rest), BARE_URL.exec(rest)]
          .filter((m) => m !== null)
          .sort((a, b) => a.index - b.index)[0]?.[1]
          ?.replace(/[.,;:]+$/, '')
      : undefined;
  if (kind === 'url' && !url) return undefined;

  return {
    text,
    kind,
    ...(url ? { url } : {}),
    type: kind === 'url' ? typeOf(rest, effective, directive) : kind,
    ...(directive ? { directive } : {}),
    ...(value ? { value } : {}),
    ...(effective && effective !== directive ? { effective } : {}),
    ...(kind !== 'url' && kind !== 'eval' && HASH.exec(rest) ? { hash: `'${HASH.exec(rest)![1]}'` } : {}),
    reportOnly: REPORT_ONLY.test(rest),
    count: 1,
  };
}

function kindOf(rest: string): Exclude<BlockedKind, 'trusted-types'> {
  // Not "event handlers" alone: Chrome's note about hashes mentions them for any inline code.
  if (/inline event handler|\ban event handler\b/i.test(rest)) return 'inline-handler';
  if (/evaluat\w* a string as JavaScript|JavaScript eval|WebAssembly|'unsafe-eval' is not an allowed source/i.test(rest)) return 'eval';
  if (/inline script|execute a script because its hash|an inline script/i.test(rest)) return 'inline-script';
  if (/inline style|apply a stylesheet because its hash|an inline style/i.test(rest)) {
    // A style="…" attribute, which a hash only reaches with 'unsafe-hashes': Chrome adds this note, Firefox names
    // the rule meant for it.
    return /hashes do not apply to event handlers, style attributes|\(style-src-attr\)/i.test(rest) ? 'style-attr' : 'inline-style';
  }
  return 'url';
}

function typeOf(rest: string, effective: string | undefined, directive: string | undefined): ResourceType {
  for (const name of [effective, directive]) if (name && DIRECTIVE_TYPE[name]) return DIRECTIVE_TYPE[name];
  // Only the words before the explanation describe what was blocked.
  const head = rest.split(/\bviolates\b|\bbecause\b/i)[0]!;
  return WORDS.find(([re]) => re.test(head))?.[1] ?? (directive === 'child-src' ? 'frame' : 'script');
}
