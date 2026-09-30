'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');

const source = readFileSync(new URL('./state-worker.js', `file://${__filename}`), 'utf8');
const settle = () => new Promise((resolve) => setImmediate(() => setImmediate(resolve)));
const routePoints = [{ latitude: 40.7, longitude: -111.8 }, { latitude: 40.8, longitude: -111.9 }];

function error(name) {
  const value = new Error(name);
  value.name = name;
  return value;
}

function createHarness(responses = []) {
  const fetchCalls = [];
  const messages = [];
  const timers = [];
  const timeouts = [];
  const pending = [];
  let messageHandler;
  const queue = [...responses];
  const self = {
    addEventListener(name, callback) {
      if (name === 'message') messageHandler = callback;
    },
    postMessage(message) { messages.push(JSON.parse(JSON.stringify(message))); },
  };
  const context = vm.createContext({
    AbortController,
    clearInterval(timer) { if (timer) timer.active = false; },
    setTimeout(callback, delay) {
      const timer = { active: true, callback, delay };
      timeouts.push(timer);
      return timer;
    },
    clearTimeout(timer) { if (timer) timer.active = false; },
    fetch: async (url, options) => {
      fetchCalls.push({ url, options });
      const response = queue.shift();
      if (response instanceof Error) throw response;
      const wrap = value => ({ ok: (value?.httpStatus ?? 200) < 300,
        status: value?.httpStatus ?? 200, json: async () => value?.httpStatus ? value.body : value });
      if (response?.deferred) return new Promise(resolve => pending.push(value => resolve(wrap(value))));
      return wrap(response);
    },
    self,
    setInterval(callback, delay) {
      const timer = { active: true, callback, delay };
      timers.push(timer);
      return timer;
    },
  });
  vm.runInContext(source, context);
  return {
    fetchCalls,
    messages,
    timers,
    timeouts,
    pending,
    async send(data) {
      messageHandler({ data });
      await settle();
    },
    async runActiveTimer() {
      const timer = timers.find((candidate) => candidate.active);
      assert.ok(timer, 'expected an active polling timer');
      timer.callback();
      await settle();
    },
    async runActiveTimeout() {
      const timer = timeouts.find(candidate => candidate.active);
      assert.ok(timer, 'expected an active request timeout');
      timer.active = false;
      timer.callback();
      await settle();
    },
  };
}

test('owns the bearer and carries only route version across polls', async () => {
  const token = 'A'.repeat(43);
  const harness = createHarness([
    { state: 'active', routeVersion: 7, routePoints },
    { state: 'active', routeVersion: 8, routePoints },
  ]);
  await harness.send({ type: 'initialize', token });
  assert.equal(harness.fetchCalls.length, 0);
  await harness.send({ type: 'start' });

  assert.equal(harness.fetchCalls[0].url, 'https://telem.statmask.com:8443/api/public/eta/state');
  assert.deepEqual(JSON.parse(harness.fetchCalls[0].options.body), { token });
  assert.equal(harness.fetchCalls[0].options.method, 'POST');
  assert.equal(harness.fetchCalls[0].options.cache, 'no-store');
  assert.equal(harness.fetchCalls[0].options.referrerPolicy, 'no-referrer');
  assert.equal(harness.timers[0].delay, 10_000);
  assert.deepEqual(harness.messages[0], { type: 'ready' });
  assert.deepEqual(harness.messages[1], {
    type: 'state', data: { state: 'active', routeVersion: 7, routePoints },
  });

  await harness.runActiveTimer();
  assert.deepEqual(JSON.parse(harness.fetchCalls[1].options.body), { token, routeVersion: 7 });
});

