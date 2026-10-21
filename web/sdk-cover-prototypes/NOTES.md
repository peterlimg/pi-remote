# SDK social cover prototypes

Question: which cover treatment should replace the rejected node-and-arrow social image?

Three 1200 × 600 compositions, switchable on one throwaway gallery route with `?variant=A`, `B`, `C` or `all`. Only the gallery and PNGs belong in a public preview. This branch does not change the live article, metadata, image or application routes.

```sh
node scripts/render-sdk-cover-prototypes.mjs
npm run prototype:sdk-covers
# http://127.0.0.1:8873/?variant=all
```

- A, Assembly: raymarched solid objects, green Pi below an orange asterisk. Dark, spatial composition.
- B, Overprint: saturated cobalt field, very large lime Pi, asymmetric headline. Typographic composition.
- C, Signal print: seeded stippled ink field, Pi cut out as negative space, orange ground. Computational print composition.

All use the existing self-hosted Bricolage font. A and C are authored procedural artwork, not generated photographs or implementation diagrams. Each exported PNG embeds its source provenance.

No winner is selected. Preserve these alternatives on this branch, not main; implement only the user's selected direction in production.
