# CSP Explained

Understand any Content-Security-Policy, in plain language. Paste a policy and get:

- **An annotated policy**: every directive and value is highlighted and explained, for three audiences (everyone, developers, security teams).
- **What it allows**: for each type of content, where the browser accepts it from.
- **Tool compatibility**: "Will Google Tag Manager / AB Tasty / Intercom… work with this policy? If not, which line is missing?"
- **A report per audience**: a message for IT that people can send as is (email, chat, ticket), a diff plus server snippets for developers, and a security review for security teams.

Everything runs in the browser: the policy is never sent anywhere. Share links keep it in the URL fragment (`#…`).

## Usage counts

To know whether the site is useful, it counts visits and a few actions. That's all it measures:

| Event | Counted when | Label sent with it |
|---|---|---|
| `visit` | A page is opened from outside the site | The page |
| `analyze` | A policy pasted or typed by the visitor is analysed (once per page load; not the example) | None |
| `example` | "Try an example" is clicked | None |
| `shared` | A share link is opened | None |
| `tool` | A tool is added in the tool picker | The tool's catalogue id |
| `copy-report` | A report is copied | The audience and the part copied (message, diff, deploy snippet, Markdown) |
| `copy-snippet` | The Find my CSP console snippet is copied | None |

What is never sent: the policy, the site address, the share link, any identifier. There are no cookies, nothing is stored
in the browser for counting, and no third-party service is involved.

How it works, so you can check it:

- The page sends a request to the site's own `/e` with the event name and its label, without a referrer
  ([`src/scripts/track.ts`](src/scripts/track.ts)).
- CloudFront forwards only the query string to a small Lambda: no headers, so no IP address or user agent
  ([`infra/lib/site-stack.ts`](infra/lib/site-stack.ts)).
- The Lambda drops unknown events and any label that isn't a short id, then writes one log line that CloudWatch turns
  into a daily count ([`src/usage.ts`](src/usage.ts), [`infra/lambda/usage.ts`](infra/lambda/usage.ts)). Logs are kept
  13 months.

The list above, [`src/usage.ts`](src/usage.ts) and the About page must stay in sync.

## Develop

Uses Yarn 4 (committed in `.yarn/releases`, so any global `yarn` picks the right version). `infra/` is a Yarn workspace.

```sh
yarn install
yarn dev               # http://localhost:4321 (our own CSP is only applied by `build`)
yarn test              # unit tests (vitest)
yarn check             # type check
yarn build && yarn test:e2e   # end-to-end tests against the production build
```

Yarn refuses package versions published in the last few days (`npmMinimalAgeGate`, a supply-chain safeguard). If an install fails with "quarantined", wait or pick the previous version rather than disabling it.

## Structure

| Path | What |
|---|---|
| `src/lib/csp/` | Pure TypeScript core: parser, fallback resolution, URL matcher (CSP Level 3), vendor compatibility, patch builder, security findings (Google's `csp_evaluator`). |
| `src/lib/reports/` | Report generators for each audience. |
| `src/content/` | Plain-language explanations of directives and sources (YAML, validated at build). |
| `catalogue/vendors/` | One YAML file per tool, built from its official documentation. |
| `src/i18n/en.json` | All interface and report text. |
| `src/components/` | The analyzer (Preact island). |
| `src/pages/` | Analyzer, Find my CSP, What is a CSP, tool pages, directive pages, about. |
| `src/site-policy.ts` | This site's own CSP (meta policy + header policy). |
| `src/usage.ts` | The usage events counted (daily totals, no cookies), shared with the Lambda in `infra/lambda/`. |
| `infra/` | AWS CDK app: S3 + CloudFront, security headers, GitHub OIDC deploy role. |
| `scripts/` | Catalogue validation and vendor documentation watcher. |

## Vendor catalogue

Each `catalogue/vendors/<id>.yaml` lists, per feature, what the tool needs (`type` of resource, CSP `sources`, `reason`). Rules:

- Every entry comes from the vendor's **official documentation**, listed in `sources`, with the `lastVerified` date.
- Use `confidence: partial` when the official page couldn't be fully captured, and explain what's missing in `notes`.
- `yarn catalogue:validate` checks the schema and that every source is a valid CSP expression.

Keeping it current: `.github/workflows/vendor-watch.yml` runs weekly. It extracts the CSP-relevant tokens (directives, keywords, hosts) from every documentation page, compares them with `catalogue/doc-snapshots.json`, and opens a pull request listing added or removed tokens. Pages that block automated reads (Hotjar at the moment) are reported for a manual check.

Known gaps and tools to add are tracked in [ROADMAP.md](ROADMAP.md#vendor-catalogue).

## Deploy (AWS)

1. Create the GitHub repository and set `REPO_URL` in `src/config.ts` and `githubRepo` in `infra/cdk.json`. Newer
   repositories need `githubRepo` as GitHub writes it in the deploy token, with IDs (`owner@123/repo@456`): a refused
   deploy shows it as `userName` in the `AssumeRoleWithWebIdentity` event in CloudTrail.
2. Choose the domain: set `SITE_URL` in `src/config.ts`. For a custom domain, its Route 53 hosted zone must exist
   (created automatically when the domain is registered with Route 53). Create an ACM certificate in **us-east-1**
   for both `example.com` and `*.example.com` (a wildcard alone doesn't cover the bare domain), then set
   `domainName`, `certificateArn` and `hostedZoneId` in `infra/cdk.json`.
   The stack adds the DNS records and redirects `www.` to the domain.
3. Deploy the infrastructure once from your machine:
   ```sh
   cd infra
   yarn cdk bootstrap       # once per account/region
   yarn cdk deploy          # add -c githubOidcProviderArn=… if your account already has the GitHub OIDC provider
   ```
4. In GitHub, add the repository variables printed as outputs: `AWS_DEPLOY_ROLE_ARN`, `SITE_BUCKET`, `DISTRIBUTION_ID`, plus `AWS_REGION`, and create a `production` environment.
5. Every push to `main` that passes CI is deployed by `.github/workflows/deploy.yml`.

## Roadmap

What's next and the ideas backlog live in [ROADMAP.md](ROADMAP.md). Conventions and known pitfalls for working on
the code (including with Claude Code) are in [CLAUDE.md](CLAUDE.md).

## Licence

Free to use, host, modify and share. Not to be sold.

- Code: [MIT with the Commons Clause](LICENSE). The Commons Clause removes the right to sell the software,
  including paid hosting or support services built mainly on it.
- Vendor catalogue (`catalogue/`): [CC BY-NC 4.0](catalogue/LICENSE). Reuse it with credit, for non-commercial
  purposes: "Vendor catalogue from CSP Explained (https://csp-explained.com)".

Neither is an OSI-approved open source licence, because both restrict commercial use.
