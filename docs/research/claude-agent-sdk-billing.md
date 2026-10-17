# SDK billing rejection investigation

Investigated October 17, 2026, with SDK 0.3.296. These are observations for the tested Claude Team login, not a general statement about Anthropic billing policy.

## The request already goes through the SDK

```text
Pi provider → createBridge() → official SDK query() → SDK-managed Claude Code → Claude
```

`experiments/claude-sdk-provider/bridge.ts` defaults to the official `@anthropic-ai/claude-agent-sdk` `query` function. The provider does not send its own Anthropic Messages requests. Authentication uses the official local Claude login. API keys and alternate cloud routing remain rejected.

The failed recovered conversation reached a new native SDK session with the expected identity. Claude then returned:

> API Error: 400 Third-party apps now draw from extra usage, not plan limits. Ask your workspace admin to add more and keep going.

The SDK classified that response as `unknown`. Native transcript inspection found zero tool calls and zero generated output tokens in that attempt. Neither the interruption guard nor a tool replay caused this rejection.

That response alone does **not** prove the user must buy extra usage. Later checks succeeded without enabling it.

## Subsequent controlled checks

All checks used the same local first-party login. Read-only SDK account/usage controls reported a Team subscription, available plan limits, and extra usage disabled. No credentials were extracted or copied, no API-key routing was enabled, and no billing settings changed.

| Check | Result | Limit |
| --- | --- | --- |
| Direct official SDK, bundled CLI 2.1.296 | Requested marker returned successfully | No Pi adapter, tools, or conversation history |
| Direct official SDK, installed CLI 2.1.302 | Requested marker returned successfully | Supported SDK executable override, not an interactive CLI billing workaround |
| Existing `live.mjs allow`, Sonnet 5.5 | Two synthetic Pi-owned tool calls and follow-up recall passed | Pi agent-core check, not the phone host |
| Real installed Pi 1.3.0 RPC, Sonnet 5.5 High | Completed checkpoint, interruption guard, `/sdk-recover`, prior-marker recall, and new native checkpoint passed | Synthetic incomplete Pi history, not a killed native MCP execution |

The real RPC recovery check appended a synthetic user/tool-use tail to its own scratch session after a completed turn. It did not execute that historical call. Ordinary continuation refused it; explicit confirmed recovery imported it as unknown historical data into a new native SDK context. The model recalled the earlier marker, no tool executed, and the prior scratch history stayed unchanged.

SDK-reported costs in these checks are estimates, not billing statements. A successful request while extra usage is disabled does not establish which included credit or allowance funded it.

## What the earlier scratch checks established

- There is no missing SDK integration to add. Both the direct SDK and the Pi bridge succeeded with isolated, small system prompts.
- The bundled CLI version alone does not explain the earlier rejection; both tested versions succeeded.
- The current account does not have a blanket requirement to enable paid extra usage before any SDK request can work.
- Small-context native recovery is supported by a real SDK/RPC check, not only protocol replay.

Those small scratch checks did not establish the cause of the request-specific rejection or prove that the original conversation could complete. The full-prompt checks below narrow the triggering input. Do not guess at entitlement flags, impersonate another application, switch credentials, or enable paid usage to force a pass.

The affected original chat was prepared for another explicit SDK context recovery after the failed request. Only its recovery decision was appended. No diagnostic model prompt was sent there, no old tool was rerun, and the missing command result remains unknown.

## October 18 full-prompt reproduction

The phone's latest `hi` reached a new native SDK context and received the same API 400. It did not fail the stale recovery-approval guard. The native transcript recorded zero input/output tokens and no tool calls for that rejected response. The older stale-approval error remains visible history; the current recovery E2E accepts that known local rejection and completed foreign-provider turns.

A private copy of the affected session reproduced the exact extra-usage error through installed Pi 1.3.0, normal resources, and the installed provider. A diagnostic preflight blocked all tool execution. The original session and personal settings remained byte-for-byte unchanged.

