import { useT } from '../ui/i18n';

/**
 * A risk a tool brings to the site itself (`warning` in the catalogue), said in words before anything else about the
 * tool. The `.tool-warning` styles live in global.css: the tool pages (Astro) write the same markup.
 */
export function ToolWarning({ text }: { text: string | undefined }) {
  const t = useT();
  if (!text) return null;
  return (
    <p class="tool-warning">
      <strong>{t('vendors.warning')}:</strong> {text}
    </p>
  );
}
