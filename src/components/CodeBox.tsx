import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import { t } from '../i18n';

interface Props {
  /** Where the code is meant to be used, e.g. "Add to your nginx server block". */
  caption: string;
  /** Text put in the clipboard by "Copy this". */
  copyText: string;
  /** What is shown; defaults to `copyText`. */
  children?: ComponentChildren;
  class?: string;
  /** Called after a successful copy. */
  onCopy?: () => void;
}

/** Island version of CodeBlock.astro: same markup and styles (global .code-block). */
export function CodeBox({ caption, copyText, children, class: className, onCopy }: Props) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(copyText);
      onCopy?.();
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard blocked: the code stays visible and selectable.
    }
  };

  return (
    <figure class="code-block">
      <figcaption>
        <span>{caption}</span>
        <button type="button" class={copied ? 'copy done' : 'copy'} onClick={copy}>
          <svg class="icon icon-copy" viewBox="0 0 16 16" aria-hidden="true">
            <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
            <path d="M10.5 3.5v-.5A1.5 1.5 0 0 0 9 1.5H4A1.5 1.5 0 0 0 2.5 3v5A1.5 1.5 0 0 0 4 9.5h.5" />
          </svg>
          <svg class="icon icon-done" viewBox="0 0 16 16" aria-hidden="true">
            <path d="M3 8.5l3.2 3L13 4.5" />
          </svg>
          <span aria-live="polite">{copied ? t('report.copied') : t('report.copyThis')}</span>
        </button>
      </figcaption>
      <pre class={className}>
        <code>{children ?? copyText}</code>
      </pre>
    </figure>
  );
}
