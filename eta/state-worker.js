'use strict';

const API = 'https://telem.statmask.com:8443/api/public/eta/state';
const POLL_MS = 10_000;
const REQUEST_TIMEOUT_MS = 25_000;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{40,80}$/;

let token = null;
let routeVersion;
let pollTimer = null;
let controller = null;
let requestTimeout = null;

function stopPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
  controller?.abort();
  controller = null;
  if (requestTimeout) clearTimeout(requestTimeout);
  requestTimeout = null;
}

async function poll() {
  if (!token || !pollTimer || controller) return;
  const requestController = new AbortController();
  controller = requestController;
  const current = () => controller === requestController && !requestController.signal.aborted && pollTimer != null;
  const timeout = setTimeout(() => {
    if (!current()) return;
    requestController.abort(); controller = null; requestTimeout = null;
    self.postMessage({ type: 'error' });
  }, REQUEST_TIMEOUT_MS);
  requestTimeout = timeout;
  try {
    const response = await fetch(API, {
      method: 'POST', cache: 'no-store', referrerPolicy: 'no-referrer',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, routeVersion }), signal: requestController.signal,
    });
    const data = await response.json();
    if (!current()) return;
    const validState = data && typeof data === 'object' && !Array.isArray(data)
      && ['active', 'delayed', 'ended', 'expired'].includes(data.state);
    const documentedTerminal = [400, 403, 404].includes(response.status)
      && (data?.state === 'ended' || data?.state === 'expired');
    if (!validState || (!response.ok && !documentedTerminal)) {
      self.postMessage({ type: 'error' });
      return;
    }
    if (data.routeVersion === '' || (Array.isArray(data.routePoints) && data.routePoints.length < 2)) {
      routeVersion = undefined;
    } else if (Object.prototype.hasOwnProperty.call(data, 'routeVersion')) {
      // Never acknowledge a new route version whose geometry was not delivered;
      // the next poll must ask for its points instead of preserving an old line.
      routeVersion = (Array.isArray(data.routePoints) && data.routePoints.length >= 2)
        || data.routeVersion === routeVersion ? data.routeVersion : undefined;
    }
    self.postMessage({ type: 'state', data });
  } catch (error) {
    if (current() && error?.name !== 'AbortError') self.postMessage({ type: 'error' });
  } finally {
    clearTimeout(timeout);
    if (controller === requestController) { controller = null; requestTimeout = null; }
  }
}

function startPolling() {
  if (!token || pollTimer) return;
  pollTimer = setInterval(poll, POLL_MS);
  void poll();
}

self.addEventListener('message', (event) => {
  const message = event.data;
  if (!message || typeof message !== 'object') return;
  if (message.type === 'initialize') {
    if (token) return;
    if (typeof message.token !== 'string' || !TOKEN_PATTERN.test(message.token)) {
      self.postMessage({ type: 'invalid' });
      return;
    }
    token = message.token;
    self.postMessage({ type: 'ready' });
    return;
  }
  if (message.type === 'start') startPolling();
  else if (message.type === 'stop') stopPolling();
});
