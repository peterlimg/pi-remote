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

## What this rules out

- There is no missing SDK integration to add. Both the direct SDK and the Pi bridge currently work.
- The bundled CLI version alone does not explain the earlier rejection; both tested versions succeeded.
- The current account does not have a blanket requirement to enable paid extra usage before any SDK request can work.
- Small-context native recovery is supported by a real SDK/RPC check, not only protocol replay.

The cause of the earlier request-specific rejection is **not established**. These small scratch checks do not prove that the original long conversation now completes successfully. Do not guess at entitlement flags, impersonate another application, switch credentials, or enable paid usage to force a pass.

The affected original chat was prepared for another explicit SDK context recovery after the failed request. Only its recovery decision was appended. No diagnostic model prompt was sent there, no old tool was rerun, and the missing command result remains unknown.

## Evidence and reproduction

Private local evidence: `/tmp/pi-sdk-billing-check.GdTkgH/` contains filtered `metadata.json`, `bundled.json`, `installed.json`, `rpc-recovery.json`, `prepared-chat.json`, and their diagnostic scripts. It contains no exported authentication secrets. The scripts were diagnostic work, not a runtime patch.

The existing bridge check is reproducible from `experiments/claude-sdk-provider`:

```sh
PI_SDK_TEST_MODEL=claude-sonnet-5-5 node live.mjs allow
```

It makes real SDK requests and consumes the account's allowance. Its result is at `/var/folders/tq/7wm5dbm117qdyz056rryqv0r0000gn/T/pi-sdk-provider-live-oKauVk/evidence.json`.

Related first-party documentation is [SDK plan access](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan) and [monthly API credits](https://support.claude.com/en/articles/17154008-monthly-api-credits-for-max-and-team-plans). Full help-page retrieval was blocked by network safety, and indexed summaries disagreed about the billing pools. They were not sufficient to establish this workspace's entitlement. The SDK account controls and successful requests above are the direct evidence for the tested account.
