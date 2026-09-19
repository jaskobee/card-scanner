# Card Scanner

Turn a pile of trading cards into an eBay-ready listing file.

```
photos → identify → verify → structured data → eBay CSV
```

This is a listing automation tool, not a collection tracker. Everything is
judged by one question: does it get 500 cards to an eBay CSV faster?

**It runs entirely in your browser.** Your photos are never uploaded anywhere.
Text recognition happens on your machine; only the words read off a card — a
name and a number — are sent to the open card database to look it up.

---

## Run it

No build step, no bundler, no dependencies.

```bash
git clone <your-repo-url>
cd card-scanner
npm start          # http://localhost:8080
```

`npm start` runs a small static server from `tools/serve.js`. You need one:
the app is made of ES modules, which browsers refuse to load from `file://`.

Node 22 or newer. Nothing is installed — `package.json` has no dependencies.

---

## Deploy it

The whole app is static files, so any static host works and all of them are
free at this size. GitHub Pages is genuinely suitable here, because there is no
backend to accommodate.

**GitHub Pages** — Settings → Pages → Deploy from branch → `main` / root.
The included workflow at `.github/workflows/deploy.yml` does it on every push.

**Cloudflare Pages / Netlify / Vercel** — connect the repo, leave the build
command empty, set the output directory to `/`.

There is nothing to configure and no environment variables. `.env.example`
exists only to stay honest about that.

---

## How it works

```
image → quality check → crop → OCR → signals → card database → rank → confidence
```

| Step | Where | What it does |
|---|---|---|
| Quality check | browser | blur, darkness, glare, size — warns with advice, never blocks |
| Crop | browser | finds the card against a plainer background |
| OCR | browser, Web Worker | Tesseract.js, English + German |
| Signals | browser | card number, year, copyright, variant terms, language, name |
| Lookup | TCGdex | free, open, no key, multilingual |
| Ranking | browser | weighted signal agreement, with a margin check |

Nothing is populated without evidence. Every identification value carries where
it came from, how confident we are, and the exact text it was read from:

```js
{ value: '4/102', source: 'ocr', confidence: 0.93, evidence: '4/102' }
```

When there is no evidence, the value is `null` and the card goes to review. It
never becomes a plausible guess.

### Confidence

| Band | Score | What happens |
|---|---|---|
| Identified | ≥ 0.90, clear of the runner-up | auto-accepted in Fast Scan |
| Check this | 0.70–0.89 | review queue, weak fields flagged |
| Needs review | < 0.70 | manual review |

A 0.92 match with a 0.91 runner-up is a coin flip, so it is demoted regardless
of the score. Field-level disagreements are flagged even when the overall match
is strong.

---

## Export

eBay has no universal CSV. Columns differ by category and by country, and they
change. So the app reads **your** template from Seller Hub rather than guessing:

1. Upload your eBay template file
2. It finds the header row beneath eBay's preamble
3. It maps what it can and shows you the mapping
4. Unknown columns are preserved verbatim, in position
5. Required columns with no evidence are marked `Needs review`, never invented
6. It validates before letting you download

Files are UTF-8 with a BOM so `Ä Ö Ü ß` survive in German Excel. Card numbers
like `004/120` are quoted as text so they are not silently turned into dates,
and cells beginning `=` `+` `-` `@` are neutralised against formula injection.

A generic CSV and a JSON export are always available too — your data stays
yours whatever eBay does next.

---

## Supported cards

**Pokémon today**, via [TCGdex](https://tcgdex.dev) — free, open, no API key,
and it carries German, French, Spanish, Italian and Japanese printings.

Data sources sit behind a provider interface (`src/providers/`), so adding
Magic (Scryfall), Yu-Gi-Oh! (YGOPRODeck) or sports cards means writing one file
and touching neither the pipeline, the UI nor the exporter.

---

## Limitations

Worth knowing before you scan 500 cards:

- **Pokémon only** so far.
- **One card per photo.** Multi-card photos are a planned step, and the
  pipeline is already shaped for it, but it is not built.
- **Front only.** Back-image support is modelled but not wired up.
- **No pricing.** Identification and valuation are deliberately separate
  systems; pricing is not implemented rather than implemented badly.
- **Condition is yours.** The app will not guess condition from a photo, ever.
- **Accuracy is unmeasured.** There is no labelled fixture set yet, so the app
  makes no accuracy claim. See `docs/testing.md`.
- **Storage is local.** Clearing site data clears your batches. Export to keep
  anything you care about.

---

## Tests

```bash
npm test     # unit tests, zero dependencies
npm run check  # import graph, unsafe innerHTML, missing references
node test/smoke.mjs   # browser smoke + pipeline E2E (needs Playwright)
```

The smoke test drives a real browser: it boots the app, walks every view,
checks that every control has an accessible name, and runs an image through the
whole pipeline with OCR and the database stubbed — so it tests our wiring, not
a third party's uptime.

---

## Docs

| | |
|---|---|
| [architecture.md](docs/architecture.md) | how the pieces fit, and why |
| [setup.md](docs/setup.md) | running it locally |
| [deployment.md](docs/deployment.md) | hosting options compared |
| [card-data-sources.md](docs/card-data-sources.md) | providers, limits, licensing |
| [ebay-export.md](docs/ebay-export.md) | template handling and CSV safety |
| [testing.md](docs/testing.md) | strategy, and the fixture set we owe |
| [troubleshooting.md](docs/troubleshooting.md) | when something goes wrong |
| [roadmap.md](docs/roadmap.md) | what is next and what is deliberately not |

`CLAUDE.md` holds the working agreement for anyone — human or agent — writing
code here. Read it first.

## Licence

MIT. Card data belongs to its respective sources; see `docs/card-data-sources.md`.