test('rejects malformed tokens and never replaces an initialized bearer', async () => {
  const invalid = createHarness();
  await invalid.send({ type: 'initialize', token: 'short' });
  await invalid.send({ type: 'start' });
  assert.deepEqual(invalid.messages, [{ type: 'invalid' }]);
  assert.equal(invalid.fetchCalls.length, 0);

  const original = 'A'.repeat(43);
  const replacement = 'B'.repeat(43);
  const initialized = createHarness([{ state: 'active' }]);
  await initialized.send({ type: 'initialize', token: original });
  await initialized.send({ type: 'initialize', token: replacement });
  await initialized.send({ type: 'start' });
  assert.deepEqual(JSON.parse(initialized.fetchCalls[0].options.body), { token: original });
});

test('stops and resumes polling without retransmitting the bearer to the page', async () => {
  const token = 'A'.repeat(43);
  const harness = createHarness([{ deferred: true }, { state: 'active' }]);
  await harness.send({ type: 'initialize', token });
  await harness.send({ type: 'start' });
  const firstSignal = harness.fetchCalls[0].options.signal;
  await harness.send({ type: 'stop' });
  assert.equal(firstSignal.aborted, true);
  assert.equal(harness.timers[0].active, false);

  await harness.send({ type: 'start' });
  assert.equal(harness.fetchCalls.length, 2);
  assert.ok(harness.messages.every((message) => !Object.hasOwn(message, 'token')));
});

test('reports network failures without exposing errors or aborted requests', async () => {
  const token = 'A'.repeat(43);
  const harness = createHarness([error('NetworkError'), error('AbortError')]);
  await harness.send({ type: 'initialize', token });
  await harness.send({ type: 'start' });
  assert.deepEqual(harness.messages, [{ type: 'ready' }, { type: 'error' }]);

  await harness.send({ type: 'stop' });
  await harness.send({ type: 'start' });
  assert.deepEqual(harness.messages, [{ type: 'ready' }, { type: 'error' }]);
});

test('allows a slow response to finish rather than aborting it every polling interval', async () => {
  const harness = createHarness([{ deferred: true }, { state: 'active', routeVersion: 2, routePoints }]);
  await harness.send({ type: 'initialize', token: 'A'.repeat(43) });
  await harness.send({ type: 'start' });
  await harness.runActiveTimer();
  assert.equal(harness.fetchCalls.length, 1);
  assert.equal(harness.fetchCalls[0].options.signal.aborted, false);
  harness.pending[0]({ state: 'active', routeVersion: 1, routePoints });
  await settle();
  assert.equal(harness.messages.at(-1).data.routeVersion, 1);
  await harness.runActiveTimer();
  assert.equal(harness.fetchCalls.length, 2);
});

test('times out a stuck request, recovers, and ignores its eventual late response', async () => {
  const harness = createHarness([{ deferred: true }, { state: 'active', routeVersion: 2, routePoints }, { state: 'active' }]);
  await harness.send({ type: 'initialize', token: 'A'.repeat(43) });
  await harness.send({ type: 'start' });
  await harness.runActiveTimeout();
  assert.equal(harness.fetchCalls[0].options.signal.aborted, true);
  assert.equal(harness.messages.at(-1).type, 'error');
  await harness.runActiveTimer();
  harness.pending[0]({ state: 'ended', routeVersion: 1 });
  await settle();
  assert.equal(harness.messages.at(-1).data.routeVersion, 2);
  await harness.runActiveTimer();
  assert.equal(JSON.parse(harness.fetchCalls[2].options.body).routeVersion, 2);
});

test('ignores an old response after a stop and resume, including its route version', async () => {
  const harness = createHarness([{ deferred: true }, { state: 'active', routeVersion: 8, routePoints }, { state: 'active' }]);
  await harness.send({ type: 'initialize', token: 'A'.repeat(43) });
  await harness.send({ type: 'start' });
  await harness.send({ type: 'stop' });
  await harness.send({ type: 'start' });
  harness.pending[0]({ state: 'active', routeVersion: 7 });
  await settle();
  assert.equal(harness.messages.filter(message => message.type === 'state').length, 1);
  assert.equal(harness.messages.at(-1).data.routeVersion, 8);
  await harness.runActiveTimer();
  assert.equal(JSON.parse(harness.fetchCalls[2].options.body).routeVersion, 8);
});

