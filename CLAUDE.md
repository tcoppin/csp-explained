# CLAUDE.md

CSP Explained: a free, independent web app that explains Content-Security-Policies to non-technical people,
developers and security teams. Everything runs in the browser. See `README.md` for the overview, `CONTRIBUTING.md`
for development and the catalogue rules, `DEPLOY.md` for hosting, and `ROADMAP.md` for what comes next. Add new
ideas to `ROADMAP.md`, not here.

## Working with the owner

- Neutral personal project: never brand it for AB Tasty or any vendor. Vendor entries stay factual and sourced.
- Commit only when asked. One commit per change (they ask for separate commits); every commit must pass the
  tests on its own. Titles follow Conventional Commits (CONTRIBUTING.md › Commit messages): they decide the next
  version. Never tag or create a release by hand: the deploy workflow does it. End messages with the
  `Co-Authored-By` line. Don't push or deploy unless asked.
- Before saying a UI change is done, build it and look at it: Playwright screenshots of desktop, mobile
  (390 px) and both themes, saved in the scratchpad.
- When a choice is a matter of taste (palette, layout), show options rendered on the real pages and let them pick.

## Commands

```sh
yarn install
yarn dev                 # no CSP in dev: our own policy only exists in the build
yarn test                # vitest (unit), src/**/*.test.ts and scripts/**/*.test.ts
yarn check               # astro check (types)
yarn build && yarn test:e2e   # Playwright against the production build, desktop + mobile
yarn catalogue:validate  # vendor schema, plus translation files that don't match the English ones
yarn i18n:status [fr] [--write]   # YAML text still in English; --write adds empty entries to translate
yarn og:image            # regenerates public/og-image.png (tagline or palette changed)
yarn infra:synth         # CDK synth (infra/ workspace); never deploy without being asked
```

A change is ready when all of these pass: `yarn test`, `yarn check`, `yarn build`, `yarn test:e2e`.

## Layout

- `src/lib/csp/`: pure TypeScript core (parser, fallback, matcher, compat, patch, security). No UI imports.
- `src/lib/reports/`: one report per audience (simple = IT message, developer, security).
- `src/lib/analysis.ts`: orchestrates parse → vendor checks → patches → findings.
- `src/components/`: Preact islands (`client:load`) and Astro components, grouped by who uses them. Each test and
  stylesheet stays next to its code; no folders by file type (`hooks/`, `css/`, `tests/`).
  - `analyzer/`: only the analyzer island (home page): `Analyzer` and its panels, the recent analyses list,
    `analyzer.css`.
  - `builder/`: only the builder island (build page): `Builder`, `BuildPanels`, `useBuilder`, `build-state`.
  - `compare/`: only the comparator island (compare page): `Compare`, `compare-state`, `compare.css`.
  - `policy/`: CSP-specific pieces used by several islands (`PolicyView`, `Explanation`, `HashTool`, `ToolPicker`,
    `SiteField`, `FindingList`), the shareable URL state (`state.ts`) and the recent analyses kept in the browser
    (`recent.ts`).
  - `ui/`: generic building blocks with no CSP knowledge (`Tabs`, `Segmented`, `CodeBox`, `Rich`, `NewTabLink`,
    `useCopy`, `i18n.ts`). Usable from islands and Astro pages.
  - `site/`: Astro-only components for the static pages and layouts (`SiteHeader`, `CodeBlock`, `DevtoolsSketch`).
  - Put new code in the narrowest folder that fits. Imports only go "down": `analyzer/`, `builder/` and `compare/` may
    import `policy/` and `ui/`; `policy/` may import `ui/`; `ui/` imports no other component folder. The islands
    never import each other. When code in one island becomes needed by another (or by a page), move
    it with `git mv` to `policy/` (CSP-specific) or `ui/` (generic) instead of importing across or duplicating it;
    likewise move code back down when its last other user goes away.
  - Styles follow the same rule. A component imports its own stylesheet (`Tabs.tsx` → `tabs.css`), so its look
    travels with it. Markup several islands write themselves goes in `ui/panels.css` (panels, buttons row, code
    text areas) or `policy/results.css` (tool requirements, findings), imported by the islands before their own
    stylesheet so the island's rules win ties. `analyzer.css`, `builder.css` and `compare.css` hold only their
    island's rules.
