# CLAUDE.md — Trading Card Scanner → eBay Listing Prep

Instructions for any agent or developer working in this repository.
Read this before writing code. It overrides general habits.

---

## 1. What this product is

A web app that turns a pile of physical trading cards into eBay-ready inventory.

```
photos → identify → verify → structured data → eBay CSV
```

It is a **listing automation tool**, not a collection tracker. Every feature is
judged by one question: *does this get 500 cards to an eBay CSV faster?*

Scale targets: 50/day now, 500/day soon, 1,000+/day eventually.

---

## 2. Non-negotiables

These are the rules that are easiest to break and most expensive to break.

### 2.1 Never invent card data

No field is populated unless there is evidence for it. Card numbers, sets,
years, variants, editions, serial numbers, grades and prices are **never**
guessed, interpolated, or filled from a plausible-looking neighbour.

Absent evidence, the value is `null` and the status is `needs_review`.
Never write `123/999` because the set usually has 999 cards.

Every extracted value carries its provenance:

```ts
type Extracted<T> = {
  value: T | null
  source: 'ocr' | 'db_match' | 'user' | 'template' | 'inferred'
  confidence: number        // 0..1
  evidence?: string         // the OCR span / the matched DB record id
}
```

`source: 'inferred'` is allowed only when the inference rule is explicit and
recorded, and it never produces confidence > 0.7.

### 2.2 Identification and pricing are separate systems

A correct identification does not imply a correct price. They live in different
modules, have different confidence scores, and are displayed separately. A price
always shows its source and its as-of date, and is always labelled an estimate.

### 2.3 Free-first

No paid API, model, OCR, database, or hosting without asking the user first.
When a free path is inadequate, stop and present: why it's needed, the free
alternatives tried, the cost, the limits, the scaling story. Then wait.

### 2.4 No fragile scrapers

Official APIs and public structured datasets only. Respect robots.txt and terms.
Never bypass auth, CAPTCHAs, or rate limits. If a source can't legally and
reliably support a feature for free, say so **before** it becomes a dependency.
Every data source sits behind the provider interface so it can be swapped.

### 2.5 One failure never cascades

A card that fails processing fails alone. The other 99 complete. Job state is
persisted so a crash or a closed tab is resumable, never a lost batch.

### 2.6 Zero silent data corruption on export

Export is the product's last mile and the place users notice damage. See §6.

---

### 2.7 Research precedes implementation

Before major build work, produce a short research report: five-plus competitors
(strengths, recurring complaints, lessons), ten-plus concrete user pain points
from real reviews, free technology options (3+ each for OCR/vision, card data,
hosting, storage), the verified eBay Germany bulk-listing workflow, the proposed
MVP scope with what's postponed and why, one architecture diagram, and risks by
category. Verify third-party formats, limits and pricing at the source — never
from memory. Recurring competitor complaints become explicit anti-requirements
in this file.

---

## 3. Product principle

Not: *"AI guessed your card, trust us."*

But: *"AI identified your card. Here's the evidence, confidence, and the
alternatives. Verify it in two seconds."*

Confidence bands, used consistently in UI and code:

| Band | Score | UI | Behaviour |
|---|---|---|---|
| High | ≥ 0.90 | ✅ | Auto-accept in Fast Scan Mode |
| Medium | 0.70–0.89 | ⚠️ | Review queue, field-level flags |
| Low | < 0.70 | ❌ | Review queue, manual required |

Status is never communicated by colour alone — always icon + text.

The user should never need to inspect all 500 cards. Only the uncertain ones.

---

## 4. Architecture

```
Browser (Next.js + React + TypeScript + Tailwind)
  ├── upload / drag-drop / camera
  ├── image quality check        ← local
  ├── card detect + crop         ← local
  ├── OCR (Tesseract.js)         ← local, in a Web Worker
  ├── virtualized results table
  └── review queue (keyboard-first)
        │
        ▼ only what needs the network
  Provider layer (pluggable)
  CardDatabase
    ├── PokemonProvider   (e.g. TCGdex / Pokémon TCG API)
    ├── MagicProvider
    ├── YugiohProvider
    ├── SportsProvider
    └── FutureProvider
        │
        ▼
  Matching + scoring  →  confidence  →  card record
        │
        ▼
  Export: generic CSV / user's eBay template / XLSX / JSON
```

Conventions:

