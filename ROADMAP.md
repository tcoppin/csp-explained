# Roadmap and ideas

Where CSP Explained is going, and a place to park ideas. Move items between sections as priorities change;
add the date when an idea comes in so old ones can be reviewed.

The sections are in the order of work (reviewed 2026-11-12): improve what exists, grow the catalogue, add features
that run in the visitor's browser, then tools outside the site that still need no server of ours. Everything that
needs our own server comes last, because it changes the site's promise that the policy never leaves the browser.

## 1. Improve what exists

- [ ] Accessibility audit with a screen reader user. The automated checks (axe, see Done) can't tell whether the
      explanations make sense when heard, or whether the sheet and tabs are easy to use with a screen reader.
- [ ] Print-friendly / PDF export of the reports.
- [ ] Nonce guide: more stacks if asked (ASP.NET Core, Laravel, SvelteKit, Nuxt, nginx in front of an app).
- [ ] Other languages come from contributors (decided 2026-11-12): CONTRIBUTING.md explains how to add one (the
      message files, YAML translations, `yarn i18n:status`, the locale list).
- [ ] `cspexplained.com` registration failed (AWS support contacted).

## 2. Vendor catalogue

Contribution rules for the catalogue are in [CONTRIBUTING.md](CONTRIBUTING.md#vendor-catalogue).

### In the catalogue, with known gaps

- [ ] **Contentsquare**: add `img-src` tracking domains, `blob:` workers (child-src / worker-src), `csxd.` frames.
- [ ] Google: country domains (`google.<TLD>`) for Ads and GA4 advertising features aren't checked.
- [ ] Intercom: EU and Australian workspace domains as separate features.
- [ ] Optimizely: account-specific frame domains (`a<account-id>.cdn.optimizely.com`).
- [ ] OneTrust: the official page lists domains without directives. Ask OneTrust which directive each domain
      belongs to, and whether the banner needs `'unsafe-inline'` for styles without a nonce.
- [ ] Didomi: directives aren't named in the docs (SDK host checked in script-src, API host in connect-src);
      confirm with Didomi. Its documented nonce covers injected styles only.
- [ ] Piano Analytics: the official page covers the CDN-hosted SDK only; add a self-hosted SDK and custom
      collection domains (CDDC) if Piano documents them.
- Hotjar and Cookiebot pages block automated reads: re-check them by hand when the weekly watcher can't.

### To add from public documentation (contributions welcome)

- [ ] Meta Pixel: no official CSP page yet; the public base code only shows the script and image hosts, not how
      events are sent.
- [ ] TikTok Pixel: the official documentation only renders with JavaScript; needs someone to read it in a
      browser.
- [ ] LinkedIn Insight Tag: the public troubleshooting page lists domains not to block, without directives or the
      tag code.
- [ ] Matomo: the public FAQ is complete, but describes the site's own Matomo server, an address the catalogue
      can't know (Matomo Cloud domains, or a field to type it in, would solve it).
- [ ] Not looked into yet: Segment, Mixpanel, Amplitude, HubSpot, Zendesk, Crisp, Stripe.js, YouTube and Vimeo
      embeds, reCAPTCHA, Cloudflare Turnstile.

### Private documentation (only with the vendor's approval)

- [ ] **Wingify (formerly VWO)**: the CSP list is only shown inside the app; its public help article links there.

### Schema

- [ ] A requirement type for tools that show the customer's site inside their own app (visual editors, replay
      viewers): `frame-ancestors`. Filled only where the public docs say so. The builder's starting
      `frame-ancestors 'self'` then opens up for those tools instead of breaking them (2026-11-12).
- [ ] Trusted Types compatibility per tool: none of the catalogue's vendors document Trusted Types publicly
      (checked 2026-11-05). Add an optional `trustedTypes` field (policy names, source, date) once one does.

### Keeping it current

Internal tooling, never part of the public site.

