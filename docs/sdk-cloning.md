# Completed-branch cloning for Claude SDK

Pi can clone an idle, saved SDK conversation at its current leaf. [Earlier-message forks](sdk-forks.md) use the same branch receipt; [tree navigation](sdk-tree.md) uses a separate same-file handoff. Cloning uses Pi's normal branch copy, then opens a fresh SDK context when the clone receives its first SDK message. It does not resume or fork the parent's native SDK query.

```text
completed Pi branch and accepted SDK work
  -> validate history and matching tool results
  -> Pi copies the active branch into a new session
  -> clone-only receipt binds copied context, configuration and new Pi session ID
  -> first new message opens an independent native SDK conversation
```

## What stays unchanged

The parent Pi file stays byte-identical while the clone is created and used. No new prompt is sent to its native SDK conversation during cloning. Pi closes the outgoing worker's native query as part of normal session replacement; returning to the parent resumes its own completed checkpoint.

The clone keeps the copied Pi messages, tool results and audit. Historical calls are labeled JSON data, never dispatched as new calls. Their IDs are retired so they cannot be reused for new execution. Private reasoning and opaque provider signatures are omitted from the imported model context, not removed from the audit. New tools still use current Pi schemas, validation, authorization and execution.

The provider verifies the previous configuration with its original Pi session ID, then permits only the explicit new owner ID and existing validated tool-only transitions. Changed instructions, environment and output limits remain guarded. A new native conversation gets a fresh usage baseline; copied historical usage remains in Pi's ordinary per-session totals.

## Receipts and restart

`claude-sdk-clone` is appended only to the new file. Its receipt binds the target Pi session, copied source/prefix hashes, accepted configuration boundary and original configuration owner. After a successful new SDK turn, the clone saves its own ordinary checkpoint.

Pi RPC can emit the same fork-start event twice. Receipt creation is idempotent for that target session, including a recorded invalid receipt. It never repairs an invalid decision by silently approving a second one.

Before the first new checkpoint, restart validates the receipt and copied history. A missing receipt cannot resume the parent's checkpoint under a new owner. Missing/altered history, a wrong owner, null/missing configuration or changed protected settings fail before another SDK request. The focused test kills only its owned RPC worker after receipt publication to check this boundary. A moved/deleted parent path after publication does not prevent the clone's own continuation.

Compaction and cloning share configuration validation. A compacted context can still refer to a configuration accepted before its summary. The provider locates that recorded checkpoint in the copied audit instead of treating the summary's shorter message count as the old configuration. This permits cloning after compaction, cloning another unactivated clone, and compacting a clone before its first SDK response without relaxing ownership checks. A receipt with accepted SDK work cannot drop its configuration to `null`.

## Scope and checks

```sh
npm --prefix experiments/claude-sdk-provider run test:clone
PI_SDK_TEST_PI=<Pi CLI> npm --prefix experiments/claude-sdk-provider run test:clone

# Opt-in paid real models and mobile messages; cloning itself uses Pi RPC.
PI_PARITY_CASES=clone-contract,recorded-identities-and-usage npm run test:provider-parity
```

All 31 focused cases passed on Pi 1.2 and 1.3 using real Pi RPC, branch copying, persistence, SDK provider, MCP and effects. Only the external SDK peer is replayed. It checks independent memory, source/clone restarts, SIGKILL before the first clone checkpoint, consecutive clones, compaction on either side of activation, provider switches, a moved parent, new tools, permissions, argument validation, Stop and reused historical IDs. Unsafe/incomplete sources, busy sources and altered/missing receipts have explicit rejection checks. A rejected busy clone must leave its source running.

The shared real-model contract reads an unknown marker through normal tools, performs one counted filesystem effect, clones through Pi RPC, and reopens both saved files through the phone UI. Each branch learns a private value, retains its original marker after worker replacement and must not reveal the other branch's value or repeat any tool. SDK branches must have different active native IDs and retain their respective IDs after restart. This contract passed on Codex GPT-6.1 Sol, SDK Haiku 5.5 and SDK Opus 5.5 with the same 14 normal parent tools. Other full-matrix rows were skipped. See [reviewed evidence](../experiments/claude-sdk-provider/verification-clone.json).

This does not enable ephemeral/in-flight cloning, uncheckpointed unknown SDK work, child-local cloning/resume, or a new phone clone control. Physical Safari and every partial-file/power-loss boundary remain unverified. The [gap tracker](provider-gaps.md) remains the canonical open-items list.
