# Character icon design: principles and behaviour

## Current brief: 32px session characters

Use small, memorable characters to distinguish sessions. They do not need to depict work types. The latest direction is a random-looking family with plain eyes and a coherent palette, shown in the selected 32px leading layout. Keep the existing bot construction rather than drawing tools with faces.

- A: enlarge resting detail-line bots from 20px to 28px, keeping the current title layout.
- B: align 32px bots in a consistent leading column, keeping compact single-line resting titles.
- C: use 40px leading bots and allow two-line titles, accepting fewer visible rows.
- Keep the 32px layout and the existing bot construction. Preserve pin, unread, working and needs-input cues, animation and selected-row feedback.
- Follow the supplied dark-list colour reference with off-white, vivid red, orange, green, violet and teal. Use solid white eyes in light mode and solid dark eyes in dark mode, without borders or glossy highlights. Prefer saturated fills to chalky pastels; adapt light-theme fills as needed for contrast. Keep the character drawings unchanged while comparing colour.
- Use static sample content shaped like the supplied screenshot, without publishing private issue identifiers or reading live sessions.
- Keep the current Idea, Fix, Build, Notes and Ship artwork and animations. Recolour them to the same palette: orange, red, green, off-white and violet, respectively.
- Use Pip, Sprout, Bun, Mochi, Pebble and Wisp without job-specific accessories. Sample sessions with the same work type should be able to have different characters.
- Add Miso, Puff, Moss, Jelly, Nim and Zig: a cat with ear perks and tail swishes, a billowing cloud, a double-hopping frog, a pulsing jellyfish with trailing tentacles, a fluttering winged bug, and a stepping triangle. Keep their own body rhythms and follow-through parts.
- Give each new character a full working loop, not one shared bob: antenna flicks and signals, leaf sway and drifting seeds, ear-led hops, jelly squashes, a rocking orbit, and a floating ghost with a curling tail. Combine body anticipation, face tracking and part follow-through. Keep movement within the row gutters, use the existing clock for continuity, and pause offscreen, when hidden or by request. Reduced motion keeps the characters and status cues still.
- Add Stella, Luna, Sol, Orbit, Comet and Vega: a rounded five-pointed star with drifting sparks, a crescent moon with a floating mote, a sun with rotating rays, a planet with a tilting ring, a comet with a streaming tail, and a stretching four-pointed star. Keep the same plain eyes and saturated palette.
- Show all twenty-three working loops in the preview lineup. Resting session rows retain their quieter behaviour; the lineup is not a claim that those sessions are running.
- A character belongs to its session, not its title or status. Default app characters are picked randomly from all twenty-three on first use and saved per session in this browser. Renames, activity, reloads, sign-out and catalogue additions must not reroll saved choices; only manual selection changes them. Assignments are browser-local, not synced across devices. The prototype uses fixed sample assignments. Preserve manual choices, custom emoji and older saved icon types.
- After comparing B and C, the user returned to B: 32px leading bots and compact single-line resting titles. Custom emoji choices retain their standard status indicator and detail-line emoji.

## Archived lifecycle-first proposal

## Why the previous attempts missed

The user rejected both the neutral art study and the colourful/warm character comparison. They are asking for an understanding of design patterns, flow and principles, not drawings that resemble Grok or Muse.

The prototypes compared appearances before establishing the icon's job. They showed separate working and resting examples, not one character responding to an actual sequence. Changing colour, shape and finish did not address that missing behaviour.

This is a proposed behaviour brief, not an approved visual direction. Do not draw another set of faces or change the live list from this document alone.

## What the references actually teach

### Grok: identity and state form one system

