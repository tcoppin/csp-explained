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
- The Lambda drops unknown events and any label that isn't a short id, then writes one log line per event: the time,
  the event name and its label, nothing else ([`src/usage.ts`](src/usage.ts), [`infra/lambda/usage.ts`](infra/lambda/usage.ts)).
  CloudWatch counts these lines for the dashboard. The lines are kept 13 months; the counts, 15 months.

The list above, [`src/usage.ts`](src/usage.ts) and the About page must stay in sync.

## Develop

Uses Yarn 4 (committed in `.yarn/releases`, so any global `yarn` picks the right version). `infra/` is a Yarn workspace.

```sh
yarn install
yarn dev               # http://localhost:4321 (our own CSP is only applied by `build`)
yarn test              # unit tests (vitest)
yarn check             # type check
yarn build && yarn test:e2e   # end-to-end tests against the production build
yarn og:image          # regenerate the link-preview image after changing the tagline or the palette
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
content is translated in
separate files that hold text only: `src/content/<locale>/{directives,sources}.yaml` and
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

## Releases

Versions follow [semantic versioning](https://semver.org/). Each one is a `vMAJOR.MINOR.PATCH` tag with a
[GitHub release](https://github.com/tcoppin/csp-explained/releases) whose notes say what changed: the releases
page is the changelog, so there is no `CHANGELOG.md`.

- **Major**: a change that breaks what people rely on: the share-link format, page addresses, or the catalogue
  YAML schema that contributors write.
- **Minor**: new features, tools or languages.
- **Patch**: fixes and catalogue corrections.

The site deploys on every push to `main`. A version is tagged once its changes are live on
[csp-explained.com](https://csp-explained.com), so a tag always names something that was in production. Tags
don't trigger any workflow. The `version` in `package.json` is bumped in the last commit before a tag, so each
tagged commit carries its own version.

## Deploy (AWS)

1. Create the GitHub repository and set `REPO_URL` in `src/config.ts` and `githubRepo` in `infra/cdk.json`. Newer
   repositories need `githubRepo` as GitHub writes it in the deploy token, with IDs (`owner@123/repo@456`): a refused
   deploy shows it as `userName` in the `AssumeRoleWithWebIdentity` event in CloudTrail.
2. Choose the domain: set `SITE_URL` in `src/config.ts`. For a custom domain, its Route 53 hosted zone must exist
   (created automatically when the domain is registered with Route 53). Create an ACM certificate in **us-east-1**
   for both `example.com` and `*.example.com` (a wildcard alone doesn't cover the bare domain), then set
   `domainName`, `certificateArn` and `hostedZoneId` in `infra/cdk.json`.
   The stack adds the DNS records and redirects `www.` to the domain.
3. Set up least-privilege deploys (once, with an administrator account). CloudFormation deploys the stack through
   an execution role limited to what this stack creates, and your everyday user can only use CDK's roles:
   - [`infra/iam/cfn-execution-policy.json`](infra/iam/cfn-execution-policy.json): what CloudFormation may create
     (the site bucket, CloudFront, DNS records, `CspExplainedSite-*` roles, the usage Lambda, log group and dashboard).
   - [`infra/iam/deployer-policy.json`](infra/iam/deployer-policy.json): attach it to the IAM user (or group) that
     runs `cdk deploy`. It only allows assuming the `cdk-hnb659fds-*` roles created by `cdk bootstrap`.

   Both files contain this site's account, region and hosted zone: replace them with yours.
   ```sh
   aws iam create-policy --policy-name CspExplainedCfnExecution \
     --policy-document file://infra/iam/cfn-execution-policy.json
   cd infra
   yarn cdk bootstrap --cloudformation-execution-policies arn:aws:iam::ACCOUNT_ID:policy/CspExplainedCfnExecution
   ```
4. Deploy the infrastructure from your machine with the everyday user: `yarn infra:deploy` (add
   `-c githubOidcProviderArn=…` if your account already has the GitHub OIDC provider). CI never deploys the
   infrastructure: run it again after changing `infra/`, **before** pushing site code that depends on it.
   If the stack gains a new kind of resource, extend the execution policy first:
   ```sh
   aws iam create-policy-version --set-as-default \
     --policy-arn arn:aws:iam::ACCOUNT_ID:policy/CspExplainedCfnExecution \
     --policy-document file://infra/iam/cfn-execution-policy.json
   ```
   A policy keeps at most five versions: delete an old one when AWS refuses a new one.
5. In GitHub, add the repository variables printed as outputs: `AWS_DEPLOY_ROLE_ARN`, `SITE_BUCKET`, `DISTRIBUTION_ID`, plus `AWS_REGION`, and create a `production` environment.
6. Every push to `main` that passes CI is deployed by `.github/workflows/deploy.yml`.

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
