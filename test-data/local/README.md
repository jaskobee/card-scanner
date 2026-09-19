# Your own card photos

Drop the original photos of cards that scanned badly in this folder (front, and
back if you have it). **Everything here except this file is ignored by git**, so
photos are never committed: the cards belong to their publishers and the photos
may show more than you mean to share.

Then run the real scanner on them, with real text recognition. It drives a real
browser, so it needs Playwright once. Nothing is added to `package.json`:

```bash
npm i --no-save playwright-core                    # small: uses a browser you already have
export CHROMIUM_PATH=/usr/bin/chromium             # or wherever Chromium / Chrome is
# or, to let Playwright fetch its own browser (larger download):
#   npm i --no-save playwright && npx playwright install chromium
```

Then, in the project folder:

```bash
node tools/scan-photos.mjs             # reads every photo in this folder (starts the app itself)
node tools/scan-photos.mjs --save /tmp/overlays   # also draws what it found on each
```

It prints, for each photo, what was read, from where, and how sure it is. Front
and back are read as separate cards for now; the back of a sports or wrestling
card usually carries the name in plain type, the card number and the year.
