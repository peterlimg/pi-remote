# Access

A phone connects with a device token, remembers the login after reopening, and can sign out all tabs in that browser profile.

## Sub-features

- `access-manual`: connect through the token form.
- `access-link`: open the private link encoded by a QR.
- `access-camera`: scan the computer's QR directly inside the login screen, including in the PWA.
- `access-reopen`: open another tab without re-entering the token.
- `access-logout`: clear authentication across tabs and reloads.
- `access-invalid`: reject bad credentials without keeping them.

## How to get to it (user POV)

- Open Pi Remote and fill `Device access token`, then choose `Connect to computer`.
- Choose `Scan QR code` in Pi Remote, allow the rear camera, and point it at the `/pi-remote` QR on the computer. The app signs in without opening Safari. Cancel returns to paste login.
- Alternatively, scan with the phone's camera app to open the complete private URL with `#token=...&key=...`.
- Reopen the saved site or an existing tab.
- Choose `Sign out` in the session sidebar. On mobile, return with `Show sessions` first.

## Driving it with Playwright

Preconditions: fresh owned fixture, Doctor passed, new browser context. Start at `/` without the generic setup's login actions.

- **Manual.** Run `.cursor/skills/verify-pi-remote/verify.mjs` for the complete proof. Its actions are `page.getByLabel('Device access token').fill('browser-test-token-only-123456789012345')` and `page.getByRole('button', { name: 'Connect to computer' }).click()`. Require `#connection` to read `Computer connected` and `#sessions .session` to have count 2.
- **Link.** In a fresh context, `await page.goto('http://127.0.0.1:8799/#token=browser-test-token-only-123456789012345')`. Require the same connection state and `expect(new URL(page.url()).hash).toBe('')`. This proves the QR URL handler, not camera scanning or QR generation.
- **Camera.** Run `npm run test:browser -- test/browser/qr-login.spec.mjs --trace on`. The camera is simulated with a real `MediaStream` carrying pixels rendered from `pairingQr`; the shipped decoder, encrypted WebSocket login, host, and saved-login reopen are real. It covers invalid and other-origin QR rejection, denied permission with paste fallback, cancellation during permission, camera cleanup on cancel/background, and backgrounding before the lazy-loaded scanner opens. Frames stay in the browser. This does not prove physical iPhone camera permissions, focus, or lighting.
- **Reopen.** `await page.close(); const reopened = await context.newPage(); await reopened.goto('http://127.0.0.1:8799/')`. Require `await expect(reopened.locator('#connection')).toHaveText('Computer connected')` without a token in the URL.
- **Sign out.** Open another page in the same context at `/`, wait for connection, then `await reopened.getByRole('button', { name: 'Sign out' }).click()`. Require both tabs' `#login` to be visible, `localStorage.getItem('pi-remote-token')` to be null, and login to remain visible after reload.
- **Invalid.** In a fresh context, open `http://127.0.0.1:8799/#token=invalid-token`. Require `await expect(page.locator('#login-error')).toHaveText('Authentication failed')` and a visible login form.
- **Regression.** Run `npm run test:browser -- test/browser/auth.spec.mjs test/browser/e2e.spec.mjs --trace on`. The Home Screen cases forward a simulated non-loopback HTTPS origin to the real fixture and cover saved token-only links, pasted complete links, reopening, fragment-only recovery, and key/token isolation. This is mobile Chromium coverage, not a physical iPhone installation test. The legacy existing-tab case sets session storage to model an older client. Treat that case as compatibility testing, not a user login proof.

## Gotchas

- New private-link fragments are handled in an already-open page without reloading. A token-only link may reuse a saved encryption key only when its token matches; a fresh Home Screen profile needs the complete private link.
- Browser contexts must be isolated; local storage carries login between tabs in one context.
- Camera access requires HTTPS or loopback. The scanner accepts complete login QR codes for this app's own origin only, never redirects to an address from an untrusted QR, and stops capture on success, cancellation, or backgrounding.
- `/health` success says nothing about token validity.
- The helper proves the manual entry only. Do not claim QR entry or production relay authentication from that result.
- Capture the trace and connected screen before sign out, plus the signed-out screen and storage read afterward. Never capture a real token in a shared trace.
