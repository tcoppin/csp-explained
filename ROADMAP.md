# Roadmap and ideas

Where CSP Explained is going, and a place to park ideas. Move items between sections as priorities change;
add the date when an idea comes in so old ones can be reviewed.

## Before launch

- [x] Publish the repository (`tcoppin/csp-explained`, public): code under MIT with the Commons Clause, vendor
      catalogue under CC BY-NC 4.0.
- [x] GitHub settings for a public repository: secret scanning and push protection, private vulnerability
      reporting, a ruleset blocking force pushes and deletion on `main`, and approval before workflows run for
      outside contributors.
- [ ] `cspexplained.com` registration failed (AWS support contacted).
- [x] Register `csp-explained.com` (Route 53).
- [x] Certificate in us-east-1; set `certificateArn` and `hostedZoneId` in `infra/cdk.json` (see README › Deploy).
- [x] First `cdk deploy`, GitHub repository variables, `production` environment (see README › Deploy).
- [x] Check the console snippet's `copy()` by hand in Chrome, Firefox and Safari (synchronous since Firefox
      ignored late calls).
- [x] Illustrations for the Network tab steps on Find my CSP: a simplified, themed drawing per browser
      (`DevtoolsSketch.astro`) rather than screenshots, which go stale with each browser release.
- [x] Open Graph image and description for link previews (`yarn og:image`).
- [x] `sitemap.xml` (`@astrojs/sitemap`) and `robots.txt`.

## Vendor catalogue

Known gaps:

- [ ] **Hotjar**: help center blocks automated reads. Verify the stricter per-directive template by hand.
- [ ] **Contentsquare**: add `img-src` tracking domains, `blob:` workers (child-src / worker-src), `csxd.` frames.
- [ ] **VWO**: requirements are only shown inside the VWO app; get them from an account or support.
- [ ] Google: country domains (`google.<TLD>`) for Ads and GA4 advertising features aren't checked.
- [ ] Intercom: EU and Australian workspace domains as separate features.
- [ ] Optimizely: account-specific frame domains (`a<account-id>.cdn.optimizely.com`).
- [ ] OneTrust: the official page lists domains without directives. Ask OneTrust which directive each domain
      belongs to, and whether the banner needs `'unsafe-inline'` for styles without a nonce.

Tools to add (official docs only): Didomi, Cookiebot, Meta Pixel, TikTok Pixel,
LinkedIn Insight Tag, Microsoft Clarity, Matomo, Piano Analytics, Segment, Mixpanel, Amplitude, HubSpot,
Zendesk, Crisp, Stripe.js, YouTube and Vimeo embeds, reCAPTCHA, Cloudflare Turnstile.

Keeping it current (internal tooling, never part of the public site):

- [ ] Drift check in CI: a scheduled GitHub Actions job opens a blank local test page in a headless browser,
      loads each vendor's own tag there, and records which domains the tag really uses. It flags vendors that
      start using a domain their documentation doesn't list yet. Complements the weekly documentation watcher.

## Translations (French first)

Added 2026-10-29. English stays the reference; other languages only replace text, never facts.

- [x] **Step 1, all copy through `t()`**: move the copy written into pages (What is a CSP, About, Find my CSP)
      and code (deploy target captions) into `src/i18n/`, and pass the locale to `t` instead of importing a
      fixed English one. Useful even if no translation ships.
- [x] **Step 2, translation files for YAML content**: `src/content/fr/*.yaml` and `catalogue/i18n/fr/<id>.yaml`
      hold text only (titles, voices, `label`, `reason`, `notes`, `nonce.how`), keyed by `name`/`id`, feature id
      and requirement `type`. Hosts, types and dates come only from the English files, so a translation can't
      change a requirement, and `lastVerified` stays tied to the facts.
  - Each translated field stores a short hash of the English text it came from. Missing or stale fields fall
    back to English, field by field; the validators list them without failing (`yarn i18n:status`), so a
    vendor update never waits on a translation. Orphan keys fail validation, as does a `type` used twice in
    one feature.
  - Our own plain-language copy per security finding `id`, instead of csp_evaluator's English `description`.
- [x] **Step 3, French pages**: `/fr/…` with the same slugs, `<html lang>`, `hreflang` alternates (pages and
      sitemap), canonical address and Open Graph image per language, a language link in the footer that keeps
      the `#` part. Shared links carry the language through their path. The IT message can be written in the
      other language, tool texts included.
- [ ] French 404 page: CloudFront serves one error page; a CloudFront Function could pick `/fr/404` for `/fr/…`.
- [ ] Suggest the French site to visitors whose browser prefers French (a dismissible note, never a redirect).

## Phase 2: "Check my website"

Enter a site address instead of copying and pasting the policy.

- [ ] **Get the policy automatically**: a server-side request reads the page's `Content-Security-Policy`
      headers and `<meta>` tags, and opens the analysis as if they had been pasted.
- [ ] **List the issues already in production**: load the page in a real (headless) browser and collect the
      CSP violations it triggers right now (`securitypolicyviolation` events and console errors). Show each one in
      plain language, linked to the tool it blocks and the line to add.
- [ ] Detect which known tools the page loads (script and network requests) and pre-select them in
      "Will my tools work?".
- [ ] Let people pick the page to check (homepage, product page, checkout), since policies can differ per page.
- [ ] Paste a console error or a violation report: "which tool is this, and what's the fix?" (works without
      the server).

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

## Name and wider scope

Decided 2026-10-28: keep **CSP Explained**. "Explained" matches what people search for ("CSP explained") and
the plain-language voice better than "CSP Explainer".

- [ ] If the site grows beyond CSP to other security headers (HSTS, Permissions-Policy, COOP/COEP, CORS,
      cookies), choose an umbrella name then, with CSP as its main section (`/csp`) and the current domain
      redirecting there. Each header gets the same three voices.
- Stay clearly apart from securityheaders.com (a grading scanner): avoid names close to it and don't drift
  into scoring sites.

## Phase 3: more value, maybe paid

- [ ] Browser extension: analyse the current tab's policy and violations in one click.
- [ ] Monitoring: alert when a site's CSP changes in a way that breaks a selected tool.
- [ ] Team workspaces: saved policies, shared reports, history.
- [ ] API and an MCP server for CI pipelines and AI assistants.
- [ ] Vendor-sponsored "verified" listings, clearly labelled, with no influence on results.

## Ideas backlog

- [ ] Compare two policies (before/after, staging vs production) with a plain-language diff.
- [ ] Nonce migration guide: from `'unsafe-inline'` to a nonce-based policy with `'strict-dynamic'`, per stack.
- [ ] Policy builder for people starting from nothing, driven by the tools they use.
- [ ] Explain reporting setups (`report-to`, `Reporting-Endpoints`) and what reports look like.
- [ ] Trusted Types explainer and compatibility notes per tool.
- [ ] Print-friendly / PDF export of the reports.
- [x] Privacy-friendly usage counts: one anonymous log line per event through our own `/e` endpoint, counted on a
      CloudWatch dashboard (`src/usage.ts`). No cookies, no third party, never the pasted policy.
- [ ] Accessibility audit with a screen reader user.
