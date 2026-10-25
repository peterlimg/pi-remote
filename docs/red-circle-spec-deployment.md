# Publish "A red circle is a good enough spec"

The public article is maintained in [peterlimg/bysepstudio-blog](https://github.com/peterlimg/bysepstudio-blog), under `public/red-circle-spec/`. That repository owns publishing and compatibility routing through the Vercel project `bysepstudio-blog` in scope `peterlimgs-projects`.

The published address remains https://red-circle-spec.vercel.app/, serving the article directly without a redirect. The central index is https://bysepstudio-blog.vercel.app/.

Push article updates to the central repository's `main` branch. Do not independently deploy the old `red-circle-spec` project or move its domain back. See the central repository's hosting documentation for verification and rollback.

## Retained authoring inputs

`docs/blog/building-pi-remote.md`, its asset directory and `scripts/build-blog-post.mjs` remain available as original authoring inputs. The published HTML and assets are maintained in the central repository. Regenerating from these inputs requires reviewing the resulting diff there; a Pi Remote Git push does not publish the article.

The old `deploy/red-circle-spec/vercel.json` records the standalone policy, not the active publishing configuration. Never deploy the repository root or all of `docs/`.

## X preview

The post has no hero image. Its static 2400 × 1260 JPEG card keeps the title in the image. Replace it deliberately if the title changes, keeping the bottom 150 px clear for X's domain overlay. Keep the original canonical and social-card URLs intact when moving hosting.

Verify the page and card return HTTP 200 without a Vercel login, including for `Twitterbot/1.0`; the card must be `image/jpeg` below 5 MB. Environment files and `.vercel/project.json` must return 404. X may retain a cached preview; publishing does not create an X post.
