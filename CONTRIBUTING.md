# Contributing to CSP Explained

Thanks for helping. The most useful contributions are usually to the vendor catalogue: a tool that's missing, or an
entry that's out of date. Open an issue with a link to the vendor's official, public documentation (the site's
"Suggest a tool" and "Report an outdated entry" links do it for you), or send a pull request.

Conventions and known pitfalls for working on the code, including with Claude Code, are in [CLAUDE.md](CLAUDE.md).
Deploying the site is described in [DEPLOY.md](DEPLOY.md).

## Develop

Uses Yarn 4 (committed in `.yarn/releases`, so any global `yarn` picks the right version). `infra/` is a Yarn workspace.

```sh
yarn install
yarn dev               # http://localhost:4321 (our own CSP is only applied by `build`)
yarn test              # unit tests (vitest)
yarn check             # type check
yarn build && yarn test:e2e   # end-to-end tests against the production build
yarn og:image          # regenerate the link-preview image after changing the tagline or the palette
yarn catalogue:validate        # vendor catalogue schema and translation files
yarn i18n:status [fr] [--write]   # YAML text still in English; --write adds empty entries to translate
```

A change is ready when `yarn test`, `yarn check`, `yarn build` and `yarn test:e2e` all pass.

## Commit messages

Versions are worked out from commit titles, so every title follows
[Conventional Commits](https://www.conventionalcommits.org/): `type(scope): summary`, the scope being optional and
the summary a plain sentence starting in lowercase.

```
feat(catalogue): add Axeptio
fix(i18n): keep the # part when switching language
docs: split the README
```

| Type | Use it for | Release |
|---|---|---|
| `feat` | A new feature, tool or language | minor |
| `fix`, `perf` | A bug fix, a catalogue correction, a speed-up | patch |
| `docs`, `chore`, `ci`, `test`, `refactor`, `style`, `build`, `revert` | Everything else | none |

A change that breaks share links, page addresses or the catalogue YAML schema adds `!` after the type
(`feat!: …`) or a `BREAKING CHANGE:` footer, and makes a major release. CI refuses titles that don't follow the
convention. To catch them before you push, enable the hook once in your clone:

```sh
git config core.hooksPath .githooks
```

Yarn refuses package versions published in the last few days (`npmMinimalAgeGate`, a supply-chain safeguard). If an install fails with "quarantined", wait or pick the previous version rather than disabling it.

## Structure

| Path | What |
|---|---|
| `src/lib/csp/` | Pure TypeScript core: parser, fallback resolution, URL matcher (CSP Level 3), vendor compatibility, patch builder, security findings (Google's `csp_evaluator`). |
| `src/lib/reports/` | Report generators for each audience. |
| `src/content/` | Plain-language explanations of directives and sources (YAML, validated at build); translations in `src/content/<locale>/`. |
| `catalogue/vendors/` | One YAML file per tool, built from its official documentation. |
| `src/i18n/` | All interface and report text (`<locale>.json`) and page copy (`<locale>.pages.json`), in English and French. |
| `src/components/` | Preact islands and Astro components, grouped by who uses them: `analyzer/` and `builder/` (one island each), `policy/` (CSP pieces both islands share), `ui/` (generic building blocks), `site/` (Astro-only, static pages). |
| `src/pages/[...lang]/` | Analyzer, Find my CSP, What is a CSP, tool pages, directive pages, about; built in English (`/`) and French (`/fr`). |
| `src/site-policy.ts` | This site's own CSP (meta policy + header policy). |
| `src/usage.ts` | The usage events counted (anonymous, no cookies), shared with the Lambda in `infra/lambda/`. |
| `infra/` | AWS CDK app: S3 + CloudFront, security headers, GitHub OIDC deploy role. |
| `scripts/` | Catalogue validation, translation status and vendor documentation watcher. |

## Accessibility

The site is meant for people who don't read CSPs every day, including people who use a screen reader, a keyboard
only, zoom, or Windows high-contrast mode. Part of that is checked on every run of `yarn test:e2e`; the rest needs
a person with a real screen reader.

### What the e2e suite checks

- **axe**, WCAG 2.2 A and AA, on every page in both languages and both themes, and on each view of the three tools
  (`everyView` in `tests/e2e/site.spec.ts`).
- **High-contrast mode**: every chosen tab, option, current page and picked part is pictured, then pictured again
  with only that state turned off; identical pictures mean the state can't be seen (`invisibleStates`).
- **A virtual screen reader** ([Guidepup](https://www.guidepup.dev/docs/virtual)), loaded into the built pages with
  our CSP still enforced. `readAloud(page, selector)` gives what a screen reader says going through part of a page,
  `announced(page, action)` what it says by itself while something happens. It reads the accessibility tree the way
  VoiceOver and NVDA do, but it isn't one of them: how they pronounce code, and how long things feel when heard, is
  left to the manual check.

### What a new feature or a redesign adds

Each in the spec of the area it touches, in the same commit as the change:

1. **What is shown is also said.** Anything shown by colour, a mark, strike-through or position (risky, added,
   ignored, chosen…) gets hidden text, and a `readAloud` test that hears it.
2. **What changes is announced, briefly.** Anything that appears or changes without a page load (a result, an
   added tool, a copied link) is announced in one short line from a `role="status"` that is always in the page,
   outside anything hidden until it opens. An `announced` test checks the line, and that it isn't a whole panel.
3. **The focus is never lost.** When an action removes or replaces the control that had the focus, the focus goes
   to the start of what replaced it (a heading with `tabIndex={-1}`, or the field to type in). A test checks
   where it lands with `toBeFocused()`.
4. **A new page or view** goes in `everyView`, so axe and the high-contrast test run on it.
5. **A new tool or a redesign of one** gets the manual check below before it ships.

### Manual check with a screen reader

About 20 minutes with VoiceOver on a Mac, in Safari (the pair most VoiceOver users have). NVDA with Firefox on
Windows is the other common pair: the same steps work with its own keys.

| VoiceOver | What it does |
|---|---|
| <kbd>Cmd</kbd>+<kbd>F5</kbd> | Turn VoiceOver on or off |
| <kbd>Ctrl</kbd>+<kbd>Option</kbd> (VO) + <kbd>→</kbd> / <kbd>←</kbd> | Next / previous item |
| VO+<kbd>Space</kbd> | Press the item |
| VO+<kbd>U</kbd> | Rotor: lists of headings, links, landmarks, form controls (arrows to switch list) |
| <kbd>Tab</kbd> / <kbd>Shift</kbd>+<kbd>Tab</kbd> | Next / previous control |
| <kbd>Ctrl</kbd> | Stop speaking |

Use the production build (`yarn build && yarn preview`) or the live site. For each step, note what was unclear, too
long, missing or said twice, and open an issue for it.

1. **Home page.** The rotor's headings and landmarks give a fair idea of the page. Tab to the text box: you hear
   what to paste. Paste a policy (Cmd+V): you hear "Your policy, heading level 1", then the summary (enforced, number
   of rules) and its actions.
2. **The views.** The tabs say which is open and how many things to check; the arrow keys move between them.
   "Explain it for" says which reader is chosen.
3. **Reading the policy.** Tab to the policy: you hear "Policy 1: arrow keys move between its parts, Enter
   explains one, Tab goes to the explanation". The whole policy is one Tab stop. Move with the arrow keys: each part
   says what it is, and "risky", "ignored" or "something to check" where the page shows a colour or a mark. Press
   Enter on a part: you hear one line ("'unsafe-inline' in script-src: Inline code"). Press Tab: the explanation is
   read out. Shift+Tab takes you back to the part. The "Things to check" list comes after the explanation.
4. **Will my tools work?** Search for a tool, choose it with the arrows and Enter: you hear "Hotjar added". Its
   result says what works and what's missing. Remove it: "Hotjar removed", and you're back in the search.
5. **Report.** Choose a format, copy it: the button says "Copied".
6. **Edit, Done, Clear.** Edit puts you in the text box, Done back on "Your policy", Clear in the empty text box.
7. **Builder.** Choose a start and go Next: you land on the new step's question each time. On the last step, the
   values added for your tools say "added for your site or tools".
8. **Compare.** Try the example, open "Both policies": what the change added and removed is said, risky additions
   too.
9. **A guide page** (Moving to nonces): the contents list, the stack tabs and a code block's "Copy this".
10. **On a phone** (iPhone, triple-click the side button for VoiceOver), once a tool is redesigned: tap a part of the
    policy, swipe through the sheet, close it, and you're back on that part.

Write the date and what was found in the roadmap.

## Vendor catalogue

Each `catalogue/vendors/<id>.yaml` lists, per feature, what the tool needs (`type` of resource, CSP `sources`, `reason`). Rules:

- Every entry comes from the vendor's **official documentation**, listed in `sources`, with the `lastVerified` date.
- That documentation must be **public**. Some vendors only show their requirements to signed-in customers (in
  their app or a customer portal): suggest those tools only with the vendor's written approval to publish the
  list, or once the vendor makes it public.
- Use `confidence: partial` when the official page couldn't be fully captured, and explain what's missing in `notes`.
- `yarn catalogue:validate` checks the schema and that every source is a valid CSP expression.

The [roadmap](ROADMAP.md#2-vendor-catalogue) lists the tools in three groups: in the catalogue with known gaps, to
add from public documentation (anyone can suggest one with a link to the vendor's page), and private
documentation waiting for the vendor's approval.

Keeping it current: `.github/workflows/vendor-watch.yml` runs weekly. It extracts the CSP-relevant tokens (directives, keywords, hosts) from every documentation page, compares them with `catalogue/doc-snapshots.json`, and opens a pull request listing added or removed tokens. Pages that block automated reads (Hotjar and Cookiebot at the moment) are reported for a manual check.

## Translations

The site is in English (`/`) and French (`/fr`), with the same page addresses. English is the reference.
Interface and report text lives in `src/i18n/<locale>.json`, page copy in `src/i18n/<locale>.pages.json`. YAML
content is translated in separate files that hold text only: `src/content/<locale>/{directives,sources}.yaml` and
`catalogue/i18n/<locale>/<vendor id>.yaml`. Hosts, resource types and verification dates always come from the
English files, so a translation can't change what a tool needs.

A message that shows a number has a form per plural category, picked from `{count}` with each language's rules
(French uses the singular for 0 and 1): `"rules": { "one": "{count} rule", "other": "{count} rules" }`. Give every
language the same categories, even when the words don't change.

Each translated field records a hash of the English text it was translated from:

```yaml
features:
  tag:
    reasons:
      script: { en: c3c65a83, text: "Charge le script de suivi." }
```

When the English text changes, the hash no longer matches and the field shows in English until it is translated
again. `yarn i18n:status fr` lists what is missing or stale, and `yarn i18n:status fr --write` adds an empty entry,
with the English text as a comment, for every missing field. Keys that match nothing in English fail
`yarn catalogue:validate` and the tests.
