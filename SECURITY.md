# Security

CSP Explained runs in the visitor's browser: the policy, reports and messages people paste never leave it. The
site itself is static files behind CloudFront, plus two small functions that count usage and our own CSP
violations ([README › Usage counts](README.md#usage-counts)).

## Reporting a vulnerability

Please report it privately, through
[GitHub's private vulnerability reporting](https://github.com/tcoppin/csp-explained/security/advisories/new),
not in a public issue. Write in English or French. You'll get an answer within 7 days.

In scope:

- The site (csp-explained.com): anything that runs code a visitor didn't write, leaks what they pasted, or gets
  around the site's own Content-Security-Policy.
- The share links (`#…`) and what the site keeps in the browser's storage.
- The usage and violation endpoints (`/e`, `/csp-violation`) and the infrastructure in `infra/`.
- The build and deploy workflows in `.github/`.

Not security issues, but welcome as [normal issues](https://github.com/tcoppin/csp-explained/issues/new):

- A wrong or outdated vendor entry in the catalogue.
- An analysis that is wrong about a policy (a verdict, a finding, an explanation). Please don't paste a private
  policy in a public issue: a cut-down example is enough.

This is a personal project with no bug bounty. Reporters are credited in the release notes if they wish.
