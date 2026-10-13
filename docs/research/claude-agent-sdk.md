# Claude Agent SDK integration with Pi

Checked October 13, 2026 against Anthropic's live documentation, installed Pi 1.1.0, and this repository.

## What changed

Anthropic's [Help Center article](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan) says:

- The June 15 update paused previously announced Agent SDK usage changes. SDK, `claude -p`, and third-party app usage continued drawing from subscription limits.
- The October 7 update added monthly API credits for Max and Team plans. It also says SDK, `claude -p`, and third-party apps can still use subscription limits.

The [API-credit article](https://support.claude.com/en/articles/17154008) lists $100 for Max 5x and $200 for Max 20x. Team credits are pooled and capped at $500 monthly. Credits must be claimed into a linked Console organization. SDK calls authenticated with that organization's API key use API credits; calls authenticated through a Claude plan use plan limits instead.

However, both the [SDK overview](https://code.claude.com/docs/en/agent-sdk/overview) and [quickstart](https://code.claude.com/docs/en/agent-sdk/quickstart) still say third-party developers need prior approval to offer claude.ai login or rate limits. These pages do not establish blanket permission for a new Pi subscription integration. Confirm the supported authentication arrangement before distributing one. Do not treat existing token support in Pi as evidence of Anthropic approval.

The quickstart's separate reference to "third-party API providers" means cloud access through Bedrock, Claude Platform on AWS, Google Cloud, and Microsoft Foundry. It is not a claim that the Agent SDK runs arbitrary non-Claude models.

## The important technical distinction

The [Agent SDK](https://code.claude.com/docs/en/agent-sdk/overview) launches Claude Code and owns an agent loop, tool execution, permissions, sessions, and context management. Its `query()` streams a whole agent run.

Pi's model provider interface returns one assistant response at a time. Pi then executes requested tools and calls the provider again. Installed Pi's `docs/custom-provider.md` describes this contract, including normalized transcript input, tool-call events, usage, cancellation, and terminal events.

```text
Existing Pi
  Pi session / agent loop
    -> Anthropic Messages API
    <- assistant text or tool calls
    -> Pi tools

Agent SDK
  SDK query / Claude Code process
    -> Claude model
    -> SDK built-in or MCP tools
    -> more model calls
    <- streamed messages and final result
```

Wrapping a whole SDK run as one Pi model response would hide or misrepresent intermediate tools and history. Emitting SDK tool calls as ordinary Pi tool calls after the SDK already executed them could execute mutations twice.

## Recommended paths

### Use Claude models and the new API credits

Use Pi's existing `anthropic` provider with an API key from the Console organization that received the credits. No Agent SDK dependency or provider implementation is necessary. Select API-key authentication through `/login`; an existing stored OAuth credential can take precedence over an environment API key.

The installed implementation is `@earendil-works/pi-ai/dist/providers/anthropic.js`; it delegates to the Anthropic Messages implementation. Provider setup and credential precedence are documented in installed Pi's `docs/providers.md` and `docs/models.md`.

This preserves Pi's tools, extensions, session tree, and model switching. Billing eligibility still depends on the user's linked Console organization and claimed credits.

### Use Claude's complete agent through Pi

Start with a separate Pi extension tool or command that invokes the SDK for an explicit task. Let the SDK own that task's loop and history rather than pretending it is one model completion. Keep it separate from the default model provider.

The SDK supports custom MCP tools through `createSdkMcpServer()`, permission callbacks, streaming, and session resume. Pi supports extension tools and nested execution through `ctx.executeTool()`. A delegated tool could expose a deliberately limited set of Pi tools to the SDK through MCP and preserve Pi validation and tool hooks. Disable unwanted SDK built-ins; do not leave a second unrestricted file or shell execution path. This is a proposed design, not a tested integration.

### Require an SDK entry in `/model`

A custom provider registered through `pi.registerProvider()` is the right Pi entry point, but the adapter needs a feasibility prototype before implementation:

1. Prove a tool call can be handed to Pi, executed exactly once, and returned to the SDK without either agent loop advancing incorrectly.
2. Prove Pi history can be restored after restart, branch changes, compaction, and switching away from and back to this provider. An SDK session ID alone is not sufficient.
3. Map text, thinking, images, tool arguments/results, usage, failures, and cancellation to Pi's stream contract. Account for the SDK's own retries and compaction.
4. Ensure authentication works in terminal and RPC workers without exposing credentials to the mobile browser.

Do not assume `maxTurns: 1` turns the SDK into a stateless completion API. The [TypeScript reference](https://code.claude.com/docs/en/agent-sdk/typescript) defines it as a limit on agentic turns, not an external tool-execution contract.

## Pi Remote impact

A correctly registered Pi provider should need no model-picker redesign:

- `extension/index.ts` discovers models through `ctx.modelRegistry.getAvailable()` and selects them through `pi.setModel()`.
- `src/rpc.mjs` uses `get_available_models` and `set_model` for host-owned workers.
- `src/commands.mjs` passes through provider, model ID, and display name without a provider allowlist.

Authentication remains on the local host. Mobile model discovery and selection would still need verification in both bridge and RPC modes.

## Verification boundary

This investigation inspected documentation and source only. It did not install the Agent SDK, authenticate an account, spend credits, or run a live SDK/model bridge. Before shipping an adapter, test one tool round trip, abort during a tool, resume and branch changes, cross-provider handoff, and mobile discovery/selection. Subscription-login approval remains unresolved by the conflicting public documentation.
