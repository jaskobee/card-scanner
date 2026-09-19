# Real eBay templates

Put templates downloaded from your own Seller Hub here, so the export can be
tested against a real file instead of one reconstructed from documentation.

**Before committing anything, open the file and remove what is yours.** eBay's
templates can carry account-specific values, such as the names of your shipping,
return and payment policies in the dropdown sheets, or your location. Commit only
a file that contains nothing but eBay's own column names and lists.

To get one: Seller Hub (Verkäufer-Cockpit Pro) → Reports → Uploads
(Berichte → Hochladen) → Get template (Vorlage abrufen). Choose the template for
new listings or for drafts, pick the categories (Sammelkartenspiele › CCG
Einzelkarten, Sport Trading Cards › Trading Card Einzelkarten, Non-Sport Trading
Cards › Trading Card Einzelkarten), and download as **.csv**.

What one real German file settles, that documentation could not:

- the exact first `#INFO` line and the `Action(...)` header for Germany
- whether the columns are called `Category ID` / `Start price`, or something German
- the German names of the item specifics (`C:` columns) for each card category
- whether `VerifyAdd` is still accepted
- how a CSV covers several categories
