import type { Field, Vendor } from './schema';

/**
 * Addresses that belong to the visitor's own account (`https://{account}.containers.piwik.pro`, `https://{server}`):
 * a tool's lines name them with a placeholder, and what the visitor types fills it in.
 *
 * The values travel with the picked features, as `field=value` tokens next to the feature ids
 * (`piwik-pro:tag-manager+account=acme`), so every link and list that carries the selection carries them too.
 * They live in the URL fragment and the visitor's browser only, like the policy.
 *
 * Kept apart from the schema so the browser bundle doesn't pull in YAML and zod.
 */

const LABEL = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
const HOST = /^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/;

export const isFieldToken = (token: string) => token.includes('=');

/** The values typed for a tool, by field id, from its selection tokens. */
export function fieldValues(selected: readonly string[] = []): Record<string, string> {
  const out: Record<string, string> = {};
  for (const token of selected.filter(isFieldToken)) {
    const at = token.indexOf('=');
    try {
      out[token.slice(0, at)] = decodeURIComponent(token.slice(at + 1));
    } catch {
      // A broken link: the field reads as empty.
    }
  }
  return out;
}

/** The selection with `field` set to what was typed (removed when empty). */
export function withFieldValue(selected: readonly string[], field: string, typed: string): string[] {
  const rest = selected.filter((token) => !(isFieldToken(token) && token.slice(0, token.indexOf('=')) === field));
  return typed.trim() === '' ? rest : [...rest, `${field}=${encodeURIComponent(typed)}`];
}

/** Every line a field fills in, as the catalogue writes it. */
const templatesOf = (vendor: Vendor) => vendor.features.flatMap((f) => f.requirements.flatMap((r) => r.templates ?? r.sources));

/**
 * What was typed, read as the field's value: a label (`acme`, or an address of the tool that contains it, such as
 * `acme.containers.piwik.pro`) or a host name (`matomo.shop.example`, `https://matomo.shop.example/`). Undefined when
 * it can't be read, or when nothing was typed.
 */
export function readField(vendor: Vendor, field: Field, typed: string | undefined): string | undefined {
  const text = (typed ?? '').trim().toLowerCase();
  if (!text) return undefined;
  let host = text.replace(/^[a-z][a-z0-9+.-]*:\/\//, '').replace(/[/?#].*$/, '').replace(/:\d+$/, '');
  if (field.kind === 'host') return HOST.test(host) ? host : undefined;
  if (LABEL.test(host)) return host;
  // An address of the tool's own: the label is what stands where the placeholder is.
  for (const template of templatesOf(vendor)) {
    const m = new RegExp(`^(?:[a-z]+://)?\\{${field.id}\\}(\\.[^/:]+)`).exec(template);
    if (m && host.endsWith(m[1]!)) {
      host = host.slice(0, -m[1]!.length);
      return LABEL.test(host) ? host : undefined;
    }
  }
  return undefined;
}

/**
 * The tool with its placeholders filled in. A field left empty (or unreadable) falls back to a wildcard for an
 * account name (`https://*.containers.piwik.pro`), and leaves the line out for a whole address, which can't be
 * guessed (the line stays, with no sources). Instead, `example` shows the field's example (the tool's own page), and
 * `choices` puts in every value the field lists (to recognise any of them in an address or a console message, as
 * the catalogue is loaded). The catalogue's lines stay in `templates`, so the tool can be filled in again.
 */
export function resolveVendor(vendor: Vendor, typed: Record<string, string> = {}, missing: 'default' | 'example' | 'choices' = 'default'): Vendor {
  if (!vendor.fields?.length) return vendor;
  const fields = new Map(vendor.fields.map((f) => [f.id, f]));
  /** What a placeholder becomes: one value, several (every choice), or none (the line waits). */
  const valuesOf = (id: string): string[] | undefined => {
    const field = fields.get(id);
    if (!field) return undefined;
    const value = readField(vendor, field, typed[id]);
    if (value !== undefined) return [value];
    if (missing === 'example') return [field.example];
    if (missing === 'choices' && field.options?.length) return field.options.map((o) => o.value);
    return field.kind === 'subdomain' ? ['*'] : [];
  };
  const fill = (template: string): string[] => {
    const m = /\{([a-z0-9-]+)\}/.exec(template);
    const values = m ? valuesOf(m[1]!) : undefined;
    if (!m || values === undefined) return [template];
    return values.flatMap((v) => fill(template.slice(0, m.index) + v + template.slice(m.index + m[0].length)));
  };
  return {
    ...vendor,
    features: vendor.features.map((f) => ({
      ...f,
      // A line waiting on an address stays, with no sources, so the tool can be filled in later.
      requirements: f.requirements.map((r) => {
        const templates = r.templates ?? r.sources;
        return { ...r, templates, sources: [...new Set(templates.flatMap(fill))] };
      }),
    })),
  };
}
