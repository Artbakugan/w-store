const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { mkdtemp, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const sqlite3 = require('sqlite3');
const { openDatabase } = require('../db');
const { createApp } = require('../server');
const { createResilientClient } = require('../../frontend/resilience');

const payload = { name: 'Тестовий товар', price: 125, stockQuantity: 3 };

function exec(db, sql) {
  return new Promise((resolve, reject) => db.exec(sql, (err) => err ? reject(err) : resolve()));
}

function closeDb(db) {
  return new Promise((resolve, reject) => db.close((err) => err ? reject(err) : resolve()));
}

async function startServer(t, db, options) {
  const server = createApp(db, options).listen(0, '127.0.0.1');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  return (path, options) => fetch(base + path, options);
}

async function fixture(t, options) {
  const db = await openDatabase(':memory:', { seed: false });
  const request = await startServer(t, db, options);
  t.after(() => closeDb(db));
  return { db, request };
}

function post(request, key, data = payload, extraHeaders = {}) {
  const headers = { 'Content-Type': 'application/json', ...extraHeaders };
  if (key !== undefined) headers['Idempotency-Key'] = key;
  return request('/items', { method: 'POST', headers, body: JSON.stringify(data) });
}

async function expectError(response, status, code) {
  assert.equal(response.status, status);
  const body = await response.json();
  assert.deepEqual(Object.keys(body).sort(), ['code', 'details', 'error', 'requestId']);
  assert.equal(body.code, code);
  assert.ok(Array.isArray(body.details));
  assert.ok(response.headers.get('X-Request-Id'));
  assert.equal(body.requestId, response.headers.get('X-Request-Id'));
  return body;
}

test('legacy schema migration, parallel POST across connections, persistent replay and CRUD', async (t) => {
  const folder = await mkdtemp(join(tmpdir(), 'w-store-test-'));
  const filename = join(folder, 'legacy.sqlite');
  try {
    const legacy = new sqlite3.Database(filename);
    try {
      await exec(legacy, `
        CREATE TABLE items (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL);
        INSERT INTO items (name) VALUES ('Legacy item');
      `);
    } finally {
      await closeDb(legacy);
    }

    await t.test('two connections racing on the same key create only one item', async (t) => {
      const connections = await Promise.all([
        openDatabase(filename, { seed: false }),
        openDatabase(filename, { seed: false }),
      ]);
      const [left, right] = await Promise.all(
        connections.map((db) => startServer(t, db, { rateLimit: { maxRequests: 30 } }))
      );
      t.after(() => Promise.all(connections.map(closeDb)));

      const responses = await Promise.all(Array.from({ length: 12 }, (_, index) =>
        post(index % 2 ? left : right, 'shared-key', payload, { 'X-Request-Id': `parallel-${index}` })
      ));
      const ids = await Promise.all(responses.map(async (response, index) => {
        assert.equal(response.status, 201);
        assert.equal(response.headers.get('X-Request-Id'), `parallel-${index}`);
        const item = await response.json();
        assert.equal(item.requestId, `parallel-${index}`);
        return item.id;
      }));
      assert.deepEqual(new Set(ids), new Set([2]));
      const list = await (await left('/items')).json();
      assert.deepEqual(list, [
        { id: 1, name: 'Legacy item', price: 0, stockQuantity: 0 },
        { id: 2, ...payload },
      ]);
      await expectError(await post(right, 'shared-key', { ...payload, price: 250 }),
        409, 'IDEMPOTENCY_KEY_CONFLICT');

      const conflicts = await Promise.all([
        post(left, 'racing-payloads', payload),
        post(right, 'racing-payloads', { ...payload, price: 250 }),
      ]);
      const conflict = conflicts.find((response) => response.status === 409);
      await expectError(conflict, 409, 'IDEMPOTENCY_KEY_CONFLICT');
      const winner = conflicts.find((response) => response.status === 201);
      assert.equal((await winner.json()).id, 3);
      assert.equal((await (await right('/items')).json()).length, 3);
    });

    await t.test('restart retains the original 201 snapshot even after update and deletion', async (t) => {
      const db = await openDatabase(filename, { seed: false });
      const request = await startServer(t, db);
      t.after(() => closeDb(db));

      const get = await request('/items/2');
      assert.equal(get.status, 200);
      assert.deepEqual(await get.json(), { id: 2, ...payload });

      const updated = { ...payload, price: 500 };
      const put = await request('/items/2', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updated),
      });
      assert.equal(put.status, 200);
      assert.deepEqual(await put.json(), { id: 2, ...updated });

      const removed = await request('/items/2', { method: 'DELETE' });
      assert.equal(removed.status, 204);
      assert.ok(removed.headers.get('X-Request-Id'));
      assert.equal(await removed.text(), '');

      const replay = await post(request, 'shared-key');
      assert.equal(replay.status, 201);
      const { requestId, ...item } = await replay.json();
      assert.equal(requestId, replay.headers.get('X-Request-Id'));
      assert.deepEqual(item, { id: 2, ...payload });
      await expectError(await request('/items/2'), 404, 'ITEM_NOT_FOUND');
      const fresh = await post(request, 'new-key');
      assert.equal(fresh.status, 201);
      assert.notEqual((await fresh.json()).id, 2);
    });
  } finally {
    await rm(folder, { recursive: true });
  }
});

