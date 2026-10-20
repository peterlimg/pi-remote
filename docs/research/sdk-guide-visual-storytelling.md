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

OWN-WORLD: Pi's green, mineral paper and ink, contrasting SDK blue, amber guards. Self-hosted Bricolage Grotesque headings, quiet body type, precise SVG wiring.

STORY: Tool ownership leads into two histories, validated replacement, branch behavior and the remaining worker-resume gap. Verification and terminology remain available in the appendix.

FIRST VIEWPORT: A compact masthead, a strong two-line title and an animated request/result loop. Motion illustrates direction and ownership, not an entrance effect.

FORM: Illustrated blog, with reader-controlled branch comparisons. No lesson navigation, progress score, quizzes or Next/Back teaching flow.

FINISH: Compare desktop and phone captures, verify functional controls and reduced motion, check factual boundaries and ship only the article and its assets.

## Motion budget

Animate only visible figures. SVG request packets follow actual diagram connectors; old/new context changes retain a stationary Pi-history reference. The worker illustration stops at the guard rather than suggesting successful continuation. Content and static diagrams remain readable without JavaScript. No sound, model requests, real tool execution or analytics.

## Social preview

The X/Open Graph image extends the article's existing visual world rather than introducing another identity. It is a static 1200 × 600 PNG, with the two-line Bricolage headline above a Pi → adapter → Claude result loop and the opposite proposal direction. The wide title remains the primary reading at thumbnail size. Mineral paper, Pi green and SDK blue retain their article meanings. No readiness or performance claim is added.

The authored source is `web/sdk-guide-social.svg`; `node scripts/render-sdk-social.mjs` renders it with the existing self-hosted font. The PNG embeds that provenance. The authoring SVG and renderer are not part of the static deployment allowlist. All share links, including `#worker-gap`, use the article's overall preview.

## Font provenance

Bricolage Grotesque's Latin variable WOFF2 was downloaded from Google's font CDN, via its first-party CSS API. Its SIL Open Font License is stored beside the font at `web/sdk-guide-font-LICENSE.txt`. The article self-hosts it and contacts no external font service when opened.
