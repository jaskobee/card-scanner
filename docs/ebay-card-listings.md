# eBay trading-card listings: what the files need

Research for the eBay export (CLAUDE.md §2.7). Checked against eBay's own pages
on **2026-09-19**, for **eBay Germany first**. Every claim below says how well it
was verified, because an eBay upload that is wrong is rejected, or worse,
accepted with the wrong meaning.

**Verified** means read on an eBay-operated page. **Corroborated** means eBay's
own community staff or several sellers agree but the primary page was not
readable. **Unverified** means it is what we would guess, and the code must not
present it as fact.

## What could not be checked, and why it matters

- **The current German template itself.** Downloading it needs a seller login. So
  the exact header row, the `#INFO` first line and the German names of the item
  specifics (the `C:` columns) are unverified. This is why the app reads *your*
  template rather than shipping its own, and why the bundled "starter" is labelled
  a starter.
- eBay's developer pages and ebay.de category pages returned 403 to automated
  reading. Nothing here was scraped past that, in line with §2.4.

## 1. The tool and the file

| Fact | Status |
|---|---|
| Upload in Seller Hub: Berichte (Reports) → Hochladen (Uploads) → *Vorlage abrufen* (Get template). `.xlsx` or `.csv`; tab or semicolon or comma separated | Verified (ebay.de help) |
| Template types: new listings, **drafts**, and edit templates (price, quantity, delete, tracking) | Verified |
| "The first column determines what action the file feed will perform" | Verified |
| Headers cannot be removed or modified | Verified |
| eBay's own bulk upload for cards: "Use only the templates provided… avoid using a custom .csv template" | Verified (US help, collection upload; the principle is why we read your template) |
| Since June 2024 one Excel template can cover **up to 10 categories**, each on its own sheet | Verified (US help). How a *CSV* covers several categories is **unverified** |
| A CSV cannot carry photos, only URLs of photos already hosted somewhere | Verified ("Item photo URL"); Corroborated (sellers) |
| No cell may contain a line break | Corroborated (sellers) |
| Legacy: comma, semicolon or tab; title max **80** characters | Verified (eBay Germany's own CSV-Manager guide) |

**Consequence for us:** we do not host photos, so we cannot fill live listings.
**Draft** listings are the natural target: for drafts only `Action` and
`Category ID` are mandatory, and the photos are added on eBay afterwards.

Live listings need: `Action`, `Category ID`, `Title`, `Start price`, `Quantity`,
`Item photo URL`, `Condition ID`, `Format`, `Duration` (Verified, US help).

## 2. `Action`

Legacy File Exchange values: `Add`, `Revise`, `Relist`, `End`, `Status`,
`VerifyAdd`, `AddToItemDescription` (Verified, eBay Germany 2015 guide).
`VerifyAdd` checks a file without creating listings, and eBay's own guide says to
use it the first time you upload. Whether the *current* Seller Hub still accepts
`VerifyAdd` is **unverified**. The header cell itself looks like
`Action(SiteID=US|Country=US|Currency=USD|Version=1193|CC=UTF-8)` on the US site
(Corroborated); the German equivalent is unverified.

## 3. Categories: single cards on eBay Germany

| Kind | ID | Status |
|---|---|---|
| Trading card games, singles (Pokémon, Magic, Yu-Gi-Oh!…) — *Spielzeug & Hobby › Sammelkartenspiele › CCG Einzelkarten* | **183454** | Verified: ebay.de category URLs |
| Non-sport, singles (film, TV, celebrities, music…) — *Sammeln & Seltenes › Non-Sport Trading Cards › Trading Card Einzelkarten* | **183050** | Verified: ebay.de category URLs |
| Sports, singles — *Sport-Fanartikel › Sport Trading Cards › Trading Card Einzelkarten* | **261328** | Verified on ebay.com; ebay.de's sibling "Sammlungen & Lots" is 261329. **Not directly seen for ebay.de.** Confirm in your template |
| Card **lots** (not supported by this app): CCG lots **183455**, sports lots 261329 | | Verified: ebay.de URLs |

**A correction to the notes this research started from:** CCG mixed lots is
**183455**, not 183456; both ebay.de and ebay.com category URLs show 183455.

Sellers pick the category per card, so a mixed batch needs a *card type* on every
card. The app never guesses it: a card the database identified as belonging to a
card game is a trading-card-game card; anything else the user chooses.

## 4. Condition: the part most often wrong

Since **23 October 2023** every single-card trading-card listing must say whether
the card is graded (eBay's community announcement, and eBay Germany's seller
portal). The old idea of one condition column with values like `4000, 5000,
6000, 7000` does not apply to cards. The model is:

| Card is | `Condition ID` | Required descriptors |
|---|---|---|
| **Ungraded** | `4000` | `Card Condition` |
| **Graded** | `2750` | `Professional Grader`, `Grade`; `Certification Number` recommended |

Status: the split and the requirements are Verified (eBay announcement, ebay.de
seller portal). The numeric IDs are Corroborated (eBay Community threads and a
seller-tools site that quotes eBay's tables; eBay's developer page listing them
returned 403).

**Ungraded `Card Condition`** — header `CD:Card Condition - (ID: 40001)`:

| ID | English | eBay Germany |
|---|---|---|
| 400010 | Near mint or better | So gut wie neu |
| 400011 | Excellent | Exzellent |
| 400012 | Very good | Sehr gut |
| 400013 | Poor | Schlecht |

Only these four exist. There is no "Good", "Played" or "Lightly Played" value, so
the app offers exactly these four and refuses to translate anything else.

**Graded** — headers `CD:Professional Grader - (ID: 27501)`,
`CD:Grade - (ID: 27502)`, `CDA:Certification Number - (ID: 27503)`. Grader IDs run
`275010` (PSA) upward; grade IDs run `275020` (10) downward through half grades to
`2750218` (1), then Authentic and its variants. The full lists are in
`src/ebay.js`. **Note the list has no CGC**, so a CGC-graded card cannot be
expressed except as `Other` (2750123), which is a choice for the seller.

Cells hold the **numeric** ID (Corroborated: "the numerical values used in cells
under the heading are…").

## 5. Item specifics (the `C:` columns)

Each category has its own item specifics, columns named `C:<aspect>` in the
marketplace's language, coloured required or recommended in eBay's Excel
template. Since 2021–22 certain ones are mandatory in *Sammeln & Seltenes*
(Verified, eBay Germany seller portal). What they are called in German
(`C:Spiel`? `C:Kartenname`? `C:Sportart`?) is **unverified**, and a wrong name is
not "close enough", so the starter template leaves them out and eBay asks for
them when you finish a draft. Your own downloaded template has them exactly, and
the app fills the ones it recognises.

## 6. Photos

eBay Germany expects front, back, any defects and any grading label. A CSV
carries URLs only. The app keeps your photos on your device, so drafts are
created without them and photos are added on eBay.

## 7. What this means for the app

1. **Primary path (unchanged in spirit):** you download eBay's template for your
   card categories and upload it. The app now also understands the card columns
   (category, `Condition ID`, the `CD:` descriptors) by their **IDs in the header**
   rather than by their words, and fills a mixed batch correctly.
2. **Starter template:** a best-effort *draft* template built only from column
   names eBay's own help pages give, for people who have not downloaded one yet.
   It is labelled unverified and the first upload should be a single card.
3. **Never guessed:** card type, graded or not, condition, grader, grade, price.

## 8. How to close the unverified gaps

- **Best, and free:** download the real templates from Seller Hub (steps in the
  Export screen) and put them in `test-data/ebay-templates/`. Then the starter
  becomes a verified preset and its header is tested against a real file.
- The Taxonomy API returns every category's item specifics per marketplace, but it
  needs a (free) eBay developer application token, which is a credential, so it
  is your call (CLAUDE.md §13).

## Sources

- eBay Seller Hub help, *Create listings in bulk*: https://pages.ebay.com/sh/reports/help/create-listings-bulk/
- eBay Germany, *Berichte im Verkäufer-Cockpit Pro*: https://www.ebay.de/help/selling/ebay-tools/file-exchange?id=4096
- eBay Germany, *Tools zum gebündelten Einstellen*: https://www.ebay.de/help/selling/ebay-tools/bulk-listing-tools?id=4160
- eBay Germany seller portal, *Durchstarten mit Sammelkarten*: https://www.ebay.de/verkaeuferportal/verkaufen-bei-ebay/sammelkarten
- eBay Germany CSV-Manager guide v3.5.2 (2015): https://pics.ebay.com/aw/pics/de/pdf/others/file_exchange/File_Exchange_Basic_Template_Mini_Guide.pdf
- eBay Community announcement, *New requirements when you revise your trading card listings*: https://community.ebay.com/t5/Announcements/New-requirements-when-you-revise-your-trading-card-listings/ba-p/34035459
- eBay, *Upload your collection*: https://www.ebay.com/help/selling/trading-cards-listing-tools/upload-your-collection?id=5290
- Category IDs: ebay.de category URLs for 183454, 183050, 183455, 261329; ebay.com for 261328
- Condition descriptor IDs, corroboration: eBay Community threads on the trading-card bulk uploader, and https://shipscript.com/ebayhelp/sellerhub/example_card_revisions.htm (third-party; treat as a transcription)