test('consistent JSON errors, request correlation, CORS and independent health check', async (t) => {
  let now = 0;
  const { request } = await fixture(t, { rateLimit: { maxRequests: 6, now: () => now } });
  const options = await request('/items', {
    method: 'OPTIONS',
    headers: { Origin: 'http://localhost:8080', 'Access-Control-Request-Method': 'POST' },
  });
  assert.equal(options.status, 204);
  assert.ok(options.headers.get('X-Request-Id'));

  const invalidJson = await request('/items', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Request-Id': 'invalid-body' },
    body: '{',
  });
  assert.equal((await expectError(invalidJson, 400, 'INVALID_JSON')).requestId, 'invalid-body');
  await expectError(await post(request), 400, 'MISSING_IDEMPOTENCY_KEY');
  await expectError(await post(request, 'bad-data', { name: '', price: -5 }), 400, 'INVALID_INPUT');
  await expectError(await request('/items/NaN'), 400, 'INVALID_ID');
  await expectError(await request('/items/999'), 404, 'ITEM_NOT_FOUND');
  await expectError(await request('/missing'), 404, 'ROUTE_NOT_FOUND');

  now = 2400;
  assert.equal((await request('/items')).status, 200);
  const limited = await request('/items');
  assert.equal(limited.headers.get('Retry-After'), '8');
  assert.match(limited.headers.get('Access-Control-Expose-Headers'), /X-Request-Id,Retry-After/i);
  await expectError(limited, 429, 'RATE_LIMIT_EXCEEDED');
  const health = await request('/health');
  assert.equal(health.status, 200);
  assert.ok(health.headers.get('X-Request-Id'));
  assert.deepEqual(await health.json(), { status: 'ok' });

  now = 10_000;
  assert.equal((await request('/items')).status, 200);
});

test('SQLite errors roll back both the create and the idempotency key', async (t) => {
  t.mock.method(console, 'error', () => {});
  const { db, request } = await fixture(t);
  await exec(db, `
    CREATE TRIGGER test_fail_item BEFORE INSERT ON items
    BEGIN SELECT RAISE(ABORT, 'private diagnostics'); END;
  `);
  await expectError(await post(request, 'retry-sqlite'), 500, 'UNEXPECTED_ERROR');
  assert.deepEqual(await (await request('/items')).json(), []);

  await exec(db, 'DROP TRIGGER test_fail_item');
  const response = await post(request, 'retry-sqlite');
  assert.equal(response.status, 201);
  assert.equal((await response.json()).id, 1);
});

