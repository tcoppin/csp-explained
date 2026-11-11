/** How the Both policies view lays them out on wide screens: inline (one annotated policy) or side by side. Phones always get inline. */
export type DiffLayout = 'tracked' | 'columns';

const LAYOUT_KEY = 'csp-explained:diff-layout';

export function loadDiffLayout(): DiffLayout {
  try {
    return localStorage.getItem(LAYOUT_KEY) === 'columns' ? 'columns' : 'tracked';
  } catch {
    // Storage can be unavailable (private mode, blocked site data).
    return 'tracked';
  }
}

export function saveDiffLayout(layout: DiffLayout): void {
  try {
    localStorage.setItem(LAYOUT_KEY, layout);
  } catch {
    // Not critical.
  }
}
