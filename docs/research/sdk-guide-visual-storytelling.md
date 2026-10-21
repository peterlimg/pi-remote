# SDK article visual direction

The reader asked for a polished technical blog with animated diagrams, explicitly not a course or step-by-step learning interface. This is an article redesign, not a change to the SDK provider or its readiness claims.

## Research and application

- [Red Blob Games, Little Design Things](https://www.redblobgames.com/making-of/little-things/) discusses matching prose labels to diagram colors, interaction feedback and responsive diagrams. Apply consistent Pi, SDK and guard colors across the article. Keep diagram labels readable on phones instead of shrinking a desktop drawing.
- [Red Blob Games, Responsive design](https://www.redblobgames.com/making-of/responsive-design/) treats diagrams as responsive content. Use alternate geometries for narrow viewports, while preserving the same meaning and captions.
- [Bartosz Ciechanowski, GPS](https://ciechanow.ski/gps/) is a primary example of a technical essay supported by interactive illustrations. Borrow the relationship between prose and adjacent illustration, not its positioning lesson, visual assets or tutorial structure.
- [W3C, Understanding SC 2.2.2](https://www.w3.org/WAI/WCAG22/Understanding/pause-stop-hide.html) requires a pause, stop or hide mechanism for nonessential automatic movement lasting more than five seconds alongside other content. Provide a global motion control, honor reduced motion, and stop diagrams offscreen or in a hidden document.

Direct fetches of the essay sites were blocked by the local fetch tool's fake-IP DNS guard. Research used source-linked search/indexed primary content. These notes do not claim a full live visual audit of those sites.

## Direction contract

THESIS: A technical essay about one invariant: Pi owns execution and history even when its native Claude context changes. Replace repetitive boxed lists and a large question index with narrative prose and a few wide illustrations.

OWN-WORLD: C, Signal print. Vermilion orange, ivory paper and near-black ink, with a seeded stippled Pi print. Self-hosted Bricolage headings, quiet reading type, square print panels and heavier SVG wiring. Pi records use ink, SDK proposals use burnt orange, and guards keep a distinct amber.

STORY: Tool ownership leads into two histories, validated replacement, branch behavior and the remaining worker-resume gap. Verification and terminology remain available in the appendix.

FIRST VIEWPORT: Orange masthead and full-width cover, a native-text ink-and-ivory headline and the stippled Pi print. A stacked phone composition avoids art/text overlap. Cream reading sections and four reworked illustration panels follow; motion still illustrates ownership, not an entrance effect.

FORM: Illustrated blog, with reader-controlled branch comparisons. No lesson navigation, progress score, quizzes or Next/Back teaching flow.

FINISH: Compare desktop and phone captures, verify functional controls and reduced motion, check factual boundaries and ship only the article and its assets.

## Motion budget

Animate only visible figures. SVG request packets follow actual diagram connectors; old/new context changes retain a stationary Pi-history reference. The worker illustration stops at the guard rather than suggesting successful continuation. Content and static diagrams remain readable without JavaScript. No sound, model requests, real tool execution or analytics.

## Social preview

The user selected C, Signal print, from [the three cover prototypes](https://github.com/peterlimg/pi-remote/blob/c2f0a4f628cc33bf23d850424572fc24fc69b345/web/sdk-cover-prototypes/choices.md), for both the share cover and the blog. The static 1200 × 600 cover uses orange, ink and ivory, with Pi lettering cut out of a seeded stippled field. The article carries the same typography, colors and print treatment through its header and all four illustrations. Technical prose, ownership boundaries, controls, motion timings and explicit gaps stay unchanged.

The authored source is `scripts/sdk-guide-social.html`; `node scripts/render-sdk-social.mjs` draws the ink field offline with the existing self-hosted font. It exports the cover and `web/sdk-guide-print.png`, a transparent 558 × 500 plate used beside the article's native-text headline. Both PNGs embed their provenance. The source, renderer, unused variants and prototype switcher are not part of the static deployment allowlist. All share links, including `#worker-gap`, use the article's overall preview. The Open Graph and X image URLs share a `signal-print-1` version query; this changes the image cache key but does not prove X has refreshed the page's cached card.

## Font provenance

Bricolage Grotesque's Latin variable WOFF2 was downloaded from Google's font CDN, via its first-party CSS API. Its SIL Open Font License is stored beside the font at `web/sdk-guide-font-LICENSE.txt`. The article self-hosts it and contacts no external font service when opened.
