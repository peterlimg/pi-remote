# SDK billing rejection investigation

Investigated October 17, 2026, with SDK 0.3.296. These are observations for the tested Claude Team login, not a general statement about Anthropic billing policy.

## The request already goes through the SDK

```text
Pi provider → createBridge() → official SDK query() → SDK-managed Claude Code → Claude
```

The [standalone bridge](https://github.com/peterlimg/pi-claude-sdk/blob/main/bridge.ts) defaults to the official `@anthropic-ai/claude-agent-sdk` `query` function. The provider does not send its own Anthropic Messages requests. Authentication uses the official local Claude login. API keys and alternate cloud routing remain rejected.

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

Repeated `/sdk-recover` or a fresh chat with the same full system prompt does not address this reproduced rejection. These initial diagnostics applied no runtime workaround. Replacing Pi's instructions with the diagnostic prompt would discard required behavior and is not a production fix. The structured projection below keeps operator instructions and Pi tool guidance.

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

## Minimized SDK reproduction on October 18

Further isolation reduced the full Pi failure to **67 characters of public documentation text**, with no Pi conversation, tool declarations, MCP server, or agent loop:

```text
providers (docs/custom-provider.md), pi packages (docs/packages.md)
```

In the tested Team workspace, each reference alone returns the requested marker. Combining them in the system prompt produces the same native extra-usage API 400. Listing the filenames without their topic labels also succeeds. This is a request-content-sensitive rejection, not evidence that custom prompts or Pi tools are inherently unsupported.

| Controlled request | Observed result |
| --- | --- |
| Original full SDK-facing Pi system prompt, 33,005 characters | Rejected |
| Neutral system text of the same character length | Accepted |
| Original prompt with only its documentation-reference section omitted | Accepted, diagnostic only; not a proposed production change |
| The 1,417-character documentation-reference section alone | Rejected |
| `providers (docs/custom-provider.md)` alone | Accepted |
| `pi packages (docs/packages.md)` alone | Accepted |
| Both references together, as above | Rejected |

The original Pi prompt and all 14 tool declarations have identical hashes in the last completed checkpoint, failed recovery, and fresh failed SDK session. The successful original native transcript and the fresh failure both identify Claude Code 2.1.296. Tests with the installed Claude Code 2.1.302 executable still rejected the full prompt. An isolated SDK 0.3.302 with Claude Code 2.1.302 also rejected the full prompt and a small documentation-only reproduction. Neither a newer runtime nor an SDK upgrade was demonstrated to fix the restriction.

The shareable [live SDK reproducer](../../experiments/claude-sdk-provider/billing-repro.mjs) tests the first reference, the combination, and the second reference in separate fresh SDK queries. All have the same model, fixed user message, safe local-login environment, disabled tools/settings discovery, and no native transcript persistence. It uses the bridge's environment safety check but does not create the Pi bridge or run a Pi agent. Its prompts and saved results contain no private conversation or credentials.

```sh
node --experimental-strip-types experiments/claude-sdk-provider/billing-repro.mjs
```

This consumes allowance for successful requests. It is an opt-in live reproduction, not a CI test. **It should exit nonzero while this bug is present:** both controls must return `SDK_SESSION_OK`, and it then requires the combined request to work too. A terminal SDK `result` with subtype `success` is not sufficient: these rejected runs can have an earlier assistant event carrying `error: unknown` and the actual API 400, so the reproducer checks the response itself.

The final three-query reproducer confirmed the same sequence on both versions: first reference accepted, combined references rejected with the exact extra-usage message, second reference accepted. SDK 0.3.296 / Claude Code 2.1.296 results are at `/var/folders/tq/7wm5dbm117qdyz056rryqv0r0000gn/T/pi-sdk-billing-repro-BuumGi/result.json`; SDK 0.3.302 / Claude Code 2.1.302 results are at `/var/folders/tq/7wm5dbm117qdyz056rryqv0r0000gn/T/pi-sdk-billing-repro-ZpGxny/result.json`. The newer-version run used an isolated copy of the same script with only its SDK import, version lookup, and supported executable path changed. Both reproductions exited 1 on the intended assertion. The script's syntax check and repository whitespace check passed.

Private isolation artifacts remain under `/tmp/pi-sdk-session-check-20261018/prompt-isolation/`. The full captured prompt remains private. The newer package was extracted under `/tmp/pi-sdk-current-test.ylmhld/`, without upgrading the installed provider.

This narrows an upstream-facing eligibility/billing failure to a small, shareable input. It does **not** reveal Anthropic's internal matching rule, explain which server/account behavior changed since October 16, or establish the behavior on other accounts. The official plan page continues to advertise subscription access. An account/request-specific explanation or correction from Anthropic is still needed. No production instructions, tool permissions, authentication identity, or billing settings were rewritten to evade the rejection; no historical action was replayed.

## Prior public reports found on October 18

This is not a newly reported October-only pattern. A web search followed by original GitHub issue/comment inspection found a direct Pi-specific match:

- **September 5, 2026, [gotgenes/pi-packages #883](https://github.com/gotgenes/pi-packages/issues/883).** The reporter independently bisected the same Pi documentation-routing clauses, `custom providers (docs/custom-provider.md)` and `pi packages (docs/packages.md)`. Each passed alone; together they produced the third-party-app extra-usage API 400 in a minimal SDK request. Their parent and helper calls worked with the same login and binary. This closely matches our independently reproduced input-sensitive failure. The reporter's claim of an internal cumulative classifier is an explanation, not Anthropic confirmation. They later corrected their initial capture-map-isolation explanation; the ordinary inheritance bug was a byte mismatch, as detailed in [their correction](https://github.com/gotgenes/pi-packages/issues/883#issuecomment-5556242452).
- **September 8, [maintainer-confirmed mitigation](https://github.com/gotgenes/pi-packages/issues/883#issuecomment-5592226300).** Repository owner `gotgenes` closed the issue after implementing opt-in portable prompt inheritance in [dba48999](https://github.com/gotgenes/pi-packages/commit/dba48999a8f6eaf7b76a3d471e9b7ddebe1eb35a). For selected re-homing providers, children inherit operator-authored context files, custom prompt and append prompt instead of Pi's assembled harness base. This is scoped to those subagents/providers, not a blanket SDK fix. PR #884 was closed without merging; the owner implemented a narrower configuration surface separately.
- **Current [pi-claude-bridge README](https://github.com/elidickinson/pi-claude-bridge/blob/f0b02cc0fd1bb63741920f797d306b527e549205/README.md#system-prompt-rejections), last README edit October 13.** It documents this rejection and deliberately refuses a forwarded Pi base prompt before sending it. Its normal projection forwards structured context files, skills, custom/appended instructions and custom sections into Claude Code's prompt while retaining Pi tool execution through MCP. Thus the existing mitigation does not require removing Pi tools or replacing Pi with an entirely separate agent backend. The README's two-path guard is conservative: [open PR #148](https://github.com/elidickinson/pi-claude-bridge/pull/148), filed September 29, reports that filenames alone did not trigger its probe, while the full Pi harness did. That agrees with our distinction between the filenames and their surrounding topic labels. The PR is not a shipped fix.

Related, less exact reports corroborate the broader pattern:

- **April 9, [anthropics/claude-code #45911](https://github.com/anthropics/claude-code/issues/45911).** A user supplied a small `claude --append-system-prompt` reproduction that produced the same third-party-app billing-error family, reporting it had worked the day before. It was closed by automation for inactivity on May 22, not with a maintainer-confirmed fix. Its presence in Anthropic's repository is not an Anthropic acknowledgement of the mechanism.
- **July 16, [NousResearch/hermes-agent #65365](https://github.com/NousResearch/hermes-agent/issues/65365).** The author [corrected their initial tool-schema diagnosis](https://github.com/NousResearch/hermes-agent/issues/65365#issuecomment-4988159762): tiny system prompt plus all schemas worked, full system prompt with no tools failed, and three prose sentences jointly triggered an `out of extra usage` 400. The wording differs from our error. A Hermes maintainer [confirmed a partial mitigation on August 15](https://github.com/NousResearch/hermes-agent/issues/65365#issuecomment-5300626014), then [closed the issue September 1](https://github.com/NousResearch/hermes-agent/issues/65365#issuecomment-5491388758), calling prose-rewording fixes an “arms race.” Their API-key recommendation is that project's conclusion, not a statement from Anthropic and not proof that our account must buy usage.

The search identified structured portable-prompt projection with Pi tools retained as an implementation reference. No runtime change was applied during that search. The follow-up implementation below uses Pi's structured transcript sections rather than substituting words in the assembled prompt.

All issue bodies, comments, closure information and the README were retrieved through the public GitHub API. Original artifacts are under `/tmp/pi-sdk-docs-current/prior-reports/`. No private chat, credential, public comment, or issue was submitted. These reports identify an established ecosystem problem and concrete mitigations, but do not prove Anthropic's internal rule or explain our last successful request.

## Pi-owned prompt projection

The provider now uses the official SDK's `claude_code` preset plus a projection of Pi's final structured system message. Only the automatically generated Pi identity and documentation-routing section stay on the Pi side. Tool descriptions and rules, tool-contributed guidelines, project/operator context files, skills, appended text, working directory and extension sections retain their original text and order. Explicit custom prompts and an operator-defined `docs` section are not removed. Pi's canonical system message remains unchanged in the transcript.

This is deliberately narrower than the reference bridge's projection. It retains Pi's generated tool guidance as well as operator-authored inputs. The SDK still has no built-in tools; unchanged Pi schemas are exposed through MCP, and Pi still validates, authorizes and executes every call. Local login, environment safety checks, SDK version and billing configuration are unchanged.

Prompt provenance is checked at the provider boundary. If the provider-facing message no longer matches the captured final Pi prompt, the request fails locally rather than guessing which instructions can be discarded. Opaque inherited prompts containing the known rejected documentation combination also fail before SDK startup. They require a portable prompt from their caller. Arbitrary subagent inheritance is not solved by deleting matching text.

The configuration fingerprint includes the requested SDK preset/append as well as Pi's canonical prompt. Old-format completed checkpoints require explicit `/sdk-recover` confirmation and a new native context. Historical tool calls remain labeled data and are never replayed. Other configuration or history mismatches still fail closed.

Exact recognized billing failures can be retained without a completed checkpoint when their Pi message has zero usage and only the fixed public error text. They are labeled provider rejections, not locally unsent requests. A new user message can reopen the closed bridge and import that failure as history. Unknown SDK errors and unresolved tool calls still require recovery. Foreign-provider error/aborted records without outstanding calls can be imported as historical failures.

The focused RPC/MCP recovery E2E now uses a normal Pi prompt instead of the short custom prompt that hid this bug. Its SDK replay peer rejects the known documentation combination. It checks preserved global/project rules, skills, appended text, late extension/tool guidelines, canonical Pi transcript, permission denial, argument validation, same-worker retries, unknown-error rejection, explicit old-checkpoint migration and no historical execution. The focused E2E passed on Pi 1.2.0 and installed Pi 1.3.0. A separate real SDK Opus/mobile Chromium run also passed with a normal generated Pi prompt, one synthetic Pi-owned tool call, follow-up recall after reload, and an idle provider round-trip in one native session. That first live check used isolated configuration.

After pushing `b07002c`, the installed checkout was fast-forwarded and a fresh mobile Chromium conversation was created through the configured opentunnel host in the normal Pi Remote project. Real SDK Opus read one scratch file through Pi, returned its random marker and recalled it after a browser reload without another tool call. All 14 normal Pi tools remained declared. Pi retained its canonical documentation section, while the saved checkpoint matched the exact projected SDK preset/append fingerprint. The shared host PID and personal settings stayed unchanged; the owned verification worker was closed. No diagnostic prompt or recovery was sent to the original chat. See [recorded follow-up evidence](../../experiments/claude-sdk-provider/verification-recovery.json).

The public upstream reproducer should still fail until Anthropic fixes the content-sensitive rejection. Existing workers must reload the provider; old native prompt snapshots still require explicit recovery confirmation.

## Evidence and reproduction

Private local evidence: `/tmp/pi-sdk-billing-check.GdTkgH/` contains filtered `metadata.json`, `bundled.json`, `installed.json`, `rpc-recovery.json`, `prepared-chat.json`, and their diagnostic scripts. It contains no exported authentication secrets. The scripts were diagnostic work, not a runtime patch.

The existing bridge check is reproducible from `experiments/claude-sdk-provider`:

```sh
PI_SDK_TEST_MODEL=claude-sonnet-5-5 node live.mjs allow
```

It makes real SDK requests and consumes the account's allowance. Its result is at `/var/folders/tq/7wm5dbm117qdyz056rryqv0r0000gn/T/pi-sdk-provider-live-oKauVk/evidence.json`.

Related first-party documentation is [SDK plan access](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan) and [monthly API credits](https://support.claude.com/en/articles/17154008-monthly-api-credits-for-max-and-team-plans). Initial retrieval was blocked and search summaries were inconclusive. On October 18, the original plan article was retrieved successfully: its June 15 update pauses the announced SDK billing change, and its October 7 credit announcement explicitly says SDK, `claude -p`, and third-party apps can still use subscription limits. The separate monthly-credit article's detailed conditions remain unverified. See the [current documentation and release review](claude-agent-sdk-docs-changes.md). These general statements do not explain this workspace's request-specific rejections or establish that buying extra usage will fix them.
