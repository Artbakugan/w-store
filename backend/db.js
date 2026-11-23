const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const databasePath = path.join(__dirname, 'database.sqlite');

function run(db, sql) {
  return new Promise((resolve, reject) => {
    db.exec(sql, (err) => err ? reject(err) : resolve());
  });
}

function getItemColumns(db) {
  return new Promise((resolve, reject) => {
    db.all('PRAGMA table_info(items)', (err, rows) => {
      if (err) return reject(err);
      resolve(new Set(rows.map(({ name }) => name)));
    });
  });
}

async function openDatabase(filename = databasePath, { seed = true } = {}) {
  const db = new sqlite3.Database(filename);
  db.configure('busyTimeout', 5000);
  // Queue operations per connection so waiting SQLite writes do not occupy the worker pool.
  db.serialize();

  let transactionOpen = false;
  try {
    await run(db, 'BEGIN IMMEDIATE');
    transactionOpen = true;
    await run(db, `CREATE TABLE IF NOT EXISTS items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      price REAL NOT NULL DEFAULT 0,
      stockQuantity INTEGER NOT NULL DEFAULT 0
    )`);

    const columns = await getItemColumns(db);
    if (!columns.has('price')) {
      await run(db, 'ALTER TABLE items ADD COLUMN price REAL NOT NULL DEFAULT 0');
    }
    if (!columns.has('stockQuantity')) {
      await run(db, 'ALTER TABLE items ADD COLUMN stockQuantity INTEGER NOT NULL DEFAULT 0');
    }

    // SQLite commits the item and its replay snapshot in the same statement.
    await run(db, `
      CREATE TABLE IF NOT EXISTS item_idempotency (
        key TEXT PRIMARY KEY NOT NULL,
        itemId INTEGER,
        name TEXT NOT NULL,
        price REAL NOT NULL,
        stockQuantity INTEGER NOT NULL
      );

      CREATE TRIGGER IF NOT EXISTS create_idempotent_item
      AFTER INSERT ON item_idempotency
      BEGIN
        INSERT INTO items (name, price, stockQuantity)
          VALUES (NEW.name, NEW.price, NEW.stockQuantity);
        UPDATE item_idempotency SET itemId = last_insert_rowid() WHERE key = NEW.key;
      END;
    `);

    if (seed) {
      await run(db, `
        WITH defaults(name) AS (VALUES
          ('Кросівки W-Run Pro'),
          ('Спортивний костюм W-Performance'),
          ('Шорти для тренувань W-Fit'),
          ('Гантелі збірні 10 кг W-Gear'),
          ('Футбольний м''яч W-Match')
        )
        INSERT INTO items (name)
          SELECT name FROM defaults WHERE NOT EXISTS (SELECT 1 FROM items);
      `);
    }

    await run(db, 'COMMIT');
    return db;
  } catch (err) {
    if (transactionOpen) await run(db, 'ROLLBACK').catch(() => {});
    db.close();
    throw err;
  }
}

module.exports = { openDatabase };
