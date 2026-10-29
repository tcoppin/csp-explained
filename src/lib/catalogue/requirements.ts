import type { Requirement } from '../csp/compat';
import type { Feature } from './schema';

/**
 * Flattens a feature into one requirement per source expression.
 * Kept apart from the schema so the browser bundle doesn't pull in YAML and zod.
 */
export function requirementsOf(feature: Feature): Requirement[] {
  return feature.requirements.flatMap((r) =>
    r.sources.map((source) => ({ type: r.type, source, reason: r.reason, ...(r.probe ? { probe: r.probe } : {}) })),
  );
}
