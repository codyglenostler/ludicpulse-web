# Shared ETA: a browser recipient experience

## Problem and constraints

A trip recipient should be able to open a link and understand arrival context without installing the sender's app or signing in. The browser must also cope with missing route geometry, unreliable network requests, and a sharing credential that should not remain in the visible URL.

This case study describes the public browser implementation. The sender app and cloud service are separate systems; customer adoption, API authorization enforcement, and live-car acceptance are outside this repository's evidence.

## Implementation decisions

### Limit the sharing token's exposure

[`app.js`](../eta/app.js) parses the URL fragment and removes it before starting the worker or loading MapKit. [`state-worker.js`](../eta/state-worker.js) retains the token and uses it for polling, while the page receives display state. This narrows where the token is retained; a Web Worker is not a substitute for server-side authorization or protection against compromised same-origin code.

Tests cover the order of URL cleanup, invalid tokens, worker initialization failure, and rejection of attempts to replace an initialized bearer. Reloading after cleanup requires reopening the original link, an explicit usability tradeoff in the UI.

### Distinguish a provided route from an estimate

[`map-model.js`](../eta/map-model.js) validates coordinates and prefers usable Tesla geometry. When that geometry is absent, it can select an Apple route using remaining distance as context. The UI labels that route as an estimate. If directions fail, current endpoints can still be shown; the client does not invent a missing destination.

Tests exercise malformed coordinates, missing position, alternate routes, transient directions failures, and stale asynchronous responses after backgrounding.

### Keep the public site simple

The site is static HTML/CSS/JavaScript with no build step. Vercel applies response headers and routing; analytics are excluded from the ETA and authorization callback pages. This keeps deployment small while leaving the API and MapKit as explicit external dependencies.

## Verification

On September 22, 2026, this command passed **77 tests** across the website and ETA suites:

```bash
node --test tests/*.test.mjs eta/*.test.js
```

[ETA page tests](../eta/app.test.js), [map-model tests](../eta/map-model.test.js), and [worker tests](../eta/state-worker.test.js) provide executable examples of the behavior described above. The public homepage was also opened in a browser for the README screenshot.

The automated browser behavior is tested with fixtures and mocks. This documentation pass did not create a real trip, exercise a Tesla vehicle, measure operational reliability, or establish end-to-end authorization enforcement. Those require coordinated app/API/device testing.

## Further evidence to collect

A future deployment case study can add a consented recipient usability session, measured time to first useful trip state, recovery behavior during connectivity loss, and confirmed expiry/revocation across client and server. Report observed results and the test conditions, including failures, before claiming improvement.
