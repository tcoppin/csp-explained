# CLAUDE.md

CSP Explained: a free, independent web app that explains Content-Security-Policies to non-technical people,
developers and security teams. Everything runs in the browser. See `README.md` for the overview and
`ROADMAP.md` for what comes next. Add new ideas to `ROADMAP.md`, not here.

## Working with the owner

- Neutral personal project: never brand it for AB Tasty or any vendor. Vendor entries stay factual and sourced.
- Commit only when asked. One commit per change (they ask for separate commits); every commit must pass the
  tests on its own. End messages with the `Co-Authored-By` line. Don't push or deploy unless asked.
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
yarn catalogue:validate
yarn infra:synth         # CDK synth (infra/ workspace); never deploy without being asked
```

A change is ready when all of these pass: `yarn test`, `yarn check`, `yarn build`, `yarn test:e2e`.

## Layout

- `src/lib/csp/`: pure TypeScript core (parser, fallback, matcher, compat, patch, security). No UI imports.
- `src/lib/reports/`: one report per audience (simple = IT message, developer, security).
- `src/lib/analysis.ts`: orchestrates parse → vendor checks → patches → findings.
- `src/components/`: the analyzer island (Preact, `client:load`) and shared components.
- `src/content/*.yaml`: plain-language explanations, three voices: `simple`, `developer`, `security`.
- `catalogue/vendors/*.yaml`: one file per tool, validated by `scripts/validate-catalogue.ts`.
- `src/i18n/en.json`: every user-facing string, including report text. No hard-coded copy in components.
- `src/site-policy.ts`: this site's own CSP (meta part via Astro, header part via CloudFront in `infra/`).

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
- Copy is plain, sentence case, active voice, no jargon in the "Everyone" voice. Explain trade-offs honestly
  without alarmism.

## Vendor catalogue rules

- Only from the vendor's **official documentation**, linked in `sources`, with `lastVerified`.
- `confidence: partial` when the page couldn't be fully read, with what's missing in `notes`.
- Don't bypass bot protection to read a vendor page; note it and ask the owner to check by hand.
- Run `yarn catalogue:validate` and, after adding a vendor, `yarn tsx scripts/watch-vendor-docs.ts --update`
  to snapshot its documentation.