test('catalog assets are served and demo faults are opt-in', async (t) => {
  const { request } = await fixture(t);
  const catalog = await request('/catalog');
  assert.equal(catalog.status, 200);
  assert.ok(catalog.headers.get('X-Request-Id'));
  assert.match(await catalog.text(), /src="\.\/resilience\.js"/);
  const script = await request('/resilience.js');
  assert.equal(script.status, 200);
  assert.ok(script.headers.get('X-Request-Id'));
  assert.match(await script.text(), /function createResilientClient/);
  assert.equal((await request('/items', { headers: { 'X-Demo-Fault': '503' } })).status, 200);

  const demo = await fixture(t, { demoFaults: true });
  for (const [status, code] of [
    [429, 'RATE_LIMIT_EXCEEDED'], [500, 'UNEXPECTED_ERROR'], [502, 'BAD_GATEWAY'],
    [503, 'UNAVAILABLE'], [504, 'GATEWAY_TIMEOUT'],
  ]) {
    const result = await post(demo.request, 'demo', payload, { 'X-Demo-Fault': String(status) });
    if (status === 429 || status === 503) assert.equal(result.headers.get('Retry-After'), '1');
    await expectError(result, status, code);
  }
  assert.deepEqual(await (await demo.request('/items')).json(), []);
});

test('the browser client aborts the HTTP timeout demo and a fresh database has the catalog seed', async (t) => {
  const db = await openDatabase(':memory:');
  const request = await startServer(t, db, { demoFaults: true });
  t.after(() => closeDb(db));

  const client = createResilientClient({ fetchRequest: request, newRequestId: () => 'demo-timeout' });
  const initial = await client('/items');
  assert.equal(initial.data.length, 5);
  assert.ok(initial.data.every((item) => item.price === 0 && item.stockQuantity === 0));

  await assert.rejects(client('/items', {
    method: 'POST',
    headers: { 'X-Demo-Fault': 'timeout' },
  }), { code: 'TIMEOUT', requestId: 'demo-timeout', transient: true });
  const afterTimeout = await client('/items');
  assert.deepEqual(afterTimeout.data, initial.data);
});

test('the default limiter emits 429 and the client resumes when its window opens', async (t) => {
  let now = 0;
  const { request } = await fixture(t, { rateLimit: { now: () => now } });

  for (let index = 0; index < 8; index++) {
    const response = await request('/items', { headers: { 'X-Forwarded-For': `192.0.2.${index + 1}` } });
    assert.equal(response.status, 200);
    await response.json();
  }

  const attempts = [];
  const waits = [];
  const client = createResilientClient({
    fetchRequest: async (url, options) => {
      const response = await request(url, options);
      attempts.push({
        status: response.status,
        requestId: response.headers.get('X-Request-Id'),
        retryAfter: response.headers.get('Retry-After'),
      });
      return response;
    },
    now: () => now,
    random: () => 0,
    newRequestId: () => `rate-${attempts.length + 1}`,
    sleep: async (ms) => {
      waits.push(ms);
      now += ms;
    },
  });

  now = 8500;
  assert.deepEqual(await client('/items'), { data: [], requestId: 'rate-2' });
  assert.deepEqual(waits, [2000]);
  assert.deepEqual(attempts, [
    { status: 429, requestId: 'rate-1', retryAfter: '2' },
    { status: 200, requestId: 'rate-2', retryAfter: null },
  ]);
});

test('a keyed POST recovers from a lost reply after SQLite commits exactly one item', async (t) => {
  const { request } = await fixture(t);
  const attempts = [];
  const client = createResilientClient({
    fetchRequest: async (url, options) => {
      const response = await request(url, options);
      attempts.push({
        status: response.status,
        key: options.headers.get('Idempotency-Key'),
        requestId: response.headers.get('X-Request-Id'),
      });
      if (attempts.length === 1) {
        await response.text();
        throw new TypeError('Simulated connection loss after commit');
      }
      return response;
    },
    newRequestId: () => `write-${attempts.length + 1}`,
    sleep: async () => {},
  });

  const result = await client('/items', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'lost-reply' },
    body: JSON.stringify(payload),
  });
  assert.deepEqual(result.data, { id: 1, ...payload, requestId: 'write-2' });
  assert.deepEqual(attempts, [
    { status: 201, key: 'lost-reply', requestId: 'write-1' },
    { status: 201, key: 'lost-reply', requestId: 'write-2' },
  ]);
  assert.deepEqual(await (await request('/items')).json(), [{ id: 1, ...payload }]);
});
