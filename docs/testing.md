# Testing

## What exists

```bash
npm test              # unit tests, node:test, zero dependencies
npm run check         # import graph, unsafe innerHTML, missing references
node test/smoke.mjs   # browser smoke + pipeline E2E (Playwright)
node tools/accuracy.mjs  # scan accuracy on synthetic photos (Playwright + network)
```

### Unit — `test/*.test.mjs`

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
- **Image processing** — lighting removal against a gradient, why light-on-dark
  text needs inverting, percentile contrast that one bright pixel cannot defeat.
- **Card finding** — position, size and tilt of a card in a synthetic photo of
  known geometry, on light and dark tables, lit from one side, with noise, on its
  side, and a card whose body matches the table. Also that a small blob, an empty
  table and a wide bar are refused.
- **Reading** — built from strings Tesseract really returned: picking the name
  from junk, never taking one from an "Evolves from" line, HP that no card can
  have, a slash read as a pipe, a set size that does not exist.
- **Text reading** (`textlines.test.mjs`) — built from what Tesseract really
  returned for drawn cards, not from strings we made up: grouping words into
  lines whatever order they arrive in, choosing a name from logos, team names and
  legal print, restoring word spaces from the gaps between letters, refusing to
  strand a single letter ("TO B IAS"), keeping apostrophes and hyphens
  (`DE'ANDRE`, `TANAKA-REYES`), never letting a tidier-looking reading replace a
  better one, and pulling manufacturer, product, league, finish, year, number and
  print run out of the lines that say them.
- **The card database** — with a fake `fetch` shaped like the real API: the two
  lookup routes, the year check that stops a misread set size landing on the
  wrong printing, filters dropped in turn, and that a failing database throws
  (to be retried) while a 404 is an empty answer.

### Browser — `test/smoke.mjs`

Drives a real Chromium: boots the app, walks every view, asserts no console
errors, checks every control has an accessible name, and runs a synthetic image
through the **whole pipeline** with OCR and the provider stubbed. It also
selects and deletes cards against real IndexedDB, asserting that the photos
leave storage and not merely that the rows leave the table.

Stubbing them is deliberate. This test proves our wiring — canvas handling,
cropping, signal extraction, scoring, provenance, persistence — rather than a
third party's uptime. It also checks the number-reading retry: corners are read
once when a valid number comes out, and again inverted only when none does, and
that a card no database knows keeps the name, maker and year printed on it (each
with the words it came from) instead of the junk the Pokémon strips read there,
while a number and a set nobody printed stay empty.

### Scan accuracy — `tools/accuracy.mjs`

Runs the real pipeline (real Tesseract, real TCGdex) on 16 official card scans
spanning 1999 to 2024, plus two German printings, clean and degraded to look like
phone photos: a table behind, tilt, blur, glare, noise, JPEG compression. It
starts the app's own code in a browser, so it measures what ships.

```bash
npm start                        # one terminal
node tools/accuracy.mjs          # another; ~4 minutes
node tools/accuracy.mjs --scen easy --save /tmp/overlays   # see what the card finder saw
```

Expected names and numbers come from the database itself, never from a person.
The card images are fetched once into `test-data/cards/pokemon/.cache/` and are
not committed — they belong to their publishers. It is not part of CI: it uses
the network and takes minutes.

**Read the caveats before quoting a number.** The photos are synthetic and start
from ~600px scans, so the *medium* and *hard* conditions blur away fine print
that a real 12-megapixel photo would keep; they are harsher than life on small
print and kinder on everything else. Sixteen cards is small (one card is six
points). Use it to compare one version of the code with another. It is not an
accuracy claim, and nothing here should be turned into one.

Measured 2026-09-19, the same photos each time:

| condition | right card, shipped scanner | right card, now | offered (one click away), now | confidently wrong |
|---|---|---|---|---|
| clean scan | 13% | 88% | 94% | 0 |
| easy photo | 19% | 63% | 75% | 0 |
| medium | 25% | 63% | 63% | 0 |
| hard | 0% | 25% | 31% | 0 |

"Offered" means the right card is the top pick or among the alternatives. The
last column is the one that matters most and must stay at zero.

Two things this does **not** say. Auto-accept stays low even when the card is
right, because a card whose printing exists in several finishes is deliberately
sent to review for its variant (`CLAUDE.md` §5): a photo cannot show holo from
normal. And nothing here has touched sleeved cards, slabs, foil glare in the
real world, or any game but Pokémon.

### Cards no database knows — `tools/accuracy-generic.mjs`

Sports, wrestling and film cards have no free database, so there is nothing to
check a reading against except what was printed on the card. This draws cards
(`tools/synthetic-cards.js`): five layouts (a nameplate low down, a banner up
high, a name stacked at the side, a big centred name, a stripe across the middle)
with a brand logo, a team, stats, legal print and serial numbers around the name,
and invented people. It records what it drew, degrades each card into a photo
(`tools/synthetic-photo.js`, shared with `accuracy.mjs`), runs the real pipeline
with a stand-in where the database would be, and compares.

