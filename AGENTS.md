# Delivery

Opentunnel is the default access path: the phone connects directly to the local Pi Remote host through the tunnel. Render is an optional relay, not the default delivery path.

After each completed fix or change, run only the tests and checks covering the affected behavior locally, commit the work, and push to `main`. Leave the full test suite to GitHub CI; do not run it locally for every fix or as a routine final validation pass. Documentation-only changes need no tests. Do not stop at local-only changes unless explicitly requested.

Do not wait for CI or Render after pushing. Report the push and local validation, and leave CI and deployment running in the background. Do not claim deployment is live unless confirmed. If host-side code changed, restart the local Pi Remote host when safe and verify it reconnects. Report any known deployment blocker rather than claiming success.

Keep unrelated work out of the commit unless explicitly authorized.
