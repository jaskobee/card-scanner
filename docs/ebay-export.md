# eBay export

## Why there is no built-in format

eBay's bulk listing columns depend on the category, the country and the moment.
A hardcoded column list is a guaranteed support ticket the first time eBay
changes something.

So the app reads **your** template instead of shipping its own.

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

Get your template from Seller Hub → Reports → Upload → Download a template,
choosing the trading-card category you list in.

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
