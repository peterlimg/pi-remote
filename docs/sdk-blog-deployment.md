# Publish the SDK article

The public article is maintained in [peterlimg/bysepstudio-blog](https://github.com/peterlimg/bysepstudio-blog), under `public/claude-sdk-in-pi/`. That repository owns publishing and compatibility routing through the Vercel project `bysepstudio-blog` in scope `peterlimgs-projects`.

Both published addresses remain unchanged and serve the article directly, without redirects:

- https://claude-sdk-in-pi.vercel.app/
- https://pi-sdk-blog.vercel.app/

The central index is https://bysepstudio-blog.vercel.app/.

Do not deploy the old `claude-sdk-in-pi` project or move its domains back. Push article updates to the central repository's `main` branch. Its hosting documentation covers legacy assets, security headers, verification and rollback.

## Application-local copy and artwork

Pi Remote still bundles `web/sdk-guide.html` and its explicitly allowed assets for its own `/sdk-guide.html` route. These files do not independently update the public blog. The old `deploy/sdk-blog/vercel.json` is retained as a record of the standalone policy, not as the active publishing configuration.

`scripts/sdk-guide-social.html` and `scripts/render-sdk-social.mjs` remain the artwork authoring tools. After intentional artwork changes, run `node scripts/render-sdk-social.mjs` and copy only the rendered `sdk-guide-social.png` and `sdk-guide-print.png` into the central article directory. Review the diff and run the central repository's focused E2E checks before publishing. Authoring HTML, credentials, sessions and application code are not article assets.

Keep the original canonical/Open Graph URLs and image version queries stable unless intentionally replacing the card. Verify crawler access without a Vercel login, including `image/png`, 1200 × 600 dimensions and a size below 5 MB. X may retain a cached preview; this publishing flow does not create an X post.
