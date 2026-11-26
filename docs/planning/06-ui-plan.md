# Web UI plan

Status: **planned, not started.** Written against the API as of commit `a404d77`. This page is meant to be executed later without re-deriving anything; the last section is a single copy-paste prompt that captures it.

## 1. Goal and scope

A read-only web UI over the existing JSON API (`GET /jobs`, `/jobs/:id`, `/stats`): search and filter jobs aggregated from 13 ATS platforms, read a posting, and jump to the original application page. Fully responsive: phone, tablet, desktop.

In scope: search/browse, job detail, a status page. Out of scope for v1: accounts, saved searches or alerts, an admin UI for sources (the CLI stays the way to manage them), applying inside our UI (we always link out to `apply_url`).

**Open decision before starting: is this public or internal?** The API has no auth, rate limiting or CORS. Public means we also need rate limiting, a robots/ToS stance on re-publishing scraped postings, and attribution links back to the source. This plan assumes a single trusted audience behind a reverse proxy; the public-facing extras are listed in section 8.

## 2. Stack (decided)

| Choice | Why |
|---|---|
| Vite + React 18 + TypeScript (strict) | Static build, no SSR needed (no SEO requirement for an internal tool), same language as the backend |
| Tailwind CSS v4, default breakpoints (`sm` 640, `md` 768, `lg` 1024, `xl` 1280) | Utility-first, small CSS, the breakpoint table below maps 1:1 to its prefixes |
| React Router (data router) | URL is the source of truth for search state |
| TanStack Query | Caching, request cancellation, `useInfiniteQuery` fits the cursor API |
| Radix UI primitives (Dialog, Popover, Select, Checkbox, Tabs) | Accessible focus management for the mobile filter sheet and menus without writing it ourselves |
| DOMPurify | Sanitizing `description_html` (see section 7) |
| lucide-react icons, one variable sans font (self-hosted) | No third-party requests at runtime |
| Vitest + Testing Library; Playwright for e2e | Matches the existing test runner |

Location: `web/` with its own `package.json` (the backend package stays untouched). In production Fastify serves the built `web/dist` with `@fastify/static` plus an SPA fallback, so the UI and API are **same-origin: no CORS needed**. In dev, Vite proxies `/jobs`, `/stats`, `/health` to `localhost:8080`.

## 3. Information architecture

| Route | Screen |
|---|---|
| `/` | Search + results (the main screen) |
| `/jobs/:id` | Job detail |
| `/status` | Crawl health from `/stats` |
| `*` | Not found |

**All search state lives in the query string, using the API's own parameter names** (`?q=react&remote=true&platform=workday,gem&sort=newest`). Links are shareable, back/forward work, and there is no translation layer to drift. The cursor is *not* in the URL: it is bound to the filters, so any filter change drops it.

## 4. Screens

### 4.1 Search and results (`/`)

- **Search box**, debounced 300 ms, aborts the in-flight request. Hint text documents the syntax the API accepts (`"exact phrase"`, `-excluded`, `a or b`). `sort` offers *Best match* only while `q` is non-empty and falls back to *Newest* when it is cleared (the API rejects `relevance` without `q`).
- **Filters** (each maps to one API param):
  - Remote: Any / Remote / On-site or hybrid. Tooltip: jobs with unknown remote status appear only under *Any*.
  - Location (text, substring), Department (text, substring)
  - Employment type, Seniority: multi-select; options come from the facets endpoint (section 6), labels are platform-specific and not normalized, so show them as-is
  - Platform: multi-select of the 13 platforms
  - Company: typeahead over company slugs, multi
  - Salary: currency select + min/max. **The currency is required by the API**, so min/max stay disabled until one is chosen. Helper text: amounts are as advertised, not normalized per hour/month/year. Plus a "Has salary" toggle.
  - Posted: Any / 24 h / 7 d / 30 d (`posted_within_days`)
  - "Hide duplicate postings" (`distinct`), **on by default** in the UI
