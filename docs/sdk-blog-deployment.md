# Publish the SDK article to Vercel

- Project: `pi-sdk-blog`
- Scope: `peterlimgs-projects`
- Production address: https://pi-sdk-blog.vercel.app
- Hosting config: `deploy/sdk-blog/vercel.json`

This is a standalone static article. It does not host Pi Remote's server, expose a bridge, run models or require the local host to stay online. The repository's `web/` files remain the article's source. Publishing is manual; a Git push alone does not update this Vercel project.

## Publish an update

Run from the repository root using the normal Vercel login. Export an explicit allowlist into a fresh directory. Never deploy the repository root or the entire `web/` directory.

```sh
publish=$(mktemp -d "${TMPDIR:-/tmp}/pi-sdk-blog-publish-XXXXXX")
mkdir "$publish/pi-sdk-blog"
cp web/sdk-guide.html web/sdk-guide.css web/sdk-guide.js \
  web/sdk-guide-font.woff2 web/sdk-guide-font-LICENSE.txt web/icon.svg \
  "$publish/pi-sdk-blog/"
cp deploy/sdk-blog/vercel.json "$publish/pi-sdk-blog/"

npx vercel link --cwd "$publish/pi-sdk-blog" --yes \
  --scope peterlimgs-projects --project pi-sdk-blog
# The CLI may download a project OIDC token. It is not an article asset.
rm -f "$publish/pi-sdk-blog/.env.local"
npx vercel deploy --cwd "$publish/pi-sdk-blog" \
  --scope peterlimgs-projects --dry --json --yes
```

Inspect the dry run. Exactly seven files should be included: the six named public assets and `vercel.json`. `.env.local`, `.vercel` and `.gitignore` must be excluded. No sessions, credentials, project instructions or other repository files belong in the upload.

```sh
npx vercel deploy --cwd "$publish/pi-sdk-blog" \
  --scope peterlimgs-projects --prod --yes
```

The config serves the article at `/` and `/sdk-guide.html`, retains self-hosted fonts and restricts scripts/styles to this site. The article makes no network connections to Pi Remote.

Verify the production address without a Vercel login, not only through the CLI's authenticated preview. Check that HTML, CSS, JavaScript, font, license and icon match the exported files. In a fresh mobile browser, check the font, branch comparison, animation pause and absence of console/CSP errors. Environment files and `.vercel/project.json` must return 404.
