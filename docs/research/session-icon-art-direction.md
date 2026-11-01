# Session icon art direction

## Scope and recommendation

This is about the icons, not the session list. The user specifically identified the different category colours as making the page look cheap. Keep the current placement and interaction unchanged while exploring the art.

My recommendation is a family of small, matte, neutral characters. Give them personality through silhouette, a shared facial style and restrained movement. Do not replace them with generic system pictograms, and do not assign a new accent colour to each task category.

This is a proposed direction, not a validated final design.

## What the current art is doing

The source reviewed is `web/app.js` and `web/style.css` at `cb02c17`, with the user's phone screenshot as the visual reference.

- Category selectors give review, fix, research, build and idea separate purple, red, blue, green and yellow bodies.
- Accessories introduce additional independent colours: the bulb, pencil, flames, handle and designer's swatches. Changing only `--kind` would leave some of that palette behind.
- Eye count, body footprint and accessories vary substantially. At 20px, the glasses, helmet and antennae produce different apparent weights even though their SVG canvases match.
- Working icons can combine body bobbing, glancing, blinking and accessory movement. The result has several competing rhythms.
- Saved icons close their eyes and lower the opacity of the whole character. On the dark background, that can make an already small face harder to read.

Those are source observations. The judgment that the combined effect resembles mismatched stickers is our assessment, not a measured usability result.

## References worth borrowing from

### Apple SF Symbols: neutral does not mean flat or lifeless

[Apple's rendering guidance](https://developer.apple.com/sf-symbols/) distinguishes monochrome, which uses one colour, from hierarchical rendering, which uses one tint at several opacities. The same source describes shared design characteristics, multiple weights/scales and layered animation.

I visually inspected the official comparison below. The first two columns show the useful direction: consistent neutral ink, with optional tonal hierarchy. The palette and multicolour columns are the contrast, not the recommendation.

![Apple's official rendering comparison, with monochrome and hierarchical examples on the left](https://developer.apple.com/sf-symbols/images/vx-poster-sf-symbols-gradients_2x.png)

Borrow the rendering discipline, not Apple's actual symbol assets or a claim that native SF Symbols are a web dependency.

### Microsoft Fluent: simplify small icons and control colour

[Fluent iconography](https://fluent2.microsoft.design/iconography) warns that adding colour can disrupt visual balance and says to use one colour when colouring a system icon. Its modifiers guidance says not to introduce too much complexity. Its product-icon section uses simplified, size-specific drawings below 48px.

The product-icon threshold is not a specification for our bots. The useful principle is that a small icon deserves its own drawing, rather than being a detailed illustration scaled down.

### Google Material Symbols: optical sizes are real design work

[Google's optical-size guidance](https://developers.google.com/fonts/docs/material_symbols) describes thickness adjustments across optical sizes of 20–48dp. That supports checking visual weight and internal gaps at the actual rendered size. It does not specify the correct eye dimensions or stroke width for our characters.

### useAnimations and Fluent Motion: movement can supply the character

[useAnimations' interaction reference](https://useanimations.com/interactions) distinguishes persistent activity loops from one-shot feedback and supplies static reduced-motion behaviour. Its [terminal example](https://useanimations.com/icons/terminal.md) documents a simple 32px loop with a static SVG fallback. The terminal SVG source was inspected; its animation was not played.

[Fluent Motion](https://fluent2.microsoft.design/motion) recommends short, natural movement, no flashes or jarring motion, and a no-motion alternative. These are useful constraints for expressive characters, not a reason to remove their personality.

## Proposed icon-only brief

| Aspect | Direction to try |
| --- | --- |
| Palette | One neutral family for every task. Smoke-coloured bodies, a darker neutral accessory tone and clear eye cutouts. Reverse contrast deliberately in light mode. |
| Colour meaning | Keep the existing unread/attention accents separate from the character palette. No purple-for-review, green-for-build or yellow-for-ideas. |
| Surface | Matte flat fill, at most two neutral tones. No glossy highlights, gradients, bevels or miniature 3D lighting in the first comparison. |
| Family | Shared eye treatment, corner softness, face placement and apparent mass. Different silhouettes are allowed, but must look drawn by the same hand. |
| Detail | At most one defining accessory. If it only reads when enlarged, simplify or omit it at 20px. |
| Size | Draw and inspect dedicated 20px and 28px versions. Match occupied visual area, not just the SVG canvas dimensions. |
| Working | One local action per character. For example, a reviewer glances or a builder moves one tool. Do not stack body bouncing, eye scanning and flashing. |
| Resting | The same identifiable character in a settled pose. Keep essential face contrast rather than fading the entire drawing. |
| Reduced motion | A deliberate static pose with the existing textual status still available. |

A starting dark-theme palette could be body `#B8B6BF`, accessory `#807D87` and face cutouts matching the dark surface. These are swatches to compare, not approved tokens or a completed contrast assessment.

I would compare only two treatments next: solid matte characters and neutral outline characters, using the same four subjects and states. My preference is solid matte, because the existing eye-and-body concept is worth preserving and fragile outlines may disappear at 20px. A grayscale filter over the current rainbow would be a quick preview, not finished art direction.

## What would settle the decision

Use review, fix, research and build as the initial set. Show each at actual 20px and 28px size, on light and dark backgrounds, still and working. Keep list layout, placement and copy identical so the comparison isolates the icons.

Accept the family only if the faces remain readable, the four icons have comparable visual weight, the active motion reads without colour, and no small accessory turns into noise. Enlarge artwork only as a secondary craft view; the phone-size view decides.

The fetched sources support a coherent neutral system, not a guarantee that this aesthetic will satisfy the user. The old Duolingo design routes redirected to general content, and a Lucide guide URL returned 404; neither was used as evidence. No new artwork, animation playback, physical-phone trial or live UI change was performed for this research.