- **Result card**: title, company (prettified slug), locations (first two + "+N"), badges (Remote, employment type, seniority), salary (`salary_text` if present, else formatted range + currency), relative posted date (`posted_at`, else "first seen"), platform label. Whole card links to `/jobs/:id`; a secondary "Apply" opens `apply_url` in a new tab with `rel="noopener noreferrer"`.
- **Pagination**: a "Load more" button driven by `next_cursor` (not infinite scroll: keeps the footer and keyboard users reachable). Page size 50. Results count shows "50 loaded" because the API returns no total (see section 6 if we want one).
- **Active filter chips** above the results, each removable, with "Clear all".
- **States**: loading skeletons shaped like cards; empty ("No jobs match", with the active filters listed and one-click removal); `400 invalid_query` shows the API's `message` inline next to the search box; network/5xx error with Retry; stop-word-only query returns an empty page and gets the same empty state with a syntax hint.

### 4.2 Job detail (`/jobs/:id`)

Title, company, platform, locations, remote, department, employment type, seniority, salary, posted / first seen / last seen, primary **Apply** button (`apply_url`, hidden if null), sanitized description, "View original posting" link. If `status = 'closed'`: a prominent "This posting is no longer open" banner and the Apply button demoted. Description missing (some Phase 4 jobs are fetched without detail yet): show "Description not available yet" and the Apply link. 404 and invalid-id states. Back navigation returns to the previous search with scroll position and filters intact (preserve via router state / query cache).

### 4.3 Status (`/status`)

From `/stats`: open/closed jobs per platform, source counts by state (`active`, `invalid`, disabled reasons), queue depth and oldest due time. A table at every width; at base width it becomes stacked key/value rows. Auto-refresh every 60 s, pauses when the tab is hidden.

## 5. Responsive behaviour

Mobile-first. Every screen is specified at base, `sm`, `md` and `lg` (and `xl` where it differs); nothing may rely on hover.

| Breakpoint | Search/results | Filters | Job detail | Status |
|---|---|---|---|---|
| **base** (<640) | Single column of full-width cards, sticky search bar, 16 px text inputs (prevents iOS zoom) | Hidden behind a "Filters (n)" button opening a full-height bottom sheet (Radix Dialog) with an "Apply" footer that shows the live result state; chips scroll horizontally | Own full screen, sticky bottom bar with Apply; description at readable measure (max ~65ch) | Stacked key/value rows |
| **sm** (640-767) | Same single column, more generous padding, two-line titles | Same bottom sheet, now a centered modal sheet with max-width | Apply button moves from the sticky bar into the header | Two-column key/value |
| **md** (768-1023) | Single results column, wider cards with metadata on one row; sticky search + sort row | **Collapsible filter panel** as a left-side drawer toggled from the toolbar (overlays, does not squeeze results); quick filters (Remote, Posted, Sort) inline in the toolbar | Single column, metadata grid of 2 columns above the description | Real tables |
| **lg** (>=1024) | Two-pane: persistent 280 px filter sidebar + results list (max-width 880) | Always visible, filters apply immediately (no Apply button), sticky with own scroll | Two-column: description (main) + sticky meta/Apply card (320 px) | Tables + summary tiles |
| **xl** (>=1280) | Optional master-detail: the list narrows and a job opens in a right pane without leaving `/`; URL still becomes `/jobs/:id` and deep links render the full page | as lg | as lg | as lg |

Rules that apply everywhere: touch targets >= 44 px on base/sm/md; no horizontal page scroll at any width from 320 px; text reflows at 200% zoom; the long descriptions' tables and `<pre>` scroll inside their own container; dark mode via `prefers-color-scheme` (tokens as CSS variables, both themes contrast-checked).

## 6. API prerequisites (backend work, do first)

The UI is buildable against today's API, but these gaps need small backend changes. Each gets tests in `tests/`.