- [ ] Drift check in CI: a scheduled GitHub Actions job opens a blank local test page in a headless browser,
      loads each vendor's own tag there, and records which domains the tag really uses. It flags vendors that
      start using a domain their documentation doesn't list yet. Complements the weekly documentation watcher.
  - Decided 2026-11-12: observed domains may reach visitors, apart from the documented requirements and labelled
    "seen in use, not documented by the vendor", with the date. Verdicts and patches use documented requirements
    only.

## 3. New features, in the browser

Everything here runs on the visitor's device, like the analyzer: nothing typed, pasted or dropped is sent anywhere.

- [ ] **Explain a pasted console error** (2026-11-12): the parser already recognises violation messages but only
      asks for the policy. Name the blocked address and the directive, the catalogue tool behind it, and the line
      to add. Its engine serves the violation reports below too.
- [ ] **Who is this domain?** (2026-11-12): look up an address in the catalogue to find the tool behind it. The
      vendors page searches by name only today. Feeds the console-error explainer.
- [ ] **Read violation reports** (2026-11-05): paste or drop a batch of reports (`report-to` or `report-uri`
      format, or a log export). Group them by blocked address, directive and page; set noise apart (browser
      extensions, code injected on the visitor's device, the same visitor's repeats); name the catalogue tool
      behind each group and build the fix with the patch engine. Raw reports are noisy and can hold personal data
      (page addresses with query strings, referrers, code samples), so this one stays on the device too. Our angle
      is the plain-language explanation, the link to the catalogue and the ready fix, not storage: report
      collectors and error-tracking tools already accept CSP reports.
- [ ] **Import a HAR file** (2026-11-12; DevTools › Network › Save all as HAR): list every address the page
      loaded, by kind of content, recognise the catalogue tools, and build the policy from it in the builder. The
      file stays on the device; say so, since a HAR can hold cookies and personal data. Most of what "Check my
      website" (section 5) would offer, without a server.
- [ ] **Browser support** (2026-11-12): a line per directive and keyword on the directive pages, and a short note
      in the analyzer when a policy relies on something some browsers ignore (`script-src-elem`, `report-to`,
      Trusted Types). Notes only: verdicts keep assuming a current browser.
- [ ] **Guides** (2026-11-12):
  - Where to set a CSP, per platform (Shopify, WordPress, Webflow, Wix, Cloudflare), including those that only
    allow a `<meta>` tag, which loses `frame-ancestors` and reporting.
  - Ship a CSP without breaking your site: Report-Only, watch, enforce, tighten, through the builder, the
    reporting guide and the comparator.
  - Clickjacking: `frame-ancestors` and `X-Frame-Options`.
  - Common mistakes.
- [ ] **Builder: directives beyond fetch**: `report-to` with a `Reporting-Endpoints` header, `frame-ancestors`
      choices, Trusted Types.
- [ ] **Hashes: the remaining cases**: inline event handlers by hash (`'unsafe-hashes'`), and hashes of external
      scripts (CSP3, Chromium only).

## 4. Outside the site, still without our server

- [ ] **The core as an npm package or CLI** (2026-11-12): check a policy and a list of tools in CI with the same
      engine. Comes before any hosted API.
