/**
 * Progressive tabs for static pages (WAI-ARIA tabs pattern, automatic activation).
 *
 * Markup: an element with `data-tabs` containing a `[role=tablist][hidden]` of `[role=tab]` buttons
 * (each with `aria-controls`) and the panels. Without JavaScript the tab list stays hidden and every
 * panel is shown, so the page still reads top to bottom.
 *
 * Options on the `data-tabs` element:
 * - `data-tabs-hash`: select the panel named in the URL fragment, and keep the fragment in sync.
 * - `data-tabs-detect`: tabs carry `data-match` (a regex tested on the user agent); the first match is selected.
 */
function setup(root: HTMLElement) {
  const list = root.querySelector<HTMLElement>(':scope > [role=tablist]');
  if (!list) return;
  const tabs = [...list.querySelectorAll<HTMLButtonElement>('[role=tab]')];
  const panelOf = (tab: HTMLButtonElement) => document.getElementById(tab.getAttribute('aria-controls') ?? '');

  const select = (tab: HTMLButtonElement, opts: { focus?: boolean; updateHash?: boolean } = {}) => {
    for (const t of tabs) {
      const selected = t === tab;
      t.setAttribute('aria-selected', String(selected));
      t.tabIndex = selected ? 0 : -1;
      const panel = panelOf(t);
      if (panel) panel.hidden = !selected;
    }
    if (opts.focus) tab.focus();
    if (opts.updateHash && root.hasAttribute('data-tabs-hash')) {
      history.replaceState(null, '', `#${tab.getAttribute('aria-controls')}`);
    }
  };

  list.hidden = false;
  root.classList.add('tabs-ready');
  for (const tab of tabs) {
    const panel = panelOf(tab);
    panel?.setAttribute('role', 'tabpanel');
    panel?.setAttribute('aria-labelledby', tab.id);
    tab.addEventListener('click', () => select(tab, { updateHash: true }));
  }

  list.addEventListener('keydown', (e) => {
    const index = tabs.findIndex((t) => t.getAttribute('aria-selected') === 'true');
    const next =
      e.key === 'ArrowRight' ? (index + 1) % tabs.length
      : e.key === 'ArrowLeft' ? (index - 1 + tabs.length) % tabs.length
      : e.key === 'Home' ? 0
      : e.key === 'End' ? tabs.length - 1
      : -1;
    if (next < 0) return;
    e.preventDefault();
    select(tabs[next]!, { focus: true, updateHash: true });
  });

  const fromHash = () =>
    root.hasAttribute('data-tabs-hash') ? tabs.find((t) => `#${t.getAttribute('aria-controls')}` === location.hash) : undefined;
  const detected = root.hasAttribute('data-tabs-detect')
    ? tabs.find((t) => t.dataset.match && new RegExp(t.dataset.match, 'i').test(navigator.userAgent))
    : undefined;
  select(fromHash() ?? detected ?? tabs[0]!);

  // In-page links (#terminal) switch tabs too.
  window.addEventListener('hashchange', () => {
    const tab = fromHash();
    if (tab) select(tab);
  });
}

document.querySelectorAll<HTMLElement>('[data-tabs]').forEach(setup);
