# Standalone SDK package

Pi Remote loads the Claude SDK provider from Pi's package settings, not from its own extension. The maintained adapter is [peterlimg/pi-claude-sdk](https://github.com/peterlimg/pi-claude-sdk). The current integration pin is `v0.1.0`, commit `bd9e41b2ba5ca2061099aaab56c496c2b454ea8e`; the underlying Agent SDK stays at 0.3.296.

```sh
pi install git:github.com/peterlimg/pi-claude-sdk@bd9e41b2ba5ca2061099aaab56c496c2b454ea8e
```

Do not keep a second declaration for the old local `pi-remote/experiments/claude-sdk-provider` package. Provider IDs and checkpoint entry formats stay unchanged. The default provider/model, unrelated packages, filters, permissions and authentication do not need to change.

## Existing installations

Stage and verify the pinned package before replacing the old package declaration in the same position. Pi's public `DefaultPackageManager.install()` installs without persisting a declaration; `SettingsManager.setPackages()` and `flush()` can then replace that single entry without a duplicate-provider window. Re-read settings before saving, preserve object-form package filters and reject unrelated concurrent changes. Do not rewrite the entire settings file from an old snapshot.

Package settings are read by each Pi worker. New sessions use the new package; already-running workers keep their loaded code until an idle reload or replacement. A phone-browser refresh alone does not replace that worker. Do not interrupt an active SDK turn, restart unrelated workers or request recovery merely to change a package path. The Pi Remote host does not need a restart for this source-only change.

An existing chat still needs its valid completed checkpoint and matching configuration. Moving the code does not approve changed instructions, unknown effects or missing results.

## Integration ownership

`experiments/claude-sdk-provider/package.json` pins the external dependency. Its extension manifest and TypeScript check target that dependency, and its replay fixture imports the package directly. CI runs those Pi Remote RPC integration E2Es rather than the archived bridge unit suite. The old implementation and early direct-SDK scripts remain research snapshots; new adapter fixes belong in the standalone repository.

When advancing the pin, update the dependency/lock and the installed Pi package source together. The paid [provider acceptance runner](provider-parity.md) verifies the SDK command's package source on each parent reopen, so an old local implementation cannot silently pass as the pinned package.

## Migration verification

The source-only migration passed with normal personal resources and SDK Haiku on Pi 1.3:

- A scratch chat read one unknown marker using the old local package and saved a completed SDK checkpoint. After changing only the package source and replacing that owned worker, it recalled the marker without tools. The native SDK context and byte-for-byte audit prefix were preserved.
- The real mobile Chromium journey passed eight selected rows: instructions, file tools, permission denial, reload/history, owned-worker restart, default-placement parallel delegates, the normal foreground worker, and recorded IDs/usage. The parent began with 12 active tools. Nine other rows were skipped, not passed.
- Source metadata identified the pinned Git package on every checked SDK parent reopen. The post-migration acceptance run left settings unchanged; only the intended package source changed during migration. No original chats or children were restarted, prompted or recovered.
- The packaged replay checks passed all ten prompt cases on Pi 1.2 and 1.3, five selected tool cases on 1.2, and recovery plus three selected clone cases on 1.3. Compatibility-entry discovery and strict checks passed. A fresh dependency install also passed with personal Git/npm configuration and SSH credentials disabled.

These are focused migration checks, not full provider parity or an observed CI result. Raw prompts, transcripts, settings snapshots and browser traces remain private. Keep unresolved SDK behavior in the [canonical gap tracker](provider-gaps.md).
