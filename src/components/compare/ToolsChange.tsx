import type { Vendor } from '../../lib/catalogue/schema';
import type { VendorChange } from '../../lib/comparison';
import type { Audience } from '../../lib/csp/model';
import { track } from '../../scripts/track';
import { ToolPicker } from '../policy/ToolPicker';
import { NewTabLink } from '../ui/NewTabLink';
import { useT } from '../ui/i18n';

interface Props {
  vendors: Vendor[];
  /** vendor id → selected feature ids */
  selected: Record<string, string[]>;
  changes: VendorChange[];
  audience: Audience;
  onChange: (selected: Record<string, string[]>) => void;
}

/** Each tool picked: does it work after the change, and what changed for it. */
export function ToolsChange({ vendors, selected, changes, audience, onChange }: Props) {
  const t = useT();
  const toggleVendor = (id: string) => {
    const next = { ...selected };
    const vendor = vendors.find((v) => v.id === id);
    if (next[id]) delete next[id];
    else if (vendor) {
      next[id] = vendor.features.filter((f) => f.default).map((f) => f.id);
      track('tool', { tool: id });
    }
    onChange(next);
  };
  const toggleFeature = (vendorId: string, featureId: string) => {
    const current = selected[vendorId] ?? [];
    onChange({ ...selected, [vendorId]: current.includes(featureId) ? current.filter((f) => f !== featureId) : [...current, featureId] });
  };

  return (
    <div class="vendors">
      <ToolPicker vendors={vendors} selected={Object.keys(selected)} onToggle={toggleVendor} />
      {changes.length === 0 && <p class="muted">{t('compare.tools.none')}</p>}
      {changes.map(({ vendor, verdictBefore, verdictAfter, requirements }) => {
        const moved = requirements.filter((r) => r.trend !== 'same');
        return (
          <section key={vendor.id} class={`vendor-result verdict-border-${verdictAfter}`} aria-labelledby={`v-${vendor.id}`}>
            <header>
              <h3 id={`v-${vendor.id}`}>{vendor.name}</h3>
              <p class={`verdict verdict-${verdictAfter}`}>{t(`vendors.verdict.${verdictAfter}`)}</p>
              <p class="was">
                {moved.length === 0 ? t('compare.tools.same') : t('compare.tools.was', { verdict: t(`vendors.verdict.${verdictBefore}`) })}
              </p>
            </header>

            {vendor.features.length > 1 && (
              <fieldset class="features">
                <legend>{t('vendors.features')}</legend>
                {vendor.features.map((f) => (
                  <label key={f.id}>
                    <input type="checkbox" checked={selected[vendor.id]?.includes(f.id)} onChange={() => toggleFeature(vendor.id, f.id)} /> {f.label}
                  </label>
                ))}
              </fieldset>
            )}

            {moved.length > 0 && (
              <ul class="requirements">
                {moved.map((r, i) => (
                  <li key={i} class={`req req-${r.after.verdict}`}>
                    <span class="req-what">
                      {t(`resources.${r.after.requirement.type}`)} <code>{r.after.requirement.source}</code>
                    </span>
                    <span class="req-why">
                      {audience === 'simple' && r.after.requirement.reason}
                      <span class="was">{t('compare.tools.was', { verdict: t(`vendors.verdict.${r.before.verdict}`) })}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}

            <p class="provenance muted">
              {vendor.sources.map((s, i) => (
                <NewTabLink key={s} href={s} label={t('vendors.sources') + (vendor.sources.length > 1 ? ` ${i + 1}` : '')} />
              ))}
            </p>
          </section>
        );
      })}
    </div>
  );
}
