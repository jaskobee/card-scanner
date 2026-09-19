# Your own card photos

Drop the original photos of cards that scanned badly in this folder (front, and
back if you have it). **Everything here except this file is ignored by git**, so
photos are never committed: the cards belong to their publishers and the photos
may show more than you mean to share.

Then run the real scanner on them, with real text recognition:

```bash
npm start                              # in one terminal
node tools/scan-photos.mjs             # in another: reads every photo in this folder
node tools/scan-photos.mjs --save /tmp/overlays   # also draws what it found on each
```

It prints, for each photo, what was read, from where, and how sure it is.