```bash
npm start                                            # one terminal
node tools/accuracy-generic.mjs                      # another; ~4½ minutes
node tools/accuracy-generic.mjs --via reader         # only the text reader; faster
node tools/accuracy-generic.mjs --save /tmp/missed   # keep the photos that went wrong
```

**The cards are drawn, not real.** They have the awkward parts (a decoy as big as
the name, italic capitals, light on dark) but not real photography, foil glare or
print detail, so real photos are harder. The people are made up. Use it to compare
one version of the reader with another and to find what breaks, never as a
promise about real cards. Twenty cards is small: one card is five points.

Measured 2026-09-20, the same 60 photos each time. "Before" is the strips alone,
as shipped, which is what read a Bray Wyatt card as "GERI".

| condition | name found, before → now | with the spaces right | maker | product | year |
|---|---|---|---|---|---|
| clean | 20% → 95% | 20% → 85% | 0% → 90% | 0% → 88% | 23% → 100% |
| easy photo | 10% → 80% | 10% → 70% | 0% → 100% | 0% → 100% | 8% → 100% |
| medium | 5% → 50% | 5% → 35% | 0% → 100% | 0% → 100% | 0% → 69% |

The first version of the reader (2026-09-19) scored 95 / 75 / 55% on name found. The
changes that followed the first real photos left clean level, raised easy, and cost
medium (blurred) photos one card in name found and three in spacing. That trade was
made knowingly: on real scans the exact name went from 1 of 5 to 4 of 5 (see below).

What is still wrong, from the misses the tool lists: a name stacked over two
lines comes out as its surname alone about half the time (`stacked-left` finds the
whole name 42% of the time), a blurry photo loses the first letters ("JOR ELLIS"),
and a few names get a space in the wrong place ("TO BIAS") or none
("JORDANELLIS"). Every card read this way goes to review, because nothing vouches
for it, and none can be auto-accepted; that is the property that must not
change, more than any percentage above.

### Your own photos — `tools/scan-photos.mjs`

```bash
node tools/scan-photos.mjs                     # every photo in test-data/local/
node tools/scan-photos.mjs --save /tmp/seen    # also draw what it found on each card
```

Runs the real scanner on photos you drop into `test-data/local/` (git ignores
everything in it except its README) and prints, for each: the fields with where
each came from and how sure the scanner was, the other names it considered, and
every line of text it could read, biggest first. When a card scans badly, this
shows whether the text was never read or was read and the wrong line chosen.
That is what a labelled set of real photos will be built from.

**What the first real photos changed.** Five real scans (a Topps Chrome wrestling
card front and back, a second wrestling card front and back, one Pokémon card) were
read very differently from the drawn cards, in three ways the drawn cards had hidden.
Every line was enlarged to 100-pixel capitals for the second reading, which suited
the drawn cards, when a real card's own 35-pixel lettering read at 92% and the enlarged
copy read as "sway war" (both sizes are read now, and the better wins). A gold stripe read as "NLE SE" outranked the real name
because it was bigger, though one of its two words was 22% sure. And a second
reading split the Pokémon name "Regigigas" into "Regigi gas". The exact name
was right on 1 of the 5 photos before these fixes and on 4 of 5 after. Five photos
say very little, and the fifth (light stencil capitals on a diamond-plate) still
reads as junk at every size and setting tried, though its back reads cleanly.
Sports and entertainment backs carry the name in plain type, which is why pairing
the front and back photos matters more than any further tuning of the front.

### The eBay file — `test/ebay.test.mjs` and `test/smoke.mjs`

Unit tests cover the eBay knowledge (categories, the four ungraded conditions,
graders, grades, and that nothing outside eBay's lists is translated) and a mixed
batch through the template machinery. The browser test then exports a real mixed
batch and asserts on **the file a person would upload**: the info line first,
`Action` leading, each card in its own category, 2750 against 4000, the
descriptors, leading zeroes in a certificate number, `Format` always written, a
template's own info lines and unknown columns written back untouched, and that an
Excel template is explained rather than ignored.

Every eBay header in these tests is **reconstructed from what eBay's pages
document, not an eBay-issued file**, and the tests say so. Real templates in
`test-data/ebay-templates/` would replace them.

## What is missing, and it matters

**There is no labelled set of real photos.** `tools/accuracy.mjs` measures
synthetic ones, which is enough to tell whether a change helped but not to say
how the app does on your desk. Until real photographs are labelled and measured,
the app makes no accuracy claim, and neither should anyone else. The README says
so. The fastest way to close this gap is a dozen of your own photos that scanned
badly, with what each card actually is.

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
