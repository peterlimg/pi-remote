# Tracing Amp's Claude SDK adapter with REA

Initial artifact checked October 13, 2026; a newer public build is examined in the compaction follow-up below. Static inspection only. Amp was not launched, no credentials were read, and no provider was installed.

## Result

Amp's published macOS executable contains a recoverable JavaScript bundle. The earlier binary-string inspection missed it because the embedded source is UTF-16LE. We recovered minified code, including the Claude SDK relay, without decompiling native instructions.

[REA](https://github.com/morluto/rea) can analyze the extracted JavaScript, but it did not perform the extraction. `bun-unpacker` did that. Reading the recovered adapter was more useful than asking REA to analyze the entire bundle.

The code confirms a waiting MCP handler, a tool-result relay, SDK-native resume, and reconnect checkpoints. It does **not** establish that Amp implements Pi's provider contract.

```text
Amp service
  -> prompt/configuration over executor relay
  -> local Claude SDK query
       -> Claude Code's agent loop
       -> MCP tool request with tool-use ID
            -> relay request to Amp
            <- matching tool result
       <- resolve waiting MCP handler
  <- SDK events with sequence numbers
```

This describes the recovered client-side relay. The server-side executor and its permission decisions were not recovered.

## What the recovered code shows

The names below are minified identifiers from this exact release, not stable public APIs.

| Code | Observed behavior |
| --- | --- |
| `Por.start()` | Creates an async prompt generator and one SDK query for the run. Tracks outstanding tool handlers in a map keyed by call ID. |
| `B0n()` | Converts supplied JSON schemas to Zod object shapes, skips tools it cannot convert, and creates an SDK MCP server named `amp`. |
| MCP handler in `B0n()` | Reads `extra._meta["claudecode/toolUseId"]`, requires a string, and forwards the tool name, arguments, and ID. It returns an error if the ID is missing. |
| `Por.open()`, `tool-result` branch | Removes the corresponding pending entry and resolves its waiting promise with the received result. The MCP handler itself does not execute the tool. |
| `N0n()` | Supplies the executable path, environment, permission mode, tool denylist, model, effort, working directory, and optional SDK resume settings to the bundled SDK query function. |
| `Por.open()`, `attach` branch | Supports reattachment, validates replay checkpoints, replays unacknowledged events and pending tool requests, and replaces an older attachment. |
| `Por.appendEvent()` | Assigns event sequence numbers and enforces a 64 MiB unacknowledged-event buffer limit. Checkpoint acknowledgements prune the buffer. |
| `Por.abort()` | Aborts the controller, wakes the prompt generator, resolves pending tools with an error, and clears their map. |
| `Por.command()` | Forwards interrupt and model-change commands to the live SDK query. |

`N0n()` enables partial messages, uses the `claude_code` system-prompt preset with an appended prompt, and loads `user`, `project`, and `local` settings. It does not use our experiment's `tools: []` or isolated settings configuration. It passes through the configured permission mode and enables the SDK's bypass flag only when that mode is `bypassPermissions`. This relay does not establish which mode Amp's server selects.

SDK resume uses `resume` and, when supplied with it, `resumeSessionAt`. Reconnecting to an existing relay run uses a separate sequence/checkpoint mechanism. These are different operations; neither proves arbitrary Pi transcript restoration.

## Compaction follow-up in the newer public build

The registry's latest public macOS package at the follow-up check was `@ampcode/cli-darwin-arm64@0.0.1792065649-g5a30fc`. It was downloaded with install scripts disabled, unpacked, and inspected as inert source. It was not executed. The relevant declarations were read in full and parsed independently.

| Observed code | Compaction implication |
| --- | --- |
| SDK query factory `Zyn()` | Uses the Claude Code preset plus an appended prompt, and reads `user`, `project`, and `local` settings. It sets no explicit local `autoCompactEnabled` or `autoCompactWindow` override. Policy can therefore come from the CLI, loaded settings, supplied environment/arguments, and the appended prompt. This does not prove auto-compaction is always enabled. |
| Relay `Tar.consume()` | Iterates one live SDK query and forwards each SDK message through its generic event buffer. It special-cases initialization and result receipts, not compaction. A native compact status or boundary is not rejected by this local loop. |
| Relay prompt handling | Preserves the supplied SDK user-message fields, stamps the receipt UUID, and queues the message on the existing async input. This is not Pi-to-SDK history reconstruction. |
| Relay commands | The local command path handles stop, interrupt, and model changes. No dedicated local compact implementation was found there. A backend-supplied prompt could still carry a native command; whether it does is not visible here. |
| SDK resume options | Native `resume` and optional `resumeSessionAt` are passed through. Sequence acknowledgements are separate relay-delivery checkpoints, not context compaction. |
| Configured executable | `pathToClaudeCodeExecutable` and executable arguments come from the supplied executable configuration, rather than necessarily using the SDK's bundled Claude binary. The local factory does not establish the actual selected CLI version. |

The bundled SDK JavaScript declares `CLAUDE_AGENT_SDK_VERSION` as **0.3.276**. Our compaction experiments used SDK **0.3.296** and its bundled Claude Code **2.1.296**. The separately installed local `claude --version` now reports **2.1.300**. These are different comparisons; do not infer that Amp exhibits our automatic `ACK_0` summary failure. A version-matched CLI/client control is the next useful experiment before attributing that failure to the architecture.

Amp's generic observer also has `compaction_started`/`compaction_complete` UI state and cut-message records. The private server translation from SDK messages to those events is not present in this artifact, so this is not proof of SDK-mode history mirroring or summary-quality validation.

### What to borrow, and what not to copy

Borrow the ownership model: keep one SDK conversation alive, forward native compaction events, retain separate receipt/call identity, and resume through the SDK. The local relay does not build its own compaction summary or reconstruct another model history.

Do **not** copy its user/project/local settings loading, SDK tool exposure, or permission configuration into the Pi bridge merely to match it. Pi must retain its tool execution and permission authority. We already tested the Claude Code preset alone and it did not fix the automatic counterexample on our pinned CLI.

This inspection narrows [the compaction research](claude-agent-sdk-compaction.md), but does not prove a safe production Pi implementation. Amp's server-supplied prompts/configuration and live summary quality remain unknown.

### Follow-up evidence

- Package: [`@ampcode/cli-darwin-arm64@0.0.1792065649-g5a30fc`](https://www.npmjs.com/package/@ampcode/cli-darwin-arm64/v/0.0.1792065649-g5a30fc).
- Binary SHA-256: `f47b67a260564ab2c5d3500733dc769ac630fa18898880d5af0c5ca26d938895`.
- Decoded UTF-8 SHA-256: `c57344562d2a01c61624c684c8e38eb43644c27c247be1e018cfa000a052f86b`.
- Original UTF-16 ranges, end-exclusive: `Tar` at `2642577..2648480`, `Zyn` at `2649396..2650182`.
- Private extraction and selection manifest: `/tmp/amp-compact-static.I2IxfG`. Proprietary recovered code remains local and is not committed.
- A whole-bundle parse under a 1 GiB heap limit exhausted memory. Targeted complete declaration parsing then succeeded; no complete application graph or private backend analysis is claimed.
- No live Amp, model inference, permission bypass, or active-session compaction was performed.

## What this changes for Pi

The MCP handoff resembles the one our live experiment already demonstrated. Amp leaves the SDK in charge of the agent loop, while our proposed provider must pause that loop at Pi's tool-execution boundary.

The new lead is `extra._meta["claudecode/toolUseId"]`. Amp checks this field instead of guessing tool identity from names or arguments. Test it with our pinned SDK and Claude Code versions, including parallel identical calls. Treat it as an observed implementation detail until its support contract is established. The SDK declaration still types the handler's `extra` argument as `unknown`.

Amp's reconnect bookkeeping is also worth learning from. A disconnected UI need not mean a cancelled query. Pending prompts, outstanding tools, and acknowledged events need separate state. That is a design observation from the code, not a runtime verification of Amp's recovery guarantees.

## Reproduce the extraction

Work in a temporary directory. These commands download the public package but do not run Amp. The unpacked program and REA evidence may contain proprietary source; keep them local.

```bash
mkdir amp-static && cd amp-static
npm init -y
npm install --ignore-scripts --omit=optional --save-exact \
  rea-agents@6.4.0 bun-unpacker@0.12.1 @babel/parser@8.0.4
npm pack @ampcode/cli-darwin-arm64@0.0.1791864325-g52e626 \
  --ignore-scripts
mkdir native
tar -xzf ampcode-cli-darwin-arm64-0.0.1791864325-g52e626.tgz -C native
./node_modules/.bin/bun-unpacker native/package/amp --list --json > manifest.json
./node_modules/.bin/bun-unpacker native/package/amp \
  --path-patching false --out unpacked --json > extraction.json
```

For this release, the source entry is `amp-darwin-arm64`, with no `.js` extension. The extractor reports it as data. Decode it, verify the byte-for-byte round trip, and give it a JavaScript extension:

```python
from pathlib import Path

raw = Path("unpacked/amp-darwin-arm64").read_bytes()
source = raw.decode("utf-16-le")
assert source.encode("utf-16-le") == raw
Path("amp-js").mkdir()
Path("amp-js/amp.mjs").write_text(source, encoding="utf-8")
```

The manifest also identifies JavaScriptCore bytecode and a native keyring addon. Neither was needed for this investigation.

## Use REA on the relevant code

An attempted whole-bundle analysis exhausted the worker heap with `--max-heap-mb 1536`. REA returned partial evidence and exit code zero. **Check coverage and limitations, not just the exit status.**

For this release, these six top-level declarations isolate the relay. Parse the bundle as inert syntax, preserve their original scope and order, and record source offsets. Never import or execute the recovered bundle.

```js
// Save as select-adapter.mjs, then run with Node.
import { parse } from '@babel/parser';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';

const source = readFileSync('amp-js/amp.mjs', 'utf8');
const names = new Set(['Dor', 'O0n', 'Por', 'P0n', 'B0n', 'N0n']);
const nodes = parse(source, { sourceType: 'module' }).program.body
  .filter(node => names.has(node.id?.name));
assert.equal(nodes.length, names.size);
mkdirSync('focused', { recursive: true });
writeFileSync('focused/sdk-relay.mjs',
  nodes.map(node => source.slice(node.start, node.end)).join('\n'));
writeFileSync('selection.json', JSON.stringify(nodes.map(node => ({
  name: node.id.name, startUtf16: node.start, endUtf16: node.end,
})), null, 2));
```

```bash
./node_modules/.bin/rea analyze-javascript-application "$PWD/focused" \
  --max-heap-mb 1024 --analysis-timeout-ms 60000 --format json > evidence.json
```

We analyzed a formatted version of this selection. It parsed without failures and produced 1,537 semantic nodes and 1,316 relations. It still reported unknown/partial semantic coverage. The selection excludes dependencies, SDK internals, and server code, so it cannot represent the entire application.

For a semantic query, save the **whole** evidence record in the input, not just its ID. Separate CLI invocations do not share retained evidence:

```js
// Save as prepare-trace.mjs, then run with Node.
import { readFileSync, writeFileSync } from 'node:fs';
writeFileSync('trace-input.json', JSON.stringify({
  application: JSON.parse(readFileSync('evidence.json', 'utf8')),
  query: {
    seed: { kind: 'property', name: 'claudecode/toolUseId' },
    direction: 'forward-influence',
  },
}));
```

```bash
./node_modules/.bin/rea trace-javascript-semantics trace-input.json \
  --format json > trace.json
```

That query found the property slot but returned `ambiguous`, with one node and no traversed relations. A literal seed for the same text matched nothing. This is a useful limit of the analyzer: reading the original function establishes what it does, while the graph does not recover the complete correlation flow.

REA's [JavaScript workflow documentation](https://github.com/morluto/rea/blob/fa0a9b2d328a07d8ec2924dc224d51c620981dcc/docs/javascript-application-workflows.md) also describes callers, ownership, feature traces, and version comparisons. Use the installed CLI's `--help` for flags; this run used `--format json`.

## Evidence and limits

- Artifact: [`@ampcode/cli-darwin-arm64@0.0.1791864325-g52e626`](https://www.npmjs.com/package/@ampcode/cli-darwin-arm64/v/0.0.1791864325-g52e626).
- Binary SHA-256: `bb27d604d2e796f20b02a8587bbe738357ab78b15e6c65ff2a1c8252c5c0e1a8`.
- Decoded UTF-8 bundle SHA-256: `b648fb0f63927de7f937d5cd64880dc1d91c1d365d999d7ecd449392a2898629`.
- Original UTF-16 code-unit ranges, end-exclusive: `Por` at `2637320..2643074`, `B0n` at `2643181..2643990`, `N0n` at `2643990..2644776`.
- Tools: REA 6.4.0, bun-unpacker 0.12.1, Babel parser 8.0.4, Prettier 3.6.2 for local readability.
- Local working directory: `/tmp/rea-inspect.6nawA9`. Extraction manifests, selections, REA evidence, and traces remain there, not in this repository.

We recovered shipped minified JavaScript, not Amp's original TypeScript, source maps, or private backend. No live Amp session, billing, permissions, parallel calls, or reconnect behavior was tested. The public package's license reserves Sourcegraph's rights; this note records findings and reproduction steps without publishing the recovered implementation.
