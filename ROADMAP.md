# Roadmap and ideas

Where CSP Explained is going, and a place to park ideas. Move items between sections as priorities change;
add the date when an idea comes in so old ones can be reviewed.

The sections are in the order of work (reviewed 2026-11-12): improve what exists, grow the catalogue, add features
that run in the visitor's browser, then tools outside the site that still need no server of ours. Everything that
needs our own server comes last, because it changes the site's promise that the policy never leaves the browser.

## 1. Improve what exists

- [ ] **Screen reader check by an experienced user** (VoiceOver or NVDA, ideally someone who uses one daily). The
      automated checks (see Done) can't tell how code is pronounced, whether the explanations make sense when heard,
      or how the tools feel to use. The owner tried on 2026-11-16 and found the policy took a Tab stop per part
      (fixed); a full run needs someone at ease with a screen reader. Give them the script in CONTRIBUTING.md ›
      Accessibility. Ways to find someone: a request on the repository's issues, accessibility communities, a
      local association for blind and partially sighted people, or a paid accessibility testing service.
      Also check "Save a copy" under each report (2026-11-16): the group and its two choices are read with their
      names; "Print or save as PDF" opens the print window and, once closed, the focus is back on that button;
      a PDF saved from it, opened in a PDF reader, reads headings and the policy in order; the downloaded .html
      file reads the same way in a browser.
      Also the address search on the Tools page (2026-11-17): typing `static.hotjar.com` in "Find a tool or an
      address", the result is announced once typing pauses ("static.hotjar.com is used by Hotjar"), not after each
      letter; the lines under a tool make sense heard ("https://static.hotjar.com in script-src, for…"), including
      how the addresses and directive names are pronounced.
      And the console-message explainer (2026-11-17): paste a few console messages in the analyzer; "6 messages
      explained" is heard once; each message reads as a heading, then whether it was blocked or only reported, then
      the tool and the line; the hash generator under a Safari message is easy to reach and its result is heard.
      And the reports reader (`/reports`, 2026-11-20): with "Try an example", "117 reports read" is heard once; each
      problem reads as a heading, then blocked or only reported, then "46 reports on 6 pages from…"; the pages list
      and "Set apart" open and close with Enter and say so; "Open a file" opens the file picker and, once a file is
      read, its name is heard; "Clear" puts the focus back in the box. Under "A script from cdn.jquery-libs.example",
      the warning is heard before the "I know what this is" checkbox; checking it says "…added to the lines" and
      the focus stays on it. "Only the reports since" is a date field: picking a day says "N reports since…";
      And "A quicker way, less safe" (2026-11-20), under a style attribute in the reports example and under `eval` in
      the console example: it is heard after the safe way, says it is collapsed or expanded, and once open the warning
      is heard before the line to copy.
      And the "Set apart" sections at the end of the reports example (2026-11-20): one per cause (extensions,
      software on visitors' devices, translation), each heard as its own collapsed group with its title and counts.
      And the problems as rows (2026-11-20): each row is heard as one control with what was blocked, its level and
      its count ("A script from cdn.jquery-libs.example, Check first, 5 reports, collapsed"), says expanded once
      opened, and its detail reads in order (the reasons it ranks there, the counts, the explanation, the warning
      before the checkbox). The arrows on folds aren't read. And the bar the box folds into once reports are read
      (2026-11-21): after "Try an example", the focus lands on "What the 138 reports say" and that is heard;
      "Change" puts it back in the box, "Done" on the heading again; the summary's highlighted counts are heard as
      plain words, and each row is heard with its level first ("Check first, A script from…, 5 reports").
      And the warning on public CDNs (2026-11-23): on the Tools page, jsDelivr's line says "Risky for your site";
      on its page, "Risk:" and the warning are heard before "Check jsDelivr against my policy"; in the tool
      picker, cdnjs is heard as "cdnjs risky" (not "cdnjsrisky"); once picked, in the builder and the analyzer, the
      warning is the first thing heard under the tool's name.
      And the folded categories on the Tools page (2026-11-23): each category is heard as a heading inside a
      collapsed control, with its count and the names of its tools ("Analytics, 4 tools, Amplitude, …, collapsed"),
      and moving by headings still reaches every category (VoiceOver with Safari is known to drop headings inside a
      summary: check it there). Enter opens it and says expanded; typing "jquery" in the search opens Libraries and
      frameworks, and clearing it folds that back.
      And partly verified tools in the builder (2026-11-23): picking Tealium iQ, its open card says "Partly verified:"
      and what's missing before its lines; on the last step, "Things to know" counts one more note, and its heading
      "Check these tools before you enforce the policy" is followed by the tools' names.
      And the account address fields (2026-11-23): picking Matomo in the builder, "Your Matomo address, edit text" is
      heard with its hint; typing "stats shop" makes it invalid and the error is heard with it; Piwik PRO's "Your
      account name" in the analyzer, and the same field in the comparator's tools. Datadog RUM's "Your Datadog site" is a list:
      heard as a pop-up button with its hint, and "Choose…" first.
      And "Save a copy" at the end of the results (2026-11-21): the group and its two checkboxes are read with their
      names; after "Print or save as PDF" the focus is back on that button; the downloaded .html file reads in
      order in a browser (title, the details under it, "In short", each problem as a heading with its level first);
      a PDF saved from it, opened in a PDF reader, reads the same way.
      And "… is one of my domains" under an unknown address (2026-11-21): checking it says "…counted as one of your
      domains", and the focus stays on it although its row can move in the list.
      And "What the reports quoted" in an opened row (2026-11-21): heard as a fold; the quoted code and the script
      addresses are read as code, with their counts.
      And "Can you enforce it?" for a report-only batch (2026-11-20): heard as a heading, the verdict ("Not yet",
      "It looks ready", "too soon to say") read first and stressed; after picking a day in "Only the reports
      since", the new verdict can be found again easily (it is above the lines, not announced by itself).
- [ ] Reports reader: try a real export from Sentry, Datadog, report-uri.com and URIports. The reader goes by field
      and column names (`blocked_uri`, `@csp-report.blocked-uri`, `tags[blocked-uri]`, "Blocked URI"…). Checked on
      2026-11-21 against what is public: Sentry's CSP interface keeps `document_uri`, `violated_directive`,
      `blocked_uri` and `effective_directive` and writes them back under `csp-report`
      (`src/sentry/interfaces/security.py`); Datadog's intake keeps the browser's `csp-report` as sent (its CSP logs
      integration page and blog post). Neither documents its export file (columns, layout), and report-uri.com and
      URIports document theirs only behind a login. An anonymised export from someone who uses one would settle it;
      add it to `src/lib/csp/violation-reports/` as a fixture.
- [ ] Nonce guide: more stacks if asked (ASP.NET Core, Laravel, SvelteKit, Nuxt, nginx in front of an app).
- [ ] Other languages come from contributors (decided 2026-11-12): CONTRIBUTING.md explains how to add one (the
      message files, YAML translations, `yarn i18n:status`, the locale list).
- [ ] `cspexplained.com` (without the hyphen): retry later. On 2026-11-17, AWS support said the account can't
      register more domains and that they can't lift that restriction for now. Another registrar, with a redirect
      to `csp-explained.com`, is the fallback.

## 2. Vendor catalogue

Contribution rules for the catalogue are in [CONTRIBUTING.md](CONTRIBUTING.md#vendor-catalogue).

### In the catalogue, with known gaps

- [ ] Google: country domains (`google.<TLD>`) for Ads and GA4 advertising features aren't checked.
- [ ] Intercom: EU and Australian workspace domains as separate features.
- [ ] Optimizely: account-specific frame domains (`a<account-id>.cdn.optimizely.com`).
- [ ] OneTrust: the official page lists domains without directives. Ask OneTrust which directive each domain
      belongs to, and whether the banner needs `'unsafe-inline'` for styles without a nonce.
- [ ] Didomi: directives aren't named in the docs (SDK host checked in script-src, API host in connect-src);
      confirm with Didomi. Its documented nonce covers injected styles only.
- [ ] Piano Analytics: the official page covers the CDN-hosted SDK only; add a self-hosted SDK and custom
      collection domains (CDDC) if Piano documents them.
- [ ] Font Awesome: the public docs only name `kit.fontawesome.com`, not the hosts a Kit loads icons and fonts from,
      and give no CDN address for version 6 or later.
- [ ] Vue: the docs don't say what the in-browser template compiler (`vue.global.js`) needs (`'unsafe-eval'`?).
- [ ] Tailwind Play CDN: the docs don't say how the generated styles are added (injected `<style>`?).
- [ ] D3: the recommended ES module bundle (`d3@7/+esm`) may import other jsDelivr packages; only the UMD bundle
      is covered.
- [ ] Amplitude: no CSP page, only two rows of the Browser SDK troubleshooting table; nothing on the inline loader.
- [ ] YouTube: no CSP page; the entry uses the embedding docs' addresses. `www.youtube-nocookie.com` isn't covered.
- [ ] HubSpot: the public list is written for HubSpot-hosted pages; the entry covers the NA1 data centre only
      (EU1, NA2, NA3 and AP1 addresses as separate features).
- [ ] Libraries on jsDelivr and unpkg are pinned to the version their docs show (Bootstrap 5.3.9, htmx 2.0.11, …):
      update them when the docs move to a new version (the weekly watcher reports the new address).
- [ ] Tealium iQ: the official page lists the Collect, data layer enrichment and API domains without directives;
      only the tag management domains are checked (script-src). Ask Tealium which directive each belongs to.
- [ ] Segment: its FAQ names cdn.segment.com and api.segment.io without directives; the entry puts the scripts in
      script-src, the settings and events in connect-src. Confirm with Segment.
- Hotjar, Cookiebot, Usercentrics, TrustArc, Segment, Adobe Fonts, Adyen, tawk.to and Kameleoon pages block automated reads: re-check them by hand when the weekly watcher can't.
- GSAP, AngularJS, jsDelivr and the Google Fonts FAQ only show their addresses once JavaScript runs (read in a
      browser, 2026-11-23): the weekly watcher can't see them change, so re-check them by hand.

### To add from public documentation (contributions welcome)

- [ ] Meta Pixel: no official CSP page yet; the public base code only shows the script and image hosts, not how
      events are sent.
- [ ] TikTok Pixel: the official documentation only renders with JavaScript; needs someone to read it in a
      browser.
- [ ] LinkedIn Insight Tag: the public troubleshooting page lists domains not to block, without directives or the
      tag code.
- [ ] Matomo Cloud: the self-hosted Matomo is in the catalogue (its address typed in a field); Matomo Cloud's
      tracker addresses aren't documented publicly.
- [ ] No official CSP page found (2026-11-23): Mouseflow, Quantum Metric, Heap, Plausible, Microsoft Advertising
      UET, Sentry (its pages cover sending CSP reports to Sentry, not what the browser SDK needs).
- [ ] Vimeo: the developer site only renders with JavaScript, and the help centre has no CSP article.
- [ ] Mixpanel: no CSP page; the JavaScript SDK page names `cdn.mxpnl.com` and regional API hosts only.
- [ ] Libraries whose docs couldn't give a CDN address (checked 2026-11-23): Three.js (its import map writes
      `three@<version>` without a version to pin), Lodash (links to jsDelivr's project page
      only), Chart.js (links to the CDNs' pages only), Select2 and Fancybox (version unreadable in the page),
      Lottie and Modernizr (no CDN address). Modernizr's ES5 detect is said to use `eval()`: confirm on its
      download page.
- [ ] Microsoft Ajax CDN (`ajax.aspnetcdn.com`), listed on jQuery's download page: check whether Microsoft still
      documents it.

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
- [ ] **Domains that changed hands** (2026-11-23): warn when a policy allows a domain known to serve malicious code
      after a change of owner, starting with `polyfill.io` (2024), and point to the replacement (cdnjs's polyfill
      copy is in the catalogue). Sourced from the official statements, like the catalogue.

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

- [x] **Read violation reports** (`/reports`, 2026-11-20): paste or open a batch of reports (`report-to` or
      `report-uri`, a JSON export, one per line, inside log lines or a collector's wrapper). Reports about the same
      address or code, under the same rule and policy, are one problem, with their pages (without query strings) and
      browsers. Under a one-sentence summary ("2 to check first, 3 to look at next…"), each problem is a folded
      row (what was blocked, its level, its count, an arrow), and the lines come after the problems, so the
      warnings come before the copy buttons. Problems come riskiest first, not most reports first ("Check first",
      "Then", "Less urgent", with why): an address no tool uses, a problem mostly on pages where visitors pay or sign in (by the words in their
      address, in five languages), code or data blocked for visitors before a look, new before gone. For each
      report-only policy, "Can you enforce it?": not yet (what it would block, how much the lines settle, what needs
      the code to change), too soon to say (less than a week of reports, or no dates), or ready, with how to switch;
      read from a day on, it answers "is it ready since the fix?". Each is explained like a console message (the tool, the case, the fix), but on
      the whole policy the report carries: one line per rule and policy, and the fixed policy opens in the comparator.
      What the site didn't cause is set apart and adds no line, one folded section per cause: browser extensions,
      software on visitors' devices (antivirus, adware, company proxies: the hosts from Sentry's list of CSP noise),
      translation (Chrome's, or a page shown through `translate.goog`), problems only apps' built-in browsers or
      only bots reported, copies of the pages (a search engine's cache, an archive, a saved file) and the
      browser's own addresses (`about:`, `chrome://`…). Safari's older reports, which don't say whether
      the policy was enforced, are marked. Nothing leaves the device or is kept: not in the address, not in storage.
      An address no catalogue tool uses, outside the site's own domain, could be injected code as well as a forgotten
      tool: it is explained with how to check it, and left out of the lines until the visitor ticks "I know what
      this is", or "… is one of my domains" (every address on that domain at once: a CDN of the site's own). Only
      an unknown address that is new, on a few pages or mostly on checkout and sign-in pages comes first; one on most
      pages since the reports start is more likely a forgotten tool, one level down, and says so. Each problem shows,
      folded, what the reports quoted: the start of the blocked code (`'report-sample'`) and the script that was
      running (without its query string); with nothing quoted, how to get it. Collectors' exports are read by their field names, in JSON or in CSV and TSV with a header row
      (a record keeping a report twice, raw and parsed, counts once). Dated reports (a collector's field or column,
      or the date starting a log line) give each problem its first and last day and can be read from a day on; a
      policy every report of which came before the newest one's first is an older version: its reports are read
      against the newest, and what that one allows is the list's last row, marked "Allowed since" the day that policy started coming (not "fixed": the reports can't say it is still the one the site sends).
      The results save as a copy to share or keep: printed or saved as PDF, a standalone .html file, or Markdown
      (downloaded, or copied for a ticket or a chat), all three made from one document built with the page's own
      pieces, so they never say something different. Unfolded and on paper: no box to fill in, the quicker way as a
      note with its cost, links pointing to the site. The pages can be left out, the policies added; the day picked
      and the addresses marked as known are said in it. Never the reports themselves. And as data, for a
      spreadsheet, a tracker or a SIEM: CSV (headers in the reader's language, no cell that a spreadsheet would run
      as a formula) or JSON (stable English keys), one row or record per problem. Reads a few hundred thousand
      reports, one per line or held in one record, in a second or two.
      Shapes from Chromium, Firefox and WebKit themselves (`src/lib/csp/violation-reports/`), except Chromium's
      Reporting API reports, which it didn't deliver to a local test server: those follow the specification.
- [x] **Explain a pasted console error** (2026-11-17): paste one or more of the browser's CSP messages (a whole
      console works) in the analyzer. Each one says what was blocked (or only reported), the rule that did it, the
      catalogue tool behind the address, and which line allows it. The lines come first, one per rule, with
      everything the messages need (the tool's documented value, the hashes the browser gave), so copying one never
      drops another; a new rule when `default-src` applied. Inline blocks of one kind are read together, Safari's
      get the hash generator. What weakens the policy for everyone (`'unsafe-inline'`, `'unsafe-eval'`, `data:` or
      `blob:` for scripts) is never in the lines: the safe way comes first (move the styles or the handler, a hash or
      a nonce, a version without `eval`), and the weaker value waits under "A quicker way, less safe", its cost said
      before its line; not offered where a nonce or a hash makes browsers ignore it. Trusted Types messages say what the
      code has to change, with the tool behind an address pasted with them; extensions and frames refused by
      another site are set apart. The wordings come from the browsers themselves: Chromium and WebKit through Playwright, Firefox
      copied by hand from a test page (whole consoles kept in `src/lib/csp/console-messages/`).
- [x] **Who is this domain?** (2026-11-17): the Tools page's search takes an address as well as a name (a host,
      a full address, or a value copied from a console message). It shows the tools that use it and the lines that
      cover it: the address, the directives and the feature ("https://cdn.us.heap-api.com in script-src, for
      Product Analytics (Heap)"). When no tool uses the address itself (`google.com`), it says so and shows the
      tools using addresses under it. Matching follows CSP's own rules (`src/lib/catalogue/lookup.ts`), ready for
      the console-error explainer.
- [x] **Save a copy of a report** (2026-11-16): under each report, "Print or save as PDF" (the browser's print
      window, with a document made for paper: always dark on white, the site, tools and date at the top), and
      downloads as .html (the same document, standalone), .md (developer, security) or .txt (IT message). The
      PDF and .html can include the analysed policy (on by default) and what each rule means. No library: the
      PDF comes from the browser, so its text stays selectable and readable by assistive technology.
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
- [x] **Screen reader and high-contrast pass** (2026-11-16): a virtual screen reader (Guidepup) in the e2e suite
      checks what is said and announced; a high-contrast test checks every chosen state on every page. Fixed what
      they found: risky, ignored and added values said aloud, one short line announced per pick instead of the
      whole explanation, the focus never lost when the analyzer, builder or tool picker changes, the policy as one
      Tab stop with the explanation read next, the phone sheet never hiding the focus, chosen tabs and options
      visible in high-contrast mode, no smooth scrolling under "reduce motion". Each new feature brings its own
      tests (CONTRIBUTING.md › Accessibility). The check by a real screen reader user is still open (section 1).
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
