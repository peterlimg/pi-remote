# Character icon research: Grok Bot and Muse

## Revised recommendation

Colour is compatible with a coherent character family. The monochrome direction was too restrictive, and the user found the resulting comparison too gray.

The next comparison should be **colourful simple characters versus a warm companion character**, not gray fill versus gray outline. Keep session-list layout and icon placement unchanged. Evaluate the artwork at the actual 20px and 28px sizes.

This revision follows inspection of first-party Grok and Muse artwork. It replaces the earlier neutral-only recommendation. Exact colours, finish and character geometry remain design hypotheses, not approved implementation choices.

## Grok Bot: bold colour with a consistent construction

### Primary sources

- [Designing Grok Bot for a world of persistent agents](https://x.ai/news/designing-grok-bot)
- [Designing Grok Bot with Grok Bot](https://x.ai/bot/guides/designing-grok-bot-with-grok-bot)

The design team explicitly describes the trade-off between individual character and a coherent family:

> Watercolor and clay gave individual Bots plenty of character but carried too much detail at sidebar scale.

Its chosen system keeps the basic construction consistent, using:

> simple shapes and expressive eyes

with controlled variations and accessories. That is direct guidance about these character avatars, unlike generic rules for toolbar pictograms.

### What the artwork actually shows

The official designer's team animation has a bright red capsule, a bright blue rounded character, a black circle carrying the Figma mark, and a black rounded square. Repeated capsule-like eyes and simple body construction make the cast recognizable as one family despite strong colour differences.

![Grok's official design-team characters, showing red, blue and black bodies with a shared facial language](https://media.x.ai/v1/website/grok-bot-guides-designing-grok-bot-with-grok-bot-meet-the-team-b9959c98.gif)

The guide's motion storyboard also shows a vivid purple circular character. Grok therefore does not support a rule that every character must be gray, muted or restricted to one shared hue.

I inspected the team GIF and six frames sampled at 2 fps. The frames show changing gaze, blinking, body turns and orbiting elements. The article describes motion changing with activity and settling after work finishes. The samples are not a complete verification of every state transition.

**Useful transfer:** a common shape/face/motion recipe can support distinct coloured characters. Colour itself is not the inconsistency.

**Do not copy:** the entire roster architecture, the exact artwork or every motion at once. The article's gallery contains rejected and exploratory styles, including rendered 3D figures; those are not all evidence of the shipped visual system. This research does not establish a public palette formula or reusable asset licence.

## Muse: warm material colour, plus a separate brand mark

The best-supported Muse reference is [Muse, Your Personal AI Agent](https://muse.ai/). Its official page identifies the product as a personal agent and its footer says © Meta 2026. This is a plausible match for the user's reference, not confirmation of which Muse they intended. It is not labelled Muse Code in the inspected material.

### What the artwork actually shows

- [Character portrait](https://muse.ai/images/landing/brand/hatch.jpg): ivory/cream fur, a pale peach-yellow face, peach-pink cheeks, glossy dark eyes and a tiny curved smile.
- [Official working illustration](https://muse.ai/images/landing/brand/og-image.jpg?v=3): the same character wearing headphones at a laptop. Orange, green and blue appear more strongly in the surrounding objects and app mark.
- [App-mark SVG](https://muse.ai/images/favicon/app-squiggle.svg): a separate blue squiggle with gradient stops including `#0082FB`, `#0064E0` and `#0040DC`. This is not the character's body palette.

![Muse's official character portrait with cream material and peach facial details](https://muse.ai/images/landing/brand/hatch.jpg)

I also inspected six frames from the official [working avatar video](https://muse.ai/videos/avatars/hatch_working.mp4). They show the character at a laptop, with changing head/hand positions and expression. The connecting video exists too, but was not played for this review. Asset basenames do not establish the mascot's public name.

**Useful transfer:** warm colour and a consistent material/face treatment can supply personality without assigning a different vivid hue to every character. A brand accent and a character palette can have different roles.

**Do not copy:** miniature fur or a full desk scene into a 20px SVG. The supplied portrait is 1080px wide; inspecting it does not prove the same detail reads at our size. Either simplify deliberately or create appropriately rendered small assets. Vendor artwork remains reference material, not a proposed dependency.

## What was wrong with the earlier conclusion

[Fluent's one-colour recommendation](https://fluent2.microsoft.design/iconography) is for system icons. [Apple's monochrome and hierarchical rendering](https://developer.apple.com/sf-symbols/) are available rendering modes, not proof that character avatars should be monochrome. Applying those rules as an overall art direction lost the personality the user wanted.

Our existing cast also changes several variables at once: category colour, body proportions, eye count, accessories and working motion. Removing all hue preserved much of that construction while removing its energy. Palette changes alone cannot establish a coherent character family.

The screenshots and source show these differences. The judgment that the result feels like mismatched stickers is a design assessment, not a measured usability finding.

## Next icon-only comparison

| Direction | Construction | Colour and finish | What it tests |
| --- | --- | --- | --- |
| Colourful shapes | Four simple, related silhouettes; the same capsule eyes and comparable apparent mass; no occupational props in the first pass | A small, deliberately chosen set of distinct body colours; consistent flat finish and eye contrast | Whether shared construction makes colour variety feel coherent |
| Warm companion | One recognisable character family with the same face proportions and a small number of pose/silhouette variations | Cream/sand bodies, peach facial warmth and dark eyes; a consistent soft finish rather than gray outlines | Whether warmth and material character provide enough personality with less hue variation |

These are original Pi Remote concepts to explore, not reproductions of the vendor mascots. My preferred first pass is colourful shapes because it is better supported at small sidebar scale; the warm direction is worth comparing rather than rejecting from a large illustration alone.

Keep the same subjects, placement, sample titles and row density across both directions. Show working and resting poses side by side at actual size, on light and dark backgrounds. Match face contrast and apparent visual weight before judging colour. Preserve the existing semantic unread/attention markers and check that character colours do not obscure them.

The decision should be whether the set reads as one family at 20px and still has character at 28px. Do not make the decision from enlarged artwork or another arbitrary palette swap. Keep the gray version only as a baseline.

## Evidence and limits

The parent directly fetched the two Grok articles, Grok's team GIF and motion storyboard, Muse's product page, portrait, working illustration, app-mark SVG and working video. It inspected the images and sampled motion frames. A delegated search independently checked Muse-name alternatives; Museapp now points to Allume, and Msty's mark is a faceted cube rather than this character.

The Grok Bot product route returned HTTP 403; the public design articles and linked assets were accessible. No private product account, live vendor interface, phone-scale recognition test, user study, contrast approval or artwork reuse permission was established. No live Pi Remote UI changed as part of this research.
