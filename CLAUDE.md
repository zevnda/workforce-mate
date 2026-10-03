# CLAUDE.md

Guidance for working on Workforce Mate. Read this before changing anything; most of the non-obvious constraints come from how the job sites and Workforce Australia (WFA) behave, not from the code.

## What the extension does

Workforce Mate is a browser extension for Australian job seekers. On the WFA "add a job search effort" form, it injects a **Job Listing URL** box with a **Fill Form** button. The user pastes a job listing URL from a supported job site. The extension fetches that page in the background, reads the **job title** and **employer name**, and fills in the WFA form. It also fills:
- the application date (today, `DD/MM/YYYY`)
- the application method (`Online`)
- the "was this job advertised" checkbox, when the form has it

It ships for **Chrome** (Manifest V3) and **Firefox** (Manifest V2) from one codebase. Published on the Chrome Web Store and Firefox Add-ons (links in README.md).

**Supported job sites:** SEEK (`seek.com.au` and the newer `au.seek.com`), Jora, LinkedIn, Adzuna, and WFA's own job listings (`/individuals/jobs/details/<id>`).
**Removed:** Indeed and CareerOne. Both serve a Cloudflare / bot-check page (HTTP 401/403, "Just a moment...", "Authenticating...") to the extension's background fetch. Don't re-add them, or any site, by working around bot protection. That means evading the site's protections, and it's fragile anyway.

## Files

| File | Role |
|---|---|
| `sites.js` | **The job site definitions and all extraction logic.** Shared by `background.js` and `content.js` in the extension, and by `scripts/check-sites.js` in Node. |
| `content.js` | Runs on WFA pages only. Injects the UI, sends the URL to the background script, extracts details with `sites.js`, fills the form, shows status messages. |
| `background.js` | Fetches job pages on request (MV3 service worker in Chrome, MV2 background page in Firefox). Only fetches URLs that `getJobSite()` and `getFetchUrl()` accept. |
| `manifest.chrome.json` / `manifest.firefox.json` | Per-browser manifests. `build.js` copies the right one to `dist/<browser>/manifest.json`. There is no root `manifest.json`. |
| `build.js` | Copies `background.js`, `content.js`, `sites.js`, `icons/` and the manifest into `dist/chrome` and `dist/firefox`. No bundling or transpiling. |
| `scripts/check-sites.js` | Node diagnostic that runs the real extraction against live URLs (see Testing). Uses `jsdom` (the only dependency, a devDependency). |
| `changelog.md` | Becomes the GitHub release notes verbatim (see Releasing). |
| `.github/workflows/release.yml` | Manual release workflow. |

There's no framework, bundler, TypeScript, linter or test suite. Everything is plain browser JavaScript loaded as classic scripts.

## Architecture and data flow

```
WFA page (content.js + sites.js)                 background (background.js + sites.js)
──────────────────────────────────               ───────────────────────────────────────
user pastes URL, clicks Fill Form / Enter
getJobSite(url) → unsupported? show error, stop
runtime.sendMessage({action:'fetchJobData', url}) ──►  getJobSite + getFetchUrl again (refuse others)
                                                        fetch(fetchUrl, {credentials:'omit', 15s timeout})
                     ◄── {data, finalUrl} | {error, status}
parseJobPage: JSON.parse (format 'json') or
  DOMParser → Document + looksLikeBotChallenge check
extractJobDetails(site, doc) → {values, sources, attempts}
logExtraction(...)  (console, with table on failure)
fillForm(values) → list of user-facing problems
showStatus(success | warning | error)
```

### Why the fetch happens in the background
Content scripts are subject to the page's CORS rules, so they can't read cross-site job pages. The background context can, because the extension has host permissions for the job sites:
- **Chrome:** `host_permissions` in `manifest.chrome.json`
- **Firefox:** the URL patterns in `permissions` in `manifest.firefox.json`

The job sites must be in those lists or the fetch fails (Firefox reports a `NetworkError`). That includes `*.workforceaustralia.gov.au`, because the background script fetches the WFA vacancy API. Don't remove it.

### Shared globals, not modules
`sites.js` declares top-level `const`/`function`s (`JOB_SITES`, `JOB_FIELDS`, `getJobSite`, `extractJobDetails`, `looksLikeBotChallenge`, ...). Classic scripts share one global scope, so other files use them directly:
- **content script:** the manifest lists `["sites.js", "content.js"]`, in that order.
- **Firefox background:** the manifest lists `"scripts": ["sites.js", "background.js"]`.
- **Chrome background:** the service worker can only have one entry file, so `background.js` calls `importScripts('sites.js')` when `importScripts` exists.
- **Node:** `sites.js` ends with a guarded `module.exports` for `scripts/check-sites.js`.