- `tests/e2e/`: one spec per area: `analyzer`, `builder`, `compare`, `guides` (static pages with behaviour of their own),
  `i18n` and `site` (checks run over every page). Put a test in the area it exercises; one that crosses islands goes
  with the island it ends on. Shared steps and the usage fixture (`sent`) live in `helpers.ts`: import `test` and
  `expect` from there, not from `@playwright/test`, so every test answers the usage events.
- `src/content/*.yaml`: plain-language explanations, three voices: `simple`, `developer`, `security`.
- `catalogue/vendors/*.yaml`: one file per tool, validated by `scripts/validate-catalogue.ts`.
- YAML content is loaded at build time only (`src/lib/content-loader.ts`; pages call `contentFor(locale)` from
  `src/lib/site-content.ts`). `src/lib/content.ts` holds the types and helpers the island uses: keep YAML, zod and
  `node:` imports out of anything the island imports.
- Translations of YAML content: `src/content/<locale>/*.yaml` and `catalogue/i18n/<locale>/<id>.yaml`, text only,
  each field `{ en: <hash of the English>, text }`. Missing, empty or stale fields show in English. Reasons are
  keyed by requirement type, so a feature lists each type once.
- Security findings are explained by `findings.*` in the messages (`findingKey` in `src/lib/csp/security.ts`);
  the evaluator's English description is only a fallback for kinds we don't know.
- `src/i18n/en.json`: every interface and report string; `src/i18n/en.pages.json`: the pages' copy (`pages.*`),
  kept apart so the island bundle doesn't carry it. `fr.json` and `fr.pages.json` mirror them key for key (tests
  check keys, placeholders and links). No hard-coded copy in pages or components. Astro pages take `t` from
  `translatorFor(Astro)`; island components call `useT()`
  (`src/components/ui/i18n.ts`, provided by the Analyzer from its `locale` prop). Long-form copy goes through
  `<Rich t={t} msg="…" />` with its inline syntax (`code`, **strong**, *em*, [[kbd]], [label](/path)), never HTML.
- Long pages you read (guides, the directives list, About) use `src/layouts/GuideLayout.astro`: heading, lead, contents
  built from the page's `<h2>`s (margin list on wide screens, a sticky bar below 80rem) and a "Read next" link.
- Pages live in `src/pages/[...lang]/` and are built once per language (`localeParams()`): English at the root,
  French under `/fr`, same slugs. The 404 is English only (CloudFront serves one error page).
- `src/site-policy.ts`: this site's own CSP (meta part via Astro, header part via CloudFront in `infra/`).
- `src/usage.ts`: the usage events we count, shared by `track()` (`src/scripts/track.ts`) and the Lambda in
  `infra/lambda/`. Never send what the visitor typed. The About page and the README list what we count: keep
  them in sync.
- `src/stored.ts`: everything kept in the visitor's browser (`csp-explained:<name>` in localStorage; no cookies).
  Before adding storage:
  - Write it only after the visitor does something that needs it: a choice they make (theme, audience) or a feature
    they turn on (the history of analyses, off by default). Never automatically, even if it never leaves the device:
    EU ePrivacy rules (Article 5(3)) need consent for any storage that isn't strictly needed for what the visitor
    asked, and a consent banner would go against this site's spirit. An explicit opt-in is that consent.
  - Add the name to `STORED` and its line to `pages.about.stored.items` (en and fr): `src/stored.test.ts` fails on a
    key the code uses that isn't listed. Say how to remove it (a button, or clearing the site's data).
  - Turning a feature off removes what it stored. Keys that are only removed now go in `LEGACY` in the test.

## Pitfalls we already hit

- **Astro drops line breaks next to inline elements.** `<a>…</a>` at the end of a source line followed by a word
  on the next line renders as `…</a>word`. The same happens before the element. Break source lines only between
  plain words. An e2e test checks every page.