1. **Serve the SPA** from Fastify: `@fastify/static` for `web/dist`, SPA fallback for non-API GETs (must not shadow `/jobs`, `/stats`, `/health`, `/openapi.json`; consider moving the API under `/api/*` before shipping so the SPA can own `/jobs/:id` without clashing with the JSON route. **Decide this up front**: the detail route `/jobs/:id` currently returns JSON).
2. **`GET /facets`**: top values with counts over *open* jobs for `platform`, `employment_type`, `seniority`, `department`, `location` (top ~50), and `salary_currency`. Cached in memory for 5 minutes. Needed because the filter option lists cannot be derived from a page of results.
3. **Total count (optional)**: `count=true` on `/jobs` returning a capped count (`10000+` above the cap) so the UI can say "1,284 jobs". Skipped in v1 if it measurably slows the 12%-match relevance query (see the performance table in 05-api.md).
4. **Security headers**: CSP (`default-src 'self'`; no inline scripts), `X-Content-Type-Options`, `Referrer-Policy`, `frame-ancestors 'none'`.
5. **Company display names**: only `company_slug` exists. v1 prettifies slugs client-side (`acme-inc` -> `Acme Inc`; Workday `tenant.wd5/site` -> tenant, Taleo -> org). A real `companies` table (name, domain, logo) is a later improvement. Do not block on it.
6. **OpenAPI** updated for new endpoints; the existing test that keeps `JOB_PARAMS` and the spec in sync must keep passing.

## 7. Security

`description_html` is **third-party HTML from scraped postings: treat it as hostile**. Sanitize with DOMPurify using a strict allowlist (`p br ul ol li strong em b i u a h1-h6 blockquote table thead tbody tr th td code pre span div`; no `style`, `class`, `id`, `on*`, `iframe`, `img` in v1), force every link to `target=_blank rel="noopener noreferrer nofollow"`, strip `javascript:`/`data:` URLs. Render once via a sanitized string, never `innerHTML` of raw data. The CSP above is the second layer. Add a unit test with a corpus of XSS payloads and run it in CI. `apply_url` and other URLs are validated to `http(s):` before being used as `href`.

## 8. If it becomes public

Add: rate limiting on the API, `robots.txt`/noindex decision, attribution on every posting ("via {platform}") with a prominent link to the original, a takedown/contact page, and privacy statement (we store no user data in v1, so this stays short). Re-check each source's terms: the verification checklist already tracks robots/ToS for YC.

## 9. Accessibility and performance targets

- WCAG 2.2 AA: semantic landmarks, one `h1` per route, labelled controls, visible focus, focus moved into and restored from the filter sheet, results region `aria-live="polite"` announcing "N jobs loaded", skeletons `aria-busy`, respects `prefers-reduced-motion`, colour is never the only signal (remote/closed badges have text).
- Automated: `axe` in the Playwright run on every route at base/md/lg.
- Performance: initial JS <= 150 kB gzipped (route-level code splitting; DOMPurify only on the detail route), LCP < 2.5 s on a throttled mid-range phone profile, no layout shift when the skeleton swaps in.
- Keyboard: `/` focuses search, `Esc` closes the sheet/drawer, results are a list of links reachable in order.

## 10. Testing and CI

- Unit: URL <-> filter-state codec (round trip incl. arrays, booleans, the currency/min/max coupling, cursor reset on change), slug prettifier, salary and date formatters, sanitizer corpus.
- Component (Testing Library): filter panel, chips, empty/error states, load-more.
- E2E (Playwright) at **375, 768 and 1280 px** against a real API and a seeded test database (reuse the integration approach in `tests/integration`): search, filter, load more, open detail, closed-job banner, deep link, back navigation keeps state, mobile filter sheet, keyboard-only pass, axe. If browsers cannot be installed in a given environment, run e2e in CI only.
- CI: new `web` job (`npm ci`, typecheck, lint, test, build) and e2e job; the build artifact is baked into the API Docker image by a multi-stage build.
- **Repo gotchas to handle when starting**: the root `eslint.config.js` must ignore `web/` (it has its own config), and the root `vitest.config.ts` must restrict `include` to `tests/**` so it does not pick up `web/` tests.

## 11. Phases