- [ ] **An MCP server for AI assistants**, shipped with that package and run on the user's machine.
- [ ] **Browser extension**: analyse the current tab's policy and violations in one click, on the device.
- [ ] **A violation collector site owners host themselves** (2026-11-05): an open-source endpoint as templates
      (Cloudflare Worker, AWS Lambda, Express/Node middleware). It shrinks each report as it arrives (the blocked
      address's origin, the page path without its query string; no sample, no IP address, no full user agent),
      keeps counts rather than raw reports, and alerts by email or webhook. "Read violation reports" (section 3)
      reads its export. The site owner keeps control of the data. What makes an alert worth sending:
  - a blocked origin that belongs to a tool the site uses;
  - a blocked origin first seen after a deploy;
  - a spike across many pages and many browsers, rather than one browser (usually an extension).

## 5. With our own server (last)

Decided 2026-11-12: these come after everything above. Each one sends something to a server we run, which the site
promises not to need today ("Your policy never leaves your browser"). Before shipping any of them, update that
promise on the About page and in the README, say on the page itself what is sent and kept, and keep the
browser-only way working.

### "Check my website"

Enter a site address instead of copying and pasting the policy. The HAR import (section 3) covers most of it first.

- [ ] **Get the policy automatically**: a server-side request reads the page's `Content-Security-Policy`
      headers and `<meta>` tags, and opens the analysis as if they had been pasted.
- [ ] **List the issues already in production**: load the page in a real (headless) browser and collect the
      CSP violations it triggers right now (`securitypolicyviolation` events and console errors). Show each one in
      plain language, linked to the tool it blocks and the line to add.
- [ ] Detect which known tools the page loads (script and network requests) and pre-select them in
      "Will my tools work?".
- [ ] Let people pick the page to check (homepage, product page, checkout), since policies can differ per page.

How it would run and what to watch:

- Reading headers needs only a small AWS Lambda behind CloudFront (`/api/*`). Collecting live errors needs a
  headless browser (Chromium in a Lambda container image, or a small Fargate task): more cost and longer runs,
  so cache results briefly and rate-limit with AWS WAF.
- Security: block private and internal addresses, including after redirects (SSRF), and limit the time and size
  of each check. Don't log the addresses people check, and say so on the page.
- Limits to explain in the UI: errors that only happen after cookie consent, a login or a click won't show up;
  some sites block automated browsers.
- The live check runs our browser on someone else's site, so keep it to one page load per request, with a
  clear user agent.

### Violation reports, collected by us

- [ ] **Use the collector on our own site**: our policy sends no reports today. Reports from our visitors would
      reach our server (page addresses, browsers), so the About page must list them first.
- [ ] **A hosted collection service** (pairs with Monitoring, maybe paid): only after a data processing
      agreement, EU hosting and short retention, with the self-hosted collector's shrinking at intake.

### More value, maybe paid

- [ ] Monitoring: alert when a site's CSP changes in a way that breaks a selected tool.
- [ ] Team workspaces: saved policies, shared reports, history.
- [ ] A hosted API for CI pipelines, for those who can't run the npm package.
- [ ] Vendor-sponsored "verified" listings, clearly labelled, with no influence on results.

## Decisions

- 2026-10-28: keep the name **CSP Explained**. "Explained" matches what people search for ("CSP explained") and
  the plain-language voice better than "CSP Explainer".
- 2026-11-12: the site stays on CSP. Other headers appear only where they interact with a policy, explained from
  the CSP side: `X-Frame-Options` beside `frame-ancestors`, `Reporting-Endpoints` beside `report-to`. No HSTS, CORS
  or Permissions-Policy sections, so no umbrella name.
- Stay clearly apart from securityheaders.com (a grading scanner): avoid names close to it and don't drift into
  scoring sites.
- 2026-11-12: Google's CSP Evaluator stays for its research on allowlist bypasses; our own checks cover what it
  misses.
- 2026-11-12: features that need our server come last (section 5).

## Done

### Review of 2026-11-12

A full review with the owner: the engine against tricky policies, every page in screenshots, and the earlier
choices.

Correctness:

- [x] Each security finding appears once. CSP Evaluator raised some once per kind of script:
      `script-src 'strict-dynamic' https:` listed "`https:` is ignored" three times, under a "0 high, 0 medium,
      0 low findings" heading.
- [x] Our own checks, on top of CSP Evaluator:
  - `'strict-dynamic'` with no nonce or hash: no script can run.
  - The builder's `'nonce-REPLACE_PER_PAGE'` left in place.
  - A hash whose length doesn't fit its algorithm (`'sha256-abc'`): it never matches.
  - `sandbox` and `upgrade-insecure-requests` in a Report-Only policy, where browsers ignore them.
  - Keywords other than `'self'` and `'none'` in `frame-ancestors`.
- [x] The patch skips a value that another added value already covers: GA4's `https://*.google.com` and GTM's
      `https://www.google.com` both landed in `connect-src` (IT message, diff and builder).
- [x] Check `worker-src` with `'strict-dynamic'` against CSP3: no change needed. The worker-src check (§6.2.2.1) is a
      plain source-list match, without nonces or `'strict-dynamic'`; those apply only when a worker falls back to
      `script-src` (§6.1.10.1), as the matcher already does (`matcher.test.ts`).
- [x] The deprecated-directive message is written per directive. `report-uri` still works everywhere and some
      browsers only report through it: keep it beside `report-to`, never say it has no effect.
- [x] The warning icon in "Read it" uses the warning colour, not the blocked one.
- [x] "What it allows" leaves out values that don't reach a row (`'unsafe-inline'` and `'unsafe-eval'` on
      background workers).
