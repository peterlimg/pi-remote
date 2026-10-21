# Publish the SDK article to Vercel

- Project: `claude-sdk-in-pi`
- Scope: `peterlimgs-projects`
- Production address: https://claude-sdk-in-pi.vercel.app
- Hosting config: `deploy/sdk-blog/vercel.json`

This is a standalone static article. It does not host Pi Remote's server, expose a bridge, run models or require the local host to stay online. The repository's `web/` files remain the article's source. Publishing is manual; a Git push alone does not update this Vercel project.

## Publish an update

Run from the repository root using the normal Vercel login. Export an explicit allowlist into a fresh directory. Never deploy the repository root or the entire `web/` directory.

```sh
publish=$(mktemp -d "${TMPDIR:-/tmp}/claude-sdk-in-pi-publish-XXXXXX")
mkdir "$publish/claude-sdk-in-pi"
cp web/sdk-guide.html web/sdk-guide.css web/sdk-guide.js \
  web/sdk-guide-font.woff2 web/sdk-guide-font-LICENSE.txt web/icon.svg \
  web/sdk-guide-social.png \
  "$publish/claude-sdk-in-pi/"
cp deploy/sdk-blog/vercel.json "$publish/claude-sdk-in-pi/"

npx vercel link --cwd "$publish/claude-sdk-in-pi" --yes \
  --scope peterlimgs-projects --project claude-sdk-in-pi
# The CLI may download a project OIDC token. It is not an article asset.
rm -f "$publish/claude-sdk-in-pi/.env.local"
npx vercel deploy --cwd "$publish/claude-sdk-in-pi" \
  --scope peterlimgs-projects --dry --json --yes
```

Inspect the dry run. Exactly eight files should be included: the seven named public assets and `vercel.json`. The authored `scripts/sdk-guide-social.html` and its renderer are not upload assets. `.env.local`, `.vercel` and `.gitignore` must be excluded. No sessions, credentials, project instructions or other repository files belong in the upload.

```sh
npx vercel deploy --cwd "$publish/claude-sdk-in-pi" \
  --scope peterlimgs-projects --prod --yes
```

The config serves the article at `/` and `/sdk-guide.html`, retains self-hosted fonts and restricts scripts/styles to this site. The article makes no network connections to Pi Remote.

Verify the production address without a Vercel login, not only through the CLI's authenticated preview. Check that HTML, CSS, JavaScript, font, license, icon and preview PNG match the exported files. In a fresh mobile browser, check the font, branch comparison, animation pause and absence of console/CSP errors. Environment files and `.vercel/project.json` must return 404.

## X and Open Graph preview

The HTML contains canonical/Open Graph URLs, `twitter:card=summary_large_image`, title/description, image alt text and an absolute HTTPS PNG URL. The static 1200 × 600 image uses the selected Assembly cover, an orange asterisk above a green Pi sculpture, and the article's self-hosted font. Crawlers do not need JavaScript, WebGL or a login. The image URL includes a version query so a changed image has a new crawler cache key.

After changing `scripts/sdk-guide-social.html`, regenerate the PNG before publishing:

```sh
node scripts/render-sdk-social.mjs
```

The renderer uses the existing Playwright dependency and local font, renders the 3D geometry offline, checks the sculpture, text bounds and dimensions, and embeds source provenance in the PNG. Only the rendered PNG is deployed. Verify HTTP 200 for the article and image with a `Twitterbot/1.0` user agent, `image/png`, dimensions and a size below 5 MB. X may retain an older cached card; a successful public crawler fetch does not prove the in-app preview has refreshed. No X post is created by this publishing workflow.
