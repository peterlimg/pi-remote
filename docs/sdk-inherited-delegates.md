# SDK inherited delegate prompts

The normal parallel `delegate` workflow failed before either child reached its SDK query:

```text
Cannot project an inherited Pi base prompt safely. Required instructions were not removed. Use a portable prompt for this SDK call.
```

This was a different path from retained-worker resume. Earlier normal-worker checks used the builtin `worker`, whose prompt mode is `replace`. The builtin `delegate` uses `append`, keeping Pi's generated base prompt.

## Cause

pi-subagents appends its child safety boundary through a legacy `before_agent_start` whole-prompt return. Pi marks that return as `forceSystemPrompt` and presents it to the provider as opaque text. The SDK projector correctly refused to guess which text was generated boilerplate, leaving the known upstream documentation trigger in that text.

The original failed workflow left child placement at its default. Explicitly forcing foreground children reproduced a different failure: their borrowed bridge forwards the whole child prompt and reached the upstream request restriction. Neither failure justifies changing billing, authentication, models or agent profiles.

## Narrow projection

For a forced prompt, the extension supplies the current structured system message from Pi's authoritative session projection. The bridge permits projection only when the complete effective prompt is exactly that canonical base, or that entire base followed by a double newline and additional text.

```text
effective prompt = exact canonical Pi base + unchanged suffix
```

Only the proven generated preamble and default documentation section stay Pi-side. Explicit documentation overrides, custom prompts, tools, project/operator instructions, skills, late extension sections and the entire suffix remain intact. The canonical Pi transcript is not edited.

A changed base, a prepended rewrite or a late input change cannot use this proof. Explicit documentation in a section or suffix is never silently removed. Unknown rewrites retain the existing fail-closed behavior. Canonical and SDK-facing prompt fingerprints still guard checkpoints; this is not permission to resume under changed instructions.

No pi-subagents code, profiles, required-extension registration policy, credentials, personal settings or SDK version changes are needed.

## Verification

```sh
# Credential-free: real Pi hooks, provider, MCP and tool execution; external SDK replay only.
npm --prefix experiments/claude-sdk-provider run test:prompt

# Paid: normal resources, real model services, real builtin agents and mobile Chromium.
PI_PARITY_MODELS=openai-codex/gpt-6.1-sol,claude-sdk/claude-haiku-5-5,claude-sdk/claude-opus-5-5 \
  PI_PARITY_CASES=parallel-inherited-delegates,foreground-standard-worker,recorded-identities-and-usage \
  npm run test:provider-parity
```

The ten focused prompt cases cover exact/append-only overrides, altered/prepended bases, explicit documentation in both sections and suffixes, late input mutation, custom prompts and opaque replacements. They exercise real Pi prompt hooks and require rejected cases to stop before any SDK query.

The shared delegate case uses the original named `parallel` workflow with two builtin `delegate` children and default placement/model/thinking/acceptance. Children count directories and read five real Git commits in scratch data, report their inherited project policy and retain independent conversations. The parent cannot read the task data. The worker regression still performs a real edit, readback and syntax check. Call/result IDs and usage are reconciled.

All three selected model rows passed the final live run with identical normal parent tool sets. Other parity scenarios were skipped, not passed. Reviewed evidence, including the retained red runs and Git-fixture correction, is in [verification-inherited.json](../experiments/claude-sdk-provider/verification-inherited.json).

## Still open

- The borrowed foreground append-mode route lacks child-owned prompt provenance; this change does not add hooks or projection to it.
- Retained-worker continuation and its foreground/background instruction change remain SDK-3.
- Child-local compaction/branching, arbitrary inherited prompts, physical Safari, stress and full provider parity are not established.

Keep the remaining scope in the [canonical gap tracker](provider-gaps.md). Original failed chats and children are not retried or recovered by these tests.