| # | Phase | Deliverable | Done when |
|---|---|---|---|
| U0 | Decisions | public vs internal; `/api` prefix; facets and count scope | Answers recorded at the top of this file |
| U1 | Backend prerequisites (section 6) | static serving, `/facets`, headers, optional count, tests | New API tests green; `curl /facets` works; OpenAPI in sync |
| U2 | Scaffold | `web/` app, Tailwind tokens, router, query client, typed API client generated from `/openapi.json`, dev proxy, CI job | `npm run build` + typecheck + lint green; empty shell renders at all four breakpoints |
| U3 | Search and results | search box, filters (desktop sidebar + mobile sheet), chips, cards, load more, all states, URL state | Every API filter reachable; e2e green at 375/768/1280 |
| U4 | Job detail | detail route, sanitizer, closed/missing-description states, back-state preservation | XSS corpus passes; deep link works |
| U5 | Status page | `/status` | Matches `/stats`; auto-refresh pauses when hidden |
| U6 | Polish | dark mode, a11y audit fixes, bundle budget, keyboard shortcuts, 404 | axe clean; budgets met |
| U7 | Ship | multi-stage Dockerfile, compose wiring, README and runbook update | `docker compose up` serves UI and API on one port |
| U8 (later) | Nice-to-haves | xl master-detail pane, saved jobs in localStorage, real company names/logos, count | Each separately scoped |

Rough size: U1 small, U2 small, U3 large (most of the work), U4 medium, U5 small, U6 medium, U7 small.

## 12. Risks

- Filter option lists and labels are **not normalized** across platforms ("Full time" vs "Full-time" vs "FULL_TIME"); the facets list will look messy until normalization exists (a backend concern, not UI).
- Salary values are raw advertised numbers with unknown period; never sort or compare across currencies, always show as advertised.
- Descriptions vary from plain text to heavy vendor HTML; the sanitizer's allowlist may need tuning after seeing real data.
- Relevance queries matching a large share of rows take ~100-140 ms server-side (measured on synthetic data); debounce and cancellation matter.
- Phase 4 connectors are unverified live, so early real data (Workday, iCIMS, Taleo, YC) may expose odd fields (e.g. missing locations, "2 Locations").

## 13. Execution prompt (single prompt, for a later session)

> Build the web UI described in `docs/planning/06-ui-plan.md` for the job-search repo (Fastify + Postgres API already exists). Work in the order of its phases U1-U7, committing per phase with the tests listed there; stop and ask if any item in section 1 or U0 is still undecided.
>
> Stack: Vite + React 18 + TypeScript strict in `web/`, Tailwind v4 default breakpoints, React Router, TanStack Query, Radix UI, DOMPurify, lucide-react, Vitest/Testing Library, Playwright. Same-origin delivery through `@fastify/static`; add `GET /facets`, security headers and (optionally) a capped count to the API first, with tests and OpenAPI updates.
>
> Screens: search/results at `/` (all `JOB_PARAMS` filters, URL query string as the only state, API parameter names verbatim, cursor-based "Load more", filter chips, loading/empty/error/invalid-query states, `sort=relevance` only with `q`, currency required for salary filters, "hide duplicates" on by default), job detail at `/jobs/:id` (sanitized description, closed-job banner, missing-description state, Apply link, back keeps state), and `/status` from `/stats`.
>
> Responsive requirements, all verified at 375, 768 and 1280 px and by inspection at the `sm`, `md`, `lg` and `xl` thresholds: **base** single column with a bottom-sheet filter dialog and sticky Apply bar; **sm** same layout with a centered sheet and header Apply button; **md** wider single-column cards, a collapsible left filter drawer, inline quick filters (Remote, Posted, Sort) and a 2-column metadata grid; **lg** persistent 280 px filter sidebar with instant filtering and a two-column detail page with a sticky Apply card; **xl** optional master-detail pane. No horizontal scroll from 320 px, 44 px touch targets below `lg`, 16 px inputs, no hover-only controls, dark mode, WCAG 2.2 AA with axe in e2e, JS <= 150 kB gzipped initial.
>
> Treat `description_html` as hostile: strict DOMPurify allowlist, forced `rel="noopener noreferrer nofollow"`, URL scheme checks, a CSP, and an XSS payload test corpus in CI. When adding `web/`, make the root ESLint ignore it and restrict the root Vitest `include` to `tests/**`. Update README, the implementation plan and the runbook when done; do not mark anything verified that was not run.
