import type { ComponentChildren } from 'preact';

export interface TabItem<T extends string> {
  id: T;
  label: ComponentChildren;
}

interface Props<T extends string> {
  /** Prefix for element ids, unique on the page. */
  id: string;
  label: string;
  items: TabItem<T>[];
  value: T;
  onChange: (value: T) => void;
  class?: string;
}

/**
 * Accessible tab list (WAI-ARIA tabs pattern, automatic activation): arrow keys, Home and End
 * move between tabs. Panels are rendered by the caller with `tabPanelProps`.
 */
export function TabList<T extends string>({ id, label, items, value, onChange, class: className }: Props<T>) {
  const onKeyDown = (e: KeyboardEvent) => {
    const index = items.findIndex((i) => i.id === value);
    const next =
      e.key === 'ArrowRight' ? (index + 1) % items.length
      : e.key === 'ArrowLeft' ? (index - 1 + items.length) % items.length
      : e.key === 'Home' ? 0
      : e.key === 'End' ? items.length - 1
      : -1;
    if (next < 0) return;
    e.preventDefault();
    const target = items[next]!;
    onChange(target.id);
    document.getElementById(`${id}-tab-${target.id}`)?.focus();
  };

  return (
    <div role="tablist" aria-label={label} class={className ?? 'tablist'} onKeyDown={onKeyDown}>
      {items.map((item) => (
        <button
          key={item.id}
          id={`${id}-tab-${item.id}`}
          type="button"
          role="tab"
          aria-selected={item.id === value}
          aria-controls={`${id}-panel-${item.id}`}
          tabIndex={item.id === value ? 0 : -1}
          onClick={() => onChange(item.id)}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

export function tabPanelProps(id: string, tab: string) {
  return { id: `${id}-panel-${tab}`, role: 'tabpanel', 'aria-labelledby': `${id}-tab-${tab}`, tabIndex: 0 } as const;
}
