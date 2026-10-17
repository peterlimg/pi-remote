# Claude Agent SDK documentation and recent releases

Checked October 18, 2026. This is a documentation/release review, not a runtime fix or an account-entitlement determination.

## Current official plan guidance

Anthropic's [Use the Claude Agent SDK with your Claude plan](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan) currently contains two dated updates:

- **June 15, 2026:** “We’ve paused the previously-announced changes to Claude Agent SDK usage.” It then says SDK, `claude -p`, and third-party app usage still draw from subscription limits.
- **October 7, 2026:** Max and Team plans now include monthly API credits covering the Agent SDK, `claude -p`, the Claude API, and Managed Agents. Crucially, the same update says: “You can still use the Claude Agent SDK, claude -p, and third-party apps with your subscription limits.”

These are quotations from the retrieved original page, not search summaries. The page does **not** announce a resumption of the paused change. The credit announcement is not evidence that every SDK call now requires paid extra usage. This review did not independently verify the separate monthly-credit article's eligibility, amounts, or claiming procedure.

## SDK integration and authentication guidance

The current official [Agent SDK overview](https://platform.claude.com/docs/en/agent-sdk/overview) describes the SDK as a library that runs the Claude Code binary, with its agent loop, built-in tools, permissions, sessions, and hooks. It separately describes the Client SDK as direct API access where the application owns the tool loop. For other programming languages it suggests running the CLI with `-p` and JSON output.

The overview also states:

> Unless previously approved, Anthropic does not allow third party developers to offer claude.ai login or rate limits for their products, including agents built on the Claude Agent SDK. Use the API key authentication methods described in the Quickstart instead.

That restriction on offering login/rate limits in third-party products must not be collapsed into a claim that all personal SDK usage is excluded from subscription limits. The plan article explicitly continues to describe subscription usage. Neither page establishes which distinction or enforcement rule applies to this workspace's rejected requests.

Our requested `/agent-sdk/authentication.md` URL returned the overview page, so it is not independent authentication-page evidence. No dated documentation edit establishing an October 16–17 authentication-policy change was verified.

The SDK does not require Pi's prompt or tools. Its installed official `Options` declarations make `systemPrompt` optional and support custom prompts or the `claude_code` preset. The current Pi provider deliberately supplies Pi's prompt, disables SDK built-in tools with `tools: []`, and exposes Pi-owned tools through MCP. That is our ownership decision, not a requirement of the SDK. Letting the SDK own tools would require its permissions, events, and session lifecycle to be integrated rather than silently bypassing Pi's controls.

## Releases newer than this installation

Official npm metadata and [TypeScript SDK releases](https://github.com/anthropics/claude-agent-sdk-typescript/releases) were checked directly. Installed **0.3.296** was published to npm on **October 9, 2026**. Latest **0.3.302** was published to npm at **2026-10-16T16:47:53Z**, and its GitHub release at **2026-10-16T20:52:24Z**.

| Release | Relevant published changes |
| --- | --- |
| [0.3.299](https://github.com/anthropics/claude-agent-sdk-typescript/releases/tag/v0.3.299) | MCP-server handling, rewind behavior, queued-message handling, Claude Code 2.1.299 parity |
| [0.3.300](https://github.com/anthropics/claude-agent-sdk-typescript/releases/tag/v0.3.300) | Transcript import, rewind/compaction behavior, thinking-mode handling, Claude Code 2.1.300 parity |
| [0.3.301](https://github.com/anthropics/claude-agent-sdk-typescript/releases/tag/v0.3.301) | Per-tool SDK MCP permission policies, model switching at usage limits, full-disk login-refresh error reporting |
| [0.3.302](https://github.com/anthropics/claude-agent-sdk-typescript/releases/tag/v0.3.302) | Structured-output refusal handling, default permission-mode changes in certain environments, fork subagents enabled by default |

None of these four SDK release notes names a fix for the exact third-party-app extra-usage HTTP 400. The [Claude Code changelog](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md), through 2.1.302, also does not identify that rejection as fixed. Its nearby authentication fixes concern other conditions, including interrupted token refresh and third-party gateway credentials. An upgrade is therefore not a verified billing fix, and its permission/subagent changes require boundary checks before adoption.

The public SDK repository comparison between these versions lists only changelog changes; it is not a complete source-code diff of the bundled Claude Code binary. The SDK README's most recent listed edit was December 9, 2025, not an October 2026 billing-policy update.

## Implications for the reported failure

The local [billing investigation](claude-agent-sdk-billing.md) records real API rejections for full Pi requests and successful minimal-system SDK diagnostics. A later comparison found identical saved Pi prompts and tool declarations in the successful original conversation, failed recovery, and fresh failed SDK conversation, with unchanged SDK/bundled CLI versions. That narrows the evidence but does not identify a changed server-side rule.

The current help page supports neither a blanket requirement to buy extra usage nor a claim that Anthropic publicly resumed the paused SDK billing change. The API's rejection and the advertised plan access need account/request-specific reconciliation. Do not infer a particular classifier from prompt-sensitive results, or discard required instructions merely to obtain a successful diagnostic response.

A native SDK-agent mode is a separate architecture worth evaluating if the user wants Claude Code's agent rather than Pi's tools and extensions. It is not proven to remove this rejection, preserve Pi capabilities, or safely resume existing Pi conversations.

## Retrieval and verification

The background researcher's fetch tool initially blocked the official domains because local DNS resolved them to TUN/fake-IP addresses in `198.18.0.0/15`. Its search summaries were discovery evidence only. The parent subsequently retrieved the original help and SDK overview pages successfully with ordinary public HTTPS `curl` requests, without changing DNS/network settings, credentials, or billing. This report supersedes the initial blocked-fetch-only draft.

Public-source artifacts are retained under `/tmp/pi-sdk-docs-current/`, including the help-page HTML/text, SDK overview HTML/text, GitHub release metadata, Claude Code changelog, npm version timestamps, and SDK README history. The file named `sdk-authentication.md` is HTML for the overview, as noted above. No private prompt or credential is required to reproduce this documentation review.

Only documentation changed. No inference probes, package upgrades, account changes, or runtime changes were performed for this review; the unresolved risk is the workspace's actual request eligibility.
