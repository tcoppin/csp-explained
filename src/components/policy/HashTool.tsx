import { useMemo, useState } from 'preact/hooks';
import { withHashes } from '../../lib/build';
import { hashSource, inlineBlocks, type InlineHash, type InlineKind } from '../../lib/csp/hash';
import type { Audience } from '../../lib/csp/model';
import { CodeBox } from '../ui/CodeBox';
import { useT } from '../ui/i18n';
import { Rich } from '../ui/Rich';
import { Segmented } from '../ui/Segmented';
import './hash-tool.css';

/** The first line of each hashed block, kept for this visit only (the link holds the hashes alone). */
const previews = new Map<string, string>();

const preview = (content: string) => {
  const line = content.split('\n').find((l) => l.trim() !== '')?.trim() ?? '';
  return line.length > 60 ? `${line.slice(0, 59)}…` : line;
};

interface Props {
  id: string;
  /** The kind the hashes are for; when absent, the visitor says what untagged code is. */
  kind?: InlineKind;
  hashes: InlineHash[];
  onChange: (hashes: InlineHash[]) => void;
}

/**
 * Turns pasted inline code into `'sha256-…'` values: the builder adds them to the policy, the analyzer offers them
 * in place of 'unsafe-inline'. Everything happens in the browser.
 */
export function HashTool({ id, kind, hashes, onChange }: Props) {
  const t = useT();
  const [text, setText] = useState('');
  const [untagged, setUntagged] = useState<InlineKind>(kind ?? 'script');
  const [notes, setNotes] = useState<string[]>([]);

  const add = async () => {
    const found: InlineHash[] = [];
    const skipped: string[] = [];
    for (const block of inlineBlocks(text)) {
      const blockKind = block.kind ?? (kind ?? untagged);
      if (block.skipped) skipped.push(t(`hashes.skipped.${block.skipped}`));
      else if (kind && blockKind !== kind) skipped.push(t(`hashes.skipped.other.${blockKind}`));
      else {
        const source = await hashSource(block.content);
        previews.set(source, preview(block.content));
        if (!hashes.some((h) => h.source === source) && !found.some((h) => h.source === source)) found.push({ kind: blockKind, source });
        else skipped.push(t('hashes.skipped.known'));
      }
    }
    setNotes(skipped);
    if (found.length > 0) {
      onChange([...hashes, ...found]);
      setText('');
    }
  };

  return (
    <div class="hash-tool">
      <label for={`${id}-code`}>{t(`hashes.paste.${kind ?? 'any'}`)}</label>
      <textarea
        id={`${id}-code`}
        class="code"
        rows={4}
        spellcheck={false}
        autocomplete="off"
        value={text}
        onInput={(e) => setText(e.currentTarget.value)}
      />
      <p class="muted">{t('hashes.exact')}</p>
      <div class="hash-actions">
        {!kind && (
          <Segmented
            class="segmented"
            label={t('hashes.untagged')}
            items={(['script', 'style'] as const).map((k) => ({ id: k, label: t(`hashes.kind.${k}`) }))}
            value={untagged}
            onChange={setUntagged}
          />
        )}
        <button type="button" class="button" disabled={text.trim() === ''} onClick={add}>
          {t('hashes.add')}
        </button>
      </div>
      {notes.map((n, i) => (
        <p key={i} class="hash-note" role="note">
          {n}
        </p>
      ))}
      {hashes.length > 0 && (
        <ul class="hash-list" aria-label={t('hashes.listLabel')}>
          {hashes.map((h) => (
            <li key={h.source}>
              <code class="hash-value">{h.source}</code>
              {!kind && <span class="tag">{t(`hashes.kind.${h.kind}`)}</span>}
              {previews.has(h.source) && <code class="hash-preview">{previews.get(h.source)}</code>}
              <button type="button" class="link-button" onClick={() => onChange(hashes.filter((x) => x.source !== h.source))}>
                {t('hashes.remove')}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const KIND_OF: Record<string, InlineKind | undefined> = {
  'script-src': 'script',
  'script-src-elem': 'script',
  'style-src': 'style',
  'style-src-elem': 'style',
  'default-src': undefined,
};

/** Directives where the analyzer offers hashes in place of 'unsafe-inline'. */
export const offersHashes = (directive: string) => directive in KIND_OF;

/** The analyzer's offer, under the explanation of 'unsafe-inline': the same generator, and the policy it gives. */
interface FixProps {
  policyText: string;
  directive: string;
  origin: string;
  audience: Audience;
  /** Starts open when the visitor came from a finding that suggests hashes. */
  open?: boolean;
}

export function HashFix({ policyText, directive, origin, audience, open }: FixProps) {
  const t = useT();
  const [hashes, setHashes] = useState<InlineHash[]>([]);
  const kind = KIND_OF[directive];
  const fixed = useMemo(() => (hashes.length > 0 ? withHashes(policyText, hashes, origin) : undefined), [policyText, hashes, origin]);
  const kinds = new Set(hashes.map((h) => h.kind));

  return (
    <details class="hash-fix" open={open}>
      <summary>{t('hashes.fix.title')}</summary>
      <p>
        <Rich msg={`hashes.fix.intro.${audience === 'simple' ? 'simple' : 'technical'}`} />
      </p>
      <HashTool id="hash-fix" kind={kind} hashes={hashes} onChange={setHashes} />
      {fixed && (
        <>
          <CodeBox caption={t('hashes.fix.caption')} copyText={fixed.text} />
          {(['script', 'style'] as const)
            .filter((k) => kinds.has(k))
            .map((k) => (
              <p key={k} class="hash-warning">
                <Rich msg={`hashes.fix.warning.${k}`} />
                {k === 'style' && fixed.styleAttributes && (
                  <>
                    {' '}
                    <Rich msg="hashes.fix.warning.styleAttr" />
                  </>
                )}
              </p>
            ))}
        </>
      )}
    </details>
  );
}
