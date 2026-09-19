# Testing

## What exists

```bash
npm test              # unit tests, node:test, zero dependencies
npm run check         # import graph, unsafe innerHTML, missing references
node test/smoke.mjs   # browser smoke + pipeline E2E (Playwright)
```

### Unit — `test/csv.test.mjs`, `test/core.test.mjs`, `test/pipeline.test.mjs`

The pure modules carry the tests, because they carry the risk:

- **CSV safety** — escaping, delimiters, BOM, leading zeroes, date coercion,
  formula injection, and a full round trip of every hazard in one row under
  both delimiter conventions.
- **Template handling** — header detection beneath preamble rows, required
  column detection, mapping suggestion, unknown-column preservation, validation.
- **Provenance** — that absent evidence yields `null`, that an inference cannot
  present as near-certain, that user input is authoritative.
- **Lifecycle** — that illegal state transitions throw and failure is always
  retryable.
- **Matching** — leading-zero equivalence, set-size disagreement, evidence
  damping, margin reporting, field-level flags.
- **Titles** — token removal, orphan decoration, word-boundary truncation.
- **Duplicates** — identity keys that ignore condition, merging to quantity.
- **Queue** — that one failure does not sink a batch, retry limits, restore
  after an interrupted run, and the circuit breaker.
- **Image quality** — blur, darkness, glare and size on synthetic images.

### Browser — `test/smoke.mjs`

Drives a real Chromium: boots the app, walks every view, asserts no console
errors, checks every control has an accessible name, and runs a synthetic image
through the **whole pipeline** with OCR and the provider stubbed. It also
selects and deletes cards against real IndexedDB, asserting that the photos
leave storage and not merely that the rows leave the table.

Stubbing them is deliberate. This test proves our wiring — canvas handling,
cropping, signal extraction, scoring, provenance, persistence — rather than a
third party's uptime.

## What is missing, and it matters

**There is no labelled fixture set.** `test-data/cards/` is an empty skeleton.
Until it is filled, the app makes no accuracy claim, and neither should anyone
else. The README says so.

## The fixture set we owe

```
test-data/cards/pokemon/<case>/
  front.jpg
  expected.json
```

```json
{
  "name": "Glurak",
  "set": "Basis",
  "number": "004/102",
  "variant": "holo",
  "language": "de",
  "confidenceRange": [0.85, 1.0],
  "notes": "German Base Set, sleeved, slight overhead glare"
}
```

Include the hard cases on purpose, because they are where the product is
actually judged:

- poor lighting, strong glare, tilt, motion blur
- sleeved and top-loadered cards
- old stock (faded, off-centre printing) and current stock
- German, French, Japanese printings
- holo, reverse holo, first edition, promo, shadowless
- numbered and signed cards
- graded slabs
- the same card photographed twice

## What to measure

Once fixtures exist, report these and put them in the README:

| Metric | Why |
|---|---|
| Field-level accuracy | per field — name accuracy hides variant failure |
| **False-positive match rate** | the dangerous one: confidently wrong |
| Review-queue size | the product promise is that it stays small |
| Calibration | do 0.9-confidence results actually succeed ~90% of the time? |
| Median and p95 processing time | p95 is what a 500-card batch feels like |

Calibration is the one people skip. A model that says 0.9 and is right 60% of
the time is worse than one that says 0.6 honestly, because Fast Scan trusts the
number.

## Conventions

- Test names state the behaviour, not the function: *"required fields with no
  evidence are marked, not guessed"*.
- Assert the guarantee, not the implementation. If a weight changes, the
  matching tests should still pass; if `null` becomes a guess, they must fail.
- No test may depend on the network.
