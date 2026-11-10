import type { ComponentChildren } from 'preact';

export interface SegmentedItem<T extends string | number> {
  id: T;
  label: ComponentChildren;
  title?: string;
  lang?: string;
}

interface Props<T extends string | number> {
  /** Accessible name of the group. */
  label: string;
  items: SegmentedItem<T>[];
  value: T;
  onChange: (value: T) => void;
  class: string;
  /** Shown before the options, e.g. a visible label. */
  children?: ComponentChildren;
}

/**
 * A few mutually exclusive options shown side by side as buttons (WAI-ARIA radio group): Tab reaches the chosen
 * option, arrow keys, Home and End choose another.
 */
export function Segmented<T extends string | number>({ label, items, value, onChange, class: className, children }: Props<T>) {
  const onKeyDown = (e: KeyboardEvent) => {
    const index = items.findIndex((i) => i.id === value);
    const next =
      e.key === 'ArrowRight' || e.key === 'ArrowDown' ? (index + 1) % items.length
      : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? (index - 1 + items.length) % items.length
      : e.key === 'Home' ? 0
      : e.key === 'End' ? items.length - 1
      : -1;
    if (next < 0) return;
    e.preventDefault();
    onChange(items[next]!.id);
    (e.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('[role="radio"]')[next]?.focus();
  };

  return (
    <div class={className} role="radiogroup" aria-label={label} onKeyDown={onKeyDown}>
      {children}
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          role="radio"
          aria-checked={item.id === value}
          tabIndex={item.id === value ? 0 : -1}
          title={item.title}
          lang={item.lang}
          onClick={() => onChange(item.id)}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