- **Local-first.** Do image work in the browser unless there is a concrete
  reason not to. It is faster, cheaper, more private and more scalable.
  Anything that does leave the browser must be disclosed in the UI.
- **Web Workers** for OCR and image processing. The main thread never blocks.
- **Virtualized lists** everywhere a collection is rendered. Never hold 1,000
  full-resolution images in memory; use downscaled working copies and thumbnails.
- **No login for the MVP.** Anonymous local usage must work. Persistence via
  IndexedDB first; a free-tier hosted DB only if genuinely needed.
- **Provider interface** is the seam. Adding a card game must not touch the
  pipeline, the UI, or the exporter.
- **Bulk multi-card images** are Phase 3, but the pipeline takes *N crops per
  uploaded image* from day one so adding it is not a rewrite.

Concurrency: a real queue with rate limiting, retries with exponential backoff,
caching, duplicate short-circuiting, cancellation, and per-job retry. Tune
concurrency to the politest free-API limit, not to the fastest machine.

---

## 5. Card data model

One normalized internal model, extensible, all identification fields wrapped in
`Extracted<T>`. Groups: identification (name, number, set, series, year,
manufacturer, brand, game, sport, team, league, language, region) · variant
(base, parallel, foil, holo, reverse holo, refractor, chrome, prizm, 1st
edition, promo, insert, autograph, relic, numbered, serial) · condition
(condition, grading company, grade, cert, raw/graded, quantity, SKU, notes) ·
listing (title, category, item specifics, description, price, shipping,
returns, format) · metadata (source/front/back images, timestamp, confidence,
identification status, review status, errors, provider, match candidates).

**Variant is first-class.** It is the single most common competitor complaint.
It gets its own extraction signals, its own confidence, and its own review step.

**Condition is never inferred from an image.** The user selects it. Always.

Lifecycle — a card is always in exactly one state, never "lost":

```
UPLOADED → PROCESSING → IDENTIFIED → NEEDS_REVIEW → VERIFIED → READY → EXPORTED
```

`FAILED` is reachable from `PROCESSING` and always retryable.

---

## 6. Export rules

There is no universal eBay CSV. Do not pretend otherwise.

Primary path: the user uploads *their* official eBay template. The app reads the
headers, detects required vs optional columns, maps internal fields, **preserves
every unknown column untouched**, fills what it can, flags what it cannot, and
validates before download. Field mappings are saveable and reusable as named
templates.

Never invent an eBay field or value. Unknown → `Missing` / `Needs review` /
`User input required`.

Title generation is a configurable template with live preview and length
validation against the marketplace limit. Default:
`{Year} {Brand} {Set} {Card Name} #{Card Number} {Variant}`

CSV correctness — this is a German-market product, so test every one of these:

- UTF-8 preserved end to end; BOM decision made deliberately and documented
- delimiter handling for both `,` and `;` conventions
- quote and delimiter escaping inside fields
- `Ä Ö Ü ä ö ü ß`, French accents, Japanese, apostrophes, curly quotes
- leading zeroes preserved — `004/120` must never become `4/120` or a date
- serial numbers and fractions never coerced to numbers or dates
- newlines inside description fields

Export is blocked on validation errors, with a per-issue breakdown and a
"Fix issues" path. "Export anyway" exists but is explicit.

Also ship a plain generic CSV, XLSX and JSON export independent of eBay.

---

## 7. UI rules

The whole product answers five questions instantly: *What do I do? What's
happening? What happened? What needs me? What's next?*

- Polished, modern, calm. Non-technical users.
- No developer terminology in user-facing text. Not `HTTP 422`, not
  "OCR confidence threshold exceeded". Say what happened and what to try.
- **Inline editing**, not dialogs. Click-to-edit, Enter to save, Esc to cancel.
- **Copy buttons** on every meaningful value, plus copy-card, copy-selection,
  copy-CSV-row. Show a brief "Copied!".
- **Alternative matches** always available, ranked with scores.
- **Review mode** is keyboard-first: `Enter` accept · `E` edit · `S` skip ·
  `D` delete · `N` next · `P` previous.
- **Fast Scan Mode**: auto-accept high confidence, route the rest to review.
- **Duplicates** are surfaced, never auto-deleted. Offer keep-all / merge-to-
  quantity / review.
