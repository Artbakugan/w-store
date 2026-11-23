const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { Pool } = require('pg');
const { openPostgresDatabase } = require('../postgresDatabase');
const { PostgresItemRepository } = require('../service/postgresItemRepository');
const { ItemService } = require('../service/itemService');

test('PostgreSQL preserves atomic writes and replay across restart, update and deletion', {
  skip: process.env.W_STORE_TEST_POSTGRES !== '1',
}, async () => {
  const schema = `lab6_test_${randomBytes(8).toString('hex')}`;
  const admin = new Pool({ connectionTimeoutMillis: 2500 });
  const config = { options: `-c search_path=${schema}` };
  const product = { name: 'PostgreSQL integration test', price: 19.95, stockQuantity: 4 };
  let pool;

  try {
    await admin.query(`CREATE SCHEMA ${schema}`);
    pool = await openPostgresDatabase(config);
    let service = new ItemService(new PostgresItemRepository(pool));
    assert.equal((await service.getAllItems()).length, 5);

    const results = await Promise.all(
      Array.from({ length: 12 }, () => service.createItem(product, 'shared-key'))
    );
    const [item] = results;
    assert.deepEqual(item, { id: 6, ...product });
    assert.ok(results.every(({ id }) => id === item.id));
    assert.equal((await service.getAllItems()).length, 6);
    await assert.rejects(service.createItem({ ...product, price: 99 }, 'shared-key'), {
      status: 409,
      code: 'IDEMPOTENCY_KEY_CONFLICT',
    });

    await pool.query("ALTER TABLE item_idempotency ADD CONSTRAINT reject_key CHECK (key <> 'blocked')");
    await assert.rejects(service.createItem(product, 'blocked'), { code: '23514' });
    assert.equal((await service.getAllItems()).length, 6);
    await pool.query('ALTER TABLE item_idempotency DROP CONSTRAINT reject_key');
    const retriedItem = await service.createItem(product, 'blocked');

    await pool.end();
    pool = undefined;
    pool = await openPostgresDatabase(config);
    service = new ItemService(new PostgresItemRepository(pool));
    assert.equal((await service.getAllItems()).length, 7);
    assert.deepEqual(await service.getItemById(item.id), item);
    assert.deepEqual(await service.getItemById(retriedItem.id), retriedItem);

    const updated = { ...item, stockQuantity: 8 };
    assert.deepEqual(await service.updateItem(item.id, updated), updated);
    await service.deleteItem(item.id);
    await assert.rejects(service.getItemById(item.id), { status: 404 });
    await assert.rejects(service.getItemById(Number.MAX_SAFE_INTEGER), { status: 404 });
    assert.deepEqual(await service.createItem(product, 'shared-key'), item);
    assert.equal((await service.getAllItems()).length, 6);
  } finally {
    try {
      if (pool) await pool.end();
      await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    } finally {
      await admin.end();
    }
  }
});