Controlled direct SDK checks then held the captured recovery input, model, local login, output cap, and tool availability constant, changing only the system prompt:

| SDK request | Result |
| --- | --- |
| Captured recovery text and image, minimal diagnostic system prompt, no tools | Requested marker returned |
| Identical recovery input, full Pi system prompt, no tools | Exact extra-usage API rejection |
| Tiny fresh input, full Pi system prompt, no tools | Same API rejection |
| Approximately 145,000 input tokens of synthetic history, minimal system prompt | Requested marker returned |
| Existing live Pi bridge check, small system prompt and synthetic MCP tool | Two Pi-owned calls and follow-up recall passed |

The captured full system prompt was 33,005 characters. These checks isolate its content or structure as a trigger in this environment, rather than interrupted history, image presence, MCP execution, a blanket SDK-login failure, or the tested input sizes. They do not identify a particular prompt passage, establish Anthropic's intended billing policy, or prove an entitlement change is required. The successful calls still reported extra usage disabled. No credentials or billing settings changed, and no other application's identity was asserted.

Repeated `/sdk-recover` or a fresh chat with the same full system prompt does not address this reproduced rejection. No runtime workaround was applied. In particular, replacing Pi's instructions with the diagnostic prompt would discard required behavior and is not a production fix.

Private evidence is under `/tmp/pi-sdk-session-check-20261018/`. `rpc-copy.json`, `captured-simple.json`, `captured-system.json`, and `captured-small.json` contain filtered outcomes. `private-payload.json` and `copied-session.jsonl` contain private conversation data and must not be shared. The diagnostic scripts preserve the comparison:

```sh
# Exact real-Pi reproduction on a private session copy; expected to reject.
node /tmp/pi-sdk-session-check-20261018/rpc-copy.mjs
# Same captured recovery input, differing only in the system prompt.
node --experimental-strip-types /tmp/pi-sdk-session-check-20261018/probe.mjs captured-simple
node --experimental-strip-types /tmp/pi-sdk-session-check-20261018/probe.mjs captured-system
# Small input still rejects with the full system prompt.
node --experimental-strip-types /tmp/pi-sdk-session-check-20261018/probe.mjs captured-small
```

Successful probes consume the account's allowance; SDK cost estimates are not billing statements. The negative checks exit nonzero because they require a successful marker and instead receive the exact native rejection. The focused `test:recovery` E2E also passed separately without model calls. No production prompt, recovery decision, or session history was modified by this investigation.

## Evidence and reproduction

Private local evidence: `/tmp/pi-sdk-billing-check.GdTkgH/` contains filtered `metadata.json`, `bundled.json`, `installed.json`, `rpc-recovery.json`, `prepared-chat.json`, and their diagnostic scripts. It contains no exported authentication secrets. The scripts were diagnostic work, not a runtime patch.

The existing bridge check is reproducible from `experiments/claude-sdk-provider`:

```sh
PI_SDK_TEST_MODEL=claude-sonnet-5-5 node live.mjs allow
```

It makes real SDK requests and consumes the account's allowance. Its result is at `/var/folders/tq/7wm5dbm117qdyz056rryqv0r0000gn/T/pi-sdk-provider-live-oKauVk/evidence.json`.

Related first-party documentation is [SDK plan access](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan) and [monthly API credits](https://support.claude.com/en/articles/17154008-monthly-api-credits-for-max-and-team-plans). Initial retrieval was blocked and search summaries were inconclusive. On October 18, the original plan article was retrieved successfully: its June 15 update pauses the announced SDK billing change, and its October 7 credit announcement explicitly says SDK, `claude -p`, and third-party apps can still use subscription limits. The separate monthly-credit article's detailed conditions remain unverified. See the [current documentation and release review](claude-agent-sdk-docs-changes.md). These general statements do not explain this workspace's request-specific rejections or establish that buying extra usage will fix them.
