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

Yarn refuses package versions published in the last few days (`npmMinimalAgeGate`, a supply-chain safeguard). If an install fails with "quarantined", wait or pick the previous version rather than disabling it.

## Structure

| Path | What |
|---|---|
| `src/lib/csp/` | Pure TypeScript core: parser, fallback resolution, URL matcher (CSP Level 3), vendor compatibility, patch builder, security findings (Google's `csp_evaluator`). |
| `src/lib/reports/` | Report generators for each audience. |
| `src/content/` | Plain-language explanations of directives and sources (YAML, validated at build); translations in `src/content/<locale>/`. |
| `catalogue/vendors/` | One YAML file per tool, built from its official documentation. |
| `src/i18n/` | All interface and report text (`<locale>.json`) and page copy (`<locale>.pages.json`), in English and French. |
| `src/components/` | The analyzer (Preact island). |
| `src/pages/[...lang]/` | Analyzer, Find my CSP, What is a CSP, tool pages, directive pages, about; built in English (`/`) and French (`/fr`). |
| `src/site-policy.ts` | This site's own CSP (meta policy + header policy). |
| `src/usage.ts` | The usage events counted (anonymous, no cookies), shared with the Lambda in `infra/lambda/`. |
| `infra/` | AWS CDK app: S3 + CloudFront, security headers, GitHub OIDC deploy role. |
| `scripts/` | Catalogue validation, translation status and vendor documentation watcher. |

## Vendor catalogue

Each `catalogue/vendors/<id>.yaml` lists, per feature, what the tool needs (`type` of resource, CSP `sources`, `reason`). Rules:

- Every entry comes from the vendor's **official documentation**, listed in `sources`, with the `lastVerified` date.
- That documentation must be **public**. Some vendors only show their requirements to signed-in customers (in
  their app or a customer portal): suggest those tools only with the vendor's written approval to publish the
  list, or once the vendor makes it public.
- Use `confidence: partial` when the official page couldn't be fully captured, and explain what's missing in `notes`.
- `yarn catalogue:validate` checks the schema and that every source is a valid CSP expression.

The [roadmap](ROADMAP.md#vendor-catalogue) lists the tools in three groups: in the catalogue with known gaps, to
add from public documentation (anyone can suggest one with a link to the vendor's page), and private
documentation waiting for the vendor's approval.

Keeping it current: `.github/workflows/vendor-watch.yml` runs weekly. It extracts the CSP-relevant tokens (directives, keywords, hosts) from every documentation page, compares them with `catalogue/doc-snapshots.json`, and opens a pull request listing added or removed tokens. Pages that block automated reads (Hotjar and Cookiebot at the moment) are reported for a manual check.

## Translations

The site is in English (`/`) and French (`/fr`), with the same page addresses. English is the reference.
Interface and report text lives in `src/i18n/<locale>.json`, page copy in `src/i18n/<locale>.pages.json`. YAML
content is translated in separate files that hold text only: `src/content/<locale>/{directives,sources}.yaml` and
`catalogue/i18n/<locale>/<vendor id>.yaml`. Hosts, resource types and verification dates always come from the
English files, so a translation can't change what a tool needs.

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
