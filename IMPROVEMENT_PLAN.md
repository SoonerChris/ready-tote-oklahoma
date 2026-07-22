# Ready Tote Oklahoma — Performance & UX Improvement Plan

## Current state

The public site (`index.html`, 1205 lines) is a single well-built, hand-coded page with a ~495-line inline `<style>` block, unoptimized JPG/PNG images (up to 348KB, none WebP/AVIF, all served larger than their display size), and a Leaflet map (external CSS+JS) that loads and initializes unconditionally even though it's far below the fold. The five admin pages (`admin.html`, `admin-finance.html`, `admin-invoice.html`, `admin-add-rental.html`, `admin-reminders.html`) are each fully standalone documents — every one reimplements its own `<style>` reset, its own `secret`/sessionStorage auth pattern, and its own "back to dashboard" link, with no shared stylesheet, script, or nav component, and no consistent behavior between them (e.g. only `admin.html` auto-loads data when a saved secret is present). Backend functions (`netlify/functions/*.mjs`) are simple and mostly reasonable, but `get-rentals.mjs` and `finance.mjs` fetch every blob individually in a loop rather than in parallel.

---

## Quick wins (low effort / high impact)

1. **Lazy-load and size below-the-fold images in `index.html`.**
   Every `<img>` (lines 581-582, 851, 866, 1027) is missing `loading="lazy"`, `width`/`height`, and `decoding="async"`. Only the header logo (line 536) and hero photos should load eagerly. Fix: add `loading="lazy" decoding="async" width="…" height="…"` to all non-hero images to cut initial page weight and prevent layout shift.

2. **Compress and right-size the images in `/images`.**
   `logo.png` is 668×700px / 348KB but is only ever displayed at 104px/64px tall (lines ~86, ~1027-1028) — a ~15-20x oversized asset. `totes-stack-large.jpg` (1372×1400, 201KB) and `totes-delivery-door.jpg` (946×1200, 233KB) are both displayed at 380×460 CSS px in `.hero-photo-row` (line ~493). None of the 8 images in `/images` are WebP/AVIF. Fix: resize to ~2x display size and convert to WebP (with JPG/PNG fallback via `<picture>` if needed). This alone should cut total image payload from ~1.1MB to under 250KB.

3. **Add `Cache-Control` headers for static assets in `netlify.toml`.**
   `netlify.toml` currently only sets `publish`/`functions` — there is no `[[headers]]` block, so images, fonts, and the favicon set have no explicit long-lived caching. Add an immutable cache policy for `/images/*`, `*.png`, `*.ico` (e.g. `Cache-Control: public, max-age=31536000, immutable`) so repeat visitors don't re-download unchanged assets.

4. **Make `admin-finance.html` and `admin-reminders.html` auto-load like `admin.html` does.**
   `admin.html` line 130 has `if ($('secret').value) load();` so the dashboard populates automatically when a secret is already saved in `sessionStorage`. `admin-finance.html` and `admin-reminders.html` restore the secret into the input (lines 111-112 / 61-62) but never call their load function — Chris has to click "Load finance data" / "Load today's reminders" manually every single time he opens either page, even though the secret is already known. One-line fix per file for an immediate daily-use UX win.

5. **Fix the un-responsive 2-column grids in `admin-finance.html`.**
   The inline `grid-template-columns:1fr 1fr` layouts at lines 46 (`#salesDetails`), 61, 74, and 95 (mileage/expense input rows) have no mobile breakpoint at all, unlike the equivalent grids in `admin.html` (line 28), `admin-add-rental.html` (line 19), and `admin-invoice.html` (line 22), which all collapse to a single column under ~700px. On a phone — where Chris most likely checks money numbers — these stay cramped at 2 columns. Fix: move these to a `.grid2`-style class with the same `@media(max-width:560px)` rule already used elsewhere.

6. **Defer the Leaflet map (CSS + JS + 2 live map instances) until it's actually scrolled to.**
   `index.html` loads `leaflet.min.css` render-blocking in `<head>` (line ~15) and `leaflet.min.js` plus map-init code at the very bottom (lines 1164-1205), unconditionally initializing two full interactive OSM maps (`#deliveryMap`, `#adaMap`) on every page load — most visitors never scroll to the "Area" section. Fix: wrap the Leaflet `<link>`/`<script>` load and `buildDeliveryMap()` calls in an `IntersectionObserver` on `#area`, so the ~150KB+ of map assets and tile requests only fire for users who scroll that far.

7. **Add the missing favicon `<link>` tags to `admin-add-rental.html` and `admin-reminders.html`.**
   `admin.html`, `admin-finance.html`, and `admin-invoice.html` all include the three favicon/apple-touch-icon links; `admin-add-rental.html` and `admin-reminders.html` don't. Small consistency/polish fix — two lines to copy in.

