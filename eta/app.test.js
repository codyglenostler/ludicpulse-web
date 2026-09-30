'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const model = require('./map-model.js');

const source = readFileSync(new URL('./app.js', `file://${__filename}`), 'utf8');
const pageSource = readFileSync(new URL('./index.html', `file://${__filename}`), 'utf8');
const position = { latitude: 40.7608, longitude: -111.8910 };
const destination = { latitude: 40.7681, longitude: -111.8941 };

const settle = () => new Promise((resolve) => setImmediate(() => setImmediate(resolve)));

test('pins the MapKit runtime whose callback contract the page implements', () => {
  assert.match(source, /\/mk\/5\.81\.65\/mapkit\.js/);
  assert.doesNotMatch(source, /\/mk\/5\.x\.x\/mapkit\.js/);
  assert.match(source, /new Worker\('\/eta\/state-worker\.js\?v=20260830-token-isolation'/);
  assert.doesNotMatch(source, /\bfetch\s*\(/);
  assert.match(source, /message\.type === 'ready'[\s\S]*token = null;/);
});

test('keeps the recipient page focused and exposes a no-install link preview', () => {
  assert.doesNotMatch(pageSource, /class="details"|id="traffic"|id="freshness"|class="privacy"/);
  assert.doesNotMatch(source, /el\('traffic'\)|el\('freshness'\)/);
  assert.doesNotMatch(pageSource, /(?:icon|favicon)\.png/);
  assert.match(pageSource, /property="og:title" content="Live ETA · Ludic Pulse"/);
  assert.match(pageSource, /property="og:description" content="Tap to follow the private live trip\. No app or sign-in required\."/);
  assert.match(pageSource, /property="og:image" content="https:\/\/ludicpulse\.com\/social-card\.png"/);
  assert.match(pageSource, /name="twitter:card" content="summary_large_image"/);
  assert.match(pageSource, /rel="canonical" href="https:\/\/ludicpulse\.com\/eta\/"/);
  assert.match(pageSource, /worker-src 'self' blob:/);
  assert.doesNotMatch(pageSource, /#[A-Za-z0-9_-]{40,80}/);
  assert.doesNotMatch(pageSource, /class="brand"|<span>Ludic Pulse<\/span>/);
});

function element() {
  const children = new Map();
  return {
    hidden: false,
    textContent: '',
    style: {},
    attributes: {},
    classList: { toggle() {} },
    setAttribute(name, value) { this.attributes[name] = value; },
    removeAttribute(name) { delete this.attributes[name]; },
    querySelector(selector) {
      if (!children.has(selector)) children.set(selector, element());
      return children.get(selector);
    },
  };
}

async function runPage(data, directionResults, options = {}) {
  const elements = new Map();
  const maps = [];
  const timers = [];
  const intervals = [];
  let now = Date.now();
  class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  }
  const warnings = [];
  const pendingDirections = [];
  const workerMessages = [];
  const historyCalls = [];
  const eventOrder = [];
  const results = Array.isArray(directionResults) ? [...directionResults] : [directionResults];
  let directionCalls = 0;
  let visibilityHandler;
  let stateWorker;
  let thirdPartyObservedHash;
  let parentFetchCalls = 0;
  let workerAttempts = 0;
  class FakeMap {
    static ColorSchemes = { Dark: 'dark' };
    constructor() { this.items = []; maps.push(this); }
    addItems(items) { this.items.push(...items); }
    removeItems(items) { this.items = this.items.filter((item) => !items.includes(item)); }
    showItems() {}
  }
  class Overlay {
    constructor(points, options = {}) { this.points = points; this.style = options.style; }
  }
  class Coordinate {
    constructor(latitude, longitude) { Object.assign(this, { latitude, longitude }); }
  }
  class Directions {
    static Transport = { Automobile: 'AUTOMOBILE' };
    route(request, callback) {
      directionCalls += 1;
      assert.equal(typeof callback, 'function');
      assert.ok(request.origin instanceof Coordinate);
      assert.ok(request.destination instanceof Coordinate);
      assert.equal(request.transportType, 'AUTOMOBILE');
      assert.equal(request.requestsAlternateRoutes, true);
      const result = results.shift();
      const complete = () => {
        if (result instanceof Error) callback(result);
        else callback(null, result);
      };
      if (result?.deferred) pendingDirections.push(() => {
        if (result.value instanceof Error) callback(result.value);
        else callback(null, result.value);
      });
      else queueMicrotask(complete);
    }
  }
  const mapkit = {
    addEventListener() {},
    init() {},
    Map: FakeMap,
    FeatureVisibility: { Hidden: 'hidden' },
    Coordinate,
    MarkerAnnotation: class MarkerAnnotation { constructor(point, options) { Object.assign(this, { point, options }); } },
    Annotation: class Annotation { constructor(point, factory, options) { Object.assign(this, { point, options, element: factory(point, options) }); } },
    PolylineOverlay: Overlay,
    Style: class Style { constructor(options) { Object.assign(this, options); } },
    Padding: class Padding {},
    Directions,
  };
  const location = {
    hash: options.hash ?? `#${'A'.repeat(43)}`,
    pathname: '/eta/',
    search: options.search ?? '?source=message',
  };
  const history = {
    replaceState(state, title, url) {
      eventOrder.push('history');
      historyCalls.push({ state, title, url });
      location.hash = '';
    },
  };
  const window = { EtaMapModel: model };
  class FakeWorker {
    constructor(url, workerOptions) {
      eventOrder.push('worker');
      workerAttempts += 1;
      if (workerAttempts <= (options.workerFailures ?? 0)) throw new Error('Worker unavailable');
      assert.equal(url, '/eta/state-worker.js?v=20260830-token-isolation');
      assert.equal(workerOptions.name, 'ludic-eta-state');
      this.listeners = new Map();
      stateWorker = this;
    }
    addEventListener(name, callback) { this.listeners.set(name, callback); }
    postMessage(message) {
      workerMessages.push(structuredClone(message));
      if (message.type === 'initialize') {
        queueMicrotask(() => this.listeners.get('message')?.({ data: { type: 'ready' } }));
      } else if (message.type === 'start') {
        queueMicrotask(() => this.listeners.get('message')?.({ data: { type: 'state', data } }));
      }
    }
    terminate() { this.terminated = true; }
  }
  const document = {
    hidden: false,
    head: {
      append(script) {
        eventOrder.push('mapkit');
        thirdPartyObservedHash = location.hash;
        window.mapkit = mapkit;
        script.onload();
      },
    },
    getElementById(id) {
      if (!elements.has(id)) {
        const node = element();
        if (id === 'map-unavailable') {
          node.querySelector('span').textContent = pageSource.match(/id="map-unavailable"[\s\S]*?<span>([^<]+)<\/span>/)[1];
        }
        elements.set(id, node);
      }
      return elements.get(id);
    },
    addEventListener(name, callback) { if (name === 'visibilitychange') visibilityHandler = callback; },
    createElement() { return element(); },
  };
  const context = vm.createContext({
    Date: Clock,
    DOMPoint: class DOMPoint { constructor(x, y) { Object.assign(this, { x, y }); } },
    console: { warn(message) { warnings.push(message); } },
    crypto: { randomUUID: () => 'session-id' },
    document,
    fetch: async () => { parentFetchCalls += 1; throw new Error('parent fetch must remain unused'); },
    history,
    location,
    structuredClone,
    URLSearchParams,
    setInterval(callback, delay) {
      const timer = { callback, delay, active: true };
      intervals.push(timer);
      return timer;
    },
    clearInterval(timer) { if (timer) timer.active = false; },
    setTimeout(callback, delay) {
      const timer = { callback, delay, active: true };
      timers.push(timer);
      return timer;
    },
    clearTimeout(timer) { if (timer) timer.active = false; },
    window,
    Worker: FakeWorker,
  });
  vm.runInContext(source, context);
  await settle();
  await settle();
  return {
    get directionCalls() { return directionCalls; },
    elements,
    maps,
    pendingDirections,
    timers,
    warnings,
    eventOrder,
    historyCalls,
    location,
    get parentFetchCalls() { return parentFetchCalls; },
    get stateWorker() { return stateWorker; },
    get thirdPartyObservedHash() { return thirdPartyObservedHash; },
    get workerAttempts() { return workerAttempts; },
    workerMessages,
    get now() { return now; },
    async advance(ms) {
      now += ms;
      intervals.filter(timer => timer.active).forEach(timer => timer.callback());
      await settle();
    },
    async message(message) {
      stateWorker.listeners.get('message')({ data: message });
      await settle();
    },
    async workerError() {
      stateWorker.listeners.get('error')();
      await settle();
    },
    async runNextTimer() {
      const timer = timers.find((candidate) => candidate.active);
      assert.ok(timer, 'expected an active retry timer');
      timer.active = false;
      timer.callback();
      await settle();
      await settle();
    },
    async setHidden(hidden) {
      document.hidden = hidden;
      visibilityHandler();
      await settle();
      await settle();
    },
  };
}

const active = (extra = {}) => ({
  state: 'active',
  mapToken: 'map-token',
  etaAt: new Date(Date.now() + 20 * 60_000).toISOString(),
  updatedAt: new Date().toISOString(),
  remainingMiles: 12,
  progress: 40,
  position,
  destination,
  ...extra,
});

test('scrubs the bearer before Worker creation and third-party MapKit execution', async () => {
  const result = await runPage(active({ routePoints: [position, destination] }), { routes: [] });
  assert.deepEqual(result.historyCalls, [{
    state: null, title: '', url: '/eta/?source=message&_eta_session=session-id',
  }]);
  assert.equal(result.location.hash, '');
  assert.equal(result.thirdPartyObservedHash, '');
  assert.ok(result.eventOrder.indexOf('history') < result.eventOrder.indexOf('worker'));
  assert.ok(result.eventOrder.indexOf('worker') < result.eventOrder.indexOf('mapkit'));
  assert.deepEqual(result.workerMessages.slice(0, 2), [
    { type: 'initialize', token: 'A'.repeat(43) },
    { type: 'start' },
  ]);
  assert.equal(result.parentFetchCalls, 0);

  await result.setHidden(true);
  await result.setHidden(false);
  assert.deepEqual(result.workerMessages.slice(2), [{ type: 'stop' }, { type: 'start' }]);
  assert.equal(result.workerMessages.filter((message) => 'token' in message).length, 1);
});

test('scrubs an invalid fragment without creating a bearer Worker', async () => {
  const result = await runPage(active(), { routes: [] }, { hash: '#not-a-valid-token' });
  assert.equal(result.location.hash, '');
  assert.equal(result.stateWorker, undefined);
  assert.deepEqual(result.workerMessages, []);
  assert.equal(result.elements.get('terminal').hidden, false);
});

test('explains that a scrubbed trip must be reopened after reload', async () => {
  const result = await runPage(active(), { routes: [] }, {
    hash: '', search: '?source=message&_eta_session=previous',
  });
  assert.equal(result.elements.get('terminal-title').textContent, 'Open the shared link again');
  assert.match(result.elements.get('terminal-body').textContent, /reloading clears this trip/i);
});

test('retries a synchronous Worker startup failure before loading MapKit', async () => {
  const result = await runPage(active({ routePoints: [position, destination] }), { routes: [] }, {
    workerFailures: 1,
  });
  assert.equal(result.workerAttempts, 1);
  assert.equal(result.thirdPartyObservedHash, undefined);
  assert.match(result.elements.get('loading').querySelector('p').textContent, /Retrying/);

  await result.runNextTimer();
  assert.equal(result.workerAttempts, 2);
  assert.equal(result.thirdPartyObservedHash, '');
});

test('treats malformed Worker state as a retryable polling error', async () => {
  const result = await runPage(null, { routes: [] });
  assert.match(result.elements.get('loading').querySelector('p').textContent, /Retrying/);
  assert.equal(result.thirdPartyObservedHash, undefined);
});

test('ages the last update without inventing arrival and honors known expiry while offline', async () => {
  const data = active({ routePoints: [position, destination], expiresAt: new Date(Date.now() + 120_000).toISOString() });
  const result = await runPage(data, { routes: [] });
  await result.advance(61_000);
  assert.equal(result.elements.get('state-chip').textContent, 'Update delayed');
  assert.equal(result.elements.get('countdown').textContent, '—');
  assert.equal(result.elements.get('arrival').textContent, '—');
  assert.match(result.elements.get('route-source').textContent, /Last known/);
  assert.equal(result.elements.get('trip').hidden, false);
  await result.advance(60_000);
  assert.equal(result.elements.get('terminal-title').textContent, 'Link expired');
  assert.equal(result.elements.get('trip').hidden, true);
  assert.equal(result.stateWorker.terminated, true);
});

test('hides delayed ETA metrics and resumes them only after a fresh update', async () => {
  const data = active({ routePoints: [position, destination] });
  const result = await runPage(data, { routes: [] });
  await result.message({ type: 'error' });
  assert.equal(result.elements.get('countdown').textContent, '—');
  assert.equal(result.elements.get('arrival').textContent, '—');
  await result.message({ type: 'state', data });
  assert.equal(result.elements.get('state-chip').textContent, 'Live');
  assert.equal(result.elements.get('countdown').textContent, '20 min');
});

test('asks to reopen the original link when the isolated bearer Worker fails', async () => {
  const result = await runPage(active({ routePoints: [position, destination] }), { routes: [] });
  await result.workerError();
  assert.equal(result.elements.get('trip').hidden, true);
  assert.equal(result.elements.get('loading').hidden, true);
  assert.equal(result.elements.get('terminal').hidden, false);
  assert.equal(result.elements.get('terminal-title').textContent, 'Open the shared link again');
  assert.match(result.elements.get('terminal-body').textContent, /connection was interrupted/i);
  assert.match(result.elements.get('terminal-body').textContent, /original link/i);
  assert.equal(result.stateWorker.terminated, true);
  assert.equal(result.timers.filter(timer => timer.active).length, 0);
  assert.equal(result.workerAttempts, 1);
  assert.equal(result.location.hash, '');
});

test('a delayed no-map view does not claim its hidden arrival metrics are still updating', async () => {
  const data = active({ state: 'delayed', mapToken: null });
  const result = await runPage(data, { routes: [] });
  assert.equal(result.elements.get('map-unavailable').hidden, false);
  assert.equal(result.elements.get('arrival').textContent, '—');
  assert.equal(result.elements.get('countdown').textContent, '—');
  assert.equal(result.elements.get('map-unavailable').querySelector('span').textContent, 'Waiting for a fresh trip update.');
  await result.message({ type: 'state', data: { ...data, state: 'active' } });
  assert.equal(result.elements.get('map-unavailable').querySelector('span').textContent, 'Arrival and trip progress are still updating.');
});

test('keeps a background-aged trip delayed until a fresh response arrives', async () => {
  const data = active({ routePoints: [position, destination] });
  const result = await runPage(data, { routes: [] });
  await result.setHidden(true);
  await result.advance(90_000);
  await result.setHidden(false);
  assert.equal(result.elements.get('state-chip').textContent, 'Update delayed');
  assert.equal(result.elements.get('countdown').textContent, '—');
  await result.message({ type: 'state', data: { ...data, updatedAt: new Date(result.now).toISOString(),
    etaAt: new Date(result.now + 10 * 60_000).toISOString() } });
  assert.equal(result.elements.get('state-chip').textContent, 'Live');
  assert.equal(result.elements.get('countdown').textContent, '10 min');
});

test('does not load a map for a known-expired first response', async () => {
  const result = await runPage(active({ expiresAt: new Date(Date.now() - 1).toISOString() }), { routes: [] });
  assert.equal(result.elements.get('terminal-title').textContent, 'Link expired');
  assert.equal(result.directionCalls, 0);
  assert.equal(result.thirdPartyObservedHash, undefined);
});

test('never resurrects an ended trip from late events or browser visibility changes', async () => {
  const result = await runPage(active({ routePoints: [position, destination] }), { routes: [] });
  await result.message({ type: 'state', data: { state: 'ended' } });
  const starts = result.workerMessages.filter(message => message.type === 'start').length;
  await result.message({ type: 'error' });
  await result.message({ type: 'state', data: active() });
  await result.setHidden(true);
  await result.setHidden(false);
  assert.equal(result.elements.get('trip').hidden, true);
  assert.equal(result.elements.get('terminal').hidden, false);
  assert.equal(result.elements.get('terminal-title').textContent, 'Sharing ended');
  assert.equal(result.workerMessages.filter(message => message.type === 'start').length, starts);
});

test('unknown state envelopes remain recoverable instead of claiming sharing ended', async () => {
  const result = await runPage(active({ routePoints: [position, destination] }), { routes: [] });
  await result.message({ type: 'state', data: { error: 'internal error' } });
  assert.equal(result.elements.get('terminal').hidden, true);
  assert.equal(result.elements.get('state-chip').textContent, 'Update delayed');
  await result.message({ type: 'state', data: active({ routePoints: [position, destination] }) });
  assert.equal(result.elements.get('state-chip').textContent, 'Live');
});

test('draws a labeled Apple estimate chosen with Tesla remaining distance', async () => {
  const short = new (class { constructor() { this.distance = 16_000; this.polyline = { style: null }; } })();
  const match = new (class { constructor() { this.distance = 19_300; this.polyline = { style: null }; } })();
  const result = await runPage(active(), { routes: [short, match] });
  assert.equal(result.directionCalls, 1);
  assert.equal(result.elements.get('route-source').textContent, 'Estimated route');
  assert.equal(result.elements.get('route-source').hidden, false);
  assert.ok(result.maps[0].items.includes(match.polyline));
  assert.ok(!result.maps[0].items.includes(short.polyline));
});

test('prefers exact Tesla route geometry and skips Apple directions', async () => {
  const result = await runPage(active({ routePoints: [position, destination] }), { routes: [] });
  assert.equal(result.directionCalls, 0);
  assert.equal(result.elements.get('route-source').textContent, 'Tesla route');
  assert.equal(result.elements.get('route-source').hidden, false);
});

test('caches same-version omission and clears only an explicit empty route', async () => {
  const estimated = { distance: 19_300, polyline: { style: null } };
  const result = await runPage(active({ routePoints: [position, destination], routeVersion: 'route-a' }), { routes: [estimated] });
  await result.message({ type: 'state', data: active({ routeVersion: 'route-a' }) });
  assert.equal(result.elements.get('route-source').textContent, 'Tesla route');
  assert.equal(result.directionCalls, 0);
  await result.message({ type: 'state', data: { state: 'delayed' } });
  assert.equal(result.elements.get('route-source').textContent, 'Last known · Tesla route');
  await result.message({ type: 'state', data: active({ routeVersion: '', routePoints: [] }) });
  assert.equal(result.directionCalls, 1);
  assert.equal(result.elements.get('route-source').textContent, 'Estimated route');
  assert.ok(result.maps[0].items.includes(estimated.polyline));
  assert.ok(!result.maps[0].items.some(item => Array.isArray(item.points)));
});

test('does not carry old Tesla geometry into a changed version without points', async () => {
  const estimated = { distance: 19_300, polyline: { style: null } };
  const result = await runPage(active({ routePoints: [position, destination], routeVersion: 'route-a' }), { routes: [estimated] });
  await result.message({ type: 'state', data: active({ routeVersion: 'route-b' }) });
  assert.equal(result.directionCalls, 1);
  assert.equal(result.elements.get('route-source').textContent, 'Estimated route');
  assert.ok(!result.maps[0].items.some(item => Array.isArray(item.points)));
});

for (const source of ['Tesla', 'Apple']) test(`explicit destination redaction removes prior ${source} route details`, async () => {
  const estimated = { distance: 19_300, polyline: { style: null } };
  const result = await runPage(active({ driverFirstName: 'Sample', destinationName: 'Example destination',
    ...(source === 'Tesla' ? { routePoints: [position, destination], routeVersion: 'route-a' } : {}),
  }), { routes: [estimated] });
  await result.message({ type: 'state', data: active({ driverFirstName: null, destinationName: null,
    destination: null, routePoints: [], routeVersion: '' }) });
  assert.equal(result.elements.get('heading').textContent, 'On the way');
  assert.equal(result.elements.get('destination').hidden, true);
  assert.equal(result.elements.get('destination').textContent, '');
  assert.equal(result.elements.get('route-source').hidden, true);
  assert.equal(result.elements.get('route-legend').hidden, true);
  assert.equal(result.elements.get('route-line').attributes.d, '');
  assert.equal(result.elements.get('destination-marker').attributes.cx, undefined);
  assert.ok(!result.maps[0].items.includes(estimated.polyline));
  assert.ok(!result.maps[0].items.some(item => Array.isArray(item.points) || item.options?.title === 'End'));
  assert.equal(result.elements.get('progress').attributes['aria-valuenow'], '40');
  assert.equal(result.elements.get('map').hidden, false);
  await result.message({ type: 'state', data: { state: 'delayed' } });
  assert.equal(result.elements.get('destination').textContent, '');
  assert.ok(!result.maps[0].items.some(item => item.options?.title === 'End'));
});

test('late Apple directions cannot restore a destination after explicit redaction', async () => {
  const estimated = { distance: 19_300, polyline: { style: null } };
  const result = await runPage(active(), [{ deferred: true, value: { routes: [estimated] } }]);
  await result.message({ type: 'state', data: active({ destinationName: null, destination: null,
    routePoints: [], routeVersion: '' }) });
  result.pendingDirections[0]();
  await settle();
  assert.ok(!result.maps[0].items.includes(estimated.polyline));
  assert.equal(result.elements.get('route-source').hidden, true);
});

test('marks chronological route ends with small green Start and red End dots', async () => {
  const midpoint = { latitude: 40.764, longitude: -111.892 };
  const result = await runPage(active({ routePoints: [position, midpoint, destination], position: midpoint }), { routes: [] });
  const annotations = result.maps[0].items.filter(item => item.options?.title);
  const start = annotations.find(item => item.options.title === 'Start');
  const end = annotations.find(item => item.options.title === 'End');
  assert.deepEqual({ ...start.point }, position);
  assert.deepEqual({ ...end.point }, destination);
  assert.equal(start.element.className, 'route-endpoint route-endpoint-start');
  assert.equal(end.element.className, 'route-endpoint route-endpoint-end');
  assert.ok(annotations.some(item => item.options.title === 'Current location'));
  assert.equal(result.elements.get('route-legend').hidden, false);
  assert.equal(result.elements.get('car-marker').attributes.visibility, 'visible');
  assert.notEqual(result.elements.get('start-marker').attributes.cx, result.elements.get('destination-marker').attributes.cx);
});

test('keeps both endpoint roles visible at a shared loop coordinate', async () => {
  const result = await runPage(active({ routePoints: [position, destination, position], position }), { routes: [] });
  const start = result.maps[0].items.find(item => item.options?.title === 'Start');
  const end = result.maps[0].items.find(item => item.options?.title === 'End');
  assert.equal(start.options.anchorOffset.x, -8);
  assert.equal(end.options.anchorOffset.x, 8);
  assert.deepEqual({ ...start.point }, { ...end.point });
  assert.notEqual(result.elements.get('start-marker').attributes.cx, result.elements.get('destination-marker').attributes.cx);
  assert.equal(result.elements.get('car-marker').attributes.visibility, 'hidden');
});

test('reveals the SVG fallback with real hidden-attribute semantics', async () => {
  const result = await runPage(active({ mapToken: null, routePoints: [position, destination, position] }), { routes: [] });
  assert.equal(result.elements.get('map').hidden, true);
  assert.equal(Object.hasOwn(result.elements.get('route-fallback').attributes, 'hidden'), false);
  assert.notEqual(result.elements.get('start-marker').attributes.cx, result.elements.get('destination-marker').attributes.cx);
  assert.doesNotMatch(source, /(?:svg|el\('route-fallback'\))\.hidden\s*=/);
});

test('uses the same endpoint names without route geometry and does not invent an end', async () => {
  const endpoints = await runPage(active(), new Error('directions unavailable'));
  assert.ok(endpoints.maps[0].items.some(item => item.options?.title === 'Start'));
  assert.ok(endpoints.maps[0].items.some(item => item.options?.title === 'End'));
  const noEnd = await runPage(active({ destination: null }), { routes: [] });
  assert.ok(!noEnd.maps[0].items.some(item => item.options?.title === 'End'));
  assert.equal(noEnd.elements.get('route-legend').hidden, true);
});

test('keeps the live endpoint map when Apple directions fails', async () => {
  const result = await runPage(active(), new Error('directions unavailable'));
  assert.equal(result.directionCalls, 1);
  assert.equal(result.elements.get('map').hidden, false);
  assert.equal(result.elements.get('route-source').textContent, 'Route temporarily unavailable · retrying');
  assert.equal(result.elements.get('route-source').hidden, false);
  assert.equal(result.elements.get('route-fallback').attributes.hidden, '');
  assert.equal(result.timers.filter((timer) => timer.active)[0].delay, 5_000);
  assert.equal(result.warnings.length, 1);
  assert.doesNotMatch(result.warnings[0], /40\.7608|-111\.891/);
});

test('retries a transient directions failure and draws the recovered route', async () => {
  const recovered = { distance: 19_300, polyline: { style: null } };
  const result = await runPage(active(), [new Error('temporary'), { routes: [recovered] }]);
  assert.equal(result.directionCalls, 1);
  await result.runNextTimer();
  assert.equal(result.directionCalls, 2);
  assert.equal(result.elements.get('route-source').textContent, 'Estimated route');
  assert.ok(result.maps[0].items.includes(recovered.polyline));
});

test('discards a stale directions response after backgrounding and refreshes on return', async () => {
  const stale = { distance: 19_300, polyline: { style: null } };
  const fresh = { distance: 19_100, polyline: { style: null } };
  const result = await runPage(active(), [{ deferred: true, value: { routes: [stale] } }, { routes: [fresh] }]);
  assert.equal(result.directionCalls, 1);
  await result.setHidden(true);
  result.pendingDirections[0]();
  await settle();
  assert.ok(!result.maps[0].items.includes(stale.polyline));
  await result.setHidden(false);
  assert.equal(result.directionCalls, 2);
  assert.ok(result.maps[0].items.includes(fresh.polyline));
});

test('discards pending directions after sharing expires', async () => {
  const stale = { distance: 19_300, polyline: { style: null } };
  const result = await runPage(active(), [{ deferred: true, value: { routes: [stale] } }]);
  await result.message({ type: 'state', data: { state: 'expired' } });
  result.pendingDirections[0]();
  await settle();
  assert.ok(!result.maps[0].items.includes(stale.polyline));
  assert.equal(result.elements.get('trip').hidden, true);
  assert.equal(result.elements.get('terminal-title').textContent, 'Link expired');
});
