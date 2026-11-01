# Coordinator interaction design research

## Conclusion

The next design question is when useful work enters the conversation, not where to put a list of workers.

Keep the existing composer. Organize the experience around accepted requests, decisions and reviewable results. Workers and their transcripts are supporting detail. Compare an arrival-led conversation with a consolidated coordinator briefing before drawing another layout.

This is a hypothesis, not a validated design. The sources below show useful parts of the interaction, but none of the inspected examples demonstrates our complete many-independent-workers, one-phone-conversation goal.

## Constraints versus assumptions

The user explicitly rejected both rounds of prototypes and specifically objected to replacing the composer. Preserve its established controls, styling and normal Send/Stop semantics. The original goal is to reduce the person's orchestration work.

The user did not explain every reason for rejecting the second round. The criticism below is our assessment, not an attribution of their motives.

Preserving the composer does not require freezing every surrounding information hierarchy. Conversely, adding coordination does not justify a new app shell. Both earlier approaches treated layout placement as the main decision before establishing what the person should see and do.

The rejected second-round reference is commit `b909622`, particularly `web/coordinator-prototype.js` and its baseline/A/B screenshots. No production UI was changed for this research.

## Visual reference board

These are public first-party illustrations, not screenshots of our own live product tests. Native apps and desktop layouts are not automatically transferable to Pi Remote's mobile web client.

### Cursor: deliver something inspectable

