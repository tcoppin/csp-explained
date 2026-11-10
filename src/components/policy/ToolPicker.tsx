import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { REPO_URL } from '../../config';
import { groupByCategory } from '../../lib/catalogue/categories';
import type { Vendor } from '../../lib/catalogue/schema';
import { matchesTool } from '../../lib/catalogue/search';
import { NewTabLink } from '../ui/NewTabLink';
import { useT } from '../ui/i18n';

/** A tool the visitor described, listed in its own group before the catalogue. */
export interface OwnOption {
  id: string;
  name: string;
}

interface Props {
  vendors: Vendor[];
  /** Selected ids (vendors and own tools), in the order they were picked. */
  selected: string[];
  onToggle: (id: string) => void;
  own?: OwnOption[];
  /** Offers to describe a tool that isn't listed, starting from what was typed. */
  onDescribe?: (name: string) => void;
}

interface Option {
  id: string;
  name: string;
  partial?: boolean;
}

const LISTBOX_ID = 'tool-listbox';
const optionId = (id: string) => `tool-option-${id}`;

/**
 * Searchable multi-select (ARIA combobox + multi-selectable listbox). Picked tools show as
 * removable chips; the list stays open after picking so several tools can be added in a row.
 */
export function ToolPicker({ vendors, selected, onToggle, own = [], onDescribe }: Props) {
  const t = useT();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<string | undefined>();
  const input = useRef<HTMLInputElement>(null);

  const groups = useMemo(
    () =>
      [
        { id: 'own', label: t('build.own.group'), options: own.filter((o) => matchesTool(o, query)) as Option[] },
        ...groupByCategory(vendors, t).map((g) => ({
          id: g.id,
          label: g.label,
          options: g.vendors.filter((v) => matchesTool(v, query, g.label)).map((v) => ({ id: v.id, name: v.name, partial: v.confidence === 'partial' })),
        })),
      ].filter((g) => g.options.length > 0),
    [vendors, own, query, t],
  );
  const visible = groups.flatMap((g) => g.options);
  const byId = new Map<string, { name: string }>([...vendors, ...own].map((v) => [v.id, v]));

  // Keep the active option valid and in view.
  const activeId = active && visible.some((v) => v.id === active) ? active : visible[0]?.id;
  useEffect(() => {
    if (open && activeId) document.getElementById(optionId(activeId))?.scrollIntoView({ block: 'nearest' });
  }, [open, activeId]);

  const move = (delta: number) => {
    if (visible.length === 0) return;
    const index = visible.findIndex((v) => v.id === activeId);
    setActive(visible[(index + delta + visible.length) % visible.length]!.id);
  };

  const pick = (id: string) => {
    onToggle(id);
    setQuery('');
    setActive(id);
    input.current?.focus();
  };

  const onKeyDown = (e: KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        if (!open) setOpen(true);
        else move(1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        if (!open) setOpen(true);
        else move(-1);
        break;
      case 'Enter':
        if (open && activeId) {
          e.preventDefault();
          pick(activeId);
        }
        break;
      case 'Escape':
        if (open) setOpen(false);
        else setQuery('');
        break;
      case 'Backspace':
        if (query === '' && selected.length > 0) onToggle(selected[selected.length - 1]!);
        break;
    }
  };

  const suggestUrl = `${REPO_URL}/issues/new?${new URLSearchParams({ labels: 'catalogue', title: `Add a tool: ${query}` })}`;

  return (
    <div
      class="tool-picker"
      onFocusOut={(e) => {
        // Close when focus leaves the whole picker.
        if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      {selected.length > 0 && (
        <ul class="picked" aria-label={t('vendors.selected')}>
          {selected.map((id) => {
            const vendor = byId.get(id);
            if (!vendor) return null;
            return (
              <li key={id}>
                <button type="button" class="picked-tool" aria-label={t('vendors.remove', { name: vendor.name })} onClick={() => onToggle(id)}>
                  {vendor.name}
                  <svg viewBox="0 0 16 16" aria-hidden="true">
                    <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" />
                  </svg>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <div class="combo">
        <label class="visually-hidden" for="tool-search">
          {t('vendors.search')}
        </label>
        <input
          ref={input}
          id="tool-search"
          type="text"
          role="combobox"
          autocomplete="off"
          spellcheck={false}
          aria-expanded={open}
          aria-controls={LISTBOX_ID}
          aria-autocomplete="list"
          aria-activedescendant={open && activeId ? optionId(activeId) : undefined}
          placeholder={t('vendors.searchPlaceholder')}
          value={query}
          onInput={(e) => {
            setQuery(e.currentTarget.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onClick={() => setOpen(true)}
          onKeyDown={onKeyDown}
        />
        <svg class="combo-chevron" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M4 6l4 4 4-4" />
        </svg>

        {open && (
          <div class="popover">
            <ul role="listbox" id={LISTBOX_ID} aria-multiselectable="true" aria-label={t('vendors.title')}>
              {groups.map((g) => (
                <li key={g.id} role="presentation">
                  <span class="group-label" id={`tool-group-${g.id}`}>
                    {g.label}
                  </span>
                  <ul role="group" aria-labelledby={`tool-group-${g.id}`}>
                    {g.options.map((v) => {
                      const isSelected = selected.includes(v.id);
                      return (
                        <li
                          key={v.id}
                          id={optionId(v.id)}
                          role="option"
                          aria-selected={isSelected}
                          class={v.id === activeId ? 'option active' : 'option'}
                          // Keep focus in the input so typing can continue.
                          onMouseDown={(e) => e.preventDefault()}
                          onMouseMove={() => setActive(v.id)}
                          onClick={() => pick(v.id)}
                        >
                          <span class="check" aria-hidden="true">
                            <svg viewBox="0 0 16 16">
                              <path d="M3.5 8.5l3 3 6-7" />
                            </svg>
                          </span>
                          {v.name}
                          {v.partial && <span class="option-note">{t('vendors.partialShort')}</span>}
                        </li>
                      );
                    })}
                  </ul>
                </li>
              ))}
            </ul>
            {visible.length === 0 && <p class="no-match">{t('vendors.noMatch', { query })}</p>}
            {onDescribe && (
              <p class="describe">
                <button
                  type="button"
                  class="button quiet"
                  onClick={() => {
                    onDescribe(query.trim());
                    setQuery('');
                    setOpen(false);
                  }}
                >
                  {query.trim() ? t('build.own.describe', { query: query.trim() }) : t('build.own.describeAny')}
                </button>
              </p>
            )}
            <p class="suggest">
              <NewTabLink href={suggestUrl} label={t('vendors.suggest')} />
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
