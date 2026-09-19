# Roadmap

Phases mirror `CLAUDE.md` §12. The rule is that the vertical slice gets proved
before infrastructure gets built.

## Phase 1 — MVP · mostly done

- [x] Multi-image upload, drag-and-drop and file picker
- [x] Image quality checks with plain-language advice
- [x] Finding the card in a photo and straightening it, from the full-resolution original
- [x] Browser OCR in a worker pool, reading the name and number strips separately
- [x] Signal extraction: number, year, copyright, variant, language, name
- [x] Pokémon identification via TCGdex
- [x] Cards no database knows are read for their printed text (name, maker, product, league, year, print run)
- [x] Confidence with margin and field-level flags
- [x] Inline editing everywhere, copy buttons everywhere
- [x] Batches, sorting, filtering, search
- [x] Multi-select in the cards table: shift-click ranges, bulk copy, bulk delete
- [x] Duplicate detection and merge-to-quantity
- [x] Keyboard-first review queue
- [x] Generic CSV, JSON, and template-driven eBay CSV
- [x] Job queue with retry, backoff, circuit breaker, resume
- [x] Static deployment, no build step
- [ ] **A labelled set of real photos and a measured accuracy figure** (a synthetic measurement exists: see `testing.md`)
- [ ] Front/back image pairing (modelled, not wired). **Next after real photos:** sports and entertainment cards keep their number, set and year on the back

## Phase 2

- [ ] Saved mapping templates per category
- [ ] Read eBay's Excel (`.xlsx`) templates: a multi-category download is Excel by default
- [ ] Verify the starter against real German templates (`test-data/ebay-templates/`)
- [ ] Set card type, condition and price for many cards at once (needs multi-select)
- [ ] Item specifics (`C:` columns) for cards, from the real templates rather than guessed
- [ ] Batch retry from the results view
- [ ] Per-card processing diagnostics in the UI
- [x] Better name extraction — the name strip is read alone and verified against the database
- [ ] Trim the located card to its true edge (a drop shadow inflates it a few percent)
- [ ] Correct perspective, not only tilt
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
| Accuracy on real photos unmeasured | Cannot promise anything yet | Synthetic measurement exists; a labelled real-photo set is the next task |
| Name extraction is a heuristic | Wrong name on low-text cards | Verified against the database; the number carries most of the weight; review catches the rest |
| TCGdex availability | Free, volunteer-run | Breaker + cache; provider seam allows a fallback |
| Sports cards have no free data | Blocks a whole market | Read from the printed text instead, always to review; a free sports database is still not found |
| Names in stylised typefaces | A name may read partial or wrong on chrome, foil or script lettering | Every line read is kept and offered; measured only on drawn cards, so real photos are the test |
| No pricing | Sellers want it | Deliberate — separate system, no reliable free DE source |
| Browser storage limits | Very large batches | Thumbnails, not originals, in the working set; export to keep |
| eBay changes its templates | Export breaks | Template-driven by design — this is the mitigation |
