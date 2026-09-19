# Architecture

## The shape of it

```
Browser (no framework, no build step)
  │
  ├── upload / drag-drop / camera
  ├── decode once, full resolution ─ ocr.js             local
  ├── image quality check ────────── imagequality.js    local, on a 1400px copy
  ├── find the card ──────────────── cardlocate.js      local, on a 400px copy
  ├── straighten and crop ────────── ocr.js             local, from the original
  ├── read the name and number ────── ocr.js, regions.js local, Web Workers
  ├── signal extraction ──────────── normalize.js       local
  │        │
  │        ▼  only a name, a number and an HP leave the device
  ├── provider lookup ────────────── providers/*.js     network
  ├── ranking + confidence ───────── match.js           local
  ├── card record ────────────────── model.js
  ├── persistence ────────────────── storage.js         IndexedDB
  └── export ─────────────────────── csv.js, title.js   local
```

## Why no framework

The app is one page with five views and a table. A framework would add a build
step, a dependency tree to audit, and a deployment story more complicated than
"copy these files to a static host". None of that buys anything here.

The cost is that `src/ui/app.js` re-renders a view wholesale rather than
diffing. At the table sizes that matter this is fine, because the table pages
at 100 rows. If the UI grows past what this comfortably carries, the module
boundaries below are already where a framework would slot in.

## Module map

| Module | Responsibility | Depends on |
|---|---|---|
| `model.js` | card shape, provenance, lifecycle, confidence bands | — |
| `normalize.js` | OCR folding, name / number / HP extraction, fuzzy containment | — |
| `match.js` | candidate scoring, ranking, margin, field flags | normalize |
| `csv.js` | CSV safety, template parsing, mapping, validation | — |
| `title.js` | title templating and length validation | — |
| `dupes.js` | identity keys, duplicate groups, merging | normalize |
| `queue.js` | jobs, concurrency, retry, backoff, breaker | — |
| `storage.js` | IndexedDB, blobs, object-URL lifetime | — |
| `imageproc.js` | lighting removal, contrast, thresholds on typed arrays | — |
| `cardlocate.js` | finds the card in a photo: position, size, tilt | imageproc, regions |
| `regions.js` | where the name and number sit, as fractions of the card | — |
| `imagequality.js` | quality heuristics and user advice | — |
| `ocr.js` | Tesseract worker pool, rendering the card, cropping strips | imageproc, regions |
| `pipeline.js` | orchestrates one image into one card | most of the above |
| `providers/*` | one card database each | queue, normalize |
| `ui/*` | views, table, review, export | everything |

Everything except `storage.js`, `ocr.js`, `pipeline.js` and `ui/*` is plain
typed-array or string code with no browser dependencies, which is why it carries
the unit tests, including finding a card in a synthetic photograph of known
tilt. `pipeline.js` is tested in a real browser with OCR and the provider
stubbed.

## How a card is read

Reading a whole card as one page of text fails: Tesseract is handed artwork,
holograms, attack text and a ten-pixel collector number at once and reads none
of it well. Measured on the clean official scans, that approach found the right
card 13% of the time. The two things that identify a card sit in predictable
places, so the pipeline reads those places and nothing else.

1. **Decode once, at full resolution.** Quality checks and card-finding run on
   small copies; everything that reads text is cut from the original, so small
   print keeps the detail the photo actually has.
2. **Find the card.** `cardlocate.js` models the table as a sloping plane fitted
   to the frame's edge, marks whatever differs from it by colour *or* by texture
   (a card's body is full of print; a table is smooth, so a silver card on a
   grey desk is still found), and fits the tightest rectangle around the largest
   blob. It reports position, size and tilt, and refuses a shape that is not
   card-like. It is not trusted blindly: when a card fills the whole frame it can
   mistake the card's own artwork for the card.
3. **Straighten and crop** to an upright 5:7 card.
4. **Read three strips** (`regions.js`): the top for the name and HP, and the two
   bottom corners for the number, which is bottom-left on recent cards and
   bottom-right on older ones. Each has its lighting removed (so glare and shadow
   stop competing with the ink) and is read on its own.
5. **Check the number against reality.** A denominator that is not a real set
   size is a misread, so numbers whose size the database knows come first.
   Nothing is repaired: the value is what was read. Black-bordered cards print
   the number in white, which lighting removal loses, so if no valid number
   comes out the corners are read again inverted.
6. **Look it up two ways** (see `card-data-sources.md`): by number and set size,
   or by name narrowed by card number and HP. The number route stops early only
   when the name *and the year* agree with what was printed, because a misread set
   size lands on a different printing of the same Pokémon whose name agrees
   perfectly and whose year does not.
7. **Take a second opinion.** If the first reading is not a confident
   identification it is repeated on the whole frame, and, if nothing at all was
   readable, upside down. The best reading wins. This is what makes an imperfect
   card-finder safe to have.

Two things were tried and rejected, on measurement. Guessing whether a strip is
light-on-dark from its pixels made light cards worse (a strip that takes in a
little dark table looks like light-on-dark), so the inverted reading is a retry
with a validity check instead. Measuring each pixel's deviation from its
surroundings in both directions made every card worse, because the pale halo
beside a dark stroke counts as ink and letters come out fat and merged.

## The provider seam

```js
{
  id, label, game,
  async search(signals) -> candidate records,
  async knownTotals() -> Set<number>,      // optional: real set sizes, to vet a number
  imageFor(record) -> url | null
}
```

A provider throws on a failed request and returns an empty list only for "there
is no such thing". A swallowed error would turn a hiccup into "no such card" and
a real outage into 500 cards quietly matched to nothing, so the queue's retries
and circuit breaker would never see it.

A candidate record is a plain object with the fields `match.js` weighs. Adding
a game is one file in `src/providers/` and one line where the provider is
chosen. The pipeline, the matcher, the UI and the exporter never learn that a
new game exists.

## Concurrency

`JobQueue` runs three jobs at a time. That number comes from politeness to a
free API, not from core count — see `card-data-sources.md`. It retries with
jittered exponential backoff, gives up after three attempts, and opens a
circuit breaker after eight consecutive failures so a provider outage stops the
run instead of converting 500 cards into 500 identical errors.

Job state is written to IndexedDB as it changes. On reload, anything left
`RUNNING` was interrupted, so it returns to `QUEUED`.

## Memory

A 500-image batch never holds 500 full-resolution bitmaps. Each image is decoded
once, measured on a 1400px copy, and read from the original; the bitmap is
closed as soon as that card's readings are done, so at most one per running job
is alive (three). A 220px WebP thumbnail is kept for display and the original
blob goes to IndexedDB. Object
URLs are handed out by `UrlCache` so they can all be revoked together.

Deleting a card removes its record and its photos in one transaction
(`removeCards`), so a crash cannot leave one without the other. The originals
are the bulk of what is stored, which is why leaving them behind is not an
option. At start-up `sweepOrphanBlobs` removes photos whose card no longer
exists — left by earlier versions that deleted only the record. It spares
anything saved in the last day, because a second open tab may be mid-scan with a
photo written and its card not yet saved.

## What is deliberately not here

No backend, no accounts, no analytics, no telemetry. Adding any of them changes
the privacy claim on the front page, so it is a product decision, not a
technical one.