- **Manual entry always exists** and uses the same form as AI correction.
- Mobile: photo → scan → review → save. Desktop: drag 500 → process → review
  the uncertain → export.
- Accessibility: keyboard navigation, visible focus, readable contrast,
  screen-reader-friendly status, never colour alone.

### Projects and statistics

Cards live in named projects/batches. Create, rename, duplicate, archive,
delete, export — all of them. Each project shows an honest summary: uploaded,
scanned, needs review, failed, average confidence, potential duplicates, ready
for export. The numbers are computed, never estimated for effect.

---

## 8. Security

Uploaded images and CSV/XLSX files are untrusted input. MIME and extension
validation, size limits, safe decoding, sanitization, throttling, secure
headers, XSS protection. Never execute an uploaded file. Never expose uploaded
images publicly. Minimize retention and logging.

---

## 9. Engineering workflow

- Feature branches → PR → CI. `main` stays deployable.
- CI runs lint, typecheck, tests, build. Dependency scanning where practical.
- Small, meaningful commits: `feat: add eBay template parser`,
  `fix: preserve UTF-8 characters in CSV`. Never one giant commit.
- Never commit secrets. `.env.example` stays current.
- Source on GitHub; hosting chosen to fit the architecture, not the reverse —
  do not contort the app into GitHub Pages if it needs server routes. Evaluate
  Vercel / Cloudflare Pages / Netlify on the free tier.
- Preview deployment per PR where the host supports it.

Docs that must exist and stay true:

```
README.md
docs/architecture.md  setup.md  deployment.md  card-data-sources.md
     ebay-export.md    testing.md  troubleshooting.md  roadmap.md
```

---

## 10. Testing

Unit: OCR normalization · field extraction · confidence calculation · duplicate
detection · title generation and truncation · CSV generation and escaping ·
template mapping.

Integration: upload · pipeline · storage · each card provider · eBay template
parsing.

E2E: 1 card upload→scan→review→edit→save→export; 100 cards
upload→process→review low confidence→export.

Fixtures at `/test-data/cards/{pokemon,mtg,yugioh,sports}/`, each case carrying
image + expected name, set, number, variant, and an expected confidence *range*.
Include the hard cases deliberately: poor lighting, glare, tilt, old and new
stock, non-English cards, foils, numbered, signed, graded slabs, duplicates.

Accuracy claims are measured against fixtures, never asserted. Do not claim
100% accuracy, ever.

---

## 11. Observability

Track, without storing personal data: scan success rate, average processing
time, OCR failure rate, low-confidence rate, provider errors, export validation
failures. Per-scan dev diagnostics: processing time, OCR confidence, match
confidence, provider, status.

---

## 12. Roadmap discipline

- **Phase 1 (MVP):** upload · multi-image · preview · OCR · identification ·
  card data · confidence · inline edit · copy · projects · sort/filter ·
  CSV export · repo · free deployment.
- **Phase 2:** eBay template upload + mapping + eBay CSV · review queue ·
  duplicates · front/back · saved templates · shortcuts · batch retry ·
  better matching.
- **Phase 3:** bulk multi-card images · advanced matching · more databases ·
  pricing · variant recognition · mobile camera · offline processing.
- **Phase 4 (do not pre-build):** eBay API, direct listing, inventory, SKU
  automation, pricing automation, analytics, AI descriptions, grading
  assistance, barcodes, label printing.

Prove the vertical slice before building infrastructure. The first milestone is
upload → OCR → identify → display → edit → export CSV, working on real,
difficult images.

---

## 13. When blocked

Decide independently where a reasonable technical choice exists. Ask only when:
scope materially changes · a credential is needed · an API requires payment ·
there are legal/ToS implications · competing architectures have materially
different consequences · a card category needs prioritizing · the eBay workflow
can't be determined reliably.

Ask in this shape: what you found · what decision is needed · Option A ·
Option B · your recommendation. Never just "what do you want me to do?"

---

## 14. Definition of done

A change is done when a user can: open the site · upload many images · watch
progress · get structured card data with confidence · correct mistakes inline ·
copy fields · search, sort, filter · see duplicates · work a review queue ·
upload an eBay template · map fields · validate · download an eBay-compatible
CSV and a generic CSV · come back to the project later · and install nothing.

And when the anti-requirements hold: nothing invented, nothing silently
corrupted, nothing lost, nothing frozen, nothing unexplained.