Keep `sites.js` free of browser-extension APIs and of `window`/`document` globals. It must only touch the `Document` passed to it, so it keeps working in all four places. Don't convert to ES modules without reworking all four loading paths.

### Cross-browser API
Both scripts use `const browserAPI = (typeof browser !== 'undefined' ? browser : chrome);`. Rules for the messaging code:
- **Sending:** `runtime.sendMessage` is used in its promise form (no callback). That works in Firefox and in Chrome MV3.
- **Receiving:** the background listener uses `sendResponse` and `return true`, because Chrome doesn't support returning a promise from `onMessage` listeners.

## Extraction (`sites.js`)

Each entry in `JOB_SITES` has a `name`, `domains` and an ordered list of `strategies`, plus two optional settings:
- **`toFetchUrl(url)`** maps the listing URL (a `URL` object) to the URL actually fetched. It returns `null` when the URL isn't a listing, and `getFetchUrl(site, url)` applies it.
- **`format: 'json'`** makes the content script `JSON.parse` the response, so strategies receive the object instead of a `Document`. It also sends `Accept: application/json` and skips the bot-check test.

 Each strategy has a `name` and an `extract(doc)` that returns `{ jobTitle?, employerName? }`. `extractJobDetails` runs **every** strategy:
- each field comes from the **first** strategy that finds it;
- a strategy that throws is recorded in `attempts`; it doesn't abort the others;
- values are whitespace-normalized by `cleanText`.

The result also has `sources` (which strategy supplied each field) and `attempts` (what every strategy found). These exist for debugging.

Current strategies, most to least preferred:

