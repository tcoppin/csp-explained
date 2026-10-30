import { explainSource, type ContentBundle } from '../lib/content';
import { EFFECTIVE_DIRECTIVE, type ResourceType } from '../lib/csp/directives';
import { resolve } from '../lib/csp/fallback';
import { checkResource, ignoredSources } from '../lib/csp/matcher';
import type { Audience, Policy } from '../lib/csp/model';
import { highlightClass } from './PolicyView';
import { useT } from './i18n';

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
          const none = governing && (governing.values.length === 0 || governing.values.every((v) => v.value === "'none'"));
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
                    {governing.values.map((v, i) =>
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
