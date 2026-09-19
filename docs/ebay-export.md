# eBay export

## Why there is no built-in format

eBay's bulk listing columns depend on the category, the country and the moment.
A hardcoded column list is a guaranteed support ticket the first time eBay
changes something.

So the app reads **your** template instead of shipping its own. eBay says the
same thing from its side: use its templates, and headers can neither be removed
nor changed.

There is one exception, and it is labelled as an exception: a **starter**, for
people who have not downloaded a template yet. See "The starter" below.

## The flow

```
Upload your eBay template
        ↓
Find the header row beneath eBay's preamble rows
        ↓
Classify columns: required · optional · unknown
        ↓
Map internal fields onto headers (editable, saveable)
        ↓
Fill what we can prove · mark what we cannot · preserve what we do not know
        ↓
Validate
        ↓
Download
```

Get your template from Seller Hub (Verkäufer-Cockpit Pro) → Reports → Uploads
(Berichte → Hochladen) → Get template (Vorlage abrufen). Choose the template for
new listings, or for **drafts** if you will add photos on eBay afterwards, pick
the card categories you list in, and download it as **.csv**.

A CSV cannot carry photos, only web addresses of photos hosted somewhere, and
this app keeps your photos on your device. So today it creates **drafts**: for a
draft eBay makes only `Action` and `Category ID` mandatory, and you add photos on
eBay. Live listings also need `Item photo URL`, which the app cannot supply.

## Rules

**Unknown columns are preserved verbatim, in position.** If your template has a
column we have never heard of, it comes out the other side untouched and empty
rather than dropped or renamed.

**Required columns with no evidence are marked, never invented.** They get the
literal text `Needs review`. An empty required field gets caught by eBay; a
confidently wrong one gets listed.

**Validation runs before download.** You see how many listings are complete and
exactly which columns are short, grouped by column. "Export anyway" exists, but
you have to choose it.

## Trading cards

The full research, with what was verified and what was not, is in
[`ebay-card-listings.md`](ebay-card-listings.md). What the app does with it:

- **Category per card.** A batch can mix trading-card games (183454), sports cards
  (261328) and non-sport cards, celebrities included (183050). Each card has a
  card type, and its `Category ID` follows from it. A card the database
  identified as belonging to a game is a card-game card; anything else is the
  user's choice. A card with no type is marked `Needs review`, never filed
  somewhere by default.
- **Graded or not, never a plain condition.** Since October 2023 a single card
  is graded (`Condition ID` 2750, with grader, grade and certificate) or ungraded
  (4000, with one of four card conditions). The app offers exactly eBay's four
  ungraded conditions. A condition eBay does not offer for cards, such as an old
  "Good" or "Played", is kept visible and marked, and is **not** translated.
- **Columns are recognised by their IDs.** The card columns are named
  `CD:Card Condition - (ID: 40001)`, `CD:Professional Grader - (ID: 27501)`,
  `CD:Grade - (ID: 27502)` and `CDA:Certification Number - (ID: 27503)`. The ID
  is the same in every language, so it is read in preference to the words.
- **Info lines survive.** eBay's first line (`#INFO …`) says which template a
  file is, and is required. Everything above the header is written back exactly
  as it came. The byte-order mark before it is an option, in case eBay objects.
- **Format is always written.** eBay Germany's guide says `Format` defaults to
  Auction when left blank, which would turn every card into an auction.
- **Defaults are yours, and yield to the card.** Card type, condition and price can
  be set once for cards that have none. A default condition is never applied to a
  graded card. The first upload defaults to `VerifyAdd` (check only), because
  eBay's older guides recommend it. Whether the current Seller Hub still accepts
  it is unverified, hence the option to switch to `Add`.
- **One file, or one per kind of card.** eBay's Excel download can cover up to 10
  categories at once. How a CSV covers several is unverified, so a batch with more
  than one kind of card can also be exported as one file per kind.

## The starter

A best-effort **draft** template for Germany, built only from column names eBay's
own help pages give: `Action(SiteID=Germany|Country=DE|Currency=EUR|Version=1193|CC=UTF-8)`,
`Category ID`, `Title`, `Condition ID`, the four descriptors above, `Start price`,
`Quantity`, `Format`, `Duration`, `Description`, `Item photo URL`.

It is **not eBay's file**. It leaves out the item specifics (`C:` columns)
because their German names could not be verified and a wrong name is rejected,
not approximated; eBay asks for them when you finish the draft. The `#INFO` line
and the `Version` number are unverified for Germany. Upload one card with "Check
only" first, and if eBay rejects it, upload your own template instead.

Once real templates are in `test-data/ebay-templates/`, the starter becomes a
verified preset and its header is tested against a real file.

## Not yet

- **Excel templates.** eBay's multi-category download is Excel by default. The
  app reads `.csv`, and says so when given an `.xlsx`.
- **Descriptions.** The description column is left empty: generating text is a
  Phase 4 item.
- **Lots.** Only single cards. CCG lots are 183455 and sports lots 261329, and
  need different rules.

## CSV safety

This is a German-market product, so the export path is tested against the
things that quietly destroy spreadsheet data:

| Hazard | What we do |
|---|---|
| UTF-8 in Excel | BOM written by default — without it `Glück` arrives mangled |
| `;` vs `,` | delimiter detected from your template, not assumed |
| Umlauts, accents, CJK | round-trip tested: `Ä Ö Ü ä ö ü ß`, `é`, `リザードン` |
| Leading zeroes | `004/120` quoted as text — never becomes `4/120` |
| Fraction-shaped values | `4/102` quoted — never becomes a date |
| Long digit strings | quoted — never becomes scientific notation |
| Embedded quotes | doubled per RFC 4180 |
| Embedded newlines | field quoted |
| Formula injection | `=` `+` `-` `@` prefixed with `'` |

The test that matters is the round trip: write the file, parse it back with an
independent parser, assert every value is unchanged. `test/csv.test.mjs` does
this for a row containing every hazard above at once, under both delimiters.

## Titles

Configurable template with a live preview and length validation:

```
{year} {manufacturer} {set} {name} #{number} {variant}
→ 1999 Pokemon Base Set Charizard #4/102 Holo
```

Empty tokens vanish with their decoration, so a missing number leaves no orphan
`#` and no double space. Titles over eBay's 80-character limit are trimmed at a
word boundary, and the preview tells you before you export rather than after.

## Also available

A generic CSV of every internal field, and a JSON dump of the full card
records. Your data stays yours whatever eBay does next.
