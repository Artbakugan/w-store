const { describe, it } = require('node:test');
const assert = require('node:assert');
const { ItemService } = require('../service/itemService');

// Мок-репозиторій у пам'яті (щоб юніт-тести не чіпали реальну базу SQLite)
class InMemoryItemRepository {
  constructor() {
    this.items = [];
    this.nextId = 1;
  }

  async findAll() {
    return this.items;
  }

  async findById(id) {
    return this.items.find((item) => item.id === id) || null;
  }

  async create(product) {
    const saved = {
      id: this.nextId++,
      name: product.name,
      price: product.price,
      stockQuantity: product.stockQuantity,
    };
    this.items.push(saved);
    return saved;
  }

  async update(id, product) {
    const index = this.items.findIndex((item) => item.id === id);
    if (index === -1) return null;
    this.items[index] = {
      id,
      name: product.name,
      price: product.price,
      stockQuantity: product.stockQuantity,
    };
    return this.items[index];
  }

  async delete(id) {
    const index = this.items.findIndex((item) => item.id === id);
    if (index === -1) return false;
    this.items.splice(index, 1);
    return true;
  }
}

describe('ItemService Unit Tests', () => {
  it('1. Успішне створення валідного товару (201)', async () => {
    const repo = new InMemoryItemRepository();
    const service = new ItemService(repo);

    const created = await service.createItem({
      name: 'Гантелі розбірні 20 кг',
      price: 1850,
      stockQuantity: 10,
    });

    assert.strictEqual(created.id, 1);
    assert.strictEqual(created.name, 'Гантелі розбірні 20 кг');
    assert.strictEqual(created.price, 1850);
    assert.strictEqual(created.stockQuantity, 10);
  });

  it('2. Помилка валідації при порожній назві або від’ємній ціні (400)', async () => {
    const repo = new InMemoryItemRepository();
    const service = new ItemService(repo);

    await assert.rejects(
      async () => {
        await service.createItem({
          name: '   ',
          price: -100,
          stockQuantity: 5,
        });
      },
      (err) => {
        assert.strictEqual(err.status, 400);
        assert.strictEqual(err.code, 'INVALID_INPUT');
        assert.strictEqual(err.details.length, 2);
        return true;
      }
    );
  });
});