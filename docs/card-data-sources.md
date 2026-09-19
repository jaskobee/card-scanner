# Card data sources

## Principles

From `CLAUDE.md` §2.3 and §2.4:

- Free first. No paid API without asking.
- Official APIs and public datasets only. No scraping, no bypassing auth,
  CAPTCHAs or rate limits.
- Every source sits behind the provider interface so it can be replaced.

If a source cannot legally and reliably support a feature for free, that gets
said out loud **before** it becomes a dependency.

## In use

### TCGdex — Pokémon

- `https://api.tcgdex.net/v2/{lang}/...`
- No API key. Open source, community maintained.
- Languages: en, de, fr, es, it, pt, ja, ko, zh — which matters for a
  German-market product more than anything else on this page.
- Gives us: card name, local number, set, set total, series, release date,
  rarity, image URLs, and which finishes a printing exists in.

We call it at **three requests per second with a burst of twelve**. That figure
is politeness, not a documented limit — it is a free service run by volunteers
and a 500-card batch should not look like an attack. If you raise it, raise it
knowingly.

The set total printed on a card (`/102`) resolves to a set, which is the
strongest identification path we have. Name search is the fallback and needs
the number to disambiguate reprints.

## Evaluated, not yet implemented

| Source | Game | Key | Notes |
|---|---|---|---|
| Pokémon TCG API | Pokémon | free key | Good fallback for TCGdex. English-centric. |
| Scryfall | Magic | none | Excellent, well documented, explicit rate guidance. Older cards lack a printed collector number, which weakens our strongest signal. |
| YGOPRODeck | Yu-Gi-Oh! | none | Complete. The passcode printed on every card is a strong OCR anchor. |
| Sports cards | — | — | **No good free structured source.** This is the real blocker for the sports market, not the scanning. Flagging it early rather than discovering it late. |

Adding one is a single file in `src/providers/` implementing `search(signals)`
and returning candidate records. Nothing else changes.

## OCR

**Tesseract.js 5**, loaded from jsDelivr, running in Web Workers. Free, open,
entirely local. English and German traineddata, about 15 MB, cached by the
browser after the first run.

Alternatives considered: the browser's own `Shape Detection API` (text
detection is not widely shipped), and PaddleOCR via ONNX Runtime Web (better
accuracy on stylised type, much larger download). Tesseract is the pragmatic
starting point; the `OcrPool` interface is small enough to swap.

## Licensing

Card names, set names and card images are the property of their publishers.
TCGdex serves them under its own terms. This app displays them for
identification and writes them into the user's own listing file — the same use
any seller makes of them. It does not redistribute a database.

Check the terms of any source before adding it, and record the answer here.

## Pricing

Deliberately absent. Identification and valuation are separate systems with
different error modes (`CLAUDE.md` §2.2), and a wrong price is more damaging to
a seller than an unidentified card. No free source gives reliable German
market comparables. Until one is found, showing nothing beats showing a number
that looks authoritative and is not.