8. **Give `admin-add-rental.html` the same required-field affordances as the public form.**
   The public booking form (`index.html` ~1073-1146) marks required fields with `*` and uses native `required` attributes for real-time browser validation. `admin-add-rental.html` (lines 40-89) has no `*` markers and no `required` attributes at all — every validation error only surfaces after clicking "Add to Rental Log" via a JS string-trim check (line 106). Add `required` + `*` labels so Chris gets immediate inline feedback instead of a post-submit error banner.

---

## Larger improvements (more effort)

9. **Extract a shared admin stylesheet/script instead of duplicating boilerplate across 5 files.**
   Every `admin*.html` file redefines the same CSS custom properties (`--ink`, `--gold`, `--cream`, `--steel`, `--line`, etc.), the same `body`/`label`/`input`/`button`/`.status` rules, and the same JS pattern (`const $ = id => document.getElementById(id)`, sessionStorage get/set for `rto-admin-secret`, a `showErr`/`showStatus` helper). Since there's no build step, the simplest fix that fits the stack is a shared `/admin/admin.css` `<link>` and a small `/admin/admin.js` (loaded as a plain `<script src>`) included on all 5 pages, replacing the per-file `<style>` blocks and repeated secret-handling code. This both shrinks page weight and means future styling/auth-flow changes happen in one place instead of five.

10. **Add a persistent admin nav instead of a single "← Admin dashboard" text link.**
    Every admin sub-page (`admin-finance.html`, `admin-invoice.html`, `admin-add-rental.html`, `admin-reminders.html`) only has a one-line `<a href="admin.html">← Admin dashboard</a>` (e.g. `admin-finance.html` line 27) — there's no way to jump directly from Finance to Reminders or Invoice without funneling back through the hub each time. Add a small shared nav/tab bar (part of the shared admin.css/js from item 9) listing all 5 admin destinations, so Chris can move directly between tools.

11. **Move `index.html`'s ~495-line inline `<style>` block (lines 15-510) to an external `site.css`.**
    Because the CSS is inline, it's re-downloaded and re-parsed with every single page load and can never be cached independently of the HTML document — unlike an external stylesheet, which the browser caches across visits. This is the single biggest "page weight on repeat visits" issue on the public site. Extracting it to `/site.css` with a long-lived cache header (see item 3) means repeat visitors only re-download the HTML skeleton.

12. **Parallelize the N+1 blob reads in `get-rentals.mjs` and `finance.mjs`.**
    `get-rentals.mjs` (lines 18-22) lists all blob keys then `await`s `store.get()` for each one sequentially in a `for` loop; `finance.mjs`'s `list` action (lines 23-30) does the same for expenses and mileage. This scales linearly with rental/expense count and will slow down every load of `admin.html` and `admin-finance.html` as the rental log grows. Fix: replace the sequential loop with `Promise.all(blobs.map(...))`.

13. **Unify the visual design language between the public site and the admin tools.**
    `index.html` uses a branded system (`Archivo Black`/`Barlow`/`JetBrains Mono`, `--yellow`/`--crate-red`/`--ink` palette); every admin page instead uses generic `Arial, Helvetica, sans-serif` and a separately-redefined, slightly different palette (`--gold` instead of `--yellow`, no crate-red, etc). Since Chris looks at these tools daily, folding them into one shared design system (as part of the item-9 shared CSS) would make the whole product feel like one piece of software rather than a marketing site bolted to a set of ad hoc internal forms.

14. **Add consistent loading/empty/error states across all data-driven admin views.**
    Loading feedback today is just a button label swap ("Load…" → "Loading…"); there's no skeleton or spinner, and only `admin-reminders.html` has an explicit empty-state message (the `<p class="empty">` note above "All rentals", line ~86) — none of the sales/expense/mileage lists in `admin-finance.html` show a "nothing here yet" message when a list happens to be empty, so an empty result can look indistinguishable from a still-loading or broken state. Standardize a small loading-spinner + empty-state pattern in the shared admin.js from item 9 and use it everywhere data is fetched.

15. **Add inline, per-field validation feedback on the public booking form.**
    `index.html`'s booking form (lines ~1073-1146) relies entirely on native browser `required`/`type` validation with no inline error text, no phone-number pattern/format hint, and no `aria-describedby` error association. Add a lightweight inline-error pattern (shown next to each field on blur/submit) plus a `pattern` attribute on the phone input, improving both usability and accessibility for screen-reader users who may not get clear feedback from the browser's default validation bubble.

---

## Flagged but out of scope (not a performance/UX item, noting for awareness)

- The admin `secret` (`INVOICE_SECRET`) is stored in **plaintext in `sessionStorage`** (`rto-admin-secret`, referenced in every admin page) and compared with a simple `!==` string check server-side (e.g. `get-rentals.mjs` line 13, `finance.mjs` line 13) rather than a constant-time comparison, with no rate-limiting on repeated wrong-secret attempts. Not part of this performance/UX pass, but worth a follow-up security review.
