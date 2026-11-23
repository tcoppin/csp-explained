import { fieldValues, readField, withFieldValue } from '../../lib/catalogue/fields';
import type { Vendor } from '../../lib/catalogue/schema';
import { useT } from '../ui/i18n';
import './tool-fields.css';

interface Props {
  /** The tool as the catalogue has it (its lines may already be filled in: only `fields` is read). */
  vendor: Vendor;
  /** The tool's selection: feature ids and `field=value` tokens. */
  selected: readonly string[];
  onChange: (next: string[]) => void;
}

/**
 * The addresses of the visitor's own account a tool's lines need (Piwik PRO's organisation name, a Matomo server):
 * one field each, after the features (a list to pick from when the vendor documents the values). What is typed stays in the page and its link, like the policy.
 */
export function ToolFields({ vendor, selected, onChange }: Props) {
  const t = useT();
  if (!vendor.fields?.length) return null;
  const typed = fieldValues(selected);
  return (
    <div class="tool-fields">
      {vendor.fields.map((field) => {
        const id = `field-${vendor.id}-${field.id}`;
        const value = typed[field.id] ?? '';
        const invalid = value.trim() !== '' && readField(vendor, field, value) === undefined;
        const described = [field.description && `${id}-hint`, invalid && `${id}-error`].filter(Boolean).join(' ');
        return (
          <p key={field.id} class="tool-field">
            <label for={id}>{field.label}</label>
            {field.description && (
              <span class="tool-field-hint" id={`${id}-hint`}>
                {field.description}
              </span>
            )}
            {field.options ? (
              <select
                id={id}
                value={value}
                aria-describedby={described || undefined}
                onChange={(e) => onChange(withFieldValue(selected, field.id, (e.target as HTMLSelectElement).value))}
              >
                <option value="">{t('vendors.fieldChoose')}</option>
                {field.options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
                {/* A value from an older link that the list no longer has: shown as it is rather than lost. */}
                {value && !field.options.some((o) => o.value === value) && <option value={value}>{value}</option>}
              </select>
            ) : (
              <input
                id={id}
                type="text"
                inputMode="url"
                autoComplete="off"
                spellcheck={false}
                placeholder={field.example}
                value={value}
                aria-invalid={invalid || undefined}
                aria-describedby={described || undefined}
                onInput={(e) => onChange(withFieldValue(selected, field.id, (e.target as HTMLInputElement).value))}
              />
            )}
            {invalid && (
              <span class="tool-field-error" id={`${id}-error`}>
                {t('vendors.fieldInvalid')}
              </span>
            )}
          </p>
        );
      })}
    </div>
  );
}
