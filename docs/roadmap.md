# Roadmap

Phases mirror `CLAUDE.md` §12. The rule is that the vertical slice gets proved
before infrastructure gets built.

## Phase 1 — MVP · mostly done

- [x] Multi-image upload, drag-and-drop and file picker
- [x] Image quality checks with plain-language advice
- [x] Card detection and cropping
- [x] Browser OCR in a worker pool
- [x] Signal extraction: number, year, copyright, variant, language, name
- [x] Pokémon identification via TCGdex
- [x] Confidence with margin and field-level flags
- [x] Inline editing everywhere, copy buttons everywhere
- [x] Batches, sorting, filtering, search
- [x] Multi-select in the cards table: shift-click ranges, bulk copy, bulk delete
- [x] Duplicate detection and merge-to-quantity
- [x] Keyboard-first review queue
- [x] Generic CSV, JSON, and template-driven eBay CSV
- [x] Job queue with retry, backoff, circuit breaker, resume
- [x] Static deployment, no build step
- [ ] **Labelled fixture set and a measured accuracy figure**
- [ ] Front/back image pairing (modelled, not wired)

## Phase 2

- [ ] Saved mapping templates per category
- [ ] Batch retry from the results view
- [ ] Per-card processing diagnostics in the UI
- [ ] Better name extraction — the current heuristic is the weakest link
- [ ] Variant selection from the printing's known finishes
- [ ] Project statistics panel
- [ ] Export presets

## Phase 3

- [ ] Multi-card photos — detect and crop a grid into separate jobs
  (the pipeline already takes N crops per image, so this is not a rewrite)
- [ ] Magic (Scryfall) and Yu-Gi-Oh! (YGOPRODeck) providers
- [ ] Mobile camera capture flow
- [ ] Image-similarity matching to complement OCR
- [ ] Fully offline mode with a cached set index

## Phase 4 — not before the above earns it

eBay API and direct listing, inventory management, SKU automation, pricing,
sales analytics, AI-written descriptions, grading assistance, barcode scanning,
label printing.

These are listed so they are not forgotten, not so they are started.

## Known risks

| Risk | Exposure | Mitigation |
|---|---|---|
| Accuracy unmeasured | Cannot promise anything yet | Fixture set is the next task |
| Name extraction is a heuristic | Wrong name on low-text cards | Number carries most of the weight; review catches the rest |
| TCGdex availability | Free, volunteer-run | Breaker + cache; provider seam allows a fallback |
| Sports cards have no free data | Blocks a whole market | Flagged early; decide before promising it |
| No pricing | Sellers want it | Deliberate — separate system, no reliable free DE source |
| Browser storage limits | Very large batches | Thumbnails, not originals, in the working set; export to keep |
| eBay changes its templates | Export breaks | Template-driven by design — this is the mitigation |
