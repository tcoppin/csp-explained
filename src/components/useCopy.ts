import { useState } from 'preact/hooks';

/** Copies text to the clipboard; `copied` stays true for a moment after a successful copy. */
export function useCopy(onCopy?: () => void) {
  const [copied, setCopied] = useState(false);
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Clipboard blocked: the text stays visible and selectable (or in the address bar, for a link).
      return;
    }
    onCopy?.();
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };
  return { copied, copy };
}
