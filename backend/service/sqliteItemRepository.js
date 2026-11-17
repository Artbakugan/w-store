class SqliteItemRepository {
  constructor(db) {
    this.db = db;
  }

  findAll() {
    return new Promise((resolve, reject) => {
      this.db.all('SELECT id, name, price, stockQuantity FROM items', [], (err, rows) => {
        if (err) return reject(err);
        resolve(rows);
      });
    });
  }

  findById(id) {
    return new Promise((resolve, reject) => {
      this.db.get('SELECT id, name, price, stockQuantity FROM items WHERE id = ?', [id], (err, row) => {
        if (err) return reject(err);
        resolve(row || null);
      });
    });
  }

  create(product) {
    return new Promise((resolve, reject) => {
      const sql = 'INSERT INTO items (name, price, stockQuantity) VALUES (?, ?, ?)';
      this.db.run(sql, [product.name, product.price, product.stockQuantity], function (err) {
        if (err) return reject(err);
        resolve({
          id: this.lastID,
          name: product.name,
          price: product.price,
          stockQuantity: product.stockQuantity,
        });
      });
    });
  }

  update(id, product) {
    return new Promise((resolve, reject) => {
      const sql = 'UPDATE items SET name = ?, price = ?, stockQuantity = ? WHERE id = ?';
      this.db.run(sql, [product.name, product.price, product.stockQuantity, id], function (err) {
        if (err) return reject(err);
        if (this.changes === 0) return resolve(null);
        resolve({
          id,
          name: product.name,
          price: product.price,
          stockQuantity: product.stockQuantity,
        });
      });
    });
  }

  delete(id) {
    return new Promise((resolve, reject) => {
      this.db.run('DELETE FROM items WHERE id = ?', [id], function (err) {
        if (err) return reject(err);
        resolve(this.changes > 0);
      });
    });
  }
}

module.exports = { SqliteItemRepository };