| Site | Strategies |
|---|---|
| All sites | `fromJsonLd`: schema.org `JobPosting` JSON-LD. **No supported site embeds it today**; it's first so that it takes over automatically if a site adds it. |
| SEEK | `[data-automation="job-detail-title"]` / `[data-automation="advertiser-name"]` (SEEK's test hooks, the most stable markup) → `fromSeekApolloData` (parses the `window.SEEK_APOLLO_DATA = {...}` inline script; finds the `__typename: 'Job'` object; the advertiser name key carries args, e.g. `name({"locale":"en-AU"})`; resolves Apollo `__ref` pointers) → page `<title>` `"<title> Job in <location> - SEEK"` (title only). |
| Jora | `h1.job-title` / `.company` → `<title>` `"<title> job at <employer> in <location> \| Jora"`. Note the `<h1>` is the advertiser's own wording (e.g. "Looking for Residential Cleaners \| Paddington..."), while `<title>` uses a normalized job title. Both are acceptable; markup wins. |
| Adzuna | JSON-LD (present and complete) → `h1` / `.ui-company` → `<title>` `"<title> - adzuna.com.au"` (title only). Only `/details/<id>` pages work; `/land/ad/` links redirect to the advertiser's own site. Adzuna blocks some HTTP clients (curl gets 429; Node `fetch` gets 200), so if it starts failing in browsers, check that first. |
| Workforce Australia | Listing pages are rendered client-side, so the HTML has no job data. `toFetchUrl` turns `/individuals/jobs/details/<id>` into the public, unauthenticated `/api/v1/global/vacancies/<id>` (the API WFA's own page calls, found in `FindAJob.min.module.js`), and the strategy reads `title` and `employerName`. An unknown or removed ID returns **HTTP 204**, which `background.js` reports as status 404 ("expired"). |
| LinkedIn | `h1.top-card-layout__title, .topcard__title, h3.sub-nav-cta__header` / `.topcard__org-name-link` → `<title>`, which LinkedIn serves in **two formats** that alternate between requests: `"<employer> hiring <title> in <location> \| LinkedIn"` and `"<title> at <employer> — <location> \| LinkedIn Jobs"` (em dash). |

Guidelines for changing strategies:
- **Prefer, in order:** structured data, then test hooks (`data-automation`, `data-testid`), then semantic markup, then CSS class names, then title or meta parsing. Class names generated by CSS-in-JS (hashed) are not acceptable.
- **Add, don't replace:** when a site changes, add the new selector or strategy alongside the old one, unless the old one is now returning *wrong* data.
- **Title regexes are a last resort.** They're ambiguous when a name contains the separator word (" at ", " in ", " hiring "). Use lazy and greedy groups deliberately, and comment an example title above each regex.
- **No bot checks in extraction:** `looksLikeBotChallenge(doc)` (checked by `content.js`) recognizes challenge pages served with a 200 status by their `<title>`. Don't try to extract from those.

### Adding a site
1. **`sites.js`:** add an entry to `JOB_SITES`. Its `name` appears in the UI text; `domains` matches the hostname exactly or as a subdomain, so `seek.com` covers `au.seek.com` but not `evilseek.com`. Start the strategies with `{ name: 'JSON-LD JobPosting', extract: fromJsonLd }`.
2. **Both manifests:** add `https://*.<domain>/*`, to `host_permissions` in Chrome and `permissions` in Firefox. Do **not** add job sites to `content_scripts.matches`. The extension only ever runs on WFA.
3. **Verify:** run `npm run check-sites -- <live listing URL>` and confirm a real fill in both browsers.
4. **Docs:** update the README features list and `changelog.md`.

The UI text listing supported sites is generated from `JOB_SITES`, so it needs no edit.

## The WFA form (`content.js`)

WFA has **two job-seeker streams with different form field names**, and both must keep working:

| Field | IEA participants | Regular WFA ("Job application (manual)") |
|---|---|---|
| Date | `form.applicationSentDate` | `form.submissionData.applicationSentDate` |
| Job title | `form.jobTitle` | `form.submissionData.jobTitle` |
| Employer | `form.employerName` | `form.submissionData.employerName` |
| Advertised checkbox | n/a | `form.submissionData.isAdvertised` (optional, may not exist) |

The pairs are combined into comma selectors in `fieldSelectors`, so `querySelector` matches whichever exists. When WFA changes a field name, **add** the new name to the selector rather than replacing the old one; the other stream may still use it.

Other form details:
- **Where the UI goes:** inside the first `.form` element. `addDivToForm` re-checks every 500ms and re-injects the UI if WFA's single-page app re-renders the form.
- **Text inputs:** `setInputValue` sets `.value`, then dispatches `input`, `change` and `blur` so WFA's framework registers the change. The title is cut to 50 characters, and to the input's own `maxlength` if shorter.
- **Checkbox:** it is **clicked**, not set via `.checked`, so the framework sees it. It's only clicked when unchecked, so a second Fill Form doesn't untick it.
- **Application method:** a custom combobox (`.mint-combobox-dropdown .dropdown-item` → `.dropdown-item-inner` text). `setApplicationMethodValue` clicks the item matching `Online`, and logs the available options if there's no match.
- **Fill order:** `fillForm` checks that the three required inputs exist first. If any are missing it throws a `FillError` ("WFA may have changed the form") before touching anything.
- **Date:** computed at click time (`getFormattedDate`), not at load, so a tab left open overnight doesn't fill yesterday's date.

## Error handling and logging conventions

- **Console:** every line uses the `log.info/warn/error` helpers in `content.js`, which prefix `[Workforce Mate]`; `background.js` uses the same prefix. Keep this so users can filter the console.
- **User-facing messages** go through `showStatus(message, type)`, with `type` one of `info`, `success`, `warning`, `error`. The status line sits under the URL box. Users don't open the console, so anything they need to act on must appear there.
- **`FillError(userMessage, details)`:** `userMessage` is shown to the user; `details` goes to the console. Any other thrown error shows a generic message and is logged in full.
- **Background errors:** they come back as `{ error, status }`. `status` is the HTTP status, `'timeout'`, or `null`. `describeFetchError` turns it into a user message:
  - 401/403/429/503/999: "blocked, probably with bot protection"
  - 404/410: "the listing may have expired"
  - `'timeout'`: "took too long"
  - anything else: a generic error or connection message
- **Extension reloaded:** if `sendMessage` throws, the extension was usually reloaded or updated while the WFA tab was open ("Extension context invalidated"). The user is told to refresh the page.
- **Extraction failures:** when a field can't be found, `logExtraction` logs a warning plus `console.table(attempts)`. That table shows which strategies broke, and is the first thing to look at when a site stops working.
- **Partial fills:** if extraction finds only some fields, the form is still filled with what was found, and a warning tells the user what to fill manually.

## Fetching rules (`background.js`)

- **`credentials: 'omit'` is required.** Sending the user's cookies made LinkedIn return its logged-in app page, which has none of the expected markup. The extension must behave the same whether or not the user is logged in to a job site. Users do **not** need to be logged in to any job site, only to WFA.
- **Only supported URLs:** `getJobSite(url)` and `getFetchUrl` are re-checked before fetching, so a compromised or malicious page can't use the extension to fetch arbitrary URLs.
- **Timeout and status:** a 15s `AbortController` timeout, and a non-2xx response is an error carrying `status`. Never parse an error page as if it were a job listing; that was the original cause of "fields empty" bugs.
- **No CORS header injection.** An earlier version used `webRequest`/`webRequestBlocking` to add `Access-Control-Allow-Origin: *` to every SEEK and Jora response, including during the user's normal browsing. That was removed: host permissions already let the background fetch read the response, and the injection weakened those sites' security in the user's browser. Don't reintroduce it. If a Firefox fetch ever fails with CORS, check the host permissions first.

## Build, run, test

```sh
npm install            # only needed for check-sites (jsdom)
npm run build          # → dist/chrome, dist/firefox (gitignored)
npm run check-sites -- <job listing URL> [<url> ...]
```

**Loading locally:**
- **Firefox:** in `about:debugging#/runtime/this-firefox`, choose **Load Temporary Add-on** and select `dist/firefox/manifest.json`. Click **Reload** after each build. It's removed when Firefox restarts. **Inspect** opens the background console.
- **Chrome:** in `chrome://extensions`, turn on Developer mode, choose **Load unpacked** and select `dist/chrome`. Click reload after each build.
- **After reloading the extension, refresh the WFA tab.** The old content script is orphaned and reports "Workforce Mate was updated or reloaded".

**`check-sites`** fetches each URL with Node `fetch` and a Firefox user agent, then runs `extractJobDetails` and prints the per-strategy table. It exits 0 only if every field was found for every URL. Caveats:
- **Not proof of a block:** Cloudflare fingerprints clients, so Node may get a challenge page where a real browser, or curl, gets through. Jora currently challenges Node's `fetch`. A `FAIL Blocked` here doesn't prove users are blocked.
- **It also works the other way:** passing here doesn't prove the extension works. The user's IP or browser may be challenged. When in doubt, have the user run this in the extension's background console:
  ```js
  fetch(URL, { credentials: 'omit' }).then(r => { console.log(r.status); return r.text(); }).then(t => console.log(t.slice(0, 1500)));
  ```
- **Listings expire:** use a current listing URL when you run it.

**No automated tests in the repo.** For changes to `content.js`, a jsdom harness works well: create a JSDOM with a fake `.form` containing the WFA inputs, combobox and checkbox, set `window.browser = { runtime: { sendMessage: async () => ({ data: html }) } }`, eval `sites.js` and `content.js`, set the input and click the button, then assert field values and the `[role="status"]` text. Two things to know:
- `content.js` polls with `setTimeout` forever, so call `process.exit()` at the end.
- Wait a tick after eval before querying the injected UI.

**Before claiming something works**, at minimum run `node --check` on the changed files and parse both manifests as JSON. Ideally also `check-sites` and a real browser test. Say plainly which of these you did and didn't do.

## Releasing

`.github/workflows/release.yml` is run manually (`workflow_dispatch`) with `version` and `previous_version` inputs. It:
1. `sed`-replaces `previous_version` with `version` in both manifests. **`previous_version` must exactly match the version currently in the manifests**; otherwise nothing changes, the commit step fails with "nothing to commit", and no release is made. `package.json` has no version.
2. Runs `npm run build` (no `npm install`; the build has no dependencies, so keep it that way) and zips each `dist/<browser>`.
3. Commits the manifest bump to `main` as `github-actions[bot]` and pushes.
4. Creates a GitHub release tagged `<version>`, using **`changelog.md` as the body**, with both zips attached.

The workflow does **not** upload to the Chrome Web Store or Firefox Add-ons; that's manual. The store listing descriptions are also edited manually, and should match the supported sites.

`changelog.md` holds only the entries for the upcoming release, as a flat bullet list in plain user-facing language. The maintainer edits it by hand (merging or rewording lines), so append to it and don't rewrite existing entries. Changes must be committed and pushed to `main` before running the workflow, since it builds from `main`.

## Conventions

- **Style:** 4-space indentation, single quotes, semicolons, `camelCase`. Short `//` comments above functions and non-obvious lines explain *why*. Match the existing comment density; don't add JSDoc blocks.
- **Inline UI styles:** the injected UI is styled with `style.cssText` strings and colours that match WFA's design (`#0076BD` button, `#05154D` label, Public Sans). There's no stylesheet.
- **Plain browser JS:** no build-time dependencies. The extension code must run as shipped, with no transpiling, so only use syntax supported by current Chrome and Firefox.
- **Line endings:** the repo has `core.autocrlf=true` on the maintainer's Windows machine. Git's "LF will be replaced by CRLF" warnings are expected and harmless.
- **Permissions:** keep them minimal. Every permission has to be justified in store review, and a new one triggers a permission prompt for existing users on update.
- **Manifest versions:** Chrome is MV3 (`host_permissions`, `service_worker`), Firefox is MV2 (`permissions`, `background.scripts`). Any change to permissions, scripts or content scripts must be made in **both** manifests. A future Firefox MV3 port should mirror the Chrome manifest, but keep `background.scripts` (Firefox MV3 doesn't use service workers by default).
