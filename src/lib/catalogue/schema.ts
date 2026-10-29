import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import { EFFECTIVE_DIRECTIVE, type ResourceType } from '../csp/directives';

const RESOURCE_TYPES = Object.keys(EFFECTIVE_DIRECTIVE) as [ResourceType, ...ResourceType[]];

const RequirementSchema = z.object({
  type: z.enum(RESOURCE_TYPES),
  sources: z.array(z.string().min(1)).min(1),
  reason: z.string().min(1),
  probe: z.url().optional(),
});

const FeatureSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  label: z.string().min(1),
  description: z.string().optional(),
  /** Pre-selected when the vendor is picked. */
  default: z.boolean().default(false),
  requirements: z.array(RequirementSchema).min(1),
});

export const VendorSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(1),
  category: z.enum(['tag-management', 'analytics', 'advertising', 'experimentation', 'session-replay', 'consent', 'chat', 'other']),
  website: z.url(),
  /** Official documentation every requirement comes from. */
  sources: z.array(z.url()).min(1),
  lastVerified: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** `partial`: the official page could not be fully read; entries may be incomplete. */
  confidence: z.enum(['verified', 'partial']),
  nonce: z
    .object({
      supported: z.boolean(),
      how: z.string().optional(),
    })
    .optional(),
  notes: z.string().optional(),
  features: z.array(FeatureSchema).min(1),
});

export type Vendor = z.infer<typeof VendorSchema>;
export type Feature = Vendor['features'][number];

export function parseVendor(yamlText: string): Vendor {
  return VendorSchema.parse(parseYaml(yamlText));
}
