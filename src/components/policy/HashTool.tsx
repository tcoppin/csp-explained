import { useMemo, useState } from 'preact/hooks';
import { withHashes } from '../../lib/build';
import { hashSource, inlineBlocks, isAttributeKind, type HashKind, type InlineHash, type InlineKind } from '../../lib/csp/hash';
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

/** What the field asks for, by the kinds the list takes. */
function pasteKey(kinds: HashKind[]): string {
  if (kinds.length === 4) return 'any';
  if (kinds.length === 2) return kinds[0] === 'script' ? 'scriptAndHandlers' : 'styleAndAttributes';
  return kinds[0]!;
}

interface Props {
  id: string;
  /**
   * The kinds of code the list takes; code pasted without tags is the first one, unless the list takes both
   * scripts and styles: the visitor then says which it is.
   */
  kinds: HashKind[];
  hashes: InlineHash[];
  onChange: (hashes: InlineHash[]) => void;
}

/**
 * Turns pasted inline code into `'sha256-…'` values: the builder adds them to the policy, the analyzer offers them
 * in place of 'unsafe-inline'. A `<script src>` with an `integrity` attribute gives the hashes it lists. Everything
 * happens in the browser.
 */
export function HashTool({ id, kinds, hashes, onChange }: Props) {
  const t = useT();
  const [text, setText] = useState('');
  const chooses = kinds.includes('script') && kinds.includes('style');
  const [untagged, setUntagged] = useState<InlineKind>('script');
  const [notes, setNotes] = useState<string[]>([]);

  const add = async () => {
    const found: InlineHash[] = [];
    const skipped: string[] = [];
    // The same code as a block and as an attribute has one hash, needed in two rules.
    const same = (kind: HashKind, source: string) => (h: InlineHash) => h.kind === kind && h.source === source;
    const keep = (kind: HashKind, source: string) => {
      if (!hashes.some(same(kind, source)) && !found.some(same(kind, source))) found.push({ kind, source });
      else skipped.push(t('hashes.skipped.known'));
    };
    const blocks = inlineBlocks(text);
    if (blocks.length === 0) skipped.push(t('hashes.skipped.nothing'));
    for (const block of blocks) {
      const blockKind = block.kind ?? (chooses ? untagged : kinds[0]!);
      if (block.skipped) skipped.push(t(`hashes.skipped.${block.skipped}`));
      else if (!kinds.includes(blockKind)) skipped.push(t(`hashes.skipped.other.${blockKind}`));
      else if (block.integrity) {
        for (const source of block.integrity) {
          previews.set(source, preview(`<script src="${block.src ?? ''}">`));
          keep(blockKind, source);
        }
        skipped.push(t('hashes.external'));
      } else {
        const source = await hashSource(block.content);
        previews.set(source, preview(block.content));
        keep(blockKind, source);
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
      <label for={`${id}-code`}>{t(`hashes.paste.${pasteKey(kinds)}`)}</label>
      <textarea
        id={`${id}-code`}
        class="code"
        rows={4}
        spellcheck={false}
        autocomplete="off"
        value={text}
        onInput={(e) => setText(e.currentTarget.value)}
      />
      <p class="muted">{t(kinds.every(isAttributeKind) ? 'hashes.exactAttributes' : 'hashes.exact')}</p>
      <div class="hash-actions">
        {chooses && (
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
            <li key={`${h.kind}|${h.source}`}>
              <code class="hash-value">{h.source}</code>
              {kinds.length > 1 && <span class="tag">{t(`hashes.kind.${h.kind}`)}</span>}
              {previews.has(h.source) && <code class="hash-preview">{previews.get(h.source)}</code>}
              <button type="button" class="link-button" onClick={() => onChange(hashes.filter((x) => x !== h))}>
                {t('hashes.remove')}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** What each directive's 'unsafe-inline' allows, which hashes can replace. */
const KINDS_OF: Record<string, HashKind[]> = {
  'script-src': ['script', 'handler'],
  'script-src-elem': ['script'],
  'script-src-attr': ['handler'],
  'style-src': ['style', 'style-attr'],
  'style-src-elem': ['style'],
  'style-src-attr': ['style-attr'],
  'default-src': ['script', 'style', 'handler', 'style-attr'],
};

/** Directives where the analyzer offers hashes in place of 'unsafe-inline'. */
export const offersHashes = (directive: string) => directive in KINDS_OF;

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
  const kinds = KINDS_OF[directive] ?? [];
  const fixed = useMemo(() => (hashes.length > 0 ? withHashes(policyText, hashes, origin) : undefined), [policyText, hashes, origin]);
  const listed = new Set(hashes.map((h) => h.kind));

  return (
    <details class="hash-fix" open={open}>
      <summary>{t('hashes.fix.title')}</summary>
      <p>
        <Rich msg={`hashes.fix.intro.${audience === 'simple' ? 'simple' : 'technical'}`} />
      </p>
      <HashTool id="hash-fix" kinds={kinds} hashes={hashes} onChange={setHashes} />
      {fixed && (
        <>
          <CodeBox caption={t('hashes.fix.caption')} copyText={fixed.text} />
          {(['script', 'handler', 'style', 'style-attr'] as const)
            .filter((k) => listed.has(k))
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
