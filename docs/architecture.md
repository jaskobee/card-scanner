# Architecture

## The shape of it

```
Browser (no framework, no build step)
  │
  ├── upload / drag-drop / camera
  ├── image quality check ──────── imagequality.js   local
  ├── card detect + crop ───────── imagequality.js   local
  ├── OCR ──────────────────────── ocr.js            local, Web Worker
  ├── signal extraction ────────── normalize.js      local
  │        │
  │        ▼  only a name and a number leave the device
  ├── provider lookup ──────────── providers/*.js    network
  ├── ranking + confidence ─────── match.js          local
  ├── card record ──────────────── model.js
  ├── persistence ──────────────── storage.js        IndexedDB
  └── export ───────────────────── csv.js, title.js  local
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
| `normalize.js` | OCR folding, signal extraction, similarity | — |
| `match.js` | candidate scoring, ranking, margin, field flags | normalize |
| `csv.js` | CSV safety, template parsing, mapping, validation | — |
| `title.js` | title templating and length validation | — |
| `dupes.js` | identity keys, duplicate groups, merging | normalize |
| `queue.js` | jobs, concurrency, retry, backoff, breaker | — |
| `storage.js` | IndexedDB, blobs, object-URL lifetime | — |
| `imagequality.js` | quality heuristics, card bounds, user advice | — |
| `ocr.js` | Tesseract worker pool, image preparation | — |
| `pipeline.js` | orchestrates one image into one card | most of the above |
| `providers/*` | one card database each | queue, normalize |
| `ui/*` | views, table, review, export | everything |

The first seven have no browser dependencies, which is why they carry the unit
tests. `pipeline.js` is tested in a real browser with OCR and the provider
stubbed.

## The provider seam

```js
{
  id, label, game,
  async search(signals) -> candidate records,
  imageFor(record) -> url | null
}
```

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

A 500-image batch never holds 500 full-resolution bitmaps. Each image is
downscaled to 1400px for OCR and to a 220px WebP thumbnail for display; the
original blob goes to IndexedDB and the bitmap is closed immediately. Object
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
