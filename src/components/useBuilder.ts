import { useEffect, useMemo, useState } from 'preact/hooks';
import type { Translate } from '../i18n';
import { DEFAULT_ORIGIN } from '../lib/analysis';
import { baselinePolicy, buildPolicy, customContribution, siteContribution, type Contribution, type CustomTool, type SiteNeed } from '../lib/build';
import { requirementsOf } from '../lib/catalogue/requirements';
import type { ContentBundle } from '../lib/content';
import type { Audience } from '../lib/csp/model';
import { track } from '../scripts/track';
import { decodeBuildState, encodeBuildState, loadTools, saveTools, type Start, type Step } from './build-state';
import { loadAudience, saveAudience, toOrigin } from './state';

/** The builder's state, kept in the link, and the policy built from it. */
export function useBuilder(content: ContentBundle, t: Translate) {
  const [start, setStart] = useState<Start | undefined>();
  const [policyText, setPolicyText] = useState('');
  const [site, setSite] = useState('');
  const [needs, setNeeds] = useState<SiteNeed[]>([]);
  const [vendors, setVendors] = useState<Record<string, string[]>>({});
  const [tools, setTools] = useState<CustomTool[]>([]);
  /** Own tools remembered in this browser. */
  const [library, setLibrary] = useState<CustomTool[]>([]);
  /** The tool whose details start open: the last one picked or described. */
  const [lastPicked, setLastPicked] = useState<string | undefined>();
  const [step, setStep] = useState<Step>('start');
  const [audience, setAudienceState] = useState<Audience>('simple');

  // Restore from the link, the remembered audience and the tools saved in this browser, once.
  useEffect(() => {
    const s = decodeBuildState(location.hash);
    setAudienceState(s.audience ?? loadAudience());
    if (s.start) setStart(s.start);
    if (s.policy) setPolicyText(s.policy);
    if (s.site) setSite(s.site);
    if (s.needs) setNeeds(s.needs);
    if (s.vendors) setVendors(s.vendors);
    if (s.tools) setTools(s.tools);
    if (s.step) setStep(s.step);
    setLibrary(loadTools());
  }, []);

  useEffect(() => {
    const hash = encodeBuildState({ start, policy: policyText, site, needs, vendors, tools, step, audience });
    history.replaceState(null, '', hash ? `#${hash}` : location.pathname);
  }, [start, policyText, site, needs, vendors, tools, step, audience]);

  const origin = toOrigin(site) ?? DEFAULT_ORIGIN;
  const baseText = start === 'policy' ? policyText : baselinePolicy(start ?? 'allowlist');
  // In the order they were picked.
  const picked = Object.keys(vendors).flatMap((id) => content.vendors.filter((v) => v.id === id));

  const built = useMemo(() => {
    const contributions: Contribution[] = [
      { ...siteContribution(needs), by: { kind: 'site', id: 'site', label: t('build.site.you') } },
      ...picked.map((v) => ({
        by: { kind: 'vendor' as const, id: v.id, label: v.name },
        requirements: v.features.filter((f) => vendors[v.id]?.includes(f.id)).flatMap(requirementsOf),
      })),
      ...tools.map(customContribution),
    ];
    return buildPolicy(baseText, contributions, origin);
  }, [baseText, needs, vendors, tools, origin, t]);

  // Every own tool known here, from this browser and from the link, once per name; ids follow this order.
  const ownTools = [...library, ...tools]
    .filter((tool, i, all) => all.findIndex((x) => x.name === tool.name) === i)
    .map((tool, i) => ({ ...(tools.find((x) => x.name === tool.name) ?? tool), id: `own-${i + 1}` }));
  const ownId = (name: string) => ownTools.find((x) => x.name === name)?.id ?? '';
  const reindex = (list: Omit<CustomTool, 'id'>[]) => list.map((tool, i) => ({ ...tool, id: `custom-${i + 1}` }));
  const remember = (next: CustomTool[]) => {
    saveTools(next);
    setLibrary(next);
  };

  return {
    start,
    setStart,
    policyText,
    setPolicyText,
    site,
    setSite,
    needs,
    toggleNeed: (need: SiteNeed) => setNeeds(needs.includes(need) ? needs.filter((n) => n !== need) : [...needs, need]),
    vendors,
    allVendors: content.vendors,
    picked,
    /** Picks or drops a catalogue tool or an own tool (`own-…`), as listed in the tool picker. */
    toggleTool: (id: string) => {
      const own = ownTools.find((x) => x.id === id);
      if (own) {
        const picked = tools.some((x) => x.name === own.name);
        setTools(reindex(picked ? tools.filter((x) => x.name !== own.name) : [...tools, own]));
        if (!picked) setLastPicked(id);
        return;
      }
      const next = { ...vendors };
      const vendor = content.vendors.find((v) => v.id === id);
      if (next[id]) delete next[id];
      else if (vendor) {
        next[id] = vendor.features.filter((f) => f.default).map((f) => f.id);
        setLastPicked(id);
        track('tool', { tool: id });
      }
      setVendors(next);
    },
    toggleFeature: (vendorId: string, featureId: string) => {
      const current = vendors[vendorId] ?? [];
      setVendors({ ...vendors, [vendorId]: current.includes(featureId) ? current.filter((f) => f !== featureId) : [...current, featureId] });
    },
    /** Own tools in this policy. */
    tools,
    ownTools,
    ownId,
    selectedTools: [...Object.keys(vendors), ...tools.map((x) => ownId(x.name))],
    lastPicked,
    /** Adds a described tool to the policy, or replaces the one named `previous`, and remembers it here. */
    saveOwn: (tool: Omit<CustomTool, 'id'>, previous?: string) => {
      const replaced = previous !== undefined && tools.some((x) => x.name === previous);
      setTools(reindex(replaced ? tools.map((x) => (x.name === previous ? tool : x)) : [...tools.filter((x) => x.name !== tool.name), tool]));
      remember(reindex([tool, ...library.filter((x) => x.name !== tool.name && x.name !== previous)]));
      setLastPicked(undefined);
    },
    removeOwn: (name: string) => setTools(reindex(tools.filter((x) => x.name !== name))),
    /** Own tools are remembered in this browser. */
    hasLibrary: library.length > 0,
    forgetLibrary: () => remember([]),
    step,
    setStep,
    audience,
    setAudience: (a: Audience) => {
      setAudienceState(a);
      saveAudience(a);
    },
    origin,
    built,
    placedBy: (kind: string, id: string) => built.requirements.filter((p) => p.by.kind === kind && p.by.id === id),
  };
}

export type BuilderModel = ReturnType<typeof useBuilder>;
