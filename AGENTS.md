# Delivery

After each completed fix or change, run only the tests and checks covering the affected behavior locally, commit the work, and push to `main` to trigger deployment. Leave the full test suite to GitHub CI; do not run it locally for every fix or as a routine final validation pass. Documentation-only changes need no tests. Do not stop at local-only changes unless explicitly requested.

Wait for CI and confirm the Render deployment is live before reporting it as deployed. If host-side code changed, restart the local Pi Remote host when safe and verify it reconnects. Report any deployment blocker rather than claiming success.

Keep unrelated work out of the commit unless explicitly authorized.
