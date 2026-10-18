# Earlier-message forks for Claude SDK

An idle saved conversation can fork before an earlier user message through Pi's normal fork operation. The new session contains only the selected path. The selected message is returned for editing, not submitted again automatically. The original file and its most recent native checkpoint stay unchanged.

```text
validate the outgoing conversation, including later work
  -> validate the selected history and its tool results
  -> Pi copies that path into a new session
  -> save an owner-bound branch receipt in the new file
  -> first edited/new message opens an independent SDK context
```

## Selected history and configuration

A selected point can have an older SDK checkpoint, compaction receipt or unactivated clone receipt. The provider reads state from that path rather than applying the outgoing conversation's latest checkpoint to shorter history. The same reader constructs the preflight bridge and the new session's bridge. Preflight never opens an SDK query.

Queued follow-ups and steering messages can precede Pi's next completed checkpoint. For those points, a later accepted SDK prefix can prove the selected messages. The branch receipt then carries the attested complete **system checkpoint only**, alongside the configuration hash and original owner ID. Later user/assistant messages are not copied as configuration context. Before opening another native query, the provider reconstructs that configuration with the recorded owner and checks the unchanged environment, output limit and protected instructions.

New SDK checkpoints record their Pi owner explicitly. For older checkpoints, a matching configuration hash in an existing clone/compaction receipt supplies the owner. This matters when a cloned chat is compacted and then forked back into its inherited history. The adapter does not weaken the fingerprint guard or resume the original native query under the new session ID.

The provider still rejects missing results, unknown uncheckpointed SDK failures, busy/unfinished outgoing work and invalid points before Pi replaces the session. If selecting a point would omit a known result for a retained tool call, it splits a tool batch and is rejected. Previously approved unknown outcomes remain unknown data, not successful receipts.

## Files and restart

Choosing old conversation history does not rewind files. Tools from the selected history are labeled data and their IDs cannot execute again. Work omitted from the selected path may already have changed the filesystem. The SDK handoff says so; new changes must inspect current state rather than assume the old task should run again.

The normal `claude-sdk-clone` receipt is shared by full-branch clones and earlier forks. It is appended only to the new session, once even when Pi repeats its fork-start event. It binds the selected context and new Pi session ID. A restart before the first new checkpoint can continue from that receipt without the parent's path remaining available. Missing or altered receipts/context/configuration remain blocked before another SDK query. Each branch subsequently saves and resumes its own native checkpoint.

## Verification

```sh
npm --prefix experiments/claude-sdk-provider run test:fork
PI_SDK_TEST_PI=<Pi CLI> npm --prefix experiments/claude-sdk-provider run test:fork

# Paid real models with normal resources and mobile messages. Fork uses Pi RPC.
PI_PARITY_CASES=fork-contract,recorded-identities-and-usage npm run test:provider-parity
PI_PARITY_FORK_QUEUED=1 PI_PARITY_CASES=fork-contract,recorded-identities-and-usage npm run test:provider-parity
```

All 44 focused cases passed on Pi 1.2 and 1.3 using real Pi fork/RPC, branch projection, persistence, provider, MCP and filesystem effects. Only the external SDK peer is replayed. It covers first-message and earlier-message selection, queued follow-ups and tool-boundary steering, compaction on either side of the selected point, inherited clone history and legacy owners, provider switching, tool activation, Stop/notices, permissions/validation, restart before a new checkpoint, moved parents and fail-closed cases. The shared clone, compaction and recovery regressions remain separate checks.

The real-model contract reads an unknown marker through tools, performs one early and one later effect, forks before the later request, and reopens both files through the mobile browser. The fork must retain the early fact but not the later private value. Neither branch may repeat tools or rewind effects. Both resume with their own memory and SDK native IDs after worker replacement. The queued variant submits the later request while a read-only tool gate is still running, then releases that gate. It passed on real Codex GPT-6.1 Sol, SDK Haiku 5.5 and SDK Opus 5.5 with the same normal 14 tools, actually exercising SDK points without a completed checkpoint. Other full-matrix rows were skipped. The first Haiku attempt missed a variable-built wait path in the test; the corrected matcher and retained failure are documented. See [reviewed evidence](../experiments/claude-sdk-provider/verification-fork.json).

Tree navigation remains separate and guarded. This does not add a phone fork control, child-local lifecycle support, ephemeral/in-flight branching, or permission to hide unknown work by selecting older history. Physical Safari, arbitrary abandoned-tree points and every power-loss/partial-write boundary remain unverified. Open items stay in the [gap tracker](provider-gaps.md).
