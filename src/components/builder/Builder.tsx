import { useEffect, useMemo, useRef } from 'preact/hooks';
import { translator, type Locale } from '../../i18n';
import type { ContentBundle } from '../../lib/content';
import type { Audience } from '../../lib/csp/model';
import { STEPS, type Step } from './build-state';
import { PolicyPreview, ReviewPanel, SitePanel, StartPanel, ToolsPanel } from './BuildPanels';
import { track } from '../../scripts/track';
import { I18n } from '../ui/i18n';
import { Rich } from '../ui/Rich';
import { Segmented } from '../ui/Segmented';
import { useBuilder } from './useBuilder';
// Shared view styles first, so the builder's own rules win when they tie
import '../ui/panels.css';
import '../policy/results.css';
import './builder.css';

const AUDIENCES: Audience[] = ['simple', 'developer', 'security'];

interface Props {
  content: ContentBundle;
  locale: Locale;
}

export default function Builder({ content, locale }: Props) {
  const t = useMemo(() => translator(locale), [locale]);
  const b = useBuilder(content, t);

  const audience = (
    <Segmented
      class="audience"
      label={t('audience.label')}
      items={AUDIENCES.map((a) => ({ id: a, label: t(`audience.${a}`), title: t(`audience.${a}Hint`) }))}
      value={b.audience}
      onChange={b.setAudience}
    >
      <span class="audience-label" aria-hidden="true">
        {t('audience.label')}
      </span>
    </Segmented>
  );
  const canContinue = b.start !== undefined && b.built.policy !== undefined;

  // Count one built policy per page load, when it is first shown.
  const counted = useRef(false);
  useEffect(() => {
    if (counted.current || b.step !== 'review' || !canContinue || !b.start) return;
    counted.current = true;
    track('build', { start: b.start });
  }, [b.step, canContinue, b.start]);
  const panel = (s: Step) =>
    s === 'start' ? <StartPanel b={b} /> : s === 'site' ? <SitePanel b={b} /> : s === 'tools' ? <ToolsPanel b={b} /> : <ReviewPanel b={b} content={content} />;
  const preview = (
    <aside class="builder-preview" aria-labelledby="preview-title">
      <h2 id="preview-title">{t('build.preview.title')}</h2>
      <PolicyPreview built={b.built} />
    </aside>
  );

  const { step } = b;
  const index = STEPS.indexOf(step);
  const next = STEPS[index + 1];
  const go = (s: Step) => {
    b.setStep(s);
    document.getElementById('builder')?.scrollIntoView({ block: 'start' });
  };

  return (
    <I18n.Provider value={t}>
      <div class={`builder step-${step}`} id="builder">
        <div class="builder-bar">
          <nav aria-label={t('build.steps.label')}>
            <ol class="steps">
              {STEPS.map((s, i) => (
                <li key={s}>
                  <button type="button" class="step" aria-current={s === step ? 'step' : undefined} disabled={i > 0 && !canContinue} onClick={() => go(s)}>
                    <span class="step-number">{i + 1}</span>
                    {t(`build.steps.${s}`)}
                  </button>
                </li>
              ))}
            </ol>
          </nav>
          {audience}
        </div>

        <div class="builder-grid">
          <section class="builder-step" aria-labelledby="step-title">
            <h2 id="step-title">{t(`build.steps.${step}Title`)}</h2>
            <p class="panel-intro">
              <Rich msg={`build.intro.${step}`} />
            </p>
            {panel(step)}
            <p class="step-nav">
              {index > 0 && (
                <button type="button" class="button quiet" onClick={() => go(STEPS[index - 1]!)}>
                  {t('build.back')}
                </button>
              )}
              {next && (
                <button type="button" class="button" disabled={!canContinue} onClick={() => go(next)}>
                  {t(`build.next.${next}`)}
                </button>
              )}
            </p>
          </section>
          {step !== 'review' && preview}
        </div>
      </div>
    </I18n.Provider>
  );
}
