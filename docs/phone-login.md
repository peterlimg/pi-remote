# Phone login

Open Pi Remote at your computer's saved phone address. Run `/pi-remote` in Pi, or `pi-remote pair` in a terminal while the host is running. The screen shows the existing private QR/link and a six-digit pairing code. Enter the code in the phone app. Codes last 60 seconds, work once, and are replaced when another code is requested.

Connection failures never erase the saved token, encryption key, conversations or drafts. Network and authentication timeouts retry automatically. Invalid credentials show "This login is no longer valid" and a **Pair again** action. That action opens the pairing form without clearing the saved login. **Back to saved login** resumes it. Only **Sign out** clears it, including other tabs in the same browser profile.

A complete private link opened in Safari saves the login and says "Open Pi Remote from your Home Screen". It also shows a one-time code to enter if the installed app has separate storage. This does not assume Safari and the installed app share local storage. Manual link entry is under **Paste a private link instead**, collapsed by default so pairing code and QR stay prominent. Pasted links accept HTML `&amp;`, a missing `#`, and surrounding whitespace or quotes. A token-only link can reuse an encryption key only for that same saved token. Otherwise, phone login reports `Link incomplete: paste the whole link including &key=`.

## Pairing protocol

- `POST /_pi/pair` creates a code in host memory. It requires the local bridge credential and rejects browser Origin headers. Nothing is persisted in configuration or session history.
- A browser opens `/pair` without a bearer token. The host permits five pairing connections per minute across direct and relayed access, including failed, malformed and idle attempts. Issuing another code does not reset the budget. Each handshake has at most ten seconds and cannot outlive its code.
- `web/pairing.js` implements a SPEKE-style password-authenticated DH exchange in the RFC 3526 2048-bit safe-prime group. SHA-256 of the domain-separated code is squared to obtain a subgroup generator. Both peers choose fresh 256-bit random exponents, reject invalid subgroup elements and reflections, and bind the ordered public keys into HKDF-SHA-256.
- The client proves possession with HMAC-SHA-256. Only after verifying that proof does the host atomically consume the code and return the token and encryption key, encrypted with AES-256-GCM and the exchange transcript as authenticated data. A captured exchange does not provide an offline code-guessing oracle. An active guess consumes a host-wide attempt.
- The normal encrypted client channel can request `pairingCode` for Safari-to-PWA transfer. Plaintext client channels cannot request codes. The relay forwards pairing frames but receives neither the code nor plaintext credentials. Pairing requires relay protocol 3, so an older optional relay must be updated. Direct opentunnel access needs no relay.

This protocol has focused interoperability and rejection tests, not an independent cryptographic audit. As with the existing app, code delivery must be trusted: a relay that replaces the browser's JavaScript can defeat browser-side encryption. Use HTTPS for phone access and keep codes and private links out of logs and shared recordings.

## Verification

Run browser checks on an unused port, with test scratch files inside this checkout:

```sh
mkdir -p .test-tmp
TMPDIR="$PWD/.test-tmp" TMP="$PWD/.test-tmp" TEMP="$PWD/.test-tmp" PI_REMOTE_TEST_PORT=8811 npm run test:browser
```

The pairing browser spec uses real host time to check the 60-second expiry. Browser coverage also checks reuse, wrong codes, rate limiting, encrypted reconnects, 1008 timeouts, incomplete links and Safari's transfer code. `test/pairing.test.mjs` checks the CLI/control endpoint and a real relay with encrypted credential delivery. The browser fixture simulates Pi bridge agents, not a real model session.

A physical iPhone check is still necessary:

1. Open the installed PWA and pair with the computer's six-digit code.
2. Open a session and type a draft without sending it.
3. Disconnect the tunnel for one minute. Confirm the PWA keeps the session and draft, and reports that the computer is offline while retrying.
4. Restore the tunnel. Confirm the app reconnects without requesting a login and preserves the draft.

Do not disconnect a shared tunnel or host without its operator's permission.
