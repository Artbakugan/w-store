const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createResilientClient, createDegradedMode } = require('../../frontend/resilience');

function client(responses, overrides = {}) {
  const attempts = [];
  const delays = [];
  const request = createResilientClient({
    fetchRequest: async (_url, { headers }) => {
      attempts.push(Object.fromEntries(headers));
      const response = responses.shift();
      if (response instanceof Error) throw response;
      return response;
    },
    newRequestId: () => `request-${attempts.length + 1}`,
    sleep: async (ms) => { delays.push(ms); },
    random: () => 0.5,
    ...overrides,
  });
  return { request, attempts, delays };
}

const ok = () => new Response('{"id":1}', { headers: { 'X-Request-Id': 'server-id' } });

for (const status of [429, 500, 501, 502, 503, 504, 507, 599]) {
  test(`HTTP ${status} retries with jitter and preserves the POST key`, async () => {
    const { request, attempts, delays } = client([
      new Response('<html>gateway error</html>', { status }),
      new Response(null, { status }),
      ok(),
    ]);
    const result = await request('/items', {
      method: 'POST',
      headers: { 'Idempotency-Key': 'same-operation' },
    });

    assert.deepEqual(result, { data: { id: 1 }, requestId: 'server-id' });
    assert.deepEqual(delays, [300, 550]);
    assert.deepEqual(attempts.map((headers) => headers['x-request-id']),
      ['request-1', 'request-2', 'request-3']);
    assert.ok(attempts.every((headers) => headers['idempotency-key'] === 'same-operation'));
  });
}

test('Retry-After accepts both seconds and an HTTP date', async () => {
  const currentTime = Date.parse('Sun, 22 Nov 2026 12:00:00 GMT');
  const { request, delays } = client([
    new Response(null, { status: 429, headers: { 'Retry-After': '2' } }),
    new Response(null, { status: 503, headers: { 'Retry-After': 'Sun, 22 Nov 2026 12:00:03 GMT' } }),
    ok(),
  ], { now: () => currentTime });
  await request('/items');
  assert.deepEqual(delays, [2050, 3050]);
});

test('validation and unkeyed writes are not retried', async () => {
  const { request, attempts, delays } = client([
    new Response(JSON.stringify({
      error: 'ValidationError',
      code: 'INVALID_INPUT',
      details: [{ field: 'name', message: 'Required' }],
      requestId: 'server-error-id',
    }), { status: 400, headers: { 'X-Request-Id': 'server-error-id' } }),
    new Response(null, { status: 500 }),
  ]);
  await assert.rejects(request('/items'), {
    status: 400,
    code: 'INVALID_INPUT',
    requestId: 'server-error-id',
    details: [{ field: 'name', message: 'Required' }],
    transient: false,
  });
  await assert.rejects(request('/items', { method: 'POST' }), { status: 500, transient: true });
  assert.equal(attempts.length, 2);
  assert.deepEqual(delays, []);
});

test('network errors retry twice and return the last request ID', async () => {
  const { request, attempts, delays } = client(Array.from({ length: 3 }, () => new TypeError('offline')));
  await assert.rejects(request('/items'), {
    code: 'NETWORK_ERROR', requestId: 'request-3', transient: true,
  });
  assert.equal(attempts.length, 3);
  assert.deepEqual(delays, [300, 550]);
});

test('the 1000 ms deadline also aborts a response with a stalled body', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let signal;
  const request = createResilientClient({
    fetchRequest: async (_url, options) => {
      signal = options.signal;
      return {
        headers: new Headers({ 'X-Request-Id': 'body-request' }),
        text: () => new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        }),
      };
    },
  });
  const rejection = assert.rejects(request('/items', { method: 'POST' }), {
    code: 'TIMEOUT', requestId: 'body-request', transient: true,
  });
  await Promise.resolve();
  t.mock.timers.tick(999);
  assert.equal(signal.aborted, false);
  t.mock.timers.tick(1);
  assert.equal(signal.aborted, true);
  await rejection;
});

test('Degraded Mode counts failed operations consecutively and unlocks once after 5 seconds', () => {
  const changes = [];
  const timers = [];
  const mode = createDegradedMode((active) => changes.push(active), (callback, delay) => {
    timers.push({ callback, delay });
  });
  mode.record(true);
  mode.record(true);
  mode.record(false);
  mode.record(true);
  mode.record(true);
  assert.equal(mode.active, false);

  mode.record(true);
  assert.equal(mode.active, true);
  assert.deepEqual(changes, [true]);
  mode.record(true);
  mode.record(false);
  assert.equal(timers.length, 1);
  assert.equal(timers[0].delay, 5000);

  timers[0].callback();
  assert.equal(mode.active, false);
  assert.deepEqual(changes, [true, false]);
  mode.record(true);
  assert.equal(mode.active, false);
});

test('Retry-After interprets legacy HTTP dates as UTC', async () => {
  const currentTime = Date.UTC(2026, 10, 22, 12, 0, 0);
  const { request, delays } = client([
    new Response(null, { status: 429, headers: { 'Retry-After': 'Sunday, 22-Nov-26 12:00:02 GMT' } }),
    new Response(null, { status: 507, headers: { 'Retry-After': 'Sun Nov 22 12:00:03 2026' } }),
    ok(),
  ], { now: () => currentTime });
  await request('/items');
  assert.deepEqual(delays, [2050, 3050]);
});

test('Retry-After falls back to backoff on malformed or past values', async () => {
  const { request, delays } = client([
    new Response(null, { status: 429, headers: { 'Retry-After': '22 Nov 2099' } }),
    new Response(null, { status: 503, headers: { 'Retry-After': 'Sat, 21 Nov 2026 12:00:00 GMT' } }),
    ok(),
  ], { now: () => Date.UTC(2026, 10, 22, 12, 0, 0) });
  await request('/items');
  assert.deepEqual(delays, [300, 550]);
});
