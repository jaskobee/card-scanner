# Setup

## Requirements

- Node 22 or newer — for the dev server and the tests
- A current browser — Chrome, Edge, Firefox or Safari

The application has **no dependencies**. `package.json` lists none, `npm
install` installs nothing, and there is no lockfile to drift.

## Run

```bash
npm start           # http://localhost:8080
PORT=3000 npm start # somewhere else
```

You need the server. The app is ES modules, and browsers refuse to load those
over `file://`, so double-clicking `index.html` will show you a blank page and
a CORS error in the console.

## Test

```bash
npm test        # unit tests (node:test, no dependencies)
npm run check   # import graph, unsafe innerHTML, missing references
```

For the browser smoke test you need Playwright, which is the project's only
dev dependency and is not required to run or deploy the app:

```bash
npm i -D playwright && npx playwright install chromium
node tools/serve.js &
node test/smoke.mjs
```

## First run

The first scan downloads Tesseract's language data (English and German, about
15 MB) from jsDelivr. Your browser caches it, so it happens once. Everything
after that works offline apart from the card database lookup.

## Storage

Batches live in IndexedDB under this origin. Nothing is sent to a server and
nothing syncs between devices. Clearing site data clears your batches — export
anything you want to keep.

Private windows often restrict IndexedDB. The app says so on startup rather
than failing silently.