[Cursor Mobile](https://cursor.com/mobile) shows the original request followed by completion recency and a playable walkthrough. The inspected image is a promotional still; playback and runtime behavior were not tested.

![Cursor phone example with the original request and a completed walkthrough](https://ptht05hbb1ssoooe.public.blob.vercel-storage.com/assets/features/mobile-og-image.jpg)

**Useful transfer:** a result should contain something the person can judge. For a UI change, the screenshot or recording is more useful than a worker status and an Inspect button. For research, the equivalent is the answer with source evidence.

**Do not copy:** the phone frame or a native app's machinery. The [iOS documentation](https://cursor.com/docs/cloud-agent/mobile) documents follow-ups, optional subagent transcripts and completion notifications, but does not establish that every notification is useful in one shared conversation. Its desktop/iPad side-by-side layouts are not phone evidence.

### Linear: put a correction next to the thing being corrected

The [coding-session documentation](https://linear.app/docs/coding-sessions) depicts a diff beside a specific follow-up request and the agent's response. It documents verification artifacts and human review; repository permissions and review rules still determine what ships.

![Linear desktop example with a code diff and a scoped correction](https://webassets.linear.app/images/ornj730p/production/f95d33c6f3b7a1d0ffac9f64c9d89c167d674b78-2140x1488.png)

**Useful transfer:** name the outcome, show its evidence, and preserve that context for the follow-up. The user should not have to translate a requested correction into a worker identity.

**Do not copy:** the issue-management shell, review navigation or desktop split view. The screenshot does not prove a mobile layout. Linear's [Agent Interaction SDK article](https://linear.app/now/our-approach-to-building-the-agent-interaction-sdk) also describes responses returning to their originating context; that is useful ownership behavior, not permission to reproduce its assignee/delegate controls.

### Claude Cowork: make the required human action specific

The [web/mobile announcement](https://claude.com/blog/cowork-web-mobile) describes decisions reaching the phone. Its first-party illustration shows Needs input and Ready for review, with different direct actions for an approval and a question.

![Claude Cowork illustration showing phone actions for approval and a question](https://assets.claude.com/929878fd0530236a3b94dcc763b357e199e23d9b.png)

**Useful transfer:** distinguish an action requiring permission from a question requiring an answer. State the consequence and provide the relevant action. A general reply must not silently become approval.

**Do not copy:** a separate task home, repeated cards or the replacement composer. This is an illustrated mobile work list, not evidence of one-conversation mediation. Its cloud continuation also differs from Pi Remote: [Claude Code Remote Control](https://code.claude.com/docs/en/remote-control) explicitly requires the local computer and process to remain running, even though conversation and subagent progress synchronize across devices.

### GitHub Mobile: distinguish execution from delivery

The [GitHub Mobile announcement](https://github.blog/changelog/2026-04-01-github-mobile-stay-in-flow-with-a-refreshed-copilot-tab-and-native-session-logs/) shows outcome titles with recency and separate In Progress, Completed and Merged states. It documents native logs, PR review and stopping a session.

![GitHub Mobile example separating In Progress, Completed and Merged outcomes](https://github.blog/wp-content/uploads/2026/04/Android-inline-1.png)

**Useful transfer:** finished execution is not reviewed, accepted or shipped. State these distinctions when they affect the next action, rather than exposing every internal phase.

**Do not copy:** separate Agent sessions and Chats destinations as our default. That would retain the person's job of managing sessions. The [mission-control announcement](https://github.blog/changelog/2025-10-28-a-mission-control-to-assign-steer-and-track-copilot-coding-agent-tasks/) documents adapting to steering after the current tool call finishes. Receiving an instruction and applying it are different events.

## OpenAI references: attention and continuity are separate concerns

The currently fetched [long-running-work documentation](https://developers.openai.com/codex/long-running-work) recommends a clear outcome, constraints and verification, and keeps related work in the same chat. It documents follow-ups while a goal runs and a separate status recap path. A goal does not broaden permissions.

The [notification documentation](https://developers.openai.com/codex/notifications) distinguishes turn-completion alerts from permission and question notifications. Its Activity view covers unread, running and waiting chats. This is evidence for separating kinds of attention, not evidence that Pi Remote needs another Activity destination.

The [mobile documentation](https://developers.openai.com/codex/mobile) separates starting work, guiding it, approving requested actions and reviewing the result. These are useful journey stages. They do not require us to expose the underlying worker/session topology.

These are documented behaviors, not visually inspected controls. The fetched Codex-route overview and features directory now label themselves ChatGPT desktop app / ChatGPT Learn. Do not use older product naming or screenshots to imply a current layout that was not inspected.

## What the previous prototypes did not settle

This is a design assessment of our artifacts, not user research:

- Both second-round variants still made the person discover and open a task container. Moving that container from the handoff to the header did not establish a different coordination experience.
- A question could be behind a historical handoff, while the current assistant message merely said that input was needed. That splits the explanation from its action and becomes harder after a long absence.
- The sample result emphasized status and inspection before a concrete artifact. It did not demonstrate judging a proposed UI, reviewing a diff or using a research answer.
- The two variants shared the same interruption behavior. They did not answer whether a completion should enter the current discussion immediately, or wait for one briefing.
- Composer parity, contrast and touch-target checks protected important constraints. They could not establish that either design was useful or desirable. Passing them was not design acceptance.

The next brief should include an interruption and a return after time away. A static initial screen is insufficient.

## Proposed experience contract

These are proposals derived from the references, not claims about proven user preferences.

| Moment | What the person should receive | What not to require |
| --- | --- | --- |
| Work accepted | A normal acknowledgement of requested outcomes and scope; only say work started after dispatch is confirmed | Choosing workers, interpreting IDs or opening a dashboard |
| Routine execution | Quiet, optional reassurance and access to details | A conversational turn for every tool or worker update |
| A decision blocks work | A current, explicitly named question, its consequence and task-scoped choices | Finding an old handoff or assuming a text reply granted permission |
| A result is usable | The answer or artifact, its evidence, verification limits and relevant next action | Opening a worker transcript to discover what was produced |
| User continues another topic | A coherent coordinator conversation with the existing composer | Switching recipient modes or guessing which worker will receive the message |
| User returns later | A fresh recap of unresolved decisions, ready outcomes and remaining work | Reconstructing changes from timestamps and scattered logs |
| Follow-up or Stop | Explicitly scoped action with honest received/applied/stopped feedback | Repurposing the normal composer Stop to mean stop every worker |
| Investigation | Optional source/session detail that returns to the same reading position and draft | Making logs the default way to review work |

Outcome titles should use the user's language. Internal worker identity is useful for diagnosis, but should not become the main vocabulary.

## Two attention contracts to compare

### Arrival-led conversation

A question, failure or usable result arrives as a new coordinator message at the current end of the conversation. Results include their artifacts or evidence. Scoped continuation is attached to that outcome. A returning user can get a short recap.

**What this tests:** can the person use completed work without going elsewhere or missing new arrivals?

**Risk:** independent completions may fragment an unrelated discussion. New messages must not steal focus, erase a draft or jump someone out of scrollback. These behaviors need a real scenario, not another screenshot of an empty thread.

### Coordinator briefing

The coordinator collects non-blocking completions into one current briefing. Candidate delivery points are the end of the current conversational turn, reopening after an absence, or an explicit status request. Blocking decisions and failures still surface promptly and remain unresolved until answered.

The briefing groups what needs a choice and what can be used, rather than listing workers. This is not a task panel placed somewhere else.

**What this tests:** can the person keep discussing one topic while independent work finishes without feeling responsible for watching it?

**Risk:** useful work can feel invisible. Timing and unread behavior are not settled, and a digest must not delay urgent questions or imply that unseen results were reviewed.

Neither contract is validated. The default need not be identical for questions, failures and non-blocking completions.

## Next research step before another visual build

Use the same short scenario for both contracts:

1. Ask for a navigation fix and a login review in parallel.
2. Continue discussing a release plan with the coordinator.
3. The login work needs a consequential decision while navigation continues.
4. Answer the login question and stop only the navigation work.
5. Leave, return later, and review the login result with its screenshot or diff.
6. Ask for a correction without naming a worker or losing the release discussion.

The comparison fails if the person must inspect a worker list to find the next decision, confuse permission with ordinary conversation, reconstruct old progress, or cannot tell what was actually verified. The strongest open question is when a non-blocking completion should enter an unrelated conversation.

Do not commission a third set of task-container layouts before resolving this interaction contract. A scenario storyboard can compare the sequence without changing the composer or committing to visual chrome.

## Evidence and limits

The delegated investigation inspected six primary pages and nine first-party images. The parent additionally fetched the OpenAI and Anthropic references and visually inspected the Cursor phone image, Linear review, GitHub Mobile list and Claude Cowork illustration, alongside our rejected baseline/A/B comparison.

Observed screenshots, documented behavior and proposed transfer are distinguished above. No private/live product sessions, interactive vendor demos, user interviews or usability tests were performed. Vendor illustrations are not independent proof that a pattern improves this user's workflow. No inspected reference establishes the full one-mobile-conversation, many-independent-workers flow.

The delegated automated source checks retrieved some relevant passages but lacked semantic verdicts; no automated verification claim is made. One Linear search missed evidence that was available in the directly fetched primary page. Original PNG assets were inspected where automatic image formatting returned an unsupported format.

No application files or prototypes were changed for this research, and no runtime tests were needed for the documentation. Existing unrelated work in the checkout was left untouched.
