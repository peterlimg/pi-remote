# Tree navigation for Claude SDK

Pi can move between validated paths in a saved SDK session without creating another file. Selecting a user or custom message excludes it and returns its text to Pi's editor. Other entries continue after the selected point. The SDK receives only that selected projection, plus a branch summary if requested.

```text
validate completed outgoing history
  -> validate destination from its checkpoint or a completed descendant
  -> persist navigation intent
  -> Pi optionally summarizes the abandoned path, then changes its leaf
  -> persist selected-source/projection/configuration receipt
  -> next message opens a fresh native SDK context
```

## Context and execution

Each move, including a return to an abandoned branch, opens a new native conversation. It never resumes an old native checkpoint midway through its transcript. Earlier Pi audit entries and native SDK transcripts remain preserved. Subsequent worker restarts resume the new branch's own completed checkpoint.

A destination can use its own SDK checkpoint or a later accepted prefix from that path. This covers assistant points just before checkpoint publication, queued inputs and completed tool batches. Only the attested system checkpoint travels as configuration context. Later user/assistant bodies stay out of the selected history. Legacy and inherited clone owners use the same configuration checks as [earlier-message forks](sdk-forks.md).

A genuinely SDK-free destination needs no old native configuration. Its foreign history must still validate, and it starts with the current Pi instructions and normal prompt-provenance checks. This is not permission to drop a configuration that already accepted SDK work.

Historical calls are labeled JSON data, not executable requests. Recorded IDs from all stored branches are retired without sending their omitted content to the model. A new call still follows Pi's unchanged schemas, validation and permissions. Selecting history neither rewinds files nor proves omitted work had no effects. Missing known results, split tool batches, uncheckpointed unknown SDK failures and unfinished outgoing work remain blocked.

## Optional summaries

Pi is the sole summarizer, through its normal isolated, tool-free request and authentication path. The SDK never compacts itself. If a summary is requested, it deliberately carries information from the abandoned branch into the destination. That information is no longer excluded history. Summary prose is context, not an execution receipt or approval to repeat work.

Pi's persisted `branch_summary` remains in the ordinary audit, with its usage and file tracking. The tree receipt binds the resulting model projection. Failed or stopped summaries leave the outgoing branch usable, including after worker restart.

## Publication and restart

`claude-sdk-tree-start` records navigation intent and retired native IDs on the outgoing path. `claude-sdk-tree` records the selected source anchor, history/projection hashes, configuration and owner on the destination. Metadata entries do not enter model context.

A restart after the receipt but before the first new checkpoint validates the selected source and starts independently. A missing or altered receipt cannot silently resume an older native context at the new position. Summary and label publication gaps reject before another SDK request. Without a summary, label or receipt, Pi has not durably moved its leaf, so restart can legitimately remain on the original branch.

The checks cover owned-worker SIGKILL after receipt publication and controlled receipt truncation. They do not prove every partial-filesystem-write or power-loss boundary.

## Verification

```sh
npm --prefix experiments/claude-sdk-provider run test:tree
PI_SDK_TEST_PI=<Pi CLI> npm --prefix experiments/claude-sdk-provider run test:tree

# Paid real models, normal resources and mobile messages.
PI_PARITY_TREE_QUEUED=1 PI_PARITY_CASES=tree-contract,recorded-identities-and-usage npm run test:provider-parity
PI_PARITY_TREE_QUEUED=1 PI_PARITY_TREE_SUMMARY=1 PI_PARITY_CASES=tree-contract,recorded-identities-and-usage npm run test:provider-parity
```

All 59 focused cases passed on Pi 1.2 and 1.3 using real Pi navigation, RPC, projections, persistence, provider, MCP and counted filesystem effects. The external SDK peer is replayed; foreign-provider rows use the existing deterministic control provider, not real Codex. They include returning to abandoned paths, first/queued/tool-boundary points, summaries and summary failure/Stop, compaction and clone combinations, other-provider roots, tools, permissions, invalid arguments, notices, Stop, restart gaps and altered history/configuration.

The shared real-model contract reads an unknown marker and performs early/later effects. It moves within the same file, verifies whether later private data is excluded or explicitly summarized, teaches the alternative branch another value, then returns to each branch after replacing its worker. Old audit entries and physical effects must remain unchanged. Native contexts must be distinct across moves and stable after a branch's own restart. The queued contract passed on real Codex GPT-6.1 Sol, SDK Haiku 5.5 and SDK Opus 5.5, both with and without the optional summary, using the same 14 normal parent tools. Each SDK journey used four distinct parent native contexts across its moves. Filtered runs skip other parity rows; they do not establish full provider parity.

Navigation uses an owned test command calling Pi's public API through RPC. Every provider uses a normal Pi label to persist the selected position before the first worker replacement. Without such an append, a no-summary position may still exist only in memory. The retained initial failures distinguish this fixture error and an ambiguous file-line instruction from provider defects. Mobile Chromium drives reopening and ordinary messages. This does not add or verify a product phone tree picker or the native interactive selector. Child-local lifecycle, physical Safari, live Sonnet and exhaustive crash/combination coverage remain outside this proof. See [reviewed evidence](../experiments/claude-sdk-provider/verification-tree.json) and the canonical [gap tracker](provider-gaps.md).
