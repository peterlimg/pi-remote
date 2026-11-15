# Session avatar design research

Why the session characters and the three "matched" avatar sets still look off, what well-made character and agent marks do differently, and which directions are worth prototyping next. This follows `session-icon-art-direction.md`; it does not replace its behaviour brief.

## Method and limits

Two read-only research workers ran without web access, so their reports came from memory. I used them only as leads and for their code-based critique of our sets. The quotes below come from first-party pages I fetched myself:

- [Linear Agent Interaction Guidelines](https://linear.app/developers/aig)
- [How Duolingo Animates Its World Characters](https://blog.duolingo.com/world-character-visemes/)
- [Gemini AI Visual Design](https://design.google/library/gemini-ai-visual-design) (Google Design)
- [OKLCH in CSS](https://evilmartians.com/chronicles/oklch-in-css-why-quit-rgb-hsl) (Evil Martians)
- [microsoft/fluentui-emoji](https://github.com/microsoft/fluentui-emoji) (repository structure)
- [Boring Avatars](https://boringavatars.com)

Material's icon guidance, Apple's HIG icon page and Duolingo's brand guidelines are JavaScript-rendered and did not load. Claims from those sources are listed separately as unverified.

## Verified findings

**Linear: the avatar identifies, separate cues carry state.** "Humans need instant certainty about who they are interacting with." Agents "should clearly indicate whether they're thinking, waiting for input, executing, or finished working. Humans should be able to understand what's happening at a glance." When invoked, an agent should give "immediate, but unobtrusive, feedback". Their examples show agents marked with "a small badge" and a "Thinking" indicator, not an animated portrait.

**Duolingo: few characters, one rig per character, state as inputs.** Duolingo animates ten World Characters. Rive's State Machine is "a visual representation of the logic that connects the animations ('states') together". The app can "show idle behavior like head nods, blinking, and eyebrows moving", then "move to a final state, showing the reaction". The drawing never changes to show state; the rig does.

**Gemini: derive the mark from your own brand, and give motion a start and end.** "Circles tend to convey simplicity, harmony, and comfort. Even Gemini's own logo is thoughtfully constructed from the negative space of four adjoining circles." They contrast their "amorphous, adaptable approach" with "the static nature of past digital assistants (many of us remember Microsoft's Clippy)". "Each animation has a defined start and end point."

**Colour: equal OKLCH numbers do not make an equal palette.** "Each hue has a different maximum chroma." A fixed chroma across hues makes some hues vivid and others dull or out of gamut. Our matched sets used fixed `L .70` and `C .15` with hues spaced 30–40° apart, then had to patch Sol's lightness. This explains the rainbow look.

**Detail is redrawn per size, not shrunk.** Every Fluent Emoji ships as four separate drawings: `3D`, `Color`, `Flat` and `High Contrast`. The README does not explain the reason. The structure shows that a family keeps simpler versions for contexts where detail fails.

**Generated families get coherence from one rule and one small palette.** Boring Avatars pairs one variant with one five-colour palette, for example `variant="beam"` with `colors={[…5 colours]}`.

## Unverified leads

These come from the workers' memory and need checking before being quoted:

- Material icons use a fixed canvas with an inner live area and keyline shapes sized for equal optical weight.
- Apple asks icon families to share similar visual weight.
- Valve's Team Fortress 2 rendering paper (NPAR 2007) argues that each character must be readable from its silhouette alone.
- Duolingo's guidelines describe characters built from a few rounded shapes with flat, limited colour.

## Why our attempts look off

Based on the drawings in `web/session-icons-prototype.js` and `web/session-avatars-prototype.js`:

- **Current cast (23):** there is no grid, so mass varies widely. Moss fills the canvas, Sol is a small circle with thin rays, and Comet is off-centre. Eye size, height and spacing vary (spacing ranges from 5 to 12 units), so the face does not unify the family. Fills and strokes are mixed. Identity relies on 1–3px parts (rays, rings, tentacles). Creatures and celestial objects are mixed in one set.
- **A · Pebbles:** every body is identical, so the silhouette test fails by design. Identity sits in a headpiece only 3–8 device pixels tall at 32px. The result reads as one character recoloured.
- **B · Tokens:** a circle with a darker top band reads as a generic profile picture. Several avatars differ only in the edge of that band, which is noise at 32px.
- **C · Blocks:** the square corners and slot eyes read as UI blocks or robots. Three colours swapped between body and hat make neighbours look alike.
- **Colour across A and B:** this is an evenly spaced rainbow with fixed chroma, and dark mode only nudges lightness.

The underlying cause is the process. Each round produced a finished gallery. None of them first set a grid, a face construction, a detail budget, a curated palette and a silhouette test. Twenty-three characters is also more than one person can draw well. Duolingo shows ten.

## Directions worth prototyping

1. **One mascot, many colours (recommended).** Draw a single well-made Pi Remote character, for example derived from the logo's coral, blue and gold shapes, as Gemini derived its mark from Google's circles. Each session gets a colour from 6–8 curated per-theme swatches, plus at most one small, bold variation. State lives in the rig: eyes, blink, posture, as in Duolingo. Linear-style badges carry anything that must be read at a glance. Putting all the craft into one drawing gives the best chance of quality.
2. **A small cast of 6–8, built to a written spec.** Use a shared 32-unit grid with a 26–28 live area, an identical face construction and placement, and silhouettes that differ in body mass rather than accessories. Allow no detail under 2px and use a curated palette. Approve black silhouettes before adding colour.
3. **An abstract living mark.** Use one shape from the logo, with a colour per session and state shown through motion only, like Gemini and the Claude spark. This gives the calmest page but is the weakest at telling sessions apart.

## Evaluation for the next round

Judge every candidate the same way, at 32px in real rows with neighbours, in both themes:

- Black silhouette test: can you tell the characters apart?
- Blur or squint test: do they share one visual weight?
- Six-row list: does any avatar pull more attention than the titles?

Show the user one direction at a time, with a reference image they like where possible, rather than a gallery of twelve.

## Evidence trail

- Worker tasks `3364af4f` (craft of small character sets) and `c4628e94` (AI-agent avatars). Both had no web tools.
- Primary pages were fetched on 2026-11-15 through the session's web tools. Material and Apple HIG fetches failed because the pages render with JavaScript.
