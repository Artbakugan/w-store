const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.resolve(__dirname, 'database.sqlite');
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL
  )`);

  db.get("SELECT COUNT(*) AS count FROM items", (err, row) => {
    if (err) {
      console.error("Помилка читання з БД:", err.message);
      return;
    }

    if (row.count === 0) {
      const stmt = db.prepare("INSERT INTO items (name) VALUES (?)");
      stmt.run("Кросівки W-Run Pro");
      stmt.run("Спортивний костюм W-Performance");
      stmt.run("Шорти для тренувань W-Fit");
      stmt.run("Гантелі збірні 10 кг W-Gear");
      stmt.run("Футбольний м'яч W-Match");
      stmt.finalize();
      console.log("Тестові товари W Store успішно додані в БД!");
    }
  });
});

module.exports = db;