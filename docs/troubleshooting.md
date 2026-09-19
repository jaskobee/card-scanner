# Troubleshooting

## The page is blank and the console mentions CORS or modules

You opened `index.html` from the filesystem. Browsers refuse to load ES modules
over `file://`. Run `npm start` and use `http://localhost:8080`.

## "Card Scanner could not start"

IndexedDB is unavailable. Usually a private window, or site data blocked for
this origin. Try a normal window, or allow site data.

## The first scan takes ages, then later ones are fast

Expected. The first scan downloads Tesseract language data (English + German,
about 15 MB). Your browser caches it afterwards.

## "Could not load the text recogniser"

The Tesseract script is fetched from jsDelivr. A blocked CDN, an offline
machine or a strict content blocker will stop it. Allow `cdn.jsdelivr.net`, or
self-host the script and change the URL at the top of `src/ocr.js`.

## Everything comes back "Needs review"

In order of likelihood:

1. **Wrong language.** A German card scanned with the language set to English
   fails at the database lookup even when OCR read the text correctly. Set the
   language on the upload screen.
2. **Glare.** The most common cause by a distance. Move out from under direct
   overhead light, tilt the card, and take sleeved cards out of the sleeve.
3. **The card is small in the photo, or the table is busy.** The number is about
   as tall as a fingernail's width on a real card, so it needs pixels. Fill most
   of the frame with the card, on a plain surface, with all four edges visible.
   A card lying on a surface close to its own colour is harder to find.
4. **The card number is not visible.** It is our strongest signal. If it is
   cropped out or covered, matching has little to work with.
5. **Black-bordered cards** print the number in white. They are read a second
   time to cope with that, but strong glare on the border can still defeat it.
6. **Unsupported game.** Only Pokémon is wired up today.

## "We stopped scanning"

The circuit breaker. Eight jobs failed in a row, which means the card database
is unreachable rather than the cards being bad. Everything already scanned is
saved. Press "Try again" when your connection is back.

## Scanning is slow

Three cards at a time by design — politeness to a free, volunteer-run API, not
a limit of your machine. `concurrency` in `src/ui/app.js` is the knob. Raising
it knowingly is fine; raising it thoughtlessly is how a free service gets shut
to everyone.

## German characters are wrong in Excel

They should not be — the export writes a BOM. If you are opening the file via
Excel's text import wizard rather than double-clicking it, choose UTF-8
explicitly there.

## Card numbers turned into dates in my spreadsheet

Not from our export — `004/120` is written as quoted text and the round trip is
tested. If it happened, something re-saved the file in between. Check whether
your spreadsheet app re-exported it.

## eBay rejected my file

Check what eBay's error names, then:

- Confirm the template came from the same category and country you are listing
  in — the columns differ.
- Look for `Needs review` in the file. That is us telling you a required field
  had no evidence.
- Confirm the delimiter matches what eBay expects for your locale. We use your
  template's own delimiter.

## My batch disappeared

Batches live in this browser's IndexedDB. Clearing site data removes them, and
they do not sync between devices or browsers. Export to keep anything you care
about — this is the honest cost of not requiring an account.

## A card was identified as the wrong printing

Open it in Review. The alternatives are listed with their scores; pick the
right one and it is applied immediately. If the right printing is not in the
list at all, the database lookup never found it — check the language setting,
then correct the fields by hand. Manual entry always works.