- **Our own CSP has no `'unsafe-inline'`.** No `style="…"` attributes and no injected `<style>`. Use classes.
  Inline `<script is:inline>` works only because Astro hashes it. The e2e suite fails on any CSP violation.
- **`[hidden]` is `display: none !important` globally**, so component display rules can't override it.
- **`astro preview` goes to the background when run by an agent.** Use `--ignore-lock` to keep it in the
  foreground (Playwright's `webServer` already does). Stop stray servers with `pkill -f "astro preview"`.
- **Yarn 4 refuses versions published in the last few days** (`npmMinimalAgeGate`). If an install fails with
  "quarantined", pick the previous version; don't disable the gate. Missing peer dependencies go in
  `packageExtensions` in `.yarnrc.yml`.
- **DevTools' `copy()` only works while the console evaluates the pasted code.** Chrome removes it after the first
  `await`; Firefox keeps it but silently does nothing. The console snippet is fully synchronous (sync XHR, no
  `await`). Test console code through CDP `Runtime.evaluate` with `includeCommandLineAPI: true`, not with a fake
  global.
- **Google's `csp_evaluator` can throw** on unusual values (browser `new URL` is stricter than Node's). We pass
  it only values our parser recognised, and run each check in its own `try`.
- **The island hydrates after first paint.** Tests must wait for `astro-island:not([ssr])` before typing.
- In screenshot scripts that inject styles, use `bypassCSP: true`. Our CSP blocks them otherwise.
- **The CloudFormation execution role is narrow** (`infra/iam/cfn-execution-policy.json`). A new kind of AWS resource
  needs that policy extended first. It can't attach managed policies: give roles inline policies (`grant*`).

## Design rules

- Identity: the policy annotated like a highlighted document. The highlighter is the one bold element; keep
  everything else quiet. Avoid generic AI-site defaults (navy/cobalt, card grids, all-caps eyebrows, middle-dot
  meta strings, arrows on buttons).
- Colours only through the tokens in `src/styles/global.css`. Light is aubergine/raspberry; dark is a
  Monokai-like olive-brown, never navy. The dark token block appears twice (explicit `data-theme` and system
  preference): keep both identical. Text pairs must pass WCAG AA in both themes.
- Status colours carry meaning: green allowed, yellow/amber warning, vermilion blocked. The accent never
  replaces a status colour.
- One question per view: analyzer tabs, Find my CSP method tabs. Prefer progressive disclosure over long pages.
- Code is shown in a box with a caption saying where it goes and an in-box "Copy this" control: `CodeBlock.astro`
  (static pages) and `CodeBox.tsx` (island). They share the `.code-block` styles in `global.css`.
- Reading width (`.prose`, 68ch) applies to long-form pages only; interface text uses its column's width.
- Every link to another website opens in a new tab through `NewTabLink.tsx` (icon + screen-reader text), on Astro
  pages and in the island. Links within the site open in the same tab (an e2e test checks the main pages) and stay
  in the page's language: write them without a language and pass them through `localePath(t.locale, …)` (`Rich`
  does it for message links). An e2e test fails on a French page linking to an English one.
- Copy is plain, sentence case, active voice, no jargon in the "Everyone" voice. Explain trade-offs honestly
  without alarmism.

## Vendor catalogue rules

- Only from the vendor's **official documentation**, linked in `sources`, with `lastVerified`.
- Only **public** documentation (CONTRIBUTING.md › Vendor catalogue): never what is shown behind a login, including through
  the owner's work accounts, unless the vendor approved publishing it in writing. Such tools wait in group 3 of
  the roadmap's catalogue section.
- `confidence: partial` when the page couldn't be fully read, with what's missing in `notes`.
- Don't bypass bot protection to read a vendor page; note it and ask the owner to check by hand.
- Run `yarn catalogue:validate` and, after adding a vendor, `yarn tsx scripts/watch-vendor-docs.ts --update`
  to snapshot its documentation.