[Grok's design team](https://x.ai/news/designing-grok-bot#presence-as-interface) frames the avatar around recognition, activity and how much detail the person needs. The same account describes a sequence: calm at rest, acknowledgement when work arrives, active movement while working, different behaviour when help is needed, and settling after completion.

The important transfer is that sequence and its meaning. Bright colours and capsule eyes are one implementation, not the principle.

I operated the article's interactive avatar demo through Idle, Working, Waiting, Blocked, Thinking and Done, checking the selected tab and capturing each state. It keeps a common presentation context while changing gaze, expression and form. Thinking can become dots and Blocked can become an exclamation mark. Continuity therefore does not require the same face to remain literally visible in every frame. It requires the changes to be understandable as the same agent's state.

Those are observations of an illustrative public demo, not a test of real Grok work or every transition's timing. The [designer's workflow article](https://x.ai/bot/guides/designing-grok-bot-with-grok-bot) separately emphasizes tuning motion with production assets in context. That supports judging behaviour over time rather than approving a static mascot sheet.

### Muse: material and expression support a consistent presence

[Muse's official personal-agent site](https://muse.ai/) uses one recognisable cream/peach character, with a consistent face, material and manner. Its blue app mark is separate from that character. The [portrait](https://muse.ai/images/landing/brand/hatch.jpg) and sampled [working animation](https://muse.ai/videos/avatars/hatch_working.mp4) support those observations.

The transferable principle is consistency of presence and expression. Fur, cheeks and a cream palette are stylistic choices. We have not verified Muse's full interactive task lifecycle, so it cannot supply our complete state model. It remains a plausible match for the user's Muse reference, not a confirmed identification.

## Principles for Pi Remote

- **Give the icon one primary job.** Proposed job: make this session's agent feel recognisable and communicate its activity at a glance. It should not simultaneously become a job-category legend, an outcome guarantee and a decoration.
- **Separate what stays from what changes.** Identity supplies stable construction and recognisable traits. Activity changes pose, rhythm or expression. Unread is a separate attention signal. A new reply should not accidentally create a new identity.
- **Design cause and response.** An acknowledgement follows a confirmed action; a working loop follows actual runtime activity; waiting redirects attention; settling follows the run ending. Motion needs a reason to start, change and stop.
- **Use one motion grammar.** Related characters can have personality, but the same state should feel related across the family. Choreographed layers are allowed. Unrelated loops at competing frequencies are not a substitute for choreography.
- **Preserve perceptual continuity.** The person should understand a change as the same agent changing state. Data refreshes, automatic retitling and movement between the leading and detail-line slots must not make it feel replaced or restarted.
- **Control attention at page scale.** A character can be expressive without every quiet session competing for attention. Evaluate several active sessions together and the return to rest, not just one enlarged icon looping alone.
- **Derive the visual language from this product.** Pi Remote's own `web/icon.svg` already uses warm off-white with coral, blue and gold modular shapes. That is a possible starting vocabulary, not a mandate to put three colours on every icon. Grok's shapes and Muse's material should not become imported skins.
- **Let scale constrain the drawing.** At 20px and 28px, apparent mass, facial spacing and contrast matter more than nominal canvas equality. Preserve meaning without motion, with textual status still available.

These are design constraints and hypotheses. They do not yet select a silhouette, palette, material, metaphor or assignment scheme.

## Behaviour before artwork

```text
Ready → Acknowledge → Working → Settle → Ready
                         ↕
                    Needs input

Interrupted run → neutral settling, not a success celebration
Connection lost → stop implying live activity
Unread reply    → independent attention signal
```

This is intended choreography, not a claim that the host exposes each box as a status.

| Moment | What the person should understand | Constraint |
| --- | --- | --- |
| Ready | Available, with nothing currently running | Calm does not mean disabled or asleep |
| Action acknowledged | The computer accepted the request | Do not imply the model has started before runtime evidence arrives |
| Working | The agent is active | A loop is not proof of useful progress or successful output |
| Needs input | The person has an action to take | Different from merely continuing to work; no urgent-looking decoration without a real need |
| Run settles | The activity has ended | `idle` alone does not prove success, completion of the user's goal, review or delivery |
| Stopped or interrupted | The run ended with an uncertain or partial outcome | No automatic celebration |
| Saved or disconnected | The agent is not currently live in the same way | Do not infer completion, failure or sleep from connectivity alone |
| Unread | A reply arrived since the conversation was last seen | Can coexist with activity; should not restart its motion |

The source contract matters. `src/state.mjs:refreshStatus` exposes starting, working, waiting, idle, saved and disconnected conditions. Working can include retries, compaction or a pending reply. It does not expose a general successful-done status. Acknowledge and Settle above are proposed presentation phases, not new backend states.

## Boundaries already established

This remains icon design, not a session-list redesign. Preserve the existing title, metadata, sections, navigation and controls. The current requested placements are a larger leading character while active and a smaller detail-line character at rest. The transition between those placements must be part of the study, rather than an unexplained swap.

Stable identity is still a product decision, not permission to invent persistent teammates across unrelated sessions. Today `web/app.js:sessionKind` derives automatic kinds from the title. We should decide deliberately whether the icon identifies the session, the agent presence or the task kind before changing that contract.

## Next design artifact

Make one small lifecycle storyboard with an original placeholder mark, not another gallery of polished characters. Show the same session through:

1. Request accepted, runtime starts, work continues, run settles.
2. Work pauses for a real question or permission, then resumes.
3. The person stops the run; activity ends without implying success.
4. A reply arrives while off-screen; opening the conversation clears unread without changing identity.
5. Connection is lost and restored; the icon does not invent activity during the gap.

Keep the real start/end placements and include a long title and several neighbouring sessions. The evaluation is whether the viewer can tell what changed, why it changed and what needs their attention. Only then choose the final drawing and palette to support that behaviour.

## Evidence and limits

Reviewed current `web/app.js`, `src/state.mjs`, `web/icon.svg` and the prototype. The prototype currently has only working/resting samples and style/theme/motion switches; it does not enact the task lifecycle above.

The first-party artwork research remains in Git history at `494e22a`. This pass additionally operated Grok's public state demo in an isolated browser and inspected six captured states. The first attempt to wait for network idle timed out; the bounded retry used DOM readiness and visible controls. No private vendor account or live task was used.

No UI or implementation changed in this pass. No user study, approved design brief, phone usability validation or evidence that a particular final appearance will fit has been established.
