# Claude Agent SDK integration with Pi

Checked October 13, 2026 against Anthropic's live documentation, installed Pi 1.1.0, and this repository.

For the SDK interfaces, ownership diagram, and Pi provider design, see the [integration blueprint](claude-agent-sdk-integration.md).

## What changed

Anthropic's [Help Center article](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan) says:

- The June 15 update paused previously announced Agent SDK usage changes. SDK, `claude -p`, and third-party app usage continued drawing from subscription limits.
- The October 7 update added monthly API credits for Max and Team plans. It also says SDK, `claude -p`, and third-party apps can still use subscription limits.

The [API-credit article](https://support.claude.com/en/articles/17154008) lists $100 for Max 5x and $200 for Max 20x. Team credits are pooled and capped at $500 monthly. Credits must be claimed into a linked Console organization. SDK calls authenticated with that organization's API key use API credits; calls authenticated through a Claude plan use plan limits instead.

The current Help Center explicitly says SDK and third-party app usage can use subscription limits. In the linked [HN discussion](https://news.ycombinator.com/item?id=49997143), [luketaylor clarified](https://news.ycombinator.com/item?id=49999702) that `claude -p` had not been removed from subscriptions, and [cjav_dev linked the corrected docs](https://news.ycombinator.com/item?id=49999756). The HN replies primarily clarify billing continuity; the Help Center is the explicit source for third-party app usage.

Both the [SDK overview](https://code.claude.com/docs/en/agent-sdk/overview) and [quickstart](https://code.claude.com/docs/en/agent-sdk/quickstart) retain conflicting prior-approval wording. The earlier version of this note overstated that as a blocker to using the official SDK with a subscription. The newer, explicit support clarification supports that route. It does not establish permission to extract subscription credentials and use them for direct model API calls outside the SDK, or endorse every possible adapter design.

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

## What Amp does

Amp's October 10, 2026 [announcement](https://ampcode.com/news/use-your-claude-plan) states: "Under the hood, this mode uses the Claude Agent SDK instead of Amp's own agent."

Its [Claude subscription documentation](https://ampcode.com/docs/the-dial#use-your-claude-subscription) describes:

- A separate **Claude Code** mode, selected when starting a thread. Amp's general mode rule fixes the mode after the first message.
- Claude Pro/Max subscription linking for hosted orbs. Local runners and the CLI use the machine's Claude Code installation and login, requiring version 2.1.276 or later. Amp's local Claude mode does not support API keys.
- Amp's orbs, runners, thread sharing, portals, multiplayer, and thread-to-thread messaging remain available around the SDK agent.
- Oracle, Librarian, and Illustrator are excluded to avoid additional Amp charges. Claude Code's plan mode, todo tool, and notebook editing are disabled. Painter still uses Amp credits, and hosted orb compute is separate from the Claude subscription.

```text
Amp normal mode: Amp UI / services -> Amp agent -> model
Amp Claude mode: Amp UI / services -> Claude Agent SDK -> Claude
```

This is an external-agent mode, not a claim that Amp feeds subscription tokens into its ordinary model provider. The public docs establish that architecture. A later [static inspection with REA and bun-unpacker](amp-sdk-static-analysis.md) recovered the SDK relay from Amp's published executable. It confirms waiting MCP handlers, tool-result correlation through `extra._meta["claudecode/toolUseId"]`, SDK resume options, and reconnect checkpoints. These are observations of shipped code, not live Amp tests.

For Pi Remote, following Amp means adding a distinct SDK-backed session runtime, preserving the remote UI but mapping SDK sessions, events, permissions, and cancellation. That differs from the Pi-provider experiment below, which retains Pi's agent loop. The experiment is still technically promising, but Amp is not evidence that Pi-style history restoration or that specific tool-handoff technique is solved. Keep SDK-native sessions separate initially rather than promise arbitrary mid-session switching.

## Recommended paths

### Use Claude models and the new API credits

Use Pi's existing `anthropic` provider with an API key from the Console organization that received the credits. No Agent SDK dependency or provider implementation is necessary. Select API-key authentication through `/login`; an existing stored OAuth credential can take precedence over an environment API key.

The installed implementation is `@earendil-works/pi-ai/dist/providers/anthropic.js`; it delegates to the Anthropic Messages implementation. Provider setup and credential precedence are documented in installed Pi's `docs/providers.md` and `docs/models.md`.

This preserves Pi's tools, extensions, session tree, and model switching. Billing eligibility still depends on the user's linked Console organization and claimed credits.

### Use Claude's complete agent through Pi

Start with a separate Pi extension tool or command that invokes the SDK for an explicit task. Let the SDK own that task's loop and history rather than pretending it is one model completion. Keep it separate from the default model provider.

The SDK supports custom MCP tools through `createSdkMcpServer()`, permission callbacks, streaming, and session resume. Pi supports extension tools and nested execution through `ctx.executeTool()`. A delegated tool could expose a deliberately limited set of Pi tools to the SDK through MCP and preserve Pi validation and tool hooks. Disable unwanted SDK built-ins; do not leave a second unrestricted file or shell execution path. This is a proposed design, not a tested integration.

### Require an SDK entry in `/model`

A custom provider registered through `pi.registerProvider()` is the right Pi entry point. The live experiment below proved a single-tool handoff through Pi's actual agent loop, including Pi permission denial and cooperative cancellation. That makes the adapter technically plausible without replacing Pi's tools.

Remaining requirements:

1. Prove Pi history can be restored after restart, branch changes, compaction, and switching away from and back to this provider. An SDK session ID alone is not sufficient.
2. Extend the single-call bridge to parallel tools, concurrent sessions, and recovery without duplicate execution.
3. Map partial text, thinking, images, usage, failures, and request instrumentation to Pi's stream contract. Account for the SDK's own retries and compaction.
4. Verify authentication in terminal and RPC workers without exposing credentials to the mobile browser.

Do not assume `maxTurns: 1` turns the SDK into a stateless completion API. The [TypeScript reference](https://code.claude.com/docs/en/agent-sdk/typescript) defines it as a limit on agentic turns, not an external tool-execution contract.

## Pi Remote impact

A correctly registered Pi provider should need no model-picker redesign:

- `extension/index.ts` discovers models through `ctx.modelRegistry.getAvailable()` and selects them through `pi.setModel()`.
- `src/rpc.mjs` uses `get_available_models` and `set_model` for host-owned workers.
- `src/commands.mjs` passes through provider, model ID, and display name without a provider allowlist.

Authentication remains on the local host. Mobile model discovery and selection would still need verification in both bridge and RPC modes.

## Live experiment results

On October 13, 2026, tested Agent SDK 0.3.296 with Claude Code 2.1.296 and Pi agent-core/AI 1.1.0. The SDK's `haiku` alias resolved to `claude-haiku-5-5`. Experiments used synthetic prompts and one in-memory tool in a temporary directory, with built-in tools and project/user settings disabled. Pi configuration was unchanged.

| Experiment | Observed result |
| --- | --- |
| Existing Claude login, no Anthropic API key | Requests succeeded using the local first-party Team login; SDK reported `apiKeySource: none` |
| Partial streaming | Received content deltas and the expected exact response |
| SDK session resume | A new query recovered a random marker from the preceding query's saved history |
| SDK MCP tool | Handler executed once and Claude returned its random token |
| `maxTurns: 1` | Tool still executed once, then SDK returned `error_max_turns` |
| Pi-owned execution | Real Pi `Agent` ran one preflight and one tool execution across two provider calls; Claude returned Pi's token |
| Pi permission denial | Pi blocked execution, returned the denied result to the SDK, and Claude answered DENIED |
| Pi cancellation | Explicit SDK close plus an early abort-signal check produced an empty aborted Pi response, with no subsequent SDK reads |

The handoff works by making the SDK's MCP handler wait rather than execute the tool:

```text
SDK tool_use -> Pi toolCall -> Pi validation / permissions / execution
                           -> Pi toolResult -> resolve waiting MCP handler
                                            -> SDK final answer
```

Direct SDK cancellation was surprising: aborting during the cooperative tool handler still produced an assistant reply and a success result before throwing ordinary `Error: Claude Code process aborted by user`. This happened twice. A provider must not treat that success result as overriding a user's cancellation. Closing the SDK and checking an already-aborted Pi signal before consuming more SDK events avoided showing that reply in the bridge experiment.

All three final Pi bridge scenarios passed. Reproducible scripts, pinned dependencies, synthetic transcripts, and detailed limitations are archived on the [experiment branch](https://github.com/peterlimg/pi-remote/tree/328a4fe/experiments/claude-agent-sdk), not installed as a production provider.

## Verification boundary

The experiment validates one live query and one synthetic tool, not a general SDK provider. It did not test transcript replay into a restarted bridge, Pi branch/compaction mapping, model switching, parallel tools, images, mobile model discovery, or real shell/file side effects. The bridge buffers complete assistant messages and zeroes Pi-side usage; partial event mapping and billing accounting remain unimplemented. SDK resume succeeded separately, but does not establish compatibility with Pi history. Reported authentication success does not verify which billing balance was charged or establish approval of this particular Pi adapter. Current support documentation explicitly permits subscription usage through the SDK and third-party apps; Amp provides a documented example of an SDK-native integration.
