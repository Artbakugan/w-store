const { withTransaction } = require('../postgresDatabase');

const itemFields = 'id::double precision AS id, name, price, stock_quantity AS "stockQuantity"';

class PostgresItemRepository {
  constructor(pool) {
    this.pool = pool;
  }

  async findAll() {
    const { rows } = await this.pool.query(`SELECT ${itemFields} FROM items ORDER BY id`);
    return rows;
  }

  async findById(id) {
    const { rows } = await this.pool.query(`SELECT ${itemFields} FROM items WHERE id = $1`, [id]);
    return rows[0] ?? null;
  }

  async create(product, db = this.pool) {
    const { rows } = await db.query(
      `INSERT INTO items (name, price, stock_quantity) VALUES ($1, $2, $3) RETURNING ${itemFields}`,
      [product.name, product.price, product.stockQuantity]
    );
    return rows[0];
  }

  createIdempotent(key, product) {
    return withTransaction(this.pool, async (client) => {
      // The lock serializes requests for the same key across API processes.
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [key]);
      const { rows } = await client.query(
        `SELECT item_id::double precision AS id, name, price, stock_quantity AS "stockQuantity"
         FROM item_idempotency WHERE key = $1`,
        [key]
      );
      if (rows.length) return rows[0];

      const item = await this.create(product, client);
      await client.query(
        'INSERT INTO item_idempotency (key, item_id, name, price, stock_quantity) VALUES ($1, $2, $3, $4, $5)',
        [key, item.id, item.name, item.price, item.stockQuantity]
      );
      return item;
    });
  }

  async update(id, product) {
    const { rows } = await this.pool.query(
      `UPDATE items SET name = $1, price = $2, stock_quantity = $3 WHERE id = $4 RETURNING ${itemFields}`,
      [product.name, product.price, product.stockQuantity, id]
    );
    return rows[0] ?? null;
  }

  async delete(id) {
    const { rowCount } = await this.pool.query('DELETE FROM items WHERE id = $1', [id]);
    return rowCount > 0;
  }
}

module.exports = { PostgresItemRepository };
