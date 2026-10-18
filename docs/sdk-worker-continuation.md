# SDK worker continuation investigation

The normal foreground worker can finish real edits, but its borrowed SDK bridge is temporary. Its Pi transcript survives completion; no child-owned SDK checkpoint is saved by that route. A later retained resume therefore cannot automatically trust the earlier SDK responses.

The shared `retained-standard-worker` check now exercises this actual workflow rather than inferring it from implementation details:

1. A normal builtin `worker`, with default High reasoning, reads a private value, edits one module and performs one counted effect.
2. Its first completion report does not reveal that value to the parent.
3. The owned parent process is replaced.
4. The parent inspects the exact retained run and resumes it without changing its profile, model, tools or acceptance policy.
5. The worker must recall its private value without tools, preserve the earlier effect and avoid inventing a parent-only value.
6. The parent receives the automatic notice and retains both values after another restart.

All files, workers and runtime records belong to the isolated fixture. Normal skill/documentation reads are allowed; the parent cannot access the child's task files. Raw prompts, sessions and traces remain private.

## What the existing API establishes

`PI_PARITY_CHILD_HOOKS=1` is a test-only option. The observer discovers the already loaded SDK and pi-subagents entry points through Pi's public source metadata, imports `pi-subagents/required-child-extensions`, and registers the SDK extension for the fixture's children. It does not modify pi-subagents, installed agent profiles, personal settings or authentication.

The real SDK worker then loads its own existing provider hooks and saves a child-owned checkpoint. So the existing API can supply that lifecycle. An upstream change is **not established as necessary** merely to load it.

It is not yet a safe production default. Required extensions apply to all native children of a registered parent, and the API permits one registration per parent. Blanket registration could conflict with another host policy or a non-SDK child's `denyExtensions` ceiling. This experiment does not bypass those restrictions or enable the registration in ordinary SDK sessions.

## The next verified guard

With child hooks loaded, retained resume still stops at the SDK configuration check. The resumed background worker has a changed `preamble` and an added `ponytail` section compared with its original foreground context. These are real instruction changes, not missing history or an authentication error.

The adapter must not ignore those instructions or resume an old native query under a different prompt. Safe continuation needs a validated fresh-context handoff that preserves the current Pi instructions and accepted history. That work is not implemented here; SDK-3 remains open.

## Parent reload fix found by the workflow

Before reaching the child, the new check exposed a separate parent failure. After restart, Pi regenerated its tool-list section in a different order while preserving every tool declaration and every non-tool instruction. The SDK guard incorrectly required a declaration change before using its existing tool handoff.

The adapter now accepts order-only regeneration through the same validated fresh-context handoff when declarations and the exact multiset of guidance lines match. It still reconstructs and verifies the old configuration, checks history/results, and rejects changed environment, output limits, ownership, non-tool instructions and operator overrides of the tool section. The new `reorder`, `reorder-override`, `reorder-override-drop` and `reorder-content` E2Es distinguish allowed ordering from changed/removed instructions. All 17 tool cases passed on Pi 1.2 and 1.3.

## Run the focused checks

```sh
npm --prefix experiments/claude-sdk-provider run test:tools

# Paid real model/host/mobile checks with normal resources.
PI_PARITY_CASES=retained-standard-worker,recorded-identities-and-usage npm run test:provider-parity
PI_PARITY_CHILD_HOOKS=1 PI_PARITY_CASES=retained-standard-worker,recorded-identities-and-usage npm run test:provider-parity
```

These worker checks currently remain red for SDK continuation. A passing Codex baseline or successful checkpoint creation is not a successful SDK resume or full provider-parity result. See [reviewed evidence](../experiments/claude-sdk-provider/verification-worker-continuation.json) and the canonical [gap tracker](provider-gaps.md).
