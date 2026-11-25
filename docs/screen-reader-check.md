# Screen reader check: what to listen for

The automated checks ([CONTRIBUTING.md › Accessibility](../CONTRIBUTING.md#accessibility)) can't tell how code is
pronounced, whether the explanations make sense when heard, or how the tools feel to use. That takes someone who
uses a screen reader daily (VoiceOver or NVDA). Start with the 20-minute script in
[CONTRIBUTING.md › Manual check with a screen reader](../CONTRIBUTING.md#manual-check-with-a-screen-reader). Then go
through the checks below: they were added with features that came after the script, each with the date it came in.

Note what was unclear, too long, missing or said twice, and open an issue for each. Once a full run is done, mark it
with its date at the end of this file, and remove the checks it covered.

Who could do it: someone answering the request in the repository's issues, accessibility communities, a local
association for blind and partially sighted people, or a paid accessibility testing service.

## Analyzer (home page)

- **Values a strict policy keeps for old browsers** (2026-11-25): with
  `script-src 'nonce-…' 'strict-dynamic' https: 'unsafe-inline'`, `https:` and `'unsafe-inline'` are heard as
  "ignored by current browsers" (never "risky"). Picking one, the reason ("…is ignored because of
  'strict-dynamic'…") is heard before what the value means on its own.
- **Console messages** (2026-11-17): paste a few console messages. "6 messages explained" is heard once. Each
  message reads as a heading, then whether it was blocked or only reported, then the tool and the line. The hash
  generator under a Safari message is easy to reach, and its result is heard.
- **"A quicker way, less safe"** (2026-11-20), under `eval` in the console example: heard after the safe way, says
  whether it is collapsed or expanded, and once open the warning is heard before the line to copy.
- **"Save a copy" under each report** (2026-11-16): the group and its two choices are read with their names.
  "Print or save as PDF" opens the print window and, once it closes, the focus is back on that button. A PDF saved
  from it, opened in a PDF reader, reads the headings and the policy in order; the downloaded .html file reads the
  same way in a browser.
- **Public CDNs** (2026-11-23): in the tool picker, cdnjs is heard as "cdnjs risky" (not "cdnjsrisky"). Once
  picked, the warning is the first thing heard under the tool's name.
- **Account fields** (2026-11-23): Piwik PRO's "Your account name", with its hint, and its error when invalid.

## Tools page (`/vendors`)

- **Address search** (2026-11-17): typing `static.hotjar.com` in "Find a tool or an address", the result is
  announced once typing pauses ("static.hotjar.com is used by Hotjar"), not after each letter. The lines under a
  tool make sense heard ("https://static.hotjar.com in script-src, for…"), including how addresses and directive
  names are pronounced.
- **Folded categories** (2026-11-23): each category is heard as a heading inside a collapsed control, with its count
  and its tools' names ("Analytics, 4 tools, Amplitude, …, collapsed"). Moving by headings still reaches every
  category (VoiceOver with Safari is known to drop headings inside a summary: check it there). Enter opens one and
  says expanded. Typing "jquery" in the search opens Libraries and frameworks; clearing it folds that back.
- **Categories in the margin** (2026-11-24, from 80rem wide): the landmark is heard as "Categories". Each entry reads
  as the category's link then "4 tools", not a bare number. Following one opens that category and the reader lands
  on it. While searching, only the categories left are heard.
- **Public CDNs** (2026-11-23): jsDelivr's line says "Risky for your site". On its page, "Risk:" and the warning are
  heard before "Check jsDelivr against my policy".

## Builder (`/build`)

- **Partly verified tools** (2026-11-23): picking Tealium iQ, its open card says "Partly verified:" and what's
  missing before its lines. On the last step, "Things to know" counts one more note, and its heading "Check these
  tools before you enforce the policy" is followed by the tools' names.
- **Account fields** (2026-11-23): picking Matomo, "Your Matomo address, edit text" is heard with its hint. Typing
  "stats shop" makes it invalid, and the error is heard with it. Datadog RUM's "Your Datadog site" is a list: heard
  as a pop-up button with its hint, and "Choose…" first.
- **Public CDNs** (2026-11-23): once picked, the warning is the first thing heard under the tool's name.

## Compare (`/compare`)

- **Account fields** (2026-11-23): the same fields as in the builder, in the comparator's tools.

## Reports reader (`/reports`)

- **The example** (2026-11-20): with "Try an example", "117 reports read" is heard once. Each problem reads as a
  heading, then blocked or only reported, then "46 reports on 6 pages from…". The pages list and "Set apart" open
  and close with Enter and say so. "Open a file" opens the file picker and, once a file is read, its name is heard.
  "Clear" puts the focus back in the box.
- **An unknown script** (2026-11-20): under "A script from cdn.jquery-libs.example", the warning is heard before
  the "I know what this is" checkbox. Checking it says "…added to the lines", and the focus stays on it.
- **Dates** (2026-11-20): "Only the reports since" is a date field; picking a day says "N reports since…".
- **"A quicker way, less safe"** (2026-11-20), under a style attribute: as in the analyzer.
- **"Set apart"** (2026-11-20): one section per cause (extensions, software on visitors' devices, translation),
  each heard as its own collapsed group with its title and counts.
- **Problems as rows** (2026-11-20): each row is heard as one control with what was blocked, its level and its
  count ("A script from cdn.jquery-libs.example, Check first, 5 reports, collapsed"), and says expanded once
  opened. Its detail reads in order: why it ranks there, the counts, the explanation, the warning before the
  checkbox. The arrows on folds aren't read.
- **The folded box** (2026-11-21): after "Try an example", the focus lands on "What the 138 reports say", and that
  is heard. "Change" puts it back in the box; "Done" on the heading again. The summary's highlighted counts are
  heard as plain words, and each row is heard with its level first ("Check first, A script from…, 5 reports").
- **"Save a copy" at the end** (2026-11-21): the group and its two checkboxes are read with their names. After
  "Print or save as PDF" the focus is back on that button. The downloaded .html file reads in order in a browser
  (title, the details under it, "In short", each problem as a heading with its level first); a PDF saved from it
  reads the same way in a PDF reader.
- **"… is one of my domains"** (2026-11-21), under an unknown address: checking it says "…counted as one of your
  domains", and the focus stays on it although its row can move in the list.
- **"What the reports quoted"** (2026-11-21), in an opened row: heard as a fold. The quoted code and the script
  addresses are read as code, with their counts.
- **"Can you enforce it?"** (2026-11-20), for a report-only batch: heard as a heading, with the verdict ("Not yet",
  "It looks ready", "too soon to say") read first and stressed. After picking a day in "Only the reports since",
  the new verdict is easy to find again (it is above the lines, not announced by itself).

## Runs

None yet. On 2026-11-16 a first try by the maintainer found the policy took one Tab stop per part (fixed since).