- [x] Learn: a policy doesn't stop data leaving through a link click or a redirect; it doesn't say it does.

Interface:

- [x] High security findings count in "Read it" ("Things to check" and its badge) for every audience, in plain
      words for everyone, linking to the security review.
- [x] A finding about a value that picked tools need names them, and the nonce way out for those that support one.
- [x] "Will my tools work?": what's missing first, what already works folded ("Show the 4 that already work").
- [x] Security review: findings in the current policy first, then those the proposed change would add.
- [x] "What it allows": a "Who can embed your site" row (`frame-ancestors`), in plain words.
- [x] Learn: a short "What it can't do" section. A safety net, not a wall.
- [x] Comparator: nonces and hashes kept apart from addresses. A renewed nonce is no change (a quiet note says so),
      the same nonce on both sides is a warning, inline code allowed by hash gets its own lines.
- [x] Builder: an "Older browsers too" option on the nonce start, adding `'unsafe-inline' https:`. The nonces guide
      says why it's off by default.

### Features

- [x] **Policy comparator** (`/compare`, 2026-11-11): two policies (before/after, staging vs production). What
      changes per kind of content through the fallback chain, both policies with the edits marked (inline, or side
      by side on wide screens), findings fixed and introduced, and tools the change breaks or fixes. Opened from the
      analyzer, the recent analyses (once the history is on) and the builder (when it started from a policy).
- [x] **Recent analyses** (2026-11-06): the last 10 policies analysed, with the site, tools, view and audience,
      in the browser's own storage only. Listed under the empty editor to reopen one where it was left, delete
      one or all. The example isn't kept. Opt-in since 2026-11-11: nothing is kept until the visitor asks for a
      history, and turning it off forgets it; a browser that already held one carries on.
- [x] **Storage only on request** (2026-11-11): everything kept in the browser is written after the visitor does
      something that needs it (a choice, or a feature turned on), as EU ePrivacy rules expect, without a consent
      banner. The About page lists each key from `src/stored.ts`, and a test fails on a key it doesn't explain.
      The rule for new storage is in CLAUDE.md.
- [x] **Nonce migration guide** (`/nonces`, 2026-11-06): from `'unsafe-inline'` to a nonce with `'strict-dynamic'`:
      the policy to aim for, the rules for the value, code for Node.js (Express), Next.js, PHP, Django and Rails
      checked against their official docs, hashes for static sites, a report-only rollout and third-party tools.
      Linked from `script-src`, the glossary, the builder's nonce note and the `script-unsafe-inline` finding.
- [x] **Hashes for inline scripts and styles** (2026-11-05): paste the code (with or without its tags), get its
      `'sha256-…'`, as an alternative to `'unsafe-inline'` when a nonce isn't possible. One generator
      (`HashTool.tsx`), used in two places: the builder lists inline code by hash, and the analyzer offers it
      under `'unsafe-inline'` and from the `script-unsafe-inline` finding.
- [x] **Policy builder** (`/build`, 2026-10-30): start from nothing (a tight allowlist, or a nonce with
      `'strict-dynamic'` when the site can add one) or from an existing policy, answer a few questions about the
      site's own pages, pick catalogue tools or describe your own. Every added value says who asked for it.
      Own tools stay in the link and in the browser's storage. Hand-offs both ways with the analyzer.
