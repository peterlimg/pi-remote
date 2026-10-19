# Reply retry feedback

A failed provider attempt is not a final failed reply while Pi can still retry. The phone shows a quiet `Retrying reply…` activity label during retries and shows `Reply failed. Try again.` only after a failure settles. Successful and cancelled retries clear the transient warning; failures from earlier user turns remain visible.

RPC workers report `auto_retry_start` and `auto_retry_end`. Terminal extensions do not receive those events, so the bridge recognizes Pi's `context_edit` omission of the failed message when publishing its next snapshot. Pending failures keep their working state until `agent_settled` rather than briefly inviting another submission during backoff.

`retryAttempt` is derived display metadata. Catalog reads and paginated history derive it from the active branch's context edits before slicing messages into pages. Raw error entries and their diagnostics stay in the session file; the UI does not delete history or replay commands. Older terminal snapshots also recognize a successful assistant response in the same user turn, without hiding failures from a different turn. Already-running terminals need `/reload` to load the exact retry/backoff metadata; refreshing the phone alone updates only the UI.

Verification uses `test/browser/reply-retry.spec.mjs` for retry success, exhaustion, cancellation, history, restart and accessible mobile/desktop feedback. `test/integration.test.mjs` checks the terminal extension through real bridge sockets. Pi/model events are replayed; no live model requests are made.
