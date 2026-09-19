# Getting this onto GitHub

The repository is already initialised with twelve commits on `main`. Nothing
here needs credentials from anyone but you.

## 1. Unzip

```bash
unzip card-scanner.zip
cd card-scanner
```

## 2. Check it runs

```bash
npm start     # then open http://localhost:8080
npm test      # 76 tests, no install needed
```

`npm install` is not required — the app has no dependencies.

## 3. Create the repo and push

With the GitHub CLI:

```bash
gh repo create card-scanner --private --source=. --remote=origin --push
```

Or by hand — create an empty repo on github.com first, then:

```bash
git remote add origin https://github.com/<you>/card-scanner.git
git push -u origin main
```

## 4. Give testers a URL

GitHub Pages works for this app, because there is no backend.

Repo → **Settings** → **Pages** → Build and deployment → Source:
**GitHub Actions**.

The included `.github/workflows/deploy.yml` publishes on every push to `main`.
Your URL will be `https://<you>.github.io/card-scanner/`.

If you would rather have preview URLs on every pull request, connect the repo
to Cloudflare Pages instead — empty build command, output directory `/`.
`docs/deployment.md` compares the options.

## 5. CI

`.github/workflows/ci.yml` runs the static checks and unit tests on every push
and pull request, plus the browser smoke test in a second job. Both work on the
free tier with no secrets.

---

## What to look at first

- `CLAUDE.md` — the working agreement. Read before changing code.
- `README.md` — what it does, how it works, and an honest limitations section.
- `docs/roadmap.md` — what is done, what is next, what the known risks are.
- `docs/testing.md` — the fixture set the project still owes, and why it
  matters before anyone claims an accuracy figure.
