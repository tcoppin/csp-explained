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

/** A few mutually exclusive options shown side by side as buttons (ARIA radio group). */
export function Segmented<T extends string | number>({ label, items, value, onChange, class: className, children }: Props<T>) {
  return (
    <div class={className} role="radiogroup" aria-label={label}>
      {children}
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          role="radio"
          aria-checked={item.id === value}
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
