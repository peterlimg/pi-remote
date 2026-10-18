# Pi-owned compaction for Claude SDK

SDK parent sessions now use Pi's normal manual and threshold compaction pipeline. Pi is the only summarizer. SDK-native automatic and idle compaction remain disabled, so this does not enable or claim to fix the earlier Haiku native `ACK_0` failure.

```text
validate accepted Pi history and matched tool results
  -> Pi's normal summarizer, in an isolated tool-free request
  -> Pi appends its compaction entry and rebuilds model context
  -> append SDK receipt binding source, compacted projection and configuration
  -> close the old native query
  -> fresh SDK context receives summary + kept history as JSON data
  -> new calls use current Pi schemas, validation and permissions
```

## Ownership and safety

Pi keeps its original audit entries and standard summary/file tracking. No historical call is replayed, and no successful tool result is invented. The SDK-facing prompt retains the ordinary operator/project instructions. Old native SDK transcripts remain archived under Claude Code's retention rules.

The receipt records hashes, the accepted-prefix boundary, the old configuration fingerprint and the saved Pi compaction ID. Before opening another native query, the bridge checks the original source, retained projection and protected configuration. A verified tool-only declaration change can accompany the handoff; unrelated instruction/environment/output-limit changes remain blocked.

Automatic compaction can run after Pi records a complete tool batch, even before the first completed SDK turn. Pending calls must have recorded results. Accepted SDK tool-use messages alone do not approve missing outcomes. A new context continues remaining work rather than restarting the original task. The same receipt also supports compaction while using another provider and returning to SDK later.

Summary requests have no executable tools, do not use the parent query or its checkpoint, and retain the normal request/authentication path. Pi records summary usage on the compaction entry. A fresh native query starts a new reported-usage baseline without resetting old Pi totals.

Repeated summaries can expose a Pi event quirk: its event may identify an older compaction entry with the same summary text. The adapter binds the latest persisted compaction on the current branch and checks its summary against the event, rather than relying on that older ID.

## Failure and restart boundaries

- Failed or cancelled summarization appends no successful compaction receipt and leaves prior history usable.
- A durable receipt permits restart before the first post-compaction SDK checkpoint. The focused E2E kills only its owned worker with SIGKILL at this boundary.
- A missing/malformed receipt, changed source/summary/configuration or unknown/unmatched work fails before another SDK request. A publication gap requires a fresh session rather than an unverified resume.
- Unknown outcomes still require the existing explicit recovery rules. Switching providers and compacting cannot silently approve an uncheckpointed SDK failure.

## Verification

```sh
npm --prefix experiments/claude-sdk-provider run test:compaction
PI_SDK_TEST_PI=<Pi CLI> npm --prefix experiments/claude-sdk-provider run test:compaction

# Paid real-model phone/Pi checks with normal personal resources:
PI_PARITY_CASES=compaction-contract,recorded-identities-and-usage npm run test:provider-parity
PI_PARITY_COMPACTION_AUTO=1 PI_PARITY_CASES=compaction-contract,recorded-identities-and-usage npm run test:provider-parity
```

The replay E2E uses real Pi RPC, its default compactor, projection/persistence, provider and MCP. Only the external SDK peer is replayed. Its 23 cases cover repeated/manual/automatic compaction, tool activation at the automatic boundary, restart, summary error/Stop, missing/altered receipts and history, provider switches, queued notices and later tool activation/Stop. CI runs this test without model credentials.

Separate live mobile Chromium checks passed manual and automatic compaction with Codex GPT-6.1 Sol, SDK Haiku 5.5 and SDK Opus 5.5 on Pi 1.3. Each reads an unknown marker through normal tools, performs one counted filesystem effect, requires the generated summary to retain the marker, recalls it without tools and repeats that check after replacing its own worker. Automatic tests use bounded inert file data and a project-local 45K threshold; manual tests retain no recent token tail. Personal settings and original chats remain untouched.

See [reviewed evidence](../experiments/claude-sdk-provider/verification-compaction-context.json). Raw traces, prompts and sessions stay private. The first live automatic Haiku attempt retained the marker but refused to reveal it after an ambiguous earlier no-print instruction. The retained failure and clarified one-turn instructions are recorded, not presented as another `ACK_0` memory-loss reproduction.

## Remaining scope

Borrowed foreground workers without provider-local hooks, overflow/length-recovery context edits, partial-file/power-loss failures during receipt publication, physical Safari and overnight stress are not established by this change. Native SDK compaction, forks and tree navigation remain separate work. The [gap tracker](provider-gaps.md) records the remaining items.

Summarization is still lossy. These checks establish particular retained facts and side effects, not preservation of every old detail or perfect interpretation of earlier instructions.
