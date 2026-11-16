# Grok Bot working motion: observed reference

## Question

What does Grok Bot actually do to communicate active work, and what did Pi Remote's rejected animation studies miss?

The user rejected subtle head gestures and then generic whole-avatar pulse, flip, swim and orbit loops. This investigation records the reference rather than proposing another unverified visual implementation. No avatar or preview changes are authorized by these findings alone.

## Primary sources

1. [Designing Grok Bot for a world of persistent agents](https://x.ai/news/designing-grok-bot#presence-as-interface), including its interactive **Avatar motion system**. This is the main visual evidence.
2. [Public demo renderer bundle](https://x.ai/_next/static/chunks/0_rgines1z2mg.js?dpl=cce67e653c7727cb68a5145c5338afdb9fb3cfc5), loaded by that article. Findings below describe this captured deployment, not a stable API or a guarantee about every Grok client.
3. [Designing Grok Bot with Grok Bot](https://x.ai/bot/guides/designing-grok-bot-with-grok-bot#motion-god-work-with-the-real-thing). The designer describes working with the actual animation specification and tuning timing, springs, distance, scale and easing against a real app window.

A community [orb recreation](https://github.com/ngocdevv/grok-bot-emoji) led to the official site. It was not used to establish official timings or behavior. General Grok chat spinners and voice companions are different references and are excluded.

## What I operated and saw

I opened the official article in a fresh Chromium context without a vendor login, selected Idle, Working, Waiting, Blocked, Thinking and Done, and captured each selection. I then recorded a separate 12-second Working clip, confirming Working remained selected throughout the source recording. The tour's automatic state switching was off; the avatar itself remained animated.

The Working demo has a small, continuing rhythm beneath a more conspicuous occasional turn:

- The body stays legible as a solid object. During a turn, the eyes travel toward the edge, narrow, disappear behind it and reappear. It does not flatten the entire drawing like our `rotateY` crescent.
- A brief curved, coloured trail follows the turn. Parts of that trail pass behind the body and parts in front, giving it depth. The trail is not a permanent status ring.
- Between turns, the avatar keeps a quicker, smaller dip/tilt rhythm while its gaze and expressions change independently.
- The movement settles after the turn rather than immediately repeating an identical full-body flip.

These are observations of the public design demo. They are not evidence that a real agent is executing work, or that this behavior is equally readable at Pi Remote's 32px size. The article renders this lifecycle avatar at 128px.

## What the delivered code confirms

The minified renderer provides unusually specific evidence for the observed behavior. These are nominal targets and schedules; spring integration changes the rendered trajectory.

| Detail | Captured implementation evidence |
| --- | --- |
| Base working rhythm | The `case"working"` branch uses `Math.sin(r*Math.PI*3.2)`, a 1.6 Hz target, with a small vertical dip, rotation and a vertical scale target as low as `.98`. This is not a large zoom pulse. |
| First turn | Entering Working schedules the first spin after a seeded interval of 1200–2400 ms. |
| Subsequent turns | The Working branch calls `tp(1,1)` and schedules another after 6000–9000 ms. `tp` targets a full `2*Math.PI` turn. |
| Facial variation | Working uses the expression sequence `[7,16,11,10]`, with changes scheduled within 1800–3200 ms. Working gaze targets are also updated at 1200–2400 ms intervals. Those expression indices are implementation details, not product labels. |
| Depth during a turn | Eye projection uses sine for horizontal travel, cosine for narrowing and visibility, and hides eyes when they are behind the body. The body is not globally squeezed to zero width. |
| Trails | The trail renderer maintains motion history, builds curved strips, and splits them into front and back paths according to depth. Trail updates receive the current spin angle. |
| Motion integration | The renderer advances damped springs using substeps capped at `1/120` second. Body, gaze, eyelids, expression interpolation and spin have separate spring parameters. This does not imply a guaranteed 120fps render rate. |
| Small-size adaptation | The renderer measures its displayed width and increases trail size at smaller widths, with a clamp controlled by `smallBoost`. Its enlarged article demo is therefore not a sufficient small-icon specification. |

The relevant code can be found in source 2 by searching for `case"working"`, `working:[1800,3200]`, `working:[2800,5500]`, `spinAngle`, `smallBoost`, and `Agent lifecycle stages`. The last selector identifies the demonstration controls rather than the motion engine.

Working and Thinking are explicitly different. In this demo, Thinking maps to a dots morph, Blocked maps to `alerting`, Waiting to `bored`, and Done to `celebrate`. It would be wrong to treat the three-dot Thinking morph as the Working loop, or to map Pi Remote idle to Grok's celebratory Done state.

## Broader character family, not only the round mascot

A follow-up inspected the [official Bot homepage](https://x.ai/bot), especially **Work with Bots like teammates**, and the design article's geometric family and visual-exploration sheet. The original round-avatar recording is only one example.

The homepage shows nine characters: brown blob, red squircle, orange teardrop, yellow dome, green tablet, cyan clover, blue cylinder, violet pebble and magenta blob. I recorded this entire row and sampled its SVGs at eight points. All nine changed their rendered paths; most also changed transforms during that sample.

What differs visibly is more than colour:

- The red rounded square tilts between upright and diamond-like poses.
- The yellow dome leans while retaining its flat-bottomed construction.
- The wide green tablet and blue cylinder have different proportions and postures from the round bots.
- Eyes change between long capsules, rounded dots, asymmetric shapes and curved expressions. The face is not two fixed dots carried by a moving outer wrapper.
- The characters change pose and expression at different times rather than reaching the same beat together.

The [homepage's delivered sequence definitions](https://x.ai/_next/static/chunks/2ty8ef6hvqv2p.js?dpl=cce67e653c7727cb68a5145c5338afdb9fb3cfc5), searchable by `bot-size:17%`, confirm four sequences distributed across the nine characters:

| Sequence | States in order |
| --- | --- |
| A | idle, happy, idle, curious |
| B | idle, curious, idle, playful |
| C | idle, proud, idle, happy |
| D | idle, excited, idle, surprised |

The renderer rotates each character's sequence start and scales its durations. **This is a personality showcase, not nine examples of the Working state.** Its range is useful motion reference, but those moods must not be presented as verified work-status signals.

The article separately shows eight geometric types: blob, pebble, squircle, tablet, wedge, hex, cloud and teardrop. Its component explicitly renders them in `idle`, at 92px on the desktop layout. The article bundle also defines additional geometry types and shape-specific behavior: tablet and cloud have composite solid definitions used to change their outline during turns; the wedge has a face-position correction. These are stronger evidence for adapting motion to each silhouette than for applying the circle's exact rotation to every character.

The style-exploration sheet is a third, separate artifact. It contains initials, emoji, drawn portraits, clay-like characters, watercolor, silhouettes, pixel art and identicon-like forms. The article calls these explorations and explains why detailed styles were not suitable at sidebar scale. They should not be mistaken for the selected live character system.

Follow-up evidence is in `/tmp/pi-grok-style-research/`: `geometric-family.png`, `style-explorations.png`, `home-sources.json`, `family-samples.json`, and `grok-bot-character-family.mp4`. The video is a cropped recording of the public homepage, not a reconstruction or a Working-only clip.

## What this changes about the design direction

The previous previews treated an avatar as a flat image to wobble, scale or flip. Grok coordinates a body, a face, depth and a short-lived trail. Its visually strong event is supported by quieter continuous activity, with different cadences rather than one repeating transformation of the entire icon.

The useful next experiment would be one existing Pi Remote character, preferably a rounded body, with face travel around the body, brief occlusion, a coordinated turn and a trailing arc. Compare that at 32px with Idea and with several idle neighbors. Keep the original artwork, palette, saved choices and real status boundaries. Do not copy Grok's mascot or introduce its whole animation engine merely to test the principle.

That is a proposed experiment, not a finding that it will look better. The broader-family inspection also shows why the round-character experiment alone cannot establish a system for our catalogue: expression changes, silhouette-specific poses and varied timing matter alongside depth and trails. Any later study should compare several structurally different existing characters rather than generalizing from the circle. A crescent, cat and jellyfish need different geometry; attaching the same rigid turn to all of them would repeat the earlier mistake. No new implementation is approved by this research.

The official design article also says the avatar provides initial reassurance of activity, while the current action is available on hover for more detail. An animation is not evidence of useful progress. Pi Remote should retain its readable status and activity information, especially on a phone where hover is unavailable.

## Evidence and limits

Local capture directory: `/tmp/pi-grok-motion-research/`.

- `states.json` records the six selected tabs; `working-0.png` through `working-11.png` and their SVG snapshots capture the first visual inspection.
- `working-recording.json` records the successful recording's bounds, source video and final selected-state check. `grok-official-working-demo.mp4` is the cropped 12-second H.264 recording, not an animation recreation.
- `sources.json` records the public URLs of captured renderer assets. The downloaded bundle is kept locally, not copied into the repository.
- The earlier `recording.json` attempt did not retain Working selection because interaction occurred before hydration. It was rejected as Working-only evidence and was not delivered.

No physical iPhone check, production Grok account, or Pi Remote implementation was involved. Search through Radius was unavailable because of its terms-acceptance gate; another configured search provider located the public sources. The read-only worker could not fetch web assets, but found the official article in this repository's earlier research. All new browser and renderer observations above were made by the parent session.
