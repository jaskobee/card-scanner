# Deployment

The app is static files. There is no backend, no build step and no environment
configuration, so every free static host works and the choice comes down to
taste.

## GitHub Pages

Genuinely suitable here, which is not true of most apps in this category —
there is no server-side processing to accommodate.

Settings → Pages → Build and deployment → GitHub Actions. The included
`.github/workflows/deploy.yml` publishes on every push to `main`.

Your URL: `https://<user>.github.io/<repo>/`

One caveat: the app must be served from the repository root, since `index.html`
references `src/ui/app.js` relatively. It is, so this works as-is.

## Cloudflare Pages

Connect the repository. Leave the build command **empty**. Output directory
`/`. Generous free tier, fast globally, and preview URLs per pull request.

## Netlify

Connect the repository. Build command empty, publish directory `.`. Deploy
previews per PR on the free tier.

## Vercel

Works, but it is built around builds and serverless functions, neither of which
this app has. Framework preset: **Other**. It is the least natural fit of the
four.

## Comparison

| | Pages | Cloudflare | Netlify | Vercel |
|---|---|---|---|---|
| Free tier | unlimited public | generous | 100 GB/mo | generous |
| PR previews | no | yes | yes | yes |
| Custom domain | yes | yes | yes | yes |
| Setup effort | lowest | low | low | low |
| Fit for this app | good | best | good | awkward |

Recommendation: **Cloudflare Pages** for the PR previews, **GitHub Pages** if
you want one less account.

## Headers

`tools/serve.js` sets `Cross-Origin-Opener-Policy` and
`Cross-Origin-Embedder-Policy` for local development. Tesseract.js 5 does not
require cross-origin isolation, so no host-side header configuration is needed;
if a future OCR path wants `SharedArrayBuffer`, it will, and that belongs in a
`_headers` (Cloudflare/Netlify) or equivalent file.

## Sharing with testers

Any of the above gives you a URL to send. Testers need no account and install
nothing. Tell them their photos stay on their own machine — it is true, and it
is the first question people ask.
