import { explainSource, type ContentBundle } from '../../lib/content';
import { EFFECTIVE_DIRECTIVE, type ResourceType } from '../../lib/csp/directives';
import { findDirective, resolve } from '../../lib/csp/fallback';
import { checkResource, ignoredSources, sourceApplies } from '../../lib/csp/matcher';
import type { Audience, Policy } from '../../lib/csp/model';
import { highlightClass } from '../policy/PolicyView';
import { useT } from '../ui/i18n';

const LOADED: ResourceType[] = ['script', 'style', 'img', 'font', 'connect', 'frame', 'media', 'worker', 'object', 'form', 'base'];
const BEHAVIOURS: ResourceType[] = ['inline-script', 'inline-handler', 'eval', 'inline-style'];

interface Props {
  policy: Policy;
  origin: string;
  audience: Audience;
  content: ContentBundle;
}

/** For each kind of content, where the browser accepts it from, in plain words. */
export function AllowMap({ policy, origin, audience, content }: Props) {
  const t = useT();
  return (
    <table class="allow-map">
      <caption class="visually-hidden">{t('map.title')}</caption>
      <tbody>
        {LOADED.map((type) => {
          const { governing } = resolve(policy, EFFECTIVE_DIRECTIVE[type]);
          const values = governing ? governing.values.filter((v) => sourceApplies(v, type)) : [];
          const none = governing && (values.length === 0 || values.every((v) => v.value === "'none'"));
          const ignored = governing ? ignoredSources(governing, type) : [];
          return (
            <tr key={type}>
              <th scope="row">{t(`resources.${type}`)}</th>
              <td>
                {!governing ? (
                  <span class="verdict-unrestricted">{t('map.notRestricted')}</span>
                ) : none ? (
                  <span class="verdict-none">{t('map.nothing')}</span>
                ) : (
                  <ul class="chips">
                    {values.map((v, i) =>
                      ignored.includes(v) ? (
                        <li key={i} class="chip-ignored">
                          <code class={`tok ${highlightClass(v)}`}>{v.raw}</code>
                          <span class="chip-note">{t('map.ignored')}</span>
                        </li>
                      ) : (
                        <li key={i}>
                          <code class={`tok ${highlightClass(v)}`}>{v.raw}</code>
                          {audience === 'simple' && v.kind !== 'host' && (
                            <span class="chip-note">{explainSource(content, v)?.title}</span>
                          )}
                        </li>
                      ),
                    )}
                  </ul>
                )}
              </td>
              <td class="via">{governing && t('map.via', { directive: governing.name })}</td>
            </tr>
          );
        })}
        <EmbedRow policy={policy} audience={audience} content={content} />
        {BEHAVIOURS.map((type) => {
          const r = checkResource(policy, type, undefined, origin);
          return (
            <tr key={type}>
              <th scope="row">{t(`resources.${type}`)}</th>
              <td>
                <span class={`verdict verdict-${r.verdict}`}>{t(`map.verdict.${r.verdict}`)}</span>
              </td>
              <td class="via">{r.directive && t('map.via', { directive: r.directive.name })}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/**
 * Which websites may show this one in a frame (frame-ancestors): the other way round from the rows above, and a
 * question non-technical readers ask. Browsers ignore it in a <meta> tag.
 */
function EmbedRow({ policy, audience, content }: Pick<Props, 'policy' | 'audience' | 'content'>) {
  const t = useT();
  const inMeta = policy.origin === 'meta';
  const d = inMeta ? undefined : findDirective(policy, 'frame-ancestors');
  const none = d && (d.values.length === 0 || d.values.every((v) => v.value === "'none'"));
  return (
    <tr>
      <th scope="row">{t('map.embed.label')}</th>
      <td>
        {!d ? (
          <span class="verdict-unrestricted">{t('map.embed.anyone')}</span>
        ) : none ? (
          <span class="verdict-none">{t('map.embed.none')}</span>
        ) : (
          <ul class="chips">
            {d.values.map((v, i) => (
              <li key={i}>
                <code class={`tok ${highlightClass(v)}`}>{v.raw}</code>
                {audience === 'simple' && v.kind !== 'host' && <span class="chip-note">{explainSource(content, v)?.title}</span>}
              </li>
            ))}
          </ul>
        )}
      </td>
      <td class="via">{inMeta ? t('map.embed.ignoredInMeta') : d && t('map.via', { directive: d.name })}</td>
    </tr>
  );
}
