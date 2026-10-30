import { useState } from 'preact/hooks';
import { isValidSource, type CustomTool } from '../lib/build';
import { CANONICAL_DIRECTIVE, type ResourceType } from '../lib/csp/directives';
import { useT } from './i18n';

/**
 * What an own tool can load, in the order people think of it. Labels: `resources.*`, followed by the directive
 * name (never translated), which is how vendor documentation usually names them.
 */
const TYPES: ResourceType[] = ['script', 'style', 'img', 'font', 'connect', 'frame', 'media', 'worker', 'form'];

interface Row {
  type: ResourceType;
  sources: string;
}

const splitSources = (text: string) => text.split(/[\s,]+/).filter(Boolean);

interface EditorProps {
  initial?: Omit<CustomTool, 'id'>;
  /** The tool is new (rather than edited). */
  isNew: boolean;
  onSave: (tool: Omit<CustomTool, 'id'>) => void;
  onCancel: () => void;
}

/** Describes a tool the catalogue doesn't know: its name, and what it loads from where. */
export function OwnToolEditor({ initial, isNew, onSave, onCancel }: EditorProps) {
  const t = useT();
  const [name, setName] = useState(initial?.name ?? '');
  const [rows, setRows] = useState<Row[]>(
    initial && initial.needs.length > 0
      ? initial.needs.map((n) => ({ type: n.type, sources: n.sources.join(' ') }))
      : [{ type: 'script', sources: '' }],
  );
  const update = (i: number, row: Partial<Row>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...row } : r)));
  const needs = rows.map((r) => ({ type: r.type, sources: splitSources(r.sources) })).filter((n) => n.sources.length > 0);
  const invalid = needs.flatMap((n) => n.sources.filter((s) => !isValidSource(s)));
  const ready = name.trim() !== '' && needs.length > 0 && invalid.length === 0;

  return (
    <form
      class="own-editor"
      onSubmit={(e) => {
        e.preventDefault();
        if (ready) onSave({ name: name.trim(), needs });
      }}
    >
      <h3>{isNew ? t('build.own.newTitle') : t('build.own.editTitle', { name: initial?.name ?? '' })}</h3>
      <p class="muted">{t('build.own.intro')}</p>
      <label class="field">
        <span>{t('build.own.name')}</span>
        <input type="text" value={name} placeholder={t('build.own.namePlaceholder')} onInput={(e) => setName(e.currentTarget.value)} />
      </label>
      <fieldset class="own-rows">
        <legend>{t('build.own.loads')}</legend>
        {rows.map((r, i) => (
          <div key={i} class="own-row">
            <select aria-label={t('build.own.type')} value={r.type} onChange={(e) => update(i, { type: e.currentTarget.value as ResourceType })}>
              {TYPES.map((type) => (
                <option key={type} value={type}>
                  {t(`resources.${type}`)} ({CANONICAL_DIRECTIVE[type]})
                </option>
              ))}
            </select>
            <input
              type="text"
              class="code"
              spellcheck={false}
              autocomplete="off"
              aria-label={t('build.own.sources')}
              placeholder="https://cdn.example.com"
              value={r.sources}
              onInput={(e) => update(i, { sources: e.currentTarget.value })}
            />
            {rows.length > 1 && (
              <button type="button" class="button quiet" onClick={() => setRows(rows.filter((_, j) => j !== i))}>
                {t('build.own.removeRow')}
              </button>
            )}
          </div>
        ))}
        <button type="button" class="button quiet" onClick={() => setRows([...rows, { type: 'connect', sources: '' }])}>
          {t('build.own.addRow')}
        </button>
      </fieldset>
      <p class="muted">{t('build.own.sourcesHint')}</p>
      {invalid.length > 0 && <p class="issue">{t('build.own.invalid', { values: invalid.join(' ') })}</p>}
      <div class="actions">
        <button type="submit" class="button" disabled={!ready}>
          {isNew ? t('build.own.save') : t('build.own.update')}
        </button>
        <button type="button" class="button quiet" onClick={onCancel}>
          {t('build.own.cancel')}
        </button>
      </div>
    </form>
  );
}
