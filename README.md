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

## Contributing

Suggestions and fixes are welcome, especially for the vendor catalogue. [CONTRIBUTING.md](CONTRIBUTING.md) covers
running the project, its structure, the catalogue rules and translations. [DEPLOY.md](DEPLOY.md) describes the
hosting setup.

## Roadmap

What's next and the ideas backlog live in [ROADMAP.md](ROADMAP.md).

## Licence

Free to use, host, modify and share. Not to be sold.

- Code: [MIT with the Commons Clause](LICENSE). The Commons Clause removes the right to sell the software,
  including paid hosting or support services built mainly on it.
- Vendor catalogue (`catalogue/`): [CC BY-NC 4.0](catalogue/LICENSE). Reuse it with credit, for non-commercial
  purposes: "Vendor catalogue from CSP Explained (https://csp-explained.com)".

Neither is an OSI-approved open source licence, because both restrict commercial use.
