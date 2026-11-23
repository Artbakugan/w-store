const { Pool } = require('pg');

async function withTransaction(pool, operation) {
  const client = await pool.connect();
  let discardClient;
  try {
    await client.query('BEGIN');
    const result = await operation(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      discardClient = rollbackError;
    }
    throw error;
  } finally {
    client.release(discardClient);
  }
}

async function openPostgresDatabase(config) {
  const pool = new Pool({ connectionTimeoutMillis: 2500, ...config });
  pool.on('error', (error) => console.error('Помилка підключення PostgreSQL:', error.message));

  try {
    await withTransaction(pool, async (client) => {
      // Startup can run in several API processes against the same database.
      await client.query('SELECT pg_advisory_xact_lock(65193, 1)');
      const { rows: [{ is_new: isNew }] } = await client.query(
        "SELECT to_regclass('items') IS NULL AS is_new"
      );

      await client.query(`
        CREATE TABLE IF NOT EXISTS items (
          id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
          name TEXT NOT NULL,
          price DOUBLE PRECISION NOT NULL DEFAULT 0,
          stock_quantity DOUBLE PRECISION NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS item_idempotency (
          key TEXT PRIMARY KEY,
          item_id BIGINT NOT NULL,
          name TEXT NOT NULL,
          price DOUBLE PRECISION NOT NULL,
          stock_quantity DOUBLE PRECISION NOT NULL
        );
      `);

      if (isNew) {
        await client.query(`
          INSERT INTO items (name) VALUES
            ('Кросівки W-Run Pro'),
            ('Спортивний костюм W-Performance'),
            ('Шорти для тренувань W-Fit'),
            ('Гантелі збірні 10 кг W-Gear'),
            ('Футбольний м''яч W-Match');
        `);
      }
    });
    return pool;
  } catch (error) {
    await pool.end();
    throw error;
  }
}

module.exports = { openPostgresDatabase, withTransaction };
