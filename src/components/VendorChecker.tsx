import { outdatedIssueUrl } from '../config';
import { t } from '../i18n';
import type { VendorCheck } from '../lib/analysis';
import type { Vendor } from '../lib/catalogue/schema';
import type { RequirementResult } from '../lib/csp/compat';
import type { Audience } from '../lib/csp/model';
import { ToolPicker } from './ToolPicker';

interface Props {
  vendors: Vendor[];
  /** vendor id → selected feature ids */
  selected: Record<string, string[]>;
  checks: VendorCheck[];
  audience: Audience;
  onChange: (selected: Record<string, string[]>) => void;
}

function requirementText(r: RequirementResult): string {
  const check = r.checks.find((c) => c.match.verdict === r.verdict) ?? r.checks[0];
  const directive = check?.match.directive?.name ?? check?.match.requested ?? '';
  if (r.verdict === 'allowed') {
    return check?.match.matchedBy
      ? t('vendors.requirement.allowed', { directive, source: check.match.matchedBy.raw })
      : t('vendors.requirement.allowedUnrestricted');
  }
  return t(`vendors.requirement.${r.verdict}`, { directive });
}

export function VendorChecker({ vendors, selected, checks, audience, onChange }: Props) {
  const toggleVendor = (id: string) => {
    const next = { ...selected };
    const vendor = vendors.find((v) => v.id === id);
    if (next[id]) delete next[id];
    else if (vendor) next[id] = vendor.features.filter((f) => f.default).map((f) => f.id);
    onChange(next);
  };

  const toggleFeature = (vendorId: string, featureId: string) => {
    const current = selected[vendorId] ?? [];
    const features = current.includes(featureId) ? current.filter((f) => f !== featureId) : [...current, featureId];
    onChange({ ...selected, [vendorId]: features });
  };

  return (
    <div class="vendors">
      <ToolPicker vendors={vendors} selected={Object.keys(selected)} onToggle={toggleVendor} />

      {checks.length === 0 && <p class="muted">{t('vendors.none')}</p>}

      {checks.map(({ vendor, results, verdict }) => (
        <section key={vendor.id} class={`vendor-result verdict-border-${verdict}`} aria-labelledby={`v-${vendor.id}`}>
          <header>
            <h3 id={`v-${vendor.id}`}>{vendor.name}</h3>
            <p class={`verdict verdict-${verdict}`}>{t(`vendors.verdict.${verdict}`)}</p>
          </header>

          {vendor.features.length > 1 && (
            <fieldset class="features">
              <legend>{t('vendors.features')}</legend>
              {vendor.features.map((f) => (
                <label key={f.id}>
                  <input type="checkbox" checked={selected[vendor.id]?.includes(f.id)} onChange={() => toggleFeature(vendor.id, f.id)} />{' '}
                  {f.label}
                </label>
              ))}
            </fieldset>
          )}

          <ul class="requirements">
            {results.map((r, i) => (
              <li key={i} class={`req req-${r.verdict}`}>
                <span class="req-what">
                  {t(`resources.${r.requirement.type}`)} <code>{r.requirement.source}</code>
                </span>
                <span class="req-why">
                  {audience === 'simple' ? r.requirement.reason : requirementText(r)}
                </span>
              </li>
            ))}
          </ul>

          {verdict === 'needs-nonce' && vendor.nonce?.how && (
            <p class="nonce-how">
              <strong>{t('vendors.nonceHow')}:</strong> {vendor.nonce.how}
            </p>
          )}
          {vendor.notes && <p class="muted">{vendor.notes}</p>}

          <p class="provenance muted">
            {vendor.confidence === 'verified' ? t('vendors.verified', { date: vendor.lastVerified }) : t('vendors.partial')}.{' '}
            {vendor.sources.map((s, i) => (
              <a key={s} href={s} rel="noopener noreferrer" target="_blank">
                {t('vendors.sources')}
                {vendor.sources.length > 1 ? ` ${i + 1}` : ''}
              </a>
            ))}{' '}
            ·{' '}
            <a href={outdatedIssueUrl(vendor.id, vendor.name)} rel="noopener noreferrer" target="_blank">
              {t('vendors.reportOutdated')}
            </a>
          </p>
        </section>
      ))}
    </div>
  );
}