test('treats server errors, throttling, and malformed state as recoverable errors', async () => {
  const harness = createHarness([
    { httpStatus: 500, body: { error: 'internal error' } },
    { httpStatus: 503, body: { state: 'ended' } },
    { httpStatus: 429, body: { state: 'delayed' } },
    { error: 'unknown' }, [], null,
    { state: 'active' },
  ]);
  await harness.send({ type: 'initialize', token: 'A'.repeat(43) });
  await harness.send({ type: 'start' });
  for (let i = 0; i < 5; i++) await harness.runActiveTimer();
  assert.equal(harness.messages.filter(message => message.type === 'error').length, 6);
  assert.equal(harness.messages.filter(message => message.type === 'state').length, 0);
  await harness.runActiveTimer();
  assert.equal(harness.messages.at(-1).data.state, 'active');
});

test('preserves explicit terminal envelopes on documented rejection statuses', async () => {
  const harness = createHarness([400, 403, 404].map(httpStatus => ({ httpStatus, body: { state: 'ended' } })));
  await harness.send({ type: 'initialize', token: 'A'.repeat(43) });
  await harness.send({ type: 'start' });
  await harness.runActiveTimer();
  await harness.runActiveTimer();
  assert.equal(harness.messages.filter(message => message.type === 'state' && message.data.state === 'ended').length, 3);
});

test('keeps independent recipients and their route versions isolated', async () => {
  const first = createHarness([{ state: 'active', routeVersion: 'first', routePoints }, { state: 'active' }]);
  const second = createHarness([{ state: 'active', routeVersion: 'second', routePoints }, { state: 'active' }]);
  await first.send({ type: 'initialize', token: 'A'.repeat(43) });
  await second.send({ type: 'initialize', token: 'B'.repeat(43) });
  await first.send({ type: 'start' });
  await second.send({ type: 'start' });
  await first.send({ type: 'stop' });
  await second.runActiveTimer();
  await first.send({ type: 'start' });
  assert.deepEqual(JSON.parse(first.fetchCalls[1].options.body), { token: 'A'.repeat(43), routeVersion: 'first' });
  assert.deepEqual(JSON.parse(second.fetchCalls[1].options.body), { token: 'B'.repeat(43), routeVersion: 'second' });
});

test('clears its known version so an identical route can be fetched after geometry disappears', async () => {
  const harness = createHarness([
    { state: 'active', routeVersion: 'route-a', routePoints },
    { state: 'active', routeVersion: '', routePoints: [] },
    { state: 'active', routeVersion: 'route-a', routePoints },
  ]);
  await harness.send({ type: 'initialize', token: 'A'.repeat(43) });
  await harness.send({ type: 'start' });
  await harness.runActiveTimer();
  await harness.runActiveTimer();
  assert.equal(JSON.parse(harness.fetchCalls[1].options.body).routeVersion, 'route-a');
  assert.equal(JSON.parse(harness.fetchCalls[2].options.body).routeVersion, undefined);
  assert.deepEqual(harness.messages.at(-1).data.routePoints, routePoints);
});

test('retains only versions whose geometry was actually received', async () => {
  const harness = createHarness([
    { state: 'active', routeVersion: 'route-a', routePoints },
    { state: 'active', routeVersion: 'route-a' },
    { state: 'delayed' },
    { state: 'active', routeVersion: 'route-b' },
    { state: 'active', routeVersion: 'route-b', routePoints },
  ]);
  await harness.send({ type: 'initialize', token: 'A'.repeat(43) });
  await harness.send({ type: 'start' });
  for (let i = 0; i < 4; i++) await harness.runActiveTimer();
  assert.deepEqual(harness.fetchCalls.map(call => JSON.parse(call.options.body).routeVersion),
    [undefined, 'route-a', 'route-a', 'route-a', undefined]);
});