- [x] **Reporting guide** (`/reporting`, 2026-11-05): the two headers (`report-to`, `Reporting-Endpoints`), both
      report formats annotated, how to read them, what to watch before collecting. Linked from the reporting
      directives, the glossary and the builder's "Put it live" tab.
- [x] **Trusted Types explainer** (`/trusted-types`, 2026-11-05), with a note beside the tools in the analyzer and
      the builder when the policy enforces them.
- [x] **Navigation** (2026-11-06): the header shows the three tasks and a Learn dropdown on desktop, and a Menu
      with the whole site, each page with a line saying what it's for. Phones get the brand and Menu; the header
      stays at the top. The colour theme moved to the footer.
- [x] **Privacy-friendly usage counts**: one anonymous log line per event through our own `/e` endpoint, counted
      on a CloudWatch dashboard (`src/usage.ts`). No cookies, no third party, never the pasted policy.
- [x] **Accessibility**: automated WCAG 2.2 AA checks (axe) on every page, both languages and themes, the analysis
      views, the builder and the open menu, in the e2e suite (2026-11-06). Controls take a 44px tap on touch
      screens, except the policy's tappable parts (36px).
- [x] **Release management** (2026-10-29): semantic versioning with `vMAJOR.MINOR.PATCH` tags and a GitHub release
      for each (rules in README › Releases); the releases page is the changelog, so there's no `CHANGELOG.md`.
      Automatic since v1.1.0: commit titles follow Conventional Commits and decide the version; the deploy workflow
      tags and publishes the release once the site is live (`scripts/release.ts`).

### Translations (French first, 2026-10-29)

English stays the reference; other languages only replace text, never facts.

- [x] **All copy through `t()`**: the copy written into pages and code moved into `src/i18n/`, with the locale
      passed to `t`.
- [x] **Translation files for YAML content**: `src/content/fr/*.yaml` and `catalogue/i18n/fr/<id>.yaml` hold text
      only (titles, voices, `label`, `reason`, `notes`, `nonce.how`), keyed by `name`/`id`, feature id and
      requirement `type`. Hosts, types and dates come only from the English files, so a translation can't change a
      requirement, and `lastVerified` stays tied to the facts.
  - Each translated field stores a short hash of the English text it came from. Missing or stale fields fall
    back to English, field by field; the validators list them without failing (`yarn i18n:status`), so a
    vendor update never waits on a translation. Orphan keys fail validation, as does a `type` used twice in
    one feature.
  - Our own plain-language copy per security finding `id`, instead of csp_evaluator's English `description`.
- [x] **French pages**: `/fr/…` with the same slugs, `<html lang>`, `hreflang` alternates (pages and sitemap),
      canonical address and Open Graph image per language, a language link in the footer that keeps the `#` part.
      Shared links carry the language through their path. The IT message can be written in the other language,
      tool texts included.
- [x] French 404 page: CloudFront serves one error page for every address, so the 404 page speaks both languages.
- [x] Suggest the other language to visitors whose browser prefers it: a quiet note above the header, in that
      language, never a redirect. Dismissing it or using the footer language link is remembered on the device.

### Before launch

- [x] Publish the repository (`tcoppin/csp-explained`, public): code under MIT with the Commons Clause, vendor
      catalogue under CC BY-NC 4.0.
- [x] GitHub settings for a public repository: secret scanning and push protection, private vulnerability
      reporting, a ruleset blocking force pushes and deletion on `main`, and approval before workflows run for
      outside contributors.
- [x] Register `csp-explained.com` (Route 53); certificate in us-east-1; first `cdk deploy`, GitHub repository
      variables, `production` environment (see DEPLOY.md).
- [x] Check the console snippet's `copy()` by hand in Chrome, Firefox and Safari (synchronous since Firefox
      ignored late calls).
- [x] Illustrations for the Network tab steps on Find my CSP: a simplified, themed drawing per browser
      (`DevtoolsSketch.astro`) rather than screenshots, which go stale with each browser release.
- [x] Open Graph image and description for link previews (`yarn og:image`); `sitemap.xml` and `robots.txt`.
