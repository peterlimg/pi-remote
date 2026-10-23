# Publish "A red circle is a good enough spec" to Vercel

- Project: `red-circle-spec`
- Scope: `peterlimgs-projects`
- Production address: https://red-circle-spec.vercel.app
- Source: `docs/blog/building-pi-remote.md` and its `docs/blog/building-pi-remote/` folder
- Hosting config: `deploy/red-circle-spec/vercel.json`

This is a standalone static post, like the [SDK article](sdk-blog-deployment.md). Publishing is manual; a Git push does not update it.

## Publish an update

Build into a fresh directory. Never deploy the repository root or `docs/`.

```sh
publish=$(mktemp -d "${TMPDIR:-/tmp}/red-circle-spec-publish-XXXXXX")
node scripts/build-blog-post.mjs docs/blog/building-pi-remote.md \
  "$publish/red-circle-spec" https://red-circle-spec.vercel.app
cp deploy/red-circle-spec/vercel.json "$publish/red-circle-spec/"

npx vercel link --cwd "$publish/red-circle-spec" --yes \
  --scope peterlimgs-projects --project red-circle-spec
# The CLI may download a project OIDC token. It is not a post asset.
rm -f "$publish/red-circle-spec/.env.local"
npx vercel deploy --cwd "$publish/red-circle-spec" \
  --scope peterlimgs-projects --dry --json --yes
```

The dry run should list twelve files: `index.html`, `style.css`, the three images the post uses, the three self-hosted fonts with their SIL Open Font License files in `fonts/`, and `vercel.json`. Then deploy with `--prod` instead of `--dry --json`.

## X preview

The post has no hero image. The page carries Open Graph tags and `twitter:card=summary`, so X shows a text card with the title and the description comment from the Markdown.

Verify without a Vercel login: the page returns 200 to a `Twitterbot/1.0` user agent, and `.env.local` and `.vercel/project.json` return 404. X may keep an older cached card, and this workflow does not create an X post.
