/**
 * Everything this site keeps in the visitor's browser (localStorage, no cookies), keyed `csp-explained:<name>`.
 * The About page lists each one from here, and a test fails on a key the code uses that isn't listed.
 *
 * Each is written only after the visitor does something that needs it: a choice they make (theme, audience), or a
 * feature they turn on (the history). Never automatically: EU ePrivacy rules require consent for storage that isn't
 * strictly needed for what the visitor asked. Nothing here is ever sent anywhere.
 */
export const STORED = ['theme', 'language-note', 'audience', 'diff-layout', 'tools', 'recent-on', 'recent'] as const;

export type Stored = (typeof STORED)[number];

export const storageKey = (name: Stored) => `csp-explained:${name}`;